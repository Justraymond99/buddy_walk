import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  AccessibilityInfo,
  Alert,
  Vibration,
  Animated,
  AppState,
} from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { Magnetometer, Accelerometer } from 'expo-sensors';
import * as Network from 'expo-network';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

import CallAccessARideButton from '../components/CallAccessARideButton';
import FeedbackModal from '../components/FeedbackModal';
import AnswerFeedback from '../components/AnswerFeedback';
import { sendTextRequest } from '../api/openAi';
import { fetchMtaArrivals } from '../api/mta';
import { createChatLog, addChatToChatLog } from '../api/chatLog';
import { track, Events } from '../api/telemetry';
import { classifyFeature, createRequestId } from '../utils/telemetryFeature';
import {
  buildTrainQuestionWithLiveData,
  extractTrainLineFromText,
  isTrainArrivalQuestion,
} from '../utils/trainLine';
import { getToken } from '../api/token';
import { transcribeAudio } from '../api/transcribe';
import { useAuthSession } from '../navigation/authSession';
import { RequestData, CustomCoords, RootStackParamList, NavRoute } from '../types';
import { expandSavedAliases } from '../utils/savedPlaces';
import { tap, tapMedium, notifySuccess } from '../utils/haptics';
import { ensureMicrophonePermission } from '../utils/microphonePermission';
import { prepareAudioForRecording, resetAudioForPlayback } from '../utils/audioSession';
import { stopSpeaking, isSpeaking } from '../utils/speakText';
import { announce, isScreenReaderActive } from '../utils/announce';
import { rotateConversationId } from '../utils/conversationSession';
import { unlockWebAudioForPlayback, isSafariBrowser } from '../utils/webAudioUnlock';
import { extractVideoFrames } from '../utils/extractVideoFrames';
import { startWebFrameCapture, WebFrameSession } from '../utils/webFrameCapture';
import {
  contentTypeForWebBlob,
  startWebAudioCapture,
  WebAudioSession,
} from '../utils/webAudioCapture';
import {
  startWebSpeechRecognition,
  WebSpeechSession,
} from '../utils/webSpeechRecognition';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

const MIN_VIDEO_RECORD_MS = 900;
const MAX_VIDEO_DURATION_MS = 30000;
const MTA_LOOKUP_MS = 8000;
const LOCATION_WAIT_MS = 1000;
const SLOW_RESPONSE_HINT_MS = 4500;
const VIDEO_RECORDING_START_VIBRATION = [0, 120, 80, 120] as const;
const PHOTO_CAPTURED_VIBRATION = [0, 50] as const;
const NO_SPEECH_VIBRATION_PATTERN = [0, 180, 120, 180];
const NO_INTERNET_VIBRATION_PATTERN = [0, 250, 150, 250];
const SPEECH_CAPTURED_VIBRATION_PATTERN = [0, 80];

// Walking routes longer than this are almost always a bad geocode (e.g. a
// Brooklyn park that resolved out-of-state) and are never practical for our
// users. We refuse to surface them and suggest transit instead. Tune freely.
const MAX_WALKING_METERS = 12000; // ~7.5 miles

function routeTotalMeters(route: NavRoute | null | undefined): number {
  if (!route) return 0;
  const total = route.totalDistance?.value;
  if (typeof total === 'number' && total > 0) return total;
  return route.steps?.reduce((sum, s) => sum + (s.distance?.value ?? 0), 0) ?? 0;
}

function isUnreasonableWalk(route: NavRoute | null | undefined): boolean {
  return routeTotalMeters(route) > MAX_WALKING_METERS;
}

// Accelerometer magnitude is in G (~1.0 at rest). A normal walking gait peaks
// around 1.3–2.0 G, so a deliberate-shake threshold must sit well above that.
const SHAKE_THRESHOLD = 2.6;
const SHAKE_COOLDOWN_MS = 2000;
// A real shake produces several strong spikes back-to-back; requiring a second
// spike within this window rejects one-off jolts from footfalls.
const SHAKE_WINDOW_MS = 700;
const VOICE_INPUT_HINT = 'Shake the phone or tap this button to ask a question by voice.';

type RecordingMode = 'idle' | 'recording-video' | 'recording-voice';
type CaptureUiState = 'idle' | 'holding' | 'recording' | 'photo-ready' | 'video-ready';

function formatRecordingTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getCaptureUiState(
  recordingMode: RecordingMode,
  hasPhotoCapture: boolean,
  hasVideoCapture: boolean
): CaptureUiState {
  if (recordingMode === 'recording-video') return 'recording';
  if (hasVideoCapture) return 'video-ready';
  if (hasPhotoCapture) return 'photo-ready';
  return 'idle';
}

function captureStatusLabel(state: CaptureUiState): string {
  switch (state) {
    case 'holding':
      return 'Keep holding — video starting…';
    case 'recording':
      return 'Recording video — tap Stop Video';
    case 'photo-ready':
      return 'Photo captured — tap Retake to replace';
    case 'video-ready':
      return 'Video captured — tap Retake to replace';
    default:
      return 'Take Photo  ·  Record Video';
  }
}

type Props = NativeStackScreenProps<RootStackParamList, 'Main'>;

export default function MainScreen({ navigation }: Props) {
  const { signOut } = useAuthSession();
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedVideoUri, setCapturedVideoUri] = useState<string | null>(null);
  // Web only: frames sampled live from the camera preview during a "video"
  // hold, since browsers can't run expo-video-thumbnails after the fact.
  const [webVideoFrames, setWebVideoFrames] = useState<string[] | null>(null);
  const webFrameSessionRef = useRef<WebFrameSession | null>(null);
  const [userInput, setUserInput] = useState('');
  const [displayQuestion, setDisplayQuestion] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('idle');
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);

  const [currentChatId, setCurrentChatId] = useState('');
  const [currentMessageId, setCurrentMessageId] = useState('');
  const [feedbackVisible, setFeedbackVisible] = useState(false);

  const locationRef = useRef<Location.LocationObject | null>(null);
  const headingRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recDotOpacity = useRef(new Animated.Value(1)).current;
  const audioRecordingRef = useRef<Audio.Recording | null>(null);
  const voiceRecordingStartedAtRef = useRef<number | null>(null);
  const voiceTranscriptRef = useRef('');
  const webAudioSessionRef = useRef<WebAudioSession | null>(null);
  const webSpeechSessionRef = useRef<WebSpeechSession | null>(null);
  const userInputRef = useRef('');
  const azureTokenRef = useRef<{ token: string; region: string } | null>(null);
  const cameraReadyRef = useRef(false);
  const videoRecordStartedRef = useRef(false);
  const videoRecordingStartedAtRef = useRef<number | null>(null);
  // Snapshot of the question actually sent, so the chat log records it even
  // after userInput is cleared on submit.
  const submittedInputRef = useRef('');
  /** Only persist chat logs after a successful backend answer (not error placeholders). */
  const chatLogEligibleRef = useRef(false);
  // Fires a spoken "still working" cue if a response is taking a while.
  const slowResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOfflineRef = useRef(false);
  const lastShakeRef = useRef(0);
  const firstSpikeAtRef = useRef(0);
  const isListeningRef = useRef(false);
  const isTranscribingRef = useRef(false);
  const loadingRef = useRef(false);
  const recordingModeRef = useRef<RecordingMode>('idle');

  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  useEffect(() => { isTranscribingRef.current = isTranscribing; }, [isTranscribing]);
  useEffect(() => { userInputRef.current = userInput; }, [userInput]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { recordingModeRef.current = recordingMode; }, [recordingMode]);

  function clearRecordingTimer(): void {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecordingElapsedSec(0);
  }

  function beginRecordingFeedback(): void {
    setRecordingMode('recording-video');
    videoRecordingStartedAtRef.current = Date.now();
    clearRecordingTimer();
    recordingTimerRef.current = setInterval(() => {
      setRecordingElapsedSec((s) => s + 1);
    }, 1000);
    try {
      Vibration.vibrate([...VIDEO_RECORDING_START_VIBRATION]);
    } catch {
      // noop
    }
  }

  useEffect(() => {
    if (recordingMode !== 'recording-video') {
      recDotOpacity.setValue(1);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(recDotOpacity, { toValue: 0.25, duration: 550, useNativeDriver: true }),
        Animated.timing(recDotOpacity, { toValue: 1, duration: 550, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [recordingMode, recDotOpacity]);

  useEffect(() => {
    return () => {
      clearRecordingTimer();
    };
  }, []);
  // ─── Setup: location, compass, Azure token ───────────────────────────────

  useEffect(() => {
    void ensureMicrophonePermission();
    void requestCameraPermission();
    void resetAudioForPlayback();
    return () => {
      webFrameSessionRef.current?.stop();
      webFrameSessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let locationSub: Location.LocationSubscription | null = null;
    let magnetometerSub: ReturnType<typeof Magnetometer.addListener> | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        // Seed an immediate fix so the very first question already carries
        // coordinates — the watcher's first callback can lag by seconds,
        // especially in browsers.
        try {
          const first = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!locationRef.current) locationRef.current = first;
        } catch {
          // Watcher below may still succeed.
        }
        locationSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2 },
          (loc) => { locationRef.current = loc; }
        );
      }
    })();

    // The magnetometer doesn't exist on web — guard so the screen still mounts
    // (heading just stays at its default for browser testers).
    if (Platform.OS !== 'web') {
      try {
        Magnetometer.setUpdateInterval(500);
        magnetometerSub = Magnetometer.addListener(({ x, y }) => {
          let angle = Math.atan2(y, x) * (180 / Math.PI);
          headingRef.current = (angle + 360) % 360;
        });
      } catch (e) {
        console.warn('Magnetometer unavailable:', e);
      }
    }

    return () => {
      locationSub?.remove();
      magnetometerSub?.remove();
    };
  }, []);

  // ─── Azure STT token (refreshed before its ~10 min expiry) ───────────────

  const refreshAzureToken = useCallback(async () => {
    try {
      const tok = await getToken();
      if (tok) azureTokenRef.current = tok;
      return tok ?? null;
    } catch {
      // Azure STT unavailable — voice input falls back to manual text entry.
      return null;
    }
  }, []);

  useEffect(() => {
    void refreshAzureToken();
    const id = setInterval(() => {
      void refreshAzureToken();
    }, 8 * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshAzureToken]);

  // ─── Network connectivity listener (expo-network) ──────────────────────

  useEffect(() => {
    try {
      const sub = Network.addNetworkStateListener((state) => {
        const connected = state.isConnected && state.isInternetReachable;
        if (!connected && !isOfflineRef.current) {
          isOfflineRef.current = true;
          Vibration.vibrate(NO_INTERNET_VIBRATION_PATTERN);
          announce('No internet connection.');
        } else if (connected && isOfflineRef.current) {
          isOfflineRef.current = false;
        }
      });
      return () => sub.remove();
    } catch (e) {
      // Listener unsupported on this platform (e.g. some browsers) — the app
      // still surfaces failures per-request, so silently skip live monitoring.
      console.warn('Network state listener unavailable:', e);
      return undefined;
    }
  }, []);

  useEffect(() => {
    return () => {
      webAudioSessionRef.current?.abort();
      webAudioSessionRef.current = null;
      webSpeechSessionRef.current?.abort();
      webSpeechSessionRef.current = null;
    };
  }, []);

  // ─── Shake-to-repeat voice input ─────────────────────────────────────────

  useEffect(() => {
    // Motion sensors are heavily restricted in browsers (iOS Safari requires a
    // user-gesture permission prompt); shake gestures are native-only.
    if (Platform.OS === 'web') return;
    Accelerometer.setUpdateInterval(150);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();

      // Always respect the post-trigger cooldown.
      if (now - lastShakeRef.current <= SHAKE_COOLDOWN_MS) return;

      if (magnitude <= SHAKE_THRESHOLD) return;

      // First strong spike arms the detector; a second spike within the window
      // confirms an intentional shake (vs. a single footfall jolt).
      if (now - firstSpikeAtRef.current <= SHAKE_WINDOW_MS) {
        lastShakeRef.current = now;
        firstSpikeAtRef.current = 0;

        if (
          isListeningRef.current ||
          isTranscribingRef.current ||
          loadingRef.current ||
          recordingModeRef.current !== 'idle' ||
          !azureTokenRef.current
        ) {
          return;
        }
        startListening();
      } else {
        firstSpikeAtRef.current = now;
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── TTS ─────────────────────────────────────────────────────────────────

  // Routes through one channel: the OS screen reader when active, otherwise the
  // app's own TTS. Prevents the double narration of speaking + announcing.
  const speak = useCallback((text: string, options?: { preferDevice?: boolean }) => {
    announce(text, options);
  }, []);

  const toggleResponseSpeech = useCallback(async () => {
    if (!aiResponse.trim()) return;
    try {
      if (await isSpeaking()) {
        await stopSpeaking();
      } else {
        speak(aiResponse);
      }
    } catch {
      speak(aiResponse);
    }
  }, [aiResponse, speak]);

  const notifyNoSpeechHeard = useCallback(() => {
    Vibration.vibrate(NO_SPEECH_VIBRATION_PATTERN);
    speak("I didn't catch that. Tap the voice button and speak again.");
  }, [speak]);

  const speakListeningPrompt = useCallback(async () => {
    speak('Listening. Speak after this message, then tap again when finished.', {
      preferDevice: true,
    });

    // Do not let the microphone record Buddy Walk's own prompt. Screen readers
    // do not expose completion state, so give their short announcement time to
    // finish; app TTS can be observed directly.
    if (Platform.OS !== 'web' && isScreenReaderActive()) {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      return;
    }

    const startDeadline = Date.now() + 1500;
    while (Date.now() < startDeadline && !(await isSpeaking())) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const finishDeadline = Date.now() + 6000;
    while (Date.now() < finishDeadline && (await isSpeaking())) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, [speak]);

  const notifyNoInternetConnection = useCallback(() => {
    // The response text is set to "No internet connection." and the auto-speak
    // effect narrates it, so here we only add the haptic cue (no double speak).
    Vibration.vibrate(NO_INTERNET_VIBRATION_PATTERN);
  }, []);

  const lastAutoSpokenRef = useRef('');

  // ─── Auto-speak AI response once, then log ───────────────────────────────

  useEffect(() => {
    if (!aiResponse) {
      lastAutoSpokenRef.current = '';
      return;
    }
    if (lastAutoSpokenRef.current !== aiResponse) {
      lastAutoSpokenRef.current = aiResponse;
      speak(aiResponse, { preferDevice: true });
    }

    const loc = locationRef.current;
    const logEntry = {
      input: submittedInputRef.current,
      output: aiResponse,
      imageURL: capturedImage ?? '',
      location: {
        lat: loc?.coords.latitude ?? 0,
        lon: loc?.coords.longitude ?? 0,
      },
    };

    if (!chatLogEligibleRef.current) return;

    (async () => {
      try {
        const storedName = await AsyncStorage.getItem('name');
        if (currentChatId === '') {
          const res = await createChatLog({
            messages: [logEntry],
            ...(storedName ? { user: storedName } : {}),
          });
          if (res?.data?._id) {
            setCurrentChatId(res.data._id);
            const msgs = res.data.messages;
            setCurrentMessageId(msgs[msgs.length - 1]._id);
          }
        } else {
          const res = await addChatToChatLog({ id: currentChatId, chat: logEntry });
          if (res?.data?.messages) {
            const msgs = res.data.messages;
            setCurrentMessageId(msgs[msgs.length - 1]._id);
          }
        }
      } catch (e) {
        console.error('Chat log error:', e);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiResponse]);

  // ─── Camera: tap = photo, hold = video ───────────────────────────────────

  const onCameraReady = useCallback(() => {
    cameraReadyRef.current = true;
  }, []);

  /** expo-camera requires onCameraReady before takePicture/recordAsync. */
  async function waitForCameraReady(timeoutMs = 5000): Promise<boolean> {
    if (cameraReadyRef.current) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 80));
      if (cameraReadyRef.current) return true;
    }
    return false;
  }

  async function toggleVideoCapture() {
    if (recordingModeRef.current === 'recording-video') {
      await stopVideoRecording();
    } else {
      await startVideoRecording();
    }
  }

  /**
   * Normalizes expo-camera output across platforms: native returns raw base64,
   * web returns a full data URL (sometimes in `uri` instead of `base64`).
   * Double-prefixing produces an invalid image the AI backend rejects.
   */
  function photoToDataUrl(photo: { base64?: string; uri?: string } | null | undefined): string | null {
    if (!photo) return null;
    if (photo.base64) {
      return photo.base64.startsWith('data:')
        ? photo.base64
        : `data:image/jpeg;base64,${photo.base64}`;
    }
    if (photo.uri && photo.uri.startsWith('data:')) return photo.uri;
    return null;
  }

  async function takePhoto() {
    if (!cameraRef.current) return;
    const ready = await waitForCameraReady();
    if (!ready) {
      speak('Camera is still starting. Try again in a moment.');
      return;
    }
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
      const dataUrl = photoToDataUrl(photo);
      if (dataUrl) {
        setCapturedVideoUri(null);
        setWebVideoFrames(null);
        setCapturedImage(dataUrl);
        setUserInput('Describe the image');
        speak('Photo captured. Ready to describe the image.');
        notifySuccess();
        try {
          Vibration.vibrate([...PHOTO_CAPTURED_VIBRATION]);
        } catch {
          // noop
        }
        void track(Events.PhotoCaptured);
      } else {
        speak('Could not capture image');
      }
    } catch (e) {
      console.error('takePhoto error:', e);
      speak('Could not capture image');
    }
  }

  async function startVideoRecording() {
    if (!cameraRef.current || videoRecordStartedRef.current) return;

    // Web: no MediaRecorder/thumbnail pipeline — sample frames off the live
    // preview while the user holds, auto-stopping at the max duration.
    if (Platform.OS === 'web') {
      const session = startWebFrameCapture();
      if (!session) {
        speak('Camera is still starting. Try again in a moment.');
        return;
      }
      webFrameSessionRef.current = session;
      videoRecordStartedRef.current = true;
      beginRecordingFeedback();
      AccessibilityInfo.announceForAccessibility('Video recording started');
      setTimeout(() => {
        if (webFrameSessionRef.current === session) void stopVideoRecording();
      }, MAX_VIDEO_DURATION_MS);
      return;
    }

    const micOk = await ensureMicrophonePermission();
    if (!micOk) {
      speak('Microphone permission is required to record video.');
      return;
    }
    const ready = await waitForCameraReady();
    if (!ready) {
      speak('Camera is still starting. Try again in a moment.');
      return;
    }
    try {
      videoRecordStartedRef.current = true;
      beginRecordingFeedback();
      await resetAudioForPlayback();
      AccessibilityInfo.announceForAccessibility('Video recording started');
      // recordAsync resolves when stopRecording is called or maxDuration is reached
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_DURATION_MS / 1000 });
      if (video?.uri) {
        setCapturedImage(null);
        setCapturedVideoUri(video.uri);
        speak('Video recording ended. Ready to describe the video.');
        setUserInput('Describe the video');
        notifySuccess();
        void track(Events.VideoRecorded, { platform: Platform.OS });
      }
    } catch (e) {
      console.error('startVideoRecording error:', e);
      const msg = e instanceof Error ? e.message : '';
      if (/not ready/i.test(msg)) {
        speak('Camera not ready. Wait a second, then try again.');
      } else {
        speak('Could not capture video');
      }
    } finally {
      videoRecordStartedRef.current = false;
      setRecordingMode('idle');
      clearRecordingTimer();
    }
  }

  function finishVideoRecording(): void {
    videoRecordStartedRef.current = false;
    videoRecordingStartedAtRef.current = null;
    setRecordingMode('idle');
    clearRecordingTimer();
    void resetAudioForPlayback();
  }

  async function stopVideoRecording() {
    if (Platform.OS === 'web') {
      const session = webFrameSessionRef.current;
      if (!session) return;
      webFrameSessionRef.current = null;
      const frames = session.stop();
      finishVideoRecording();
      if (frames.length > 0) {
        setCapturedImage(null);
        setCapturedVideoUri(null);
        setWebVideoFrames(frames);
        setUserInput('Describe the video');
        speak('Video recording ended. Ready to describe the video.');
        notifySuccess();
        void track(Events.VideoRecorded, {
          platform: 'web',
          frameCount: frames.length,
        });
      } else {
        setWebVideoFrames(null);
        speak('Could not capture video');
      }
      return;
    }

    const startedAt = videoRecordingStartedAtRef.current;
    if (startedAt != null) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_VIDEO_RECORD_MS) {
        await new Promise((r) => setTimeout(r, MIN_VIDEO_RECORD_MS - elapsed));
      }
    }
    cameraRef.current?.stopRecording();
  }

  // ─── Voice input via Azure Speech-to-Text REST ───────────────────────────
  //
  // iOS:     Records LinearPCM (true WAV) at 16kHz mono — exactly what Azure expects.
  // Android: Records AAC-ADTS at 16kHz mono — Azure accepts audio/aac natively.
  // Content-Type is set per platform to match the actual encoded format.

  const AZURE_RECORDING_OPTIONS: Audio.RecordingOptions = {
    android: {
      extension: '.aac',
      outputFormat: Audio.AndroidOutputFormat.AAC_ADTS,
      audioEncoder: Audio.AndroidAudioEncoder.AAC,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 128000,
    },
    ios: {
      extension: '.wav',
      outputFormat: Audio.IOSOutputFormat.LINEARPCM,
      audioQuality: Audio.IOSAudioQuality.HIGH,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 256000,
      bitDepthHint: 16,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {},
  };

  const AZURE_CONTENT_TYPE = Platform.OS === 'ios'
    ? 'audio/wav; codecs=audio/pcm; samplerate=16000'
    : 'audio/aac';

  const MIN_VOICE_RECORDING_MS = 1200;
  const LISTENING_PLACEHOLDER = '🎙 Listening… speak your question';
  const TRANSCRIBING_PLACEHOLDER = '⏳ Transcribing your question…';

  function isVoiceStatusText(text: string): boolean {
    const t = text.trim();
    return t === LISTENING_PLACEHOLDER || t === TRANSCRIBING_PLACEHOLDER;
  }

  /** Clear the on-screen Q&A/capture state and start a fresh server AI session. */
  const resetConversationState = useCallback(
    (options?: { announceReset?: boolean }) => {
      rotateConversationId();
      void stopSpeaking();
      if (slowResponseTimerRef.current) {
        clearTimeout(slowResponseTimerRef.current);
        slowResponseTimerRef.current = null;
      }
      setLoading(false);
      setUserInput('');
      setDisplayQuestion('');
      submittedInputRef.current = '';
      setAiResponse('');
      setCapturedImage(null);
      setCapturedVideoUri(null);
      setWebVideoFrames(null);
      setCurrentChatId('');
      setCurrentMessageId('');
      chatLogEligibleRef.current = false;
      lastAutoSpokenRef.current = '';
      cameraReadyRef.current = false;
      if (options?.announceReset) {
        AccessibilityInfo.announceForAccessibility(
          'New test started. Previous question, answer, and AI memory cleared.'
        );
        announce('New test started.');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  async function startNewTest(): Promise<void> {
    await cleanupVoiceCapture();
    resetConversationState({ announceReset: true });
    void track(Events.NewTestStarted);
  }

  // Force a clean AI session when the app is backgrounded/closed so a new
  // launch never inherits the previous session's chat history.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        rotateConversationId();
      }
    });
    return () => sub.remove();
  }, []);

  async function cleanupVoiceCapture(): Promise<void> {
    webAudioSessionRef.current?.abort();
    webAudioSessionRef.current = null;
    webSpeechSessionRef.current?.abort();
    webSpeechSessionRef.current = null;
    voiceTranscriptRef.current = '';

    if (audioRecordingRef.current) {
      try {
        await audioRecordingRef.current.stopAndUnloadAsync();
      } catch {
        /* recording may already be stopped */
      }
      audioRecordingRef.current = null;
    }
    voiceRecordingStartedAtRef.current = null;
    await resetAudioForPlayback();
  }

  async function resetVoiceUiState(): Promise<void> {
    setIsListening(false);
    setIsTranscribing(false);
    isListeningRef.current = false;
    isTranscribingRef.current = false;
    await cleanupVoiceCapture();
  }

  async function submitVoiceQuestion(transcript: string): Promise<void> {
    const trimmed = transcript.trim();
    if (!trimmed) {
      notifyNoSpeechHeard();
      return;
    }
    if (loadingRef.current) {
      speak('Still loading the last answer. Please wait.');
      return;
    }
    setUserInput(trimmed);
    setDisplayQuestion(trimmed);
    Vibration.vibrate(SPEECH_CAPTURED_VIBRATION_PATTERN);
    AccessibilityInfo.announceForAccessibility(`Question: ${trimmed}. Sending now.`);
    await handleSubmit(trimmed);
  }

  async function toggleListening() {
    if (isListeningRef.current) {
      await stopListening();
      return;
    }
    await startListening();
  }

  async function transcribeWithAzure(audioBody: Blob | ArrayBuffer, contentType: string): Promise<string | null> {
    const result = await transcribeAudio(audioBody, contentType);
    if (!result) return null;
    if (result.status === 'Success') return result.transcript;
    if (result.status === 'NoMatch' || result.status === 'InitialSilenceTimeout' || result.status === 'EmptyAudio') {
      return '';
    }
    console.error('Azure STT unhandled status:', result.status);
    return null;
  }

  async function startListening() {
    if (Platform.OS === 'web') unlockWebAudioForPlayback();

    if (loadingRef.current) {
      speak('Still loading your last answer. Wait a moment, then try again.');
      return;
    }
    if (isTranscribingRef.current) {
      speak('Still transcribing your last question. Wait a moment.');
      return;
    }
    if (isListeningRef.current) return;

    await stopSpeaking();
    await cleanupVoiceCapture();

    if (!azureTokenRef.current) {
      await refreshAzureToken();
    }
    if (!azureTokenRef.current) {
      speak('Voice input is unavailable. Make sure the backend is running and try again.');
      if (Platform.OS !== 'web') {
        Alert.alert(
          'Voice Input Unavailable',
          'Could not connect to the speech service. Make sure the backend is running and try again.'
        );
      }
      return;
    }
    const micOk = await ensureMicrophonePermission();
    if (!micOk) {
      speak('Microphone permission is required for voice questions.');
      return;
    }

    await speakListeningPrompt();

    if (Platform.OS === 'web') {
      try {
        const session = await startWebAudioCapture();
        if (!session) {
          speak('Could not start microphone. Check browser permissions and try again.');
          return;
        }
        webAudioSessionRef.current = session;

        const auth = azureTokenRef.current;
        if (auth) {
          const speech = startWebSpeechRecognition(
            auth,
            (interim) => {
              voiceTranscriptRef.current = interim;
              setUserInput(interim);
            },
            (final) => {
              voiceTranscriptRef.current = final;
              setUserInput(final);
            },
            (message) => console.warn('live speech:', message)
          );
          if (speech) {
            webSpeechSessionRef.current = speech;
          }
        }

        voiceRecordingStartedAtRef.current = Date.now();
        isListeningRef.current = true;
        setIsListening(true);
        setUserInput(LISTENING_PLACEHOLDER);
        void track(Events.VoiceStarted);
      } catch (e) {
        console.error('startListening web error:', e);
        await resetVoiceUiState();
        speak('Could not start microphone');
      }
      return;
    }

    try {
      await prepareAudioForRecording();
      const { recording } = await Audio.Recording.createAsync(AZURE_RECORDING_OPTIONS);
      audioRecordingRef.current = recording;
      voiceRecordingStartedAtRef.current = Date.now();
      isListeningRef.current = true;
      setIsListening(true);
      setUserInput(LISTENING_PLACEHOLDER);
      Vibration.vibrate(60);
      void track(Events.VoiceStarted);
    } catch (e) {
      console.error('startListening error:', e);
      await resetVoiceUiState();
      await resetAudioForPlayback();
      speak('Could not start microphone. Tap again in a moment.');
    }
  }

  async function stopListening() {
    if (Platform.OS === 'web') unlockWebAudioForPlayback();

    if (Platform.OS === 'web') {
      const session = webAudioSessionRef.current;
      const speech = webSpeechSessionRef.current;
      webAudioSessionRef.current = null;
      webSpeechSessionRef.current = null;
      isListeningRef.current = false;
      setIsListening(false);

      const startedAt = voiceRecordingStartedAtRef.current;
      voiceRecordingStartedAtRef.current = null;
      if (startedAt != null && Date.now() - startedAt < MIN_VOICE_RECORDING_MS) {
        speech?.abort();
        if (session) await session.stop();
        setUserInput('');
        setIsTranscribing(false);
        isTranscribingRef.current = false;
        speak('I did not hear enough speech. Tap the voice button, speak, then tap it again.');
        return;
      }

      isTranscribingRef.current = true;
      setIsTranscribing(true);
      setUserInput(TRANSCRIBING_PLACEHOLDER);
      void track(Events.VoiceStopped);

      try {
        const [liveText, blob] = await Promise.all([
          speech ? speech.stop() : Promise.resolve(''),
          session ? session.stop() : Promise.resolve(null),
        ]);

        // Safari needs the mic fully released before speechSynthesis can run.
        if (isSafariBrowser()) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          unlockWebAudioForPlayback();
        }
        speak('Transcribing your question.', { preferDevice: true });

        let text =
          liveText.trim() ||
          voiceTranscriptRef.current.trim() ||
          userInputRef.current.trim();

        if (isVoiceStatusText(text)) text = '';

        if (!text && blob && blob.size > 0) {
          const transcript = await transcribeWithAzure(blob, contentTypeForWebBlob(blob));
          if (transcript === null) {
            speak('Speech service error. Please try again.');
            return;
          }
          text = transcript.trim();
        }

        voiceTranscriptRef.current = '';
        if (text && !isVoiceStatusText(text)) {
          setUserInput(text);
          setIsTranscribing(false);
          isTranscribingRef.current = false;
          await submitVoiceQuestion(text);
        } else {
          notifyNoSpeechHeard();
        }
      } catch (e) {
        console.error('stopListening web error:', e);
        speak('Voice recognition failed. Tap the voice button and speak again.');
      } finally {
        setIsTranscribing(false);
        isTranscribingRef.current = false;
      }
      return;
    }

    if (!audioRecordingRef.current) {
      await resetVoiceUiState();
      return;
    }
    try {
      isListeningRef.current = false;
      setIsListening(false);
      const startedAt = voiceRecordingStartedAtRef.current;
      voiceRecordingStartedAtRef.current = null;
      if (startedAt != null && Date.now() - startedAt < MIN_VOICE_RECORDING_MS) {
        await audioRecordingRef.current.stopAndUnloadAsync();
        audioRecordingRef.current = null;
        await resetAudioForPlayback();
        setIsTranscribing(false);
        isTranscribingRef.current = false;
        setUserInput('');
        speak('I did not hear enough speech. Tap the voice button, speak, then tap it again.');
        return;
      }
      setIsTranscribing(true);
      isTranscribingRef.current = true;
      setUserInput(TRANSCRIBING_PLACEHOLDER);
      void track(Events.VoiceStopped);
      const recording = audioRecordingRef.current;
      const uri = recording.getURI();
      await recording.stopAndUnloadAsync();
      audioRecordingRef.current = null;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await resetAudioForPlayback();
      speak('Transcribing your question.', { preferDevice: true });

      if (!uri || !azureTokenRef.current) {
        setIsTranscribing(false);
        if (!uri) speak('Could not read the recording. Please try again.');
        return;
      }

      const audioData = await fetch(uri);
      const audioBlob = await audioData.arrayBuffer();
      const transcript = await transcribeWithAzure(audioBlob, AZURE_CONTENT_TYPE);

      if (transcript === null) {
        speak('Speech service error. Please try again.');
        return;
      }
      const cleaned = transcript.trim();
      if (cleaned && !isVoiceStatusText(cleaned)) {
        setUserInput(cleaned);
        setIsTranscribing(false);
        isTranscribingRef.current = false;
        await submitVoiceQuestion(cleaned);
      } else {
        notifyNoSpeechHeard();
      }
    } catch (e) {
      console.error('stopListening error:', e);
      speak('Voice recognition failed. Tap the voice button and speak again.');
    } finally {
      setIsTranscribing(false);
      isTranscribingRef.current = false;
    }
  }

  // ─── Submit to backend ────────────────────────────────────────────────────

  async function handleSubmit(questionOverride?: string) {
    const raw = (questionOverride ?? userInput).trim();
    if (!raw || isVoiceStatusText(raw)) {
      speak('Please enter a question first');
      return;
    }
    const question = raw;
    setUserInput(question);
    setDisplayQuestion(question);
    submittedInputRef.current = question;
    chatLogEligibleRef.current = false;
    const requestStartedAt = Date.now();
    const requestId = createRequestId();
    const hasWebVideo = !!(webVideoFrames && webVideoFrames.length > 0);
    const hasVideo = !!capturedVideoUri || hasWebVideo;
    const feature = classifyFeature({
      text: question,
      hasImage: !!capturedImage,
      hasVideo,
    });
    void track(Events.QuestionAsked, {
      requestId,
      feature,
      length: question.length,
      hasImage: !!capturedImage,
      hasVideo,
      hasWebVideo,
    });
    try {
      setLoading(true);
      void stopSpeaking();
      AccessibilityInfo.announceForAccessibility('Loading response');

      // A blind user otherwise has no feedback during a long wait, so reassure
      // them out loud if the backend is taking its time. The eventual answer
      // (or error) cancels this by starting its own speech.
      if (slowResponseTimerRef.current) clearTimeout(slowResponseTimerRef.current);
      slowResponseTimerRef.current = setTimeout(() => {
        if (loadingRef.current) speak('Still working on your answer.', { preferDevice: true });
      }, SLOW_RESPONSE_HINT_MS);

      let loc = locationRef.current;
      if (!loc) {
        try {
          loc = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('location_timeout')), LOCATION_WAIT_MS)
            ),
          ]);
          locationRef.current = loc;
        } catch {
          loc = null;
        }
      }
      if (!loc) {
        speak(
          'I could not determine your location, so answers about nearby places may be wrong. ' +
            'Please check that location access is allowed.'
        );
      } else if ((loc.coords.accuracy ?? 0) > 5000) {
        // Browser IP-based estimates can be off by entire cities; warn rather
        // than silently answering about the wrong place.
        speak('Your location looks approximate, so nearby results may be off.');
      }
      const coords: CustomCoords | null = loc
        ? {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy ?? 0,
            altitude: loc.coords.altitude,
            altitudeAccuracy: loc.coords.altitudeAccuracy,
            heading: headingRef.current,
            speed: loc.coords.speed,
            orientation: null,
          }
        : null;

      // Resolve any saved-place aliases like "home" or "work" before sending.
      const { text: resolvedText, matched } = await expandSavedAliases(question);
      if (matched.length > 0) {
        const aliasNames = matched.map(m => m.alias).join(', ');
        AccessibilityInfo.announceForAccessibility(`Using saved place: ${aliasNames}`);
        void track(Events.SavedPlaceUsed, {
          count: matched.length,
          aliases: aliasNames.slice(0, 120),
        });
      }

      let imagePayload: string | null | (string | null)[] = capturedImage ? [capturedImage] : [null];
      if (webVideoFrames && webVideoFrames.length > 0) {
        // Web "video": frames were already sampled live during the hold.
        imagePayload = webVideoFrames;
      } else if (capturedVideoUri) {
        AccessibilityInfo.announceForAccessibility('Processing video frames');
        const frames = await extractVideoFrames(capturedVideoUri);
        if (frames.length === 0) {
          speak('Could not read the video. Try recording again.');
          void track(Events.AnswerRejected, { reason: 'video_frames_failed', feature: 'video_qa' });
          return;
        }
        imagePayload = frames;
      }

      let textToSend = resolvedText;
      let mtaDirectAnswer: string | null = null;
      const trainLine =
        coords && isTrainArrivalQuestion(resolvedText)
          ? extractTrainLineFromText(resolvedText)
          : null;
      const isMtaOnlyQuestion =
        !!trainLine && !capturedImage && !capturedVideoUri && !(webVideoFrames && webVideoFrames.length > 0);

      if (trainLine && coords) {
        try {
          const arrivals = await Promise.race([
            fetchMtaArrivals(trainLine, coords.latitude, coords.longitude),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('mta_timeout')), MTA_LOOKUP_MS)
            ),
          ]);
          mtaDirectAnswer = arrivals;
          textToSend = buildTrainQuestionWithLiveData(resolvedText, trainLine, arrivals);
        } catch (e) {
          console.warn('MTA prefetch failed', e);
          if (isMtaOnlyQuestion) {
            const message =
              'Could not load live subway arrival times. Check your internet connection and try again.';
            setAiResponse(message);
            lastAutoSpokenRef.current = message;
            speak(message, { preferDevice: true });
            setUserInput('');
            setCapturedImage(null);
            setCapturedVideoUri(null);
            setWebVideoFrames(null);
            void track(Events.AnswerFailed, {
              requestId,
              feature: 'mta',
              latencyMs: Date.now() - requestStartedAt,
              reason: 'mta_fetch_failed',
            });
            return;
          }
        }
      }

      if (mtaDirectAnswer && isMtaOnlyQuestion) {
        chatLogEligibleRef.current = true;
        setAiResponse(mtaDirectAnswer);
        lastAutoSpokenRef.current = mtaDirectAnswer;
        speak(mtaDirectAnswer, { preferDevice: true });
        setUserInput('');
        setCapturedImage(null);
        setCapturedVideoUri(null);
        setWebVideoFrames(null);
        void track(Events.AnswerReceived, {
          requestId,
          feature: 'mta',
          latencyMs: Date.now() - requestStartedAt,
          hasRoute: false,
          routeSource: 'none',
          outputLength: mtaDirectAnswer.length,
        });
        return;
      }

      const data: RequestData = {
        text: textToSend,
        image: imagePayload,
        coords,
        analytics: { requestId, feature },
      };

      const res = await sendTextRequest(data);
      if (res?.output) {
        const structured =
          res.route && res.route.steps && res.route.steps.length > 0 ? res.route : null;

        if (structured && isUnreasonableWalk(structured)) {
          const miles = (routeTotalMeters(structured) * 0.00062137).toFixed(1);
          const dest =
            structured.destination?.name ||
            structured.destination?.address ||
            'That destination';
          const message =
            `${dest} is about ${miles} miles away, which is too far to walk. ` +
            `It may not be the nearby place you meant — try a closer destination or use public transit.`;
          chatLogEligibleRef.current = true;
          setAiResponse(message);
          setUserInput('');
          setCapturedImage(null);
          setCapturedVideoUri(null);
          setWebVideoFrames(null);
          void track(Events.AnswerRejected, {
            reason: 'unreasonable_walk',
            feature: 'directions',
            requestId,
          });
          return;
        }

        chatLogEligibleRef.current = true;
        setAiResponse(res.output);
        setUserInput('');
        setCapturedImage(null);
        setCapturedVideoUri(null);
        setWebVideoFrames(null);
        void track(Events.AnswerReceived, {
          requestId,
          feature,
          latencyMs: Date.now() - requestStartedAt,
          hasRoute: !!structured,
          routeSource: structured ? 'structured' : 'none',
          outputLength: res.output.length,
        });
      }
    } catch (e) {
      console.error('handleSubmit error:', e);
      const maybeAxiosError = e as {
        code?: string;
        message?: string;
        response?: unknown;
      };
      const isTimeout = maybeAxiosError?.code === 'ECONNABORTED';
      const isOffline =
        !isTimeout &&
        (!maybeAxiosError?.response || maybeAxiosError?.message === 'Network Error');

      if (isTimeout) {
        setAiResponse('That took too long to answer. The server may be busy. Please try again.');
      } else if (isOffline) {
        notifyNoInternetConnection();
        setAiResponse('No internet connection.');
      } else {
        setAiResponse('An error occurred. Please try again.');
      }
      void track(Events.AnswerFailed, {
        requestId,
        feature,
        latencyMs: Date.now() - requestStartedAt,
        reason: isTimeout ? 'timeout' : isOffline ? 'offline' : 'error',
      });
    } finally {
      if (slowResponseTimerRef.current) {
        clearTimeout(slowResponseTimerRef.current);
        slowResponseTimerRef.current = null;
      }
      setLoading(false);
      // Do not stopSpeaking() here — it was cutting off the AI answer right after Submit.
    }
  }

  // ─── Sign out ─────────────────────────────────────────────────────────────

  function handleSignOutPress() {
    Alert.alert('Sign out?', 'Are you sure you want to sign out of Buddy Walk?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          try {
            // Force a clean AI session so the next user never inherits this chat history.
            resetConversationState();
            await signOut();
          } catch (e) {
            console.error('Sign out error:', e);
            Alert.alert('Could not sign out', 'Please try again.');
          }
        },
      },
    ]);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const cameraReady = cameraPermission?.granted;
  const hasPhotoCapture = Boolean(capturedImage);
  const hasVideoCapture = Boolean(capturedVideoUri || webVideoFrames?.length);
  const hasCapture = hasPhotoCapture || hasVideoCapture;
  const captureUiState = getCaptureUiState(
    recordingMode,
    hasPhotoCapture,
    hasVideoCapture
  );
  const captureLabel = captureStatusLabel(captureUiState);
  const isRecordingVideo = captureUiState === 'recording';

  const cameraPreview = (
    <View
      style={[
        styles.cameraPreviewWrapper,
        captureUiState === 'holding' && styles.cameraPreviewHolding,
        captureUiState === 'recording' && styles.cameraPreviewRecording,
      ]}
    >
      <CameraView
        ref={cameraRef}
        style={styles.cameraPreview}
        facing={'back' as CameraType}
        mode="video"
        onCameraReady={onCameraReady}
      />
      {captureUiState === 'holding' ? (
        <View style={styles.captureOverlayHolding} pointerEvents="none">
          <Text style={styles.captureOverlayTitle}>KEEP HOLDING</Text>
          <Text style={styles.captureOverlaySub}>Video starts in a moment</Text>
        </View>
      ) : null}
      {captureUiState === 'recording' ? (
        <View style={styles.captureOverlayRecording} pointerEvents="none">
          <View style={styles.recBadge}>
            <Animated.View style={[styles.recDot, { opacity: recDotOpacity }]} />
            <Text style={styles.recBadgeText}>
              REC {formatRecordingTime(recordingElapsedSec)}
            </Text>
          </View>
          <Text style={styles.recHint}>Tap Stop Video below</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* ── Blue Section: Camera ── */}
        <View style={styles.blueSection}>
          <Text style={styles.sectionLabel} accessibilityRole="header">
            {captureLabel}
          </Text>

          {!hasCapture && cameraReady ? (
            <View style={styles.cameraCaptureBlock}>
              {cameraPreview}
              <View style={styles.captureActionRow}>
                <Button
                  mode="contained"
                  onPressIn={() => tap()}
                  onPress={() => void takePhoto()}
                  disabled={isRecordingVideo}
                  style={[styles.captureActionButton, styles.capturePhotoButton]}
                  labelStyle={styles.captureActionLabel}
                  accessibilityLabel="Take photo"
                  accessibilityHint="Captures a still photo from the camera"
                >
                  Take Photo
                </Button>
                <Button
                  mode="contained"
                  onPressIn={() => tapMedium()}
                  onPress={() => void toggleVideoCapture()}
                  style={[
                    styles.captureActionButton,
                    isRecordingVideo ? styles.captureStopButton : styles.captureVideoButton,
                  ]}
                  labelStyle={
                    isRecordingVideo ? styles.captureActionLabelOnDark : styles.captureActionLabel
                  }
                  accessibilityLabel={isRecordingVideo ? 'Stop video recording' : 'Record video'}
                  accessibilityHint={
                    isRecordingVideo
                      ? 'Stops the current video recording'
                      : 'Starts recording video from the camera'
                  }
                  accessibilityState={{ busy: isRecordingVideo }}
                >
                  {isRecordingVideo ? 'Stop Video' : 'Record Video'}
                </Button>
              </View>
            </View>
          ) : hasCapture ? (
            <Button
              mode="contained"
              onPressIn={() => tap()}
              onPress={() => {
                cameraReadyRef.current = false;
                setCapturedImage(null);
                setCapturedVideoUri(null);
                setWebVideoFrames(null);
                setAiResponse('');
              }}
              style={[
                styles.retakeButton,
                hasVideoCapture ? styles.retakeButtonVideo : styles.retakeButtonPhoto,
              ]}
              labelStyle={styles.retakeLabel}
              accessibilityLabel={
                hasVideoCapture
                  ? 'Retake video. Replace the captured video.'
                  : 'Retake photo. Replace the captured photo.'
              }
            >
              {hasVideoCapture ? 'Retake Video' : 'Retake Photo'}
            </Button>
          ) : (
            <Button
              mode="contained"
              onPressIn={() => tap()}
              onPress={requestCameraPermission}
              style={styles.retakeButton}
              labelStyle={styles.retakeLabel}
            >
              Enable Camera
            </Button>
          )}
        </View>

        {/* ── Gray Section: Input ── */}
        <View style={styles.graySection}>
          <Text style={styles.sectionLabel}>Ask By Voice Or Text</Text>

          <TextInput
            value={userInput}
            onChangeText={setUserInput}
            placeholder={
              isListening
                ? 'Speak now — your words appear here…'
                : isTranscribing
                  ? 'Transcribing your question…'
                  : 'Example: What is in front of me?'
            }
            placeholderTextColor="rgba(255,255,255,0.75)"
            style={styles.textInput}
            multiline
            returnKeyType="done"
            editable={!isListening && !loading}
            accessibilityLabel="Question input field"
            accessibilityHint="Type or speak your question"
          />

          <Pressable
            onPressIn={() => {
              tap();
              if (Platform.OS === 'web') unlockWebAudioForPlayback();
            }}
            onPress={() => void toggleListening()}
            disabled={loading && !isListening}
            style={[
              styles.voiceButton,
              isListening && styles.voiceButtonActive,
              isTranscribing && styles.voiceButtonTranscribing,
            ]}
            accessibilityLabel={
              isTranscribing
                ? 'Transcribing your question'
                : isListening
                  ? 'Stop listening and send your question'
                  : 'Tap to speak your question'
            }
            accessibilityHint={VOICE_INPUT_HINT}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.voiceButtonLabel,
                (isListening || isTranscribing) && styles.voiceButtonLabelOnDark,
              ]}
            >
              {isTranscribing
                ? '⏳ Transcribing…'
                : isListening
                  ? '🎙 Listening — tap to send'
                  : '🎙 Tap to Ask'}
            </Text>
          </Pressable>
        </View>

        {/* ── Green Section: Submit + Response ── */}
        <View style={styles.greenSection}>
          <Pressable
            onPressIn={() => tapMedium()}
            onPress={() => void handleSubmit()}
            style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed]}
            accessibilityLabel="Submit question"
            accessibilityRole="button"
            disabled={loading}
          >
            <Text style={styles.submitLabel}>Submit</Text>
          </Pressable>

          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#f8f8ff" />
              <Text style={styles.loadingText}>Loading response...</Text>
              {displayQuestion ? (
                <Text style={styles.pendingQuestion} accessibilityRole="text">
                  Your question: {displayQuestion}
                </Text>
              ) : null}
            </View>
          )}

          {!loading && aiResponse !== '' && (
            <View style={styles.responseContainer}>
              {displayQuestion ? (
                <Text style={styles.questionEcho} accessibilityRole="text">
                  You asked: {displayQuestion}
                </Text>
              ) : null}
              <View style={styles.responseActions}>
                <Pressable
                  onPressIn={() => tap()}
                  onPress={toggleResponseSpeech}
                  style={styles.actionButton}
                  accessibilityLabel="Play or pause text to speech"
                  accessibilityRole="button"
                >
                  <Text style={styles.actionButtonLabel}>🔊 Play / Pause</Text>
                </Pressable>
              </View>

              <Text
                style={styles.responseText}
                accessibilityLabel={`AI Response: ${aiResponse}`}
              >
                {aiResponse}
              </Text>

              <AnswerFeedback answer={aiResponse} question={submittedInputRef.current} />
            </View>
          )}
        </View>

        {/* ── Companion + Saved Places ── */}
        <View style={styles.toolsSection}>
          <Pressable
            onPressIn={() => tap()}
            onPress={() => void startNewTest()}
            style={({ pressed }) => [styles.toolButton, pressed && styles.toolButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Start a new test. Clears the question, answer, photo or video, and AI chat memory."
          >
            <Text style={styles.toolButtonIcon}>🔄</Text>
            <View style={styles.toolButtonText}>
              <Text style={styles.toolButtonTitle}>New Test</Text>
              <Text style={styles.toolButtonSubtitle}>
                Clear screen and AI memory before the next test run
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPressIn={() => tap()}
            onPress={() => {
              void stopSpeaking();
              navigation.navigate('Companion');
            }}
            style={({ pressed }) => [styles.toolButton, pressed && styles.toolButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Open Companion Mode to share live location with a trusted contact"
          >
            <Text style={styles.toolButtonIcon}>📍</Text>
            <View style={styles.toolButtonText}>
              <Text style={styles.toolButtonTitle}>Companion Mode</Text>
              <Text style={styles.toolButtonSubtitle}>Share live location via web link</Text>
            </View>
          </Pressable>

          <Pressable
            onPressIn={() => tap()}
            onPress={() => {
              void stopSpeaking();
              navigation.navigate('SavedPlaces');
            }}
            style={({ pressed }) => [styles.toolButton, pressed && styles.toolButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Open Saved Places to bookmark home, work, and other addresses"
          >
            <Text style={styles.toolButtonIcon}>⭐</Text>
            <View style={styles.toolButtonText}>
              <Text style={styles.toolButtonTitle}>Saved Places</Text>
              <Text style={styles.toolButtonSubtitle}>
                Save home, work, and ask "How do I get home?"
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPressIn={() => tap()}
            onPress={() => {
              void stopSpeaking();
              setFeedbackVisible(true);
            }}
            style={({ pressed }) => [styles.toolButton, pressed && styles.toolButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Send feedback about Buddy Walk"
          >
            <Text style={styles.toolButtonIcon}>💬</Text>
            <View style={styles.toolButtonText}>
              <Text style={styles.toolButtonTitle}>Send Feedback</Text>
              <Text style={styles.toolButtonSubtitle}>
                Rate the app and tell us what to improve
              </Text>
            </View>
          </Pressable>

          <Pressable
            onPressIn={() => tap()}
            onPress={handleSignOutPress}
            style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Sign out of Buddy Walk"
          >
            <Text style={styles.signOutLabel}>Sign Out</Text>
          </Pressable>
        </View>

      </ScrollView>
      <CallAccessARideButton />
      <FeedbackModal
        visible={feedbackVisible}
        onDismiss={() => setFeedbackVisible(false)}
        screen="Main"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scroll: {
    flexGrow: 1,
  },

  // ─── Blue Section ───
  blueSection: {
    backgroundColor: '#000',
    padding: 20,
    alignItems: 'center',
    gap: 16,
    minHeight: 320,
  },
  sectionLabel: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  cameraButton: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#111',
    alignItems: 'stretch',
    borderWidth: 3,
    borderColor: 'transparent',
    position: 'relative',
  },
  cameraTouchOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  cameraLabelBar: {
    width: '100%',
    backgroundColor: '#fff',
    zIndex: 3,
  },
  cameraCaptureBlock: {
    width: '100%',
    gap: 12,
  },
  captureActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  captureActionButton: {
    flex: 1,
    borderRadius: 14,
  },
  capturePhotoButton: {
    backgroundColor: '#fff',
  },
  captureVideoButton: {
    backgroundColor: '#fff',
  },
  captureStopButton: {
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: '#fff',
  },
  stopVideoButton: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: '#fff',
  },
  captureActionLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    color: '#000',
  },
  captureActionLabelOnDark: {
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    color: '#fff',
  },
  cameraButtonHolding: {
    borderColor: '#fff',
    backgroundColor: '#e8e8e8',
  },
  cameraButtonRecording: {
    borderColor: '#fff',
    backgroundColor: '#000',
  },
  cameraButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  cameraPreviewWrapper: {
    width: '100%',
    height: 260,
    minHeight: 260,
    backgroundColor: '#1a1a1a',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 16,
  },
  cameraPreviewHolding: {
    borderBottomWidth: 4,
    borderBottomColor: '#fff',
  },
  cameraPreviewRecording: {
    borderBottomWidth: 4,
    borderBottomColor: '#888',
  },
  cameraPreview: {
    width: '100%',
    height: '100%',
  },
  captureOverlayHolding: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  captureOverlayRecording: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  captureOverlayTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 1.5,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  captureOverlaySub: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: '#fff',
  },
  recDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#fff',
  },
  recBadgeText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  recHint: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  cameraButtonLabel: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.8,
    paddingVertical: 14,
    textAlign: 'center',
  },
  cameraButtonLabelHolding: {
    color: '#000',
  },
  cameraButtonLabelRecording: {
    color: '#000',
  },
  retakeButton: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: '#000',
  },
  retakeButtonPhoto: {
    borderColor: '#000',
  },
  retakeButtonVideo: {
    borderColor: '#000',
  },
  retakeLabel: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // ─── Gray Section ───
  graySection: {
    backgroundColor: '#1a1a1a',
    padding: 20,
    gap: 12,
  },
  textInput: {
    backgroundColor: '#0e1116',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    minHeight: 56,
    borderWidth: 1,
    borderColor: '#2a313c',
  },
  voiceButton: {
    backgroundColor: '#fff',
    borderRadius: 40,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  voiceButtonActive: {
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: '#fff',
  },
  voiceButtonTranscribing: {
    backgroundColor: '#333',
    borderWidth: 2,
    borderColor: '#fff',
  },
  voiceButtonLabel: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  voiceButtonLabelOnDark: {
    color: '#fff',
  },

  // ─── Green Section ───
  greenSection: {
    backgroundColor: '#1a1a1a',
    padding: 20,
    gap: 16,
    flexGrow: 1,
  },
  submitButton: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 20,
    alignItems: 'center',
  },
  submitButtonPressed: {
    backgroundColor: '#e0e0e0',
  },
  submitLabel: {
    color: '#000',
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  loadingContainer: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 20,
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
  },
  pendingQuestion: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  responseContainer: {
    gap: 12,
  },
  questionEcho: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  responseActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    backgroundColor: '#fff',
    borderRadius: 40,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  actionButtonLabel: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  responseText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 26,
  },

  // ─── Tools Section (Companion + Saved Places) ───
  toolsSection: {
    backgroundColor: '#0e1116',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 90, // leave room above the floating call button
    gap: 12,
  },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a313c',
    gap: 14,
  },
  toolButtonPressed: {
    backgroundColor: '#1f2630',
  },
  toolButtonIcon: {
    fontSize: 28,
  },
  toolButtonText: {
    flex: 1,
  },
  toolButtonTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  toolButtonSubtitle: {
    color: '#fff',
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  signOutButton: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 40,
    borderWidth: 1,
    borderColor: '#3a4150',
    marginTop: 4,
  },
  signOutButtonPressed: {
    backgroundColor: '#1f2630',
  },
  signOutLabel: {
    color: '#d6605d',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
