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
} from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Magnetometer, Accelerometer } from 'expo-sensors';
import * as Network from 'expo-network';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

import CallAccessARideButton from '../components/CallAccessARideButton';
import { sendTextRequest } from '../api/openAi';
import { createChatLog, addChatToChatLog } from '../api/chatLog';
import { getToken } from '../api/token';
import { RequestData, CustomCoords } from '../types';

const HOLD_THRESHOLD_MS = 600;
const MAX_VIDEO_DURATION_MS = 30000;
const NO_SPEECH_VIBRATION_PATTERN = [0, 180, 120, 180];
const NO_INTERNET_VIBRATION_PATTERN = [0, 250, 150, 250];

const SHAKE_THRESHOLD = 1.8;
const SHAKE_COOLDOWN_MS = 2000;

type RecordingMode = 'idle' | 'recording-video' | 'recording-voice';

export default function MainScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [userInput, setUserInput] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('idle');

  const [currentChatId, setCurrentChatId] = useState('');
  const [currentMessageId, setCurrentMessageId] = useState('');

  const locationRef = useRef<Location.LocationObject | null>(null);
  const headingRef = useRef<number>(0);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRecordingRef = useRef<Audio.Recording | null>(null);
  const azureTokenRef = useRef<{ token: string; region: string } | null>(null);

  const isOfflineRef = useRef(false);
  const lastShakeRef = useRef(0);
  const isListeningRef = useRef(false);
  const loadingRef = useRef(false);
  const recordingModeRef = useRef<RecordingMode>('idle');

  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { recordingModeRef.current = recordingMode; }, [recordingMode]);

  // ─── Setup: location, compass, Azure token ───────────────────────────────

  useEffect(() => {
    let locationSub: Location.LocationSubscription | null = null;
    let magnetometerSub: ReturnType<typeof Magnetometer.addListener> | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        locationSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 2 },
          (loc) => { locationRef.current = loc; }
        );
      }
    })();

    Magnetometer.setUpdateInterval(500);
    magnetometerSub = Magnetometer.addListener(({ x, y }) => {
      let angle = Math.atan2(y, x) * (180 / Math.PI);
      headingRef.current = (angle + 360) % 360;
    });

    (async () => {
      try {
        const tok = await getToken();
        if (tok) azureTokenRef.current = tok;
      } catch {
        // Azure STT unavailable — voice input will fall back to manual text
      }
    })();

    return () => {
      locationSub?.remove();
      magnetometerSub?.remove();
    };
  }, []);

  // ─── Network connectivity listener (expo-network) ──────────────────────

  useEffect(() => {
    const sub = Network.addNetworkStateListener((state) => {
      const connected = state.isConnected && state.isInternetReachable;
      if (!connected && !isOfflineRef.current) {
        isOfflineRef.current = true;
        Vibration.vibrate(NO_INTERNET_VIBRATION_PATTERN);
        Speech.stop();
        Speech.speak('No internet connection.', { language: 'en-US' });
        AccessibilityInfo.announceForAccessibility('No internet connection.');
      } else if (connected && isOfflineRef.current) {
        isOfflineRef.current = false;
      }
    });
    return () => sub.remove();
  }, []);

  // ─── Shake-to-repeat voice input ─────────────────────────────────────────

  useEffect(() => {
    Accelerometer.setUpdateInterval(150);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (
        magnitude > SHAKE_THRESHOLD &&
        now - lastShakeRef.current > SHAKE_COOLDOWN_MS &&
        !isListeningRef.current &&
        !loadingRef.current &&
        recordingModeRef.current === 'idle' &&
        azureTokenRef.current
      ) {
        lastShakeRef.current = now;
        startListening();
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── TTS ─────────────────────────────────────────────────────────────────

  const speak = useCallback((text: string) => {
    Speech.stop();
    Speech.speak(text, { language: 'en-US', rate: 1.0 });
  }, []);

  const stopSpeaking = useCallback(() => Speech.stop(), []);

  const notifyNoSpeechHeard = useCallback(() => {
    Vibration.vibrate(NO_SPEECH_VIBRATION_PATTERN);
    speak("I didn't catch that. Please try again.");
  }, [speak]);

  const notifyNoInternetConnection = useCallback(() => {
    Vibration.vibrate(NO_INTERNET_VIBRATION_PATTERN);
    speak('No internet connection.');
    AccessibilityInfo.announceForAccessibility('No internet connection.');
  }, [speak]);

  // ─── Auto-speak and log AI response ──────────────────────────────────────

  useEffect(() => {
    if (!aiResponse) return;
    speak(aiResponse);

    const loc = locationRef.current;
    const logEntry = {
      input: userInput,
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

  function handlePressIn() {
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      startVideoRecording();
    }, HOLD_THRESHOLD_MS);
  }

  async function handlePressOut() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      await takePhoto();
    } else if (recordingMode === 'recording-video') {
      await stopVideoRecording();
    }
  }

  async function takePhoto() {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
      if (photo?.base64) {
        setCapturedImage(`data:image/jpeg;base64,${photo.base64}`);
        setUserInput('Describe the image');
        speak('Photo captured.');
        Alert.alert('Photo captured', 'Ready to describe the image.');
        AccessibilityInfo.announceForAccessibility('Photo captured.');
      }
    } catch (e) {
      console.error('takePhoto error:', e);
      speak('Could not capture image');
    }
  }

  async function startVideoRecording() {
    if (!cameraRef.current) return;
    try {
      setRecordingMode('recording-video');
      speak('Video recording.');
      // recordAsync resolves when stopRecording is called or maxDuration is reached
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_DURATION_MS / 1000 });
      if (video?.uri) {
        speak('Video recording ended.');
        Alert.alert('Video captured', 'Ready to describe the video.');
        AccessibilityInfo.announceForAccessibility('Video recording ended.');
        setUserInput('Describe the video');
        // Video URI stored for future frame extraction — not yet implemented on mobile
      }
    } catch (e) {
      console.error('startVideoRecording error:', e);
      speak('Could not capture video');
    } finally {
      setRecordingMode('idle');
    }
  }

  async function stopVideoRecording() {
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

  async function toggleListening() {
    if (isListening) {
      await stopListening();
    } else {
      await startListening();
    }
  }

  async function startListening() {
    if (!azureTokenRef.current) {
      Alert.alert(
        'Voice Input Unavailable',
        'Could not connect to the speech service. Make sure the backend is running and try again.'
      );
      return;
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(AZURE_RECORDING_OPTIONS);
      audioRecordingRef.current = recording;
      setIsListening(true);
      speak('Listening');
    } catch (e) {
      console.error('startListening error:', e);
      speak('Could not start microphone');
    }
  }

  async function stopListening() {
    if (!audioRecordingRef.current) return;
    try {
      setIsListening(false);
      await audioRecordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = audioRecordingRef.current.getURI();
      audioRecordingRef.current = null;

      if (!uri || !azureTokenRef.current) return;

      speak('Processing');

      const { token, region } = azureTokenRef.current;
      const audioData = await fetch(uri);
      const audioBlob = await audioData.arrayBuffer();

      const response = await fetch(
        `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': AZURE_CONTENT_TYPE,
            Accept: 'application/json',
          },
          body: audioBlob,
        }
      );

      if (!response.ok) {
        console.error('Azure STT HTTP error:', response.status, await response.text());
        speak('Speech service error. Please try again.');
        return;
      }

      const result = await response.json() as {
        DisplayText?: string;
        RecognitionStatus: string;
        NBest?: { Display: string }[];
      };

      if (result.RecognitionStatus === 'Success') {
        // Prefer NBest[0].Display (more accurate) then fall back to DisplayText
        const transcript = result.NBest?.[0]?.Display ?? result.DisplayText ?? '';
        if (transcript) {
          setUserInput(transcript);
        } else {
          notifyNoSpeechHeard();
        }
      } else if (result.RecognitionStatus === 'NoMatch') {
        notifyNoSpeechHeard();
      } else if (result.RecognitionStatus === 'InitialSilenceTimeout') {
        notifyNoSpeechHeard();
      } else {
        console.error('Azure STT unhandled status:', result.RecognitionStatus);
        speak('Could not process speech. Please try again.');
      }
    } catch (e) {
      console.error('stopListening error:', e);
      speak('Voice recognition failed');
    }
  }

  // ─── Submit to backend ────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!userInput.trim()) {
      speak('Please enter a question first');
      return;
    }
    try {
      setLoading(true);
      stopSpeaking();
      speak('Loading response');

      const loc = locationRef.current;
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

      const data: RequestData = {
        text: userInput,
        image: capturedImage ? [capturedImage] : [null],
        coords,
      };

      const res = await sendTextRequest(data);
      if (res?.output) {
        setAiResponse(res.output);
        setUserInput('');
        setCapturedImage(null);
        // Announce to screen readers
        AccessibilityInfo.announceForAccessibility(res.output);
      }
    } catch (e) {
      console.error('handleSubmit error:', e);
      const maybeAxiosError = e as {
        code?: string;
        message?: string;
        response?: unknown;
      };
      const isNetworkError =
        !maybeAxiosError?.response ||
        maybeAxiosError?.code === 'ECONNABORTED' ||
        maybeAxiosError?.message === 'Network Error';

      if (isNetworkError) {
        notifyNoInternetConnection();
        setAiResponse('No internet connection.');
      } else {
        speak('An error occurred. Please try again.');
        setAiResponse('An error occurred while processing your request. Please try again.');
      }
    } finally {
      setLoading(false);
      stopSpeaking();
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const cameraReady = cameraPermission?.granted;
  const captureLabel = recordingMode === 'recording-video'
    ? 'Recording... release to stop'
    : capturedImage
      ? 'Image Captured — tap to retake'
      : 'Tap for Photo  ·  Hold for Video';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* ── Blue Section: Camera ── */}
        <View style={styles.blueSection}>
          <Text style={styles.sectionLabel} accessibilityRole="header">
            {captureLabel}
          </Text>

          {!capturedImage && cameraReady ? (
            <Pressable
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              style={({ pressed }) => [
                styles.cameraButton,
                pressed && styles.cameraButtonPressed,
              ]}
              accessibilityLabel="Camera button. Tap for photo, hold for video."
              accessibilityRole="button"
              accessibilityHint="Tap quickly to take a photo. Hold to record video."
            >
              <View style={styles.cameraPreviewWrapper}>
                <CameraView
                  ref={cameraRef}
                  style={styles.cameraPreview}
                  facing={'back' as CameraType}
                  mode={recordingMode === 'recording-video' ? 'video' : 'picture'}
                />
              </View>
              <Text style={styles.cameraButtonLabel}>
                {recordingMode === 'recording-video' ? 'STOP VIDEO' : 'CAMERA BUTTON'}
              </Text>
            </Pressable>
          ) : capturedImage ? (
            <Button
              mode="contained"
              onPress={() => { setCapturedImage(null); setAiResponse(''); }}
              style={styles.retakeButton}
              labelStyle={styles.retakeLabel}
              accessibilityLabel="Retake photo or video"
            >
              Retake
            </Button>
          ) : (
            <Button
              mode="contained"
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
          <Text style={styles.sectionLabel}>Enter A Question Below</Text>

          <TextInput
            value={userInput}
            onChangeText={setUserInput}
            placeholder="Type your question here..."
            placeholderTextColor="#888"
            style={styles.textInput}
            multiline
            returnKeyType="done"
            accessibilityLabel="Question input field"
            accessibilityHint="Type or speak your question"
          />

          <Pressable
            onPress={toggleListening}
            style={[styles.voiceButton, isListening && styles.voiceButtonActive]}
            accessibilityLabel={isListening ? 'Stop listening' : 'Tap to speak your question'}
            accessibilityRole="button"
          >
            <Text style={styles.voiceButtonLabel}>
              {isListening ? '🎙 Listening...' : '🎙 Tap to Ask'}
            </Text>
          </Pressable>
        </View>

        {/* ── Green Section: Submit + Response ── */}
        <View style={styles.greenSection}>
          <Pressable
            onPress={handleSubmit}
            style={({ pressed }) => [styles.submitButton, pressed && styles.submitButtonPressed]}
            accessibilityLabel="Submit question"
            accessibilityRole="button"
            disabled={loading}
          >
            <Text style={styles.submitLabel}>Submit</Text>
          </Pressable>

          {loading && (
            <View style={styles.loadingContainer} accessibilityLiveRegion="polite">
              <ActivityIndicator size="large" color="#f8f8ff" />
              <Text style={styles.loadingText}>Loading response...</Text>
            </View>
          )}

          {!loading && aiResponse !== '' && (
            <View style={styles.responseContainer} accessibilityLiveRegion="polite">
              <View style={styles.responseActions}>
                <Pressable
                  onPress={() => Speech.speaking() ? Speech.stop() : speak(aiResponse)}
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
            </View>
          )}
        </View>

      </ScrollView>
      <CallAccessARideButton />
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
  },
  cameraButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  cameraPreviewWrapper: {
    width: '100%',
    height: 200,
    backgroundColor: '#111',
  },
  cameraPreview: {
    flex: 1,
  },
  cameraButtonLabel: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
    paddingVertical: 14,
  },
  retakeButton: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: '#fff',
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
  responseContainer: {
    gap: 12,
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
});
