import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  AccessibilityInfo,
  Pressable,
  Share,
  AppState,
  Platform,
} from 'react-native';
import { Text, Button, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { RootStackParamList } from '../types';
import { describeApiError } from '../api/apiErrors';
import { checkCompanionApiAvailability } from '../api/companionAvailability';
import {
  buildShareUrl,
  createCompanionSession,
  pingCompanionSession,
  stopCompanionSession,
} from '../api/companion';
import { track, Events } from '../api/telemetry';

type Props = NativeStackScreenProps<RootStackParamList, 'Companion'>;

const ACTIVE_SESSION_KEY = '@buddywalk:companionSession:v1';
const PING_INTERVAL_MS = 15_000;

interface PersistedSession {
  token: string;
  ownerSecret: string;
  displayName?: string;
  expiresAt: string;
  startedAt: string;
}

function formatTime(iso?: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'unknown';
  return d.toLocaleTimeString();
}

function companionUnavailableMessage(
  reason: 'html_not_api' | 'network' | 'bad_response' | null
): string {
  if (Platform.OS === 'web') {
    if (reason === 'network') {
      return 'Could not reach the Companion API. Check your connection and reload this page.';
    }
    return 'Companion API is temporarily unavailable. Reload this page in a moment.';
  }
  if (reason === 'html_not_api') {
    return (
      'The configured backend does not expose /api/companion yet. Redeploy the latest server ' +
      'code or point EXPO_PUBLIC_COMPANION_API_URL at a host that does.'
    );
  }
  return (
    'Companion backend unreachable. On this PC run npm run serve in mobile/, then set ' +
    'EXPO_PUBLIC_COMPANION_API_URL to its LAN IP (same Wi-Fi as the phone). Q&A can stay on buddywalk.app.'
  );
}

export default function CompanionScreen({ navigation }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [session, setSession] = useState<PersistedSession | null>(null);
  const [working, setWorking] = useState(false);
  const [lastPingAt, setLastPingAt] = useState<string | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [companionAvailable, setCompanionAvailable] = useState<boolean | null>(null);
  const [companionUnavailableReason, setCompanionUnavailableReason] = useState<
    'html_not_api' | 'network' | 'bad_response' | null
  >(null);

  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const lastFixRef = useRef<Location.LocationObject | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<PersistedSession | null>(null);

  // Keep the ref in sync so the polling loop can read the latest session
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    checkCompanionApiAvailability().then(({ available, reason }) => {
      setCompanionAvailable(available);
      setCompanionUnavailableReason(available ? null : reason === 'ok' ? null : reason);
    });
  }, []);

  // Restore an in-progress sharing session if the user backed out of the screen.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as PersistedSession;
        if (!parsed?.token) return;
        if (new Date(parsed.expiresAt).getTime() < Date.now()) {
          await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
          return;
        }
        setSession(parsed);
        if (parsed.displayName) setDisplayName(parsed.displayName);
        await beginTracking(parsed);
      } catch (e) {
        console.warn('Failed to restore companion session:', e);
      }
    })();
    return () => {
      stopTracking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the OS pauses the JS interval (background), we'll catch up when
  // the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && sessionRef.current) {
        sendPingNow().catch(() => {});
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendPingNow = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    let fix = lastFixRef.current;
    if (!fix) {
      try {
        fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        lastFixRef.current = fix;
      } catch {
        return;
      }
    }
    try {
      await pingCompanionSession(current.token, current.ownerSecret, {
        lat: fix.coords.latitude,
        lon: fix.coords.longitude,
        accuracy: fix.coords.accuracy ?? undefined,
        heading: fix.coords.heading,
        speed: fix.coords.speed,
      });
      setLastPingAt(new Date().toISOString());
      setPingError(null);
    } catch (e: any) {
      console.warn('companion ping failed:', e?.message || e);
      setPingError('Could not reach the sharing server');
    }
  }, []);

  async function beginTracking(persisted: PersistedSession) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Location permission needed',
        'Buddy Walk needs location access to share your position with your contact.'
      );
      return;
    }

    locationSubRef.current?.remove();
    locationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 5,
        timeInterval: 5_000,
      },
      (loc) => {
        lastFixRef.current = loc;
      }
    );

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      sendPingNow().catch(() => {});
    }, PING_INTERVAL_MS);

    // fire one immediately so the viewer gets a fix right away
    sessionRef.current = persisted;
    setTimeout(() => {
      sendPingNow().catch(() => {});
    }, 800);
  }

  function stopTracking() {
    if (locationSubRef.current) {
      locationSubRef.current.remove();
      locationSubRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    lastFixRef.current = null;
  }

  async function handleStart() {
    setWorking(true);
    try {
      const created = await createCompanionSession(displayName);
      const persisted: PersistedSession = {
        token: created.token,
        ownerSecret: created.ownerSecret,
        displayName: created.displayName ?? displayName.trim() ?? undefined,
        expiresAt: created.expiresAt,
        startedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(persisted));
      setSession(persisted);
      setLastPingAt(null);
      setPingError(null);
      Speech.speak('Sharing started.', { language: 'en-US' });
      AccessibilityInfo.announceForAccessibility('Sharing started.');
      await beginTracking(persisted);
      void track(Events.CompanionSessionCreated, {
        hasDisplayName: Boolean(persisted.displayName),
      });
    } catch (e: unknown) {
      console.error('Failed to start companion session:', e);
      Alert.alert('Could not start sharing', describeApiError(e, 'companion'));
    } finally {
      setWorking(false);
    }
  }

  async function handleStop(silent = false) {
    const current = sessionRef.current;
    stopTracking();
    setSession(null);
    sessionRef.current = null;
    setLastPingAt(null);
    setPingError(null);
    await AsyncStorage.removeItem(ACTIVE_SESSION_KEY);
    if (current) {
      try {
        await stopCompanionSession(current.token, current.ownerSecret);
      } catch (e) {
        // best-effort; server will TTL-cleanup anyway
        console.warn('stopCompanionSession failed (link will still expire):', e);
      }
    }
    if (!silent) {
      Speech.speak('Sharing ended.', { language: 'en-US' });
      AccessibilityInfo.announceForAccessibility('Sharing ended.');
    }
  }

  async function handleShareLink() {
    if (!session) return;
    const url = buildShareUrl(session.token);
    try {
      await Share.share({
        message: `Follow my live location on Buddy Walk:\n${url}`,
        url: Platform.OS === 'ios' ? url : undefined,
        title: 'Buddy Walk — live location',
      });
      void track(Events.CompanionLinkShared);
    } catch (e) {
      console.warn('share failed:', e);
    }
  }

  const url = session ? buildShareUrl(session.token) : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor="#fff"
          size={28}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to main screen"
        />
        <Text style={styles.headerTitle} accessibilityRole="header">
          Companion Mode
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Share your live location with a trusted contact. They open the link in any web
          browser — no app or account needed.
        </Text>

        {companionAvailable === false && (
          <View style={styles.warnBox} accessibilityRole="alert">
            <Text style={styles.warnTitle}>Companion API not on this server yet</Text>
            <Text style={styles.warnText}>
              {companionUnavailableMessage(companionUnavailableReason)}
            </Text>
          </View>
        )}

        {!session ? (
          <View style={styles.card}>
            <Text style={styles.label}>Your name (optional)</Text>
            <Text style={styles.helper}>
              Shown to whoever opens your link, e.g. "Alex – Live Location".
            </Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="e.g. Alex"
              placeholderTextColor="#888"
              maxLength={60}
              style={styles.input}
              accessibilityLabel="Optional display name"
            />

            <Pressable
              onPress={handleStart}
              disabled={working || companionAvailable === false}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
                working && styles.primaryButtonDisabled,
              ]}
              accessibilityLabel="Start sharing my live location"
              accessibilityRole="button"
            >
              {working ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.primaryButtonLabel}>START SHARING</Text>
              )}
            </Pressable>

            <Text style={styles.fineprint}>
              The link expires automatically after 6 hours of inactivity. You can end it
              any time from this screen.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <View style={styles.liveDot} />
              <Text style={styles.statusText}>Sharing live</Text>
            </View>

            <Text style={styles.label}>Shareable link</Text>
            <View style={styles.linkBox} accessible accessibilityLabel={`Shareable link: ${url}`}>
              <Text style={styles.linkText} selectable>
                {url}
              </Text>
            </View>

            <Pressable
              onPress={handleShareLink}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
              ]}
              accessibilityLabel="Share live location link"
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonLabel}>SHARE LINK</Text>
            </Pressable>

            <View style={styles.detailsRow}>
              <Text style={styles.detailLabel}>Last update sent</Text>
              <Text style={styles.detailValue}>{formatTime(lastPingAt)}</Text>
            </View>
            <View style={styles.detailsRow}>
              <Text style={styles.detailLabel}>Expires</Text>
              <Text style={styles.detailValue}>{formatTime(session.expiresAt)}</Text>
            </View>

            {pingError ? (
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                {pingError}
              </Text>
            ) : null}

            <Button
              mode="outlined"
              onPress={() => handleStop(false)}
              style={styles.stopButton}
              labelStyle={styles.stopButtonLabel}
              textColor="#fff"
              accessibilityLabel="End sharing now"
            >
              END SHARING
            </Button>

            <Text style={styles.fineprint}>
              Live updates only flow while Buddy Walk is open on this device. Switching
              apps or locking the screen will pause updates until you come back.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 4,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  scroll: { padding: 20, gap: 16, flexGrow: 1 },
  lead: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 4,
  },
  warnBox: {
    backgroundColor: '#3d1f1f',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#8b3a3a',
    gap: 8,
  },
  warnTitle: {
    color: '#ffb4a9',
    fontSize: 16,
    fontWeight: '700',
  },
  warnText: {
    color: '#f0d0cc',
    fontSize: 14,
    lineHeight: 21,
  },
  warnMono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#fff',
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 16,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#2a313c',
  },
  label: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  helper: {
    color: '#aab1bd',
    fontSize: 13,
    lineHeight: 20,
    marginTop: -4,
  },
  input: {
    backgroundColor: '#fff',
    color: '#000',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  primaryButton: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryButtonPressed: { backgroundColor: '#e0e0e0' },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonLabel: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  fineprint: {
    color: '#8a93a3',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  liveDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2ecc71',
  },
  statusText: {
    color: '#2ecc71',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  linkBox: {
    backgroundColor: '#0e1116',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2a313c',
  },
  linkText: { color: '#8aa6ff', fontSize: 15 },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLabel: { color: '#aab1bd', fontSize: 14 },
  detailValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  errorText: { color: '#ff8a8a', fontSize: 14 },
  stopButton: {
    borderRadius: 14,
    borderColor: '#fff',
    marginTop: 4,
  },
  stopButtonLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1.2,
  },
});
