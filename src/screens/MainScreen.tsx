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
import { parseStepsFromText, extractDestinationQuery } from '../utils/parseSteps';
import { hasUsableDestination } from '../utils/navigationMath';
import { tap, tapMedium, iconForManeuver, notifySuccess } from '../utils/haptics';
import { useTurnByTurnNavigation } from '../hooks/useTurnByTurnNavigation';
import { ensureMicrophonePermission } from '../utils/microphonePermission';
import { prepareAudioForRecording, resetAudioForPlayback } from '../utils/audioSession';
import { stopSpeaking, isSpeaking } from '../utils/speakText';
import { announce } from '../utils/announce';
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

const HOLD_THRESHOLD_MS = 600;
const MAX_VIDEO_DURATION_MS = 30000;
const LOCATION_WAIT_MS = 1000;
const SLOW_RESPONSE_HINT_MS = 4500;
const VIDEO_RECORDING_START_VIBRATION = [0, 120, 80, 120] as const;
const PHOTO_CAPTURED_VIBRATION = [0, 50] as const;
const NO_SPEECH_VIBRATION_PATTERN = [0, 180, 120, 180];
const NO_INTERNET_VIBRATION_PATTERN = [0, 250, 150, 250];
const SPEECH_CAPTURED_VIBRATION_PATTERN = [0, 80];
const NAV_STOPPED_VIBRATION_PATTERN = [0, 60, 80, 60];

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
  isHoldingForVideo: boolean,
  hasPhotoCapture: boolean,
  hasVideoCapture: boolean
): CaptureUiState {
  if (recordingMode === 'recording-video') return 'recording';
  if (isHoldingForVideo) return 'holding';
  if (hasVideoCapture) return 'video-ready';
  if (hasPhotoCapture) return 'photo-ready';
  return 'idle';
}

function captureStatusLabel(state: CaptureUiState): string {
  switch (state) {
    case 'holding':
      return 'Keep holding — video starting…';
    case 'recording':
      return 'Recording video — release to stop';
    case 'photo-ready':
      return 'Photo captured — tap Retake to replace';
    case 'video-ready':
      return 'Video captured — tap Retake to replace';
    default:
      return Platform.OS === 'web'
        ? 'Take Photo  ·  Record Video'
        : 'Tap for Photo  ·  Hold for Video';
  }
}

function captureButtonLabel(state: CaptureUiState): string {
  switch (state) {
    case 'holding':
      return 'KEEP HOLDING FOR VIDEO';
    case 'recording':
      return 'RELEASE TO STOP VIDEO';
    case 'photo-ready':
      return 'PHOTO READY';
    case 'video-ready':
      return 'VIDEO READY';
    default:
      return 'TAP = PHOTO  ·  HOLD = VIDEO';
  }
}

function captureAccessibilityLabel(state: CaptureUiState): string {
  switch (state) {
    case 'holding':
      return 'Keep holding the camera button to start video recording';
    case 'recording':
      return 'Video recording in progress. Release to stop recording';
    case 'photo-ready':
      return 'Photo captured. Tap retake to capture again';
    case 'video-ready':
      return 'Video captured. Tap retake to capture again';
    default:
      return 'Camera button. Tap quickly for a photo. Hold to record video';
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
  const [aiRoute, setAiRoute] = useState<NavRoute | null>(null);
  const nav = useTurnByTurnNavigation();
  const aiRouteRef = useRef<NavRoute | null>(null);
  const navStartRef = useRef(nav.start);
  const navStopRef = useRef(nav.stop);
  const navActiveRef = useRef(false);
  const autoStartedRouteRef = useRef<NavRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('idle');
  const [isHoldingForVideo, setIsHoldingForVideo] = useState(false);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);

  const [currentChatId, setCurrentChatId] = useState('');
  const [currentMessageId, setCurrentMessageId] = useState('');
  const [feedbackVisible, setFeedbackVisible] = useState(false);

  const locationRef = useRef<Location.LocationObject | null>(null);
  const headingRef = useRef<number>(0);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Snapshot of the question actually sent, so the chat log records it even
  // after userInput is cleared on submit.
  const submittedInputRef = useRef('');
  // Fires a spoken "still working" cue if a response is taking a while.
  const slowResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOfflineRef = useRef(false);
  const lastShakeRef = useRef(0);
  const firstSpikeAtRef = useRef(0);
  const isListeningRef = useRef(false);
  const loadingRef = useRef(false);
  const recordingModeRef = useRef<RecordingMode>('idle');

  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
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
    setIsHoldingForVideo(false);
    setRecordingMode('recording-video');
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
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      clearRecordingTimer();
    };
  }, []);
  useEffect(() => { aiRouteRef.current = aiRoute; }, [aiRoute]);
  useEffect(() => { navStartRef.current = nav.start; }, [nav.start]);
  useEffect(() => { navStopRef.current = nav.stop; }, [nav.stop]);
  useEffect(() => { navActiveRef.current = nav.active; }, [nav.active]);

  // Hands-off: the instant directions arrive, begin haptic navigation
  // automatically so blind users never have to find and press a button.
  useEffect(() => {
    if (aiRoute && aiRoute.steps.length > 0) {
      if (autoStartedRouteRef.current !== aiRoute) {
        autoStartedRouteRef.current = aiRoute;
        void stopSpeaking();
        void track(Events.NavigationStarted, {
          steps: aiRoute.steps.length,
          travelMode: aiRoute.travelMode ?? 'unknown',
          autoStarted: true,
        });
        void navStartRef.current(aiRoute);
      }
    } else {
      autoStartedRouteRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRoute]);

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
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderEnabled);
    const sub = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      setScreenReaderEnabled
    );
    return () => sub.remove();
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

        // Priority: while navigating, a shake ends navigation hands-off so the
        // user never has to find the Stop button. This must work even if the
        // Azure token isn't ready (it's only needed for voice input).
        if (navActiveRef.current) {
          void navStopRef.current();
          Vibration.vibrate(NAV_STOPPED_VIBRATION_PATTERN);
          AccessibilityInfo.announceForAccessibility('Navigation stopped.');
          return;
        }

        // Otherwise fall back to shake-to-ask voice input, unless busy.
        if (
          isListeningRef.current ||
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
    speak("I didn't catch that. Please try again.");
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
      // When the response is a route, haptic navigation speaks the steps as we
      // go — reading the full directions text too would talk over those cues.
      if (!aiRouteRef.current) {
        // Safari blocks async MP3 playback after mic capture — use device speech.
        speak(aiResponse, { preferDevice: true });
      }
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

  async function handleReleaseCapture() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      setIsHoldingForVideo(false);
      await takePhoto();
    } else if (recordingModeRef.current === 'recording-video') {
      await stopVideoRecording();
    }
  }

  function handlePressIn() {
    tap();
    setIsHoldingForVideo(true);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      void startVideoRecording();
    }, HOLD_THRESHOLD_MS);
  }

  async function handlePressOut() {
    await handleReleaseCapture();
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
        setIsHoldingForVideo(false);
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
      setIsHoldingForVideo(false);
      speak('Microphone permission is required to record video.');
      return;
    }
    const ready = await waitForCameraReady();
    if (!ready) {
      setIsHoldingForVideo(false);
      speak('Camera is still starting. Hold a little longer next time.');
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
        speak('Camera not ready. Wait a second, then hold again.');
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
    setRecordingMode('idle');
    setIsHoldingForVideo(false);
    clearRecordingTimer();
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

  const MIN_VOICE_RECORDING_MS = 400;

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
    if (isListening) {
      await stopListening();
    } else {
      await startListening();
    }
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

    if (Platform.OS === 'web') {
      webAudioSessionRef.current?.abort();
      webSpeechSessionRef.current?.abort();
      voiceTranscriptRef.current = '';
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
        setIsListening(true);
        setUserInput('');
        void track(Events.VoiceStarted);
        AccessibilityInfo.announceForAccessibility(
          'Listening. Tap again when finished speaking.'
        );
      } catch (e) {
        console.error('startListening web error:', e);
        speak('Could not start microphone');
      }
      return;
    }

    try {
      await prepareAudioForRecording();
      const { recording } = await Audio.Recording.createAsync(AZURE_RECORDING_OPTIONS);
      audioRecordingRef.current = recording;
      voiceRecordingStartedAtRef.current = Date.now();
      setIsListening(true);
      setUserInput('');
      Vibration.vibrate(60);
      void track(Events.VoiceStarted);
      AccessibilityInfo.announceForAccessibility('Listening. Tap again when finished speaking.');
    } catch (e) {
      console.error('startListening error:', e);
      speak('Could not start microphone');
    }
  }

  async function stopListening() {
    if (Platform.OS === 'web') unlockWebAudioForPlayback();

    if (Platform.OS === 'web') {
      const session = webAudioSessionRef.current;
      const speech = webSpeechSessionRef.current;
      webAudioSessionRef.current = null;
      webSpeechSessionRef.current = null;
      setIsListening(false);

      const startedAt = voiceRecordingStartedAtRef.current;
      voiceRecordingStartedAtRef.current = null;
      if (startedAt != null && Date.now() - startedAt < MIN_VOICE_RECORDING_MS) {
        speech?.abort();
        if (session) await session.stop();
        speak('Hold Tap to Ask a little longer while you speak, then tap again.');
        return;
      }

      setIsTranscribing(true);
      void track(Events.VoiceStopped);
      AccessibilityInfo.announceForAccessibility('Processing speech');

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

        let text =
          liveText.trim() ||
          voiceTranscriptRef.current.trim() ||
          userInputRef.current.trim();

        if (!text && blob && blob.size > 0) {
          const transcript = await transcribeWithAzure(blob, contentTypeForWebBlob(blob));
          if (transcript === null) {
            speak('Speech service error. Please try again.');
            return;
          }
          text = transcript.trim();
        }

        voiceTranscriptRef.current = '';
        if (text) {
          setUserInput(text);
          await submitVoiceQuestion(text);
        } else {
          notifyNoSpeechHeard();
        }
      } catch (e) {
        console.error('stopListening web error:', e);
        speak('Voice recognition failed');
      } finally {
        setIsTranscribing(false);
      }
      return;
    }

    if (!audioRecordingRef.current) return;
    try {
      setIsListening(false);
      const startedAt = voiceRecordingStartedAtRef.current;
      voiceRecordingStartedAtRef.current = null;
      if (startedAt != null && Date.now() - startedAt < MIN_VOICE_RECORDING_MS) {
        await audioRecordingRef.current.stopAndUnloadAsync();
        audioRecordingRef.current = null;
        await resetAudioForPlayback();
        speak('Hold Tap to Ask a little longer while you speak, then tap again.');
        return;
      }
      setIsTranscribing(true);
      void track(Events.VoiceStopped);
      const recording = audioRecordingRef.current;
      const uri = recording.getURI();
      await recording.stopAndUnloadAsync();
      audioRecordingRef.current = null;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await resetAudioForPlayback();

      if (!uri || !azureTokenRef.current) {
        setIsTranscribing(false);
        if (!uri) speak('Could not read the recording. Please try again.');
        return;
      }

      AccessibilityInfo.announceForAccessibility('Processing speech');

      const audioData = await fetch(uri);
      const audioBlob = await audioData.arrayBuffer();
      const transcript = await transcribeWithAzure(audioBlob, AZURE_CONTENT_TYPE);

      if (transcript === null) {
        speak('Speech service error. Please try again.');
        return;
      }
      if (transcript.trim()) {
        await submitVoiceQuestion(transcript);
      } else {
        notifyNoSpeechHeard();
      }
    } catch (e) {
      console.error('stopListening error:', e);
      speak('Voice recognition failed');
    } finally {
      setIsTranscribing(false);
    }
  }

  // ─── Submit to backend ────────────────────────────────────────────────────

  async function handleSubmit(questionOverride?: string) {
    const question = (questionOverride ?? userInput).trim();
    if (!question) {
      speak('Please enter a question first');
      return;
    }
    setUserInput(question);
    setDisplayQuestion(question);
    submittedInputRef.current = question;
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
      if (coords && isTrainArrivalQuestion(resolvedText)) {
        const trainLine = extractTrainLineFromText(resolvedText);
        if (trainLine) {
          try {
            const arrivals = await Promise.race([
              fetchMtaArrivals(trainLine, coords.latitude, coords.longitude),
              new Promise<string>((_, reject) =>
                setTimeout(() => reject(new Error('mta_timeout')), 1500)
              ),
            ]);
            textToSend = buildTrainQuestionWithLiveData(resolvedText, trainLine, arrivals);
          } catch (e) {
            console.warn('MTA prefetch failed, sending question without live data', e);
          }
        }
      }

      const data: RequestData = {
        text: textToSend,
        image: imagePayload,
        coords,
        analytics: { requestId, feature },
      };

      const res = await sendTextRequest(data);
      if (res?.output) {
        // Prefer structured directions from the backend; otherwise try to
        // recover steps from the AI text itself so haptic navigation still works.
        const structured =
          res.route && res.route.steps && res.route.steps.length > 0 ? res.route : null;

        // Safety net: never hand the user a convoluted, far-flung walking route
        // (e.g. a Brooklyn destination that geocoded out-of-state). Suppress the
        // haptic route and the bloated step-by-step text, and nudge to transit.
        if (structured && isUnreasonableWalk(structured)) {
          const miles = (routeTotalMeters(structured) * 0.00062137).toFixed(1);
          const dest =
            structured.destination?.name ||
            structured.destination?.address ||
            'That destination';
          const message =
            `${dest} is about ${miles} miles away, which is too far to walk. ` +
            `It may not be the nearby place you meant — try a closer destination or use public transit.`;
          setAiResponse(message);
          setUserInput('');
          setCapturedImage(null);
          setCapturedVideoUri(null);
          setWebVideoFrames(null);
          setAiRoute(null);
          void track(Events.AnswerRejected, {
            reason: 'unreasonable_walk',
            feature: 'directions',
            requestId,
          });
          return;
        }

        const fallback = structured ? null : parseStepsFromText(res.output);
        const finalRoute = structured ?? fallback ?? null;

        // Text-parsed routes arrive without a destination coordinate, so GPS
        // can't confirm exact arrival. Geocode one on-device from the query in
        // the background; the live navigator (which holds this same route
        // object) picks up the coordinate as soon as it resolves.
        if (!structured && finalRoute && !hasUsableDestination(finalRoute)) {
          const destStr = extractDestinationQuery(resolvedText);
          if (destStr) {
            void (async () => {
              try {
                const geo = await Location.geocodeAsync(destStr);
                if (Array.isArray(geo) && geo.length > 0) {
                  finalRoute.destination = {
                    ...finalRoute.destination,
                    lat: geo[0].latitude,
                    lng: geo[0].longitude,
                  };
                }
              } catch {
                // Best-effort: fall back to the timer-based arrival estimate.
              }
            })();
          }
        }

        // Set the ref synchronously *before* the response so the auto-speak
        // effect knows a route is present and lets navigation narrate the steps
        // instead of reading the full directions text over the voice cues.
        aiRouteRef.current = finalRoute;
        setAiResponse(res.output);
        if (!finalRoute) {
          lastAutoSpokenRef.current = res.output;
          speak(res.output, { preferDevice: true });
        }
        setUserInput('');
        setCapturedImage(null);
        setCapturedVideoUri(null);
        setWebVideoFrames(null);
        setAiRoute(finalRoute);
        void track(Events.AnswerReceived, {
          requestId,
          feature,
          latencyMs: Date.now() - requestStartedAt,
          hasRoute: !!finalRoute,
          routeSource: structured ? 'structured' : fallback ? 'text_parsed' : 'none',
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

      setAiRoute(null);
      if (isTimeout) {
        // We reached the network but the server was too slow — distinct from
        // being offline, so don't tell the user their connection is down.
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
    isHoldingForVideo,
    hasPhotoCapture,
    hasVideoCapture
  );
  const captureLabel = captureStatusLabel(captureUiState);
  const cameraButtonLabel = captureButtonLabel(captureUiState);
  const cameraA11yLabel = captureAccessibilityLabel(captureUiState);
  const useExplicitCaptureControls = Platform.OS === 'web' || screenReaderEnabled;
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
          <Text style={styles.recHint}>
            {useExplicitCaptureControls ? 'Tap Stop Video below' : 'Release to stop'}
          </Text>
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
            useExplicitCaptureControls ? (
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
                    labelStyle={styles.captureActionLabel}
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
            ) : (
              <View>
                <Pressable
                  onPressIn={handlePressIn}
                  onPressOut={handlePressOut}
                  onTouchEnd={() => void handleReleaseCapture()}
                  onPointerUp={() => void handleReleaseCapture()}
                  onPointerCancel={() => void handleReleaseCapture()}
                  style={({ pressed }) => [
                    styles.cameraButton,
                    captureUiState === 'holding' && styles.cameraButtonHolding,
                    captureUiState === 'recording' && styles.cameraButtonRecording,
                    pressed && styles.cameraButtonPressed,
                  ]}
                  accessibilityLabel={cameraA11yLabel}
                  accessibilityRole="button"
                  accessibilityHint="Tap quickly to take a photo. Hold to record video."
                  accessibilityState={{
                    busy: captureUiState === 'recording',
                  }}
                >
                  {cameraPreview}
                  <Text
                    style={[
                      styles.cameraButtonLabel,
                      captureUiState === 'holding' && styles.cameraButtonLabelHolding,
                      captureUiState === 'recording' && styles.cameraButtonLabelRecording,
                    ]}
                  >
                    {cameraButtonLabel}
                  </Text>
                </Pressable>
                {isRecordingVideo ? (
                  <Button
                    mode="contained"
                    onPressIn={() => tapMedium()}
                    onPress={() => void stopVideoRecording()}
                    style={styles.stopVideoButton}
                    labelStyle={styles.captureActionLabel}
                    accessibilityLabel="Stop video recording"
                    accessibilityHint="Stops the current video recording immediately"
                  >
                    Stop Video
                  </Button>
                ) : null}
              </View>
            )
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
            placeholderTextColor="#888"
            style={styles.textInput}
            multiline
            returnKeyType="done"
            editable={!isListening && !isTranscribing && !loading}
            accessibilityLabel="Question input field"
            accessibilityHint="Type or speak your question"
          />

          <Pressable
            onPressIn={() => {
              tap();
              if (Platform.OS === 'web') unlockWebAudioForPlayback();
            }}
            onPress={() => void toggleListening()}
            disabled={loading || isTranscribing}
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
            <Text style={styles.voiceButtonLabel}>
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

              {aiRoute && aiRoute.steps.length > 0 && !nav.active && !nav.arrived && (
                <Pressable
                  onPressIn={() => tapMedium()}
                  onPress={() => {
                    void stopSpeaking();
                    void track(Events.NavigationStarted, {
                      steps: aiRoute.steps.length,
                      travelMode: aiRoute.travelMode ?? 'unknown',
                      autoStarted: false,
                    });
                    void nav.start(aiRoute);
                  }}
                  style={({ pressed }) => [
                    styles.hapticNavButton,
                    pressed && styles.hapticNavButtonPressed,
                  ]}
                  accessibilityLabel={`Resume haptic turn-by-turn navigation. ${aiRoute.steps.length} steps. Directions advance automatically as you walk.`}
                  accessibilityRole="button"
                >
                  <Text style={styles.hapticNavIcon}>📳</Text>
                  <View style={styles.hapticNavText}>
                    <Text style={styles.hapticNavTitle}>Resume Haptic Navigation</Text>
                    <Text style={styles.hapticNavSubtitle}>
                      {aiRoute.steps.length} step{aiRoute.steps.length === 1 ? '' : 's'}
                      {aiRoute.totalDistance?.text ? ` · ${aiRoute.totalDistance.text}` : ''}
                      {aiRoute.totalDuration?.text ? ` · ${aiRoute.totalDuration.text}` : ''}
                    </Text>
                  </View>
                </Pressable>
              )}

              <AnswerFeedback answer={aiResponse} question={submittedInputRef.current} />
            </View>
          )}

          {/* ── Live haptic navigation (auto-advances by GPS) ── */}
          {(nav.active || nav.arrived) && (
            <View
              style={styles.liveNavCard}
              accessible
              accessibilityLiveRegion={nav.arrived || nav.offRoute ? 'assertive' : 'polite'}
              accessibilityLabel={
                nav.arrived
                  ? 'You have arrived at your destination.'
                  : `Navigating. Step ${(nav.stepIndex ?? 0) + 1} of ${nav.totalSteps}. ${
                      nav.currentStep?.instruction ?? ''
                    }`
              }
            >
              {nav.arrived ? (
                <Text style={styles.liveNavBanner}>🏁 You have arrived</Text>
              ) : nav.offRoute ? (
                <Text style={[styles.liveNavBanner, styles.liveNavOffRoute]}>
                  ⚠️ You may be off-route
                </Text>
              ) : (
                <Text style={styles.liveNavStepCount}>
                  Step {(nav.stepIndex ?? 0) + 1} of {nav.totalSteps} · navigating automatically
                </Text>
              )}

              {!nav.arrived && nav.currentStep && (
                <View style={styles.liveNavStepRow}>
                  <Text style={styles.liveNavIcon}>
                    {iconForManeuver(nav.currentStep.maneuver)}
                  </Text>
                  <Text style={styles.liveNavInstruction}>
                    {nav.currentStep.instruction}
                  </Text>
                </View>
              )}

              <Pressable
                onPressIn={() => tap()}
                onPress={() => {
                  void nav.stop();
                  AccessibilityInfo.announceForAccessibility('Navigation stopped.');
                }}
                style={({ pressed }) => [
                  styles.liveNavStop,
                  pressed && styles.liveNavStopPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={nav.arrived ? 'Dismiss navigation' : 'Stop navigation'}
                accessibilityHint={nav.arrived ? undefined : 'You can also shake the phone to stop'}
              >
                <Text style={styles.liveNavStopLabel}>
                  {nav.arrived ? 'DISMISS' : 'STOP NAVIGATION'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ── Companion + Saved Places ── */}
        <View style={styles.toolsSection}>
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
    backgroundColor: '#0a1628',
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
    backgroundColor: '#fff',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
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
    backgroundColor: '#2e7d32',
  },
  captureVideoButton: {
    backgroundColor: '#1565c0',
  },
  captureStopButton: {
    backgroundColor: '#c62828',
  },
  stopVideoButton: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: '#c62828',
  },
  captureActionLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  cameraButtonHolding: {
    borderColor: '#ffb300',
    backgroundColor: '#fff8e1',
  },
  cameraButtonRecording: {
    borderColor: '#ff1744',
    backgroundColor: '#1a0008',
  },
  cameraButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  cameraPreviewWrapper: {
    width: '100%',
    height: 200,
    backgroundColor: '#111',
    position: 'relative',
  },
  cameraPreviewHolding: {
    borderBottomWidth: 4,
    borderBottomColor: '#ffb300',
  },
  cameraPreviewRecording: {
    borderBottomWidth: 4,
    borderBottomColor: '#ff1744',
  },
  cameraPreview: {
    flex: 1,
  },
  captureOverlayHolding: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 179, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  captureOverlayRecording: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(180, 0, 30, 0.42)',
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
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: '#ff5252',
  },
  recDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ff1744',
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
    color: '#e65100',
  },
  cameraButtonLabelRecording: {
    color: '#ff5252',
  },
  retakeButton: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 3,
  },
  retakeButtonPhoto: {
    borderColor: '#43a047',
  },
  retakeButtonVideo: {
    borderColor: '#e53935',
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
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#000',
    minHeight: 56,
  },
  voiceButton: {
    backgroundColor: '#fff',
    borderRadius: 40,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  voiceButtonActive: {
    backgroundColor: '#c62828',
  },
  voiceButtonTranscribing: {
    backgroundColor: '#ff8f00',
  },
  voiceButtonLabel: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },

  // ─── Green Section ───
  greenSection: {
    backgroundColor: '#0a1f0a',
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
    color: '#f8f8ff',
    fontSize: 16,
  },
  pendingQuestion: {
    color: '#d7e8ff',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  responseContainer: {
    gap: 12,
  },
  questionEcho: {
    color: '#b8d4ff',
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

  // ─── Haptic Navigation CTA inside response card ───
  hapticNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2ecc71',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
    marginTop: 12,
  },
  hapticNavButtonPressed: { backgroundColor: '#27ae60' },
  hapticNavIcon: { fontSize: 28 },
  hapticNavText: { flex: 1 },
  hapticNavTitle: {
    color: '#0a1f0a',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  hapticNavSubtitle: {
    color: '#0a1f0a',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
    opacity: 0.9,
  },

  // ─── Live haptic navigation banner (auto-advances by GPS) ───
  liveNavCard: {
    backgroundColor: '#161b22',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a313c',
    padding: 16,
    gap: 12,
    marginTop: 12,
  },
  liveNavBanner: {
    color: '#2ecc71',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  liveNavOffRoute: { color: '#ffb86b' },
  liveNavStepCount: {
    color: '#aab1bd',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  liveNavStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  liveNavIcon: { fontSize: 34 },
  liveNavInstruction: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    flex: 1,
    lineHeight: 24,
  },
  liveNavStop: {
    backgroundColor: '#7c2d12',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  liveNavStopPressed: { backgroundColor: '#5a1f0d' },
  liveNavStopLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 1,
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
    color: '#aab1bd',
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
