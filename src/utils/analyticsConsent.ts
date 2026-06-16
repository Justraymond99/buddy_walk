import AsyncStorage from '@react-native-async-storage/async-storage';

const OPT_OUT_KEY = '@buddywalk:analyticsOptOut';

/**
 * Usage tracking is anonymous and on by default during testing, but every tester
 * can opt out. The choice is cached in memory so the hot telemetry path never
 * has to await storage.
 */
let cachedOptOut: boolean | null = null;

const listeners = new Set<(optedOut: boolean) => void>();

export async function isAnalyticsOptedOut(): Promise<boolean> {
  if (cachedOptOut !== null) return cachedOptOut;
  try {
    const raw = await AsyncStorage.getItem(OPT_OUT_KEY);
    cachedOptOut = raw === 'true';
  } catch {
    cachedOptOut = false;
  }
  return cachedOptOut;
}

/** Synchronous best-effort read for the hot path; defaults to opted-in. */
export function isAnalyticsOptedOutSync(): boolean {
  return cachedOptOut === true;
}

export async function setAnalyticsOptedOut(optedOut: boolean): Promise<void> {
  cachedOptOut = optedOut;
  try {
    await AsyncStorage.setItem(OPT_OUT_KEY, optedOut ? 'true' : 'false');
  } catch {
    // Keep the in-memory value even if persistence fails.
  }
  listeners.forEach((fn) => fn(optedOut));
}

export function subscribeAnalyticsOptOut(fn: (optedOut: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Warm the in-memory cache early (e.g. on app start). */
export async function primeAnalyticsConsent(): Promise<void> {
  await isAnalyticsOptedOut();
}
