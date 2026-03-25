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
  Keyboard,
} from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { Magnetometer, DeviceMotion } from 'expo-sensors';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

import * as VideoThumbnails from 'expo-video-thumbnails';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import CallAccessARideButton from '../components/CallAccessARideButton';
import { sendTextRequest } from '../api/openAi';
import { createChatLog, addChatToChatLog, flagMessage } from '../api/chatLog';
import { getToken } from '../api/token';
import { RequestData, CustomCoords } from '../types';

const HOLD_THRESHOLD_MS = 600;
const MAX_VIDEO_DURATION_MS = 30000;

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

  const [videoFrames, setVideoFrames] = useState<string[]>([]);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportReason, setReportReason] = useState('');

  const locationRef = useRef<Location.LocationObject | null>(null);
  const headingRef = useRef<number>(0);
  const orientationRef = useRef<{ alpha: number | null; beta: number | null; gamma: number | null }>({ alpha: null, beta: null, gamma: null });
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRecordingRef = useRef<Audio.Recording | null>(null);
  const azureTokenRef = useRef<{ token: string; region: string } | null>(null);

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

    DeviceMotion.setUpdateInterval(500);
    const motionSub = DeviceMotion.addListener(({ rotation }) => {
      if (rotation) {
        orientationRef.current = {
          alpha: rotation.alpha ?? null,
          beta: rotation.beta ?? null,
          gamma: rotation.gamma ?? null,
        };
      }
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
      motionSub.remove();
    };
  }, []);

  // ─── Sound effects ───────────────────────────────────────────────────────

  const playListenStart = useCallback(async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/listen_start.mp3'),
        { shouldPlay: true, volume: 0.6 }
      );
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) sound.unloadAsync();
      });
    } catch {
      // sound file missing or audio unavailable — fail silently
    }
  }, []);

  const playListenStop = useCallback(async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/listen_stop.mp3'),
        { shouldPlay: true, volume: 0.6 }
      );
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) sound.unloadAsync();
      });
    } catch {
      // sound file missing or audio unavailable — fail silently
    }
  }, []);

  // ─── TTS ─────────────────────────────────────────────────────────────────

  const speak = useCallback((text: string) => {
    Speech.stop();
    Speech.speak(text, { language: 'en-US', rate: 1.0 });
  }, []);

  const stopSpeaking = useCallback(() => Speech.stop(), []);

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      startVideoRecording();
    }, HOLD_THRESHOLD_MS);
  }

  async function handlePressOut() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      await takePhoto();
    } else if (recordingMode === 'recording-video') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
        speak('Image captured');
      }
    } catch (e) {
      console.error('takePhoto error:', e);
      speak('Could not capture image');
    }
  }

  async function extractFrames(uri: string): Promise<string[]> {
    const frames: string[] = [];
    const intervalSecs = 2;
    const maxFrames = 8;
    try {
      for (let i = 0; i < maxFrames; i++) {
        const { uri: frameUri } = await VideoThumbnails.getThumbnailAsync(uri, {
          time: i * intervalSecs * 1000,
          quality: 0.5,
        });
        const response = await fetch(frameUri);
        const blob = await response.blob();
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        frames.push(base64);
      }
    } catch {
      // fewer frames than expected is fine — return what we got
    }
    return frames;
  }

  async function startVideoRecording() {
    if (!cameraRef.current) return;
    try {
      setRecordingMode('recording-video');
      setVideoFrames([]);
      speak('Recording video');
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_VIDEO_DURATION_MS / 1000 });
      if (video?.uri) {
        speak('Processing video');
        const frames = await extractFrames(video.uri);
        if (frames.length > 0) {
          setVideoFrames(frames);
          speak(`Video captured. ${frames.length} frames extracted`);
        } else {
          speak('Video captured');
        }
        setUserInput('Describe the video');
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
      try {
        const tok = await getToken();
        if (tok) {
          azureTokenRef.current = tok;
        } else {
          Alert.alert('Voice Input Unavailable', 'Could not connect to the speech service. Make sure the backend is running and try again.');
          return;
        }
      } catch {
        Alert.alert('Voice Input Unavailable', 'Could not connect to the speech service. Make sure the backend is running and try again.');
        return;
      }
    }
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(AZURE_RECORDING_OPTIONS);
      audioRecordingRef.current = recording;
      setIsListening(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      playListenStart();
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

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      playListenStop();
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
          speak('Nothing was heard. Please try again.');
        }
      } else if (result.RecognitionStatus === 'NoMatch') {
        speak('Could not understand. Please speak more clearly and try again.');
      } else if (result.RecognitionStatus === 'InitialSilenceTimeout') {
        speak('No speech detected. Please try again.');
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      speak('Please enter a question first');
      return;
    }
    try {
      Keyboard.dismiss();
      setLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
            orientation: orientationRef.current,
          }
        : null;

      const images: (string | null)[] = videoFrames.length > 0
        ? videoFrames
        : capturedImage
          ? [capturedImage]
          : [null];

      const data: RequestData = {
        text: userInput,
        image: images,
        coords,
      };

      const res = await sendTextRequest(data);
      if (res?.output) {
        setAiResponse(res.output);
        setUserInput('');
        setCapturedImage(null);
        setVideoFrames([]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        AccessibilityInfo.announceForAccessibility(res.output);
      }
    } catch (e) {
      console.error('handleSubmit error:', e);
      speak('An error occurred. Please try again.');
      setAiResponse('An error occurred while processing your request. Please try again.');
    } finally {
      setLoading(false);
      stopSpeaking();
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const cameraReady = cameraPermission?.granted;
  const captureLabel = recordingMode === 'recording-video'
    ? 'Recording... release to stop'
    : videoFrames.length > 0
      ? `Video Captured — ${videoFrames.length} frames`
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
          ) : capturedImage || videoFrames.length > 0 ? (
            <Button
              mode="contained"
              onPress={() => { setCapturedImage(null); setVideoFrames([]); setAiResponse(''); }}
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
                  onPress={async () => {
                    const speaking = await Speech.isSpeakingAsync();
                    speaking ? Speech.stop() : speak(aiResponse);
                  }}
                  style={styles.actionButton}
                  accessibilityLabel="Play or pause text to speech"
                  accessibilityRole="button"
                >
                  <Text style={styles.actionButtonLabel}>🔊 Play / Pause</Text>
                </Pressable>

                <Pressable
                  onPress={async () => {
                    await Clipboard.setStringAsync(aiResponse);
                    speak('Response copied');
                  }}
                  style={styles.actionButton}
                  accessibilityLabel="Copy response to clipboard"
                  accessibilityRole="button"
                >
                  <Text style={styles.actionButtonLabel}>📋 Copy</Text>
                </Pressable>

                <Pressable
                  onPress={() => setReportVisible(true)}
                  style={[styles.actionButton, styles.reportButton]}
                  accessibilityLabel="Report this response"
                  accessibilityRole="button"
                >
                  <Text style={styles.reportButtonLabel}>⚑ Report</Text>
                </Pressable>
              </View>

              <Text
                style={styles.responseText}
                accessibilityLabel={`AI Response: ${aiResponse}`}
              >
                {aiResponse}
              </Text>

              {reportVisible && (
                <View style={styles.reportContainer}>
                  <Text style={styles.reportTitle}>Why are you reporting this?</Text>
                  <TextInput
                    value={reportReason}
                    onChangeText={setReportReason}
                    placeholder="Describe the issue (optional)"
                    placeholderTextColor="#888"
                    style={styles.reportInput}
                    multiline
                    accessibilityLabel="Report reason input"
                  />
                  <View style={styles.reportActions}>
                    <Pressable
                      onPress={async () => {
                        await flagMessage({
                          messageId: currentMessageId,
                          chatlogId: currentChatId,
                          flagReason: reportReason,
                        });
                        setReportVisible(false);
                        setReportReason('');
                        speak('Response reported. Thank you.');
                      }}
                      style={styles.actionButton}
                      accessibilityLabel="Submit report"
                      accessibilityRole="button"
                    >
                      <Text style={styles.actionButtonLabel}>Submit</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { setReportVisible(false); setReportReason(''); }}
                      style={[styles.actionButton, styles.cancelButton]}
                      accessibilityLabel="Cancel report"
                      accessibilityRole="button"
                    >
                      <Text style={styles.cancelButtonLabel}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              )}
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
  reportButton: {
    backgroundColor: '#3a0000',
  },
  reportButtonLabel: {
    color: '#ff6b6b',
    fontSize: 16,
    fontWeight: '700',
  },
  reportContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  reportTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  reportInput: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#000',
    minHeight: 60,
  },
  reportActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    backgroundColor: '#333',
  },
  cancelButtonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
