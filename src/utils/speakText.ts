import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system/legacy';

import { sendAudioRequest } from '../api/openAi';
import { resetAudioForPlayback } from './audioSession';

const MAX_TTS_CHARS = 800;
const isWeb = Platform.OS === 'web';

let activeSound: Audio.Sound | null = null;
/** Bumps when a new speak starts or stopSpeaking() runs — stale async work exits early. */
let speakGeneration = 0;

function stopDeviceSpeech(): void {
  if (isWeb && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    return;
  }
  Speech.stop();
}

async function stopPlayback(): Promise<void> {
  if (!activeSound) return;
  const sound = activeSound;
  activeSound = null;
  try {
    sound.setOnPlaybackStatusUpdate(null);
    await sound.stopAsync();
    await sound.unloadAsync();
  } catch {
    /* ignore */
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function playMp3Buffer(buffer: ArrayBuffer, generation: number): Promise<boolean> {
  if (generation !== speakGeneration) return false;

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) return false;

  const uri = `${cacheDir}tts-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(uri, arrayBufferToBase64(buffer), {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (generation !== speakGeneration) return false;

  await stopPlayback();

  const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1.0 });
  activeSound = sound;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      sound.setOnPlaybackStatusUpdate(null);
      if (activeSound === sound) activeSound = null;
      void sound.unloadAsync().catch(() => undefined);
      resolve();
    };

    const timeout = setTimeout(finish, 120_000);
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded || settled) return;
      if (status.didJustFinish) finish();
      if ('error' in status && status.error) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(String(status.error)));
      }
    });
  });

  return generation === speakGeneration;
}

function speakWithWebSpeech(text: string, generation: number): Promise<void> {
  return new Promise((resolve) => {
    if (generation !== speakGeneration) {
      resolve();
      return;
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.onend = () => {
      if (generation === speakGeneration) resolve();
    };
    utterance.onerror = () => resolve();
    // iOS Safari can leave synthesis paused after mic capture.
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  });
}

function speakWithExpoSpeech(text: string, generation: number): Promise<void> {
  if (isWeb) return speakWithWebSpeech(text, generation);
  return new Promise((resolve) => {
    if (generation !== speakGeneration) {
      resolve();
      return;
    }
    Speech.speak(text, {
      language: 'en-US',
      rate: 1.0,
      onDone: () => {
        if (generation === speakGeneration) resolve();
      },
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}

/** True if server MP3 or device TTS is currently playing. */
export async function isSpeaking(): Promise<boolean> {
  if (activeSound) {
    try {
      const status = await activeSound.getStatusAsync();
      if (status.isLoaded && status.isPlaying) return true;
    } catch {
      /* ignore */
    }
  }
  if (isWeb && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return window.speechSynthesis.speaking;
  }
  try {
    return await Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}

/**
 * Speak text aloud once: server MP3 first (reliable after mic recording), then device TTS.
 * New calls cancel any in-progress speech.
 * Use preferDevice for long AI answers — starts talking immediately without waiting on /api/audio.
 */
export async function speakText(text: string, options?: { preferDevice?: boolean }): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const generation = ++speakGeneration;
  stopDeviceSpeech();
  await stopPlayback();
  if (generation !== speakGeneration) return;

  await resetAudioForPlayback();
  if (generation !== speakGeneration) return;

  if (options?.preferDevice) {
    await speakWithExpoSpeech(trimmed, generation);
    return;
  }

  const forAudio =
    trimmed.length > MAX_TTS_CHARS ? `${trimmed.slice(0, MAX_TTS_CHARS)}…` : trimmed;

  try {
    const mp3 = await sendAudioRequest(forAudio);
    if (generation !== speakGeneration) return;
    if (mp3 && mp3.byteLength > 0) {
      const played = await playMp3Buffer(mp3, generation);
      if (played && generation === speakGeneration) return;
    }
  } catch (e) {
    console.warn('speakText: backend audio failed, using expo-speech', e);
  }

  if (generation !== speakGeneration) return;
  await speakWithExpoSpeech(trimmed, generation);
}

export async function stopSpeaking(): Promise<void> {
  speakGeneration += 1;
  stopDeviceSpeech();
  await stopPlayback();
}
