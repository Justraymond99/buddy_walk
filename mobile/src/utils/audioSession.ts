import { AppState } from 'react-native';
import { Audio, AudioMode, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

type Mode = 'playback' | 'recording';

const PLAYBACK_MODE: Partial<AudioMode> = {
  allowsRecordingIOS: false,
  playsInSilentModeIOS: true,
  staysActiveInBackground: false,
  interruptionModeIOS: InterruptionModeIOS.DoNotMix,
  interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
  shouldDuckAndroid: false,
  playThroughEarpieceAndroid: false,
};

const RECORDING_MODE: Partial<AudioMode> = {
  ...PLAYBACK_MODE,
  allowsRecordingIOS: true,
};

// Serialize audio-mode changes. iOS throws OSStatus 561017449 when the session
// is reconfigured while another change is still settling, so we chain calls and
// never run two at once.
let chain: Promise<void> = Promise.resolve();
let lastApplied: Mode | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyMode(mode: Mode): Promise<void> {
  if (AppState.currentState !== 'active') return;
  // Skip redundant switches — re-applying the same mode is what most often
  // trips the "session busy" error and it buys us nothing.
  if (mode === lastApplied) return;

  const config = mode === 'recording' ? RECORDING_MODE : PLAYBACK_MODE;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await Audio.setAudioModeAsync(config);
      lastApplied = mode;
      return;
    } catch (e) {
      // The session is often busy for only a moment (e.g. a recording is still
      // tearing down). Wait briefly and try once more before giving up quietly.
      if (attempt === 0) {
        await sleep(150);
        continue;
      }
      console.warn(`audioSession: could not switch to ${mode} mode:`, e);
    }
  }
}

function enqueue(mode: Mode): Promise<void> {
  chain = chain.then(() => applyMode(mode)).catch(() => {});
  return chain;
}

/** Switch from mic recording to TTS playback (fixes silent AI answers after Tap to Ask). */
export function resetAudioForPlayback(): Promise<void> {
  return enqueue('playback');
}

export function prepareAudioForRecording(): Promise<void> {
  // Recording mode must always be (re)applied right before capture, even if it
  // was the last mode set, so the OS re-activates the input route.
  lastApplied = null;
  return enqueue('recording');
}
