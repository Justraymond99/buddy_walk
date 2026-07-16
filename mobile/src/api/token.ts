import { aiClient, apiClient } from './client';

interface SpeechToken {
  token: string;
  region: string;
}

/**
 * Azure speech tokens live ~10 minutes. Cache one client-side so Tap to Ask
 * never waits on a token round-trip (previously it re-fetched through the
 * Render proxy, which added cold-start latency and timeouts).
 */
const TOKEN_TTL_MS = 9 * 60 * 1000;

let cached: { value: SpeechToken; fetchedAt: number } | null = null;
let inFlight: Promise<SpeechToken> | null = null;

function isFresh(): boolean {
  return !!cached && Date.now() - cached.fetchedAt < TOKEN_TTL_MS;
}

async function fetchToken(): Promise<SpeechToken> {
  // Direct upstream first (fast, no Render cold start), Render as fallback.
  try {
    const response = await aiClient.get('/token/getToken', { timeout: 15_000 });
    if (response.data?.token && response.data?.region) {
      return { token: response.data.token, region: response.data.region };
    }
  } catch (e) {
    console.warn('getToken: direct AI host failed, falling back to Render', e);
  }

  const response = await apiClient.get('/token/getToken', { timeout: 45_000 });
  if (response.data?.token && response.data?.region) {
    return { token: response.data.token, region: response.data.region };
  }

  throw new Error('Failed to fetch speech token');
}

export async function getToken(): Promise<SpeechToken> {
  if (isFresh()) return cached!.value;

  if (!inFlight) {
    inFlight = fetchToken()
      .then((value) => {
        cached = { value, fetchedAt: Date.now() };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Warm the token cache without blocking the caller (fire on app launch). */
export function prefetchToken(): void {
  void getToken().catch(() => {});
}
