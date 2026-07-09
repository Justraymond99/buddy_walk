import { companionApiClient } from './companionClient';

export type CompanionAvailabilityReason =
  | 'ok'
  | 'network'
  | 'html_not_api'
  | 'bad_response';

export interface CompanionAvailabilityResult {
  available: boolean;
  reason: CompanionAvailabilityReason;
}

function isHealthyPayload(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { ok?: boolean }).ok === true;
}

function looksLikeHtmlPayload(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  const lower = data.toLowerCase();
  return lower.includes('<!doctype html') || lower.includes('<html');
}

/** True when the companion API returns JSON (not the SPA HTML shell). */
export async function checkCompanionApiAvailability(): Promise<CompanionAvailabilityResult> {
  try {
    // Generous timeout: a free-tier host waking from idle can take a while
    // on the first request, and failing here silently downgrades to maps mode.
    const health = await companionApiClient.get('/companion/health', {
      timeout: 20000,
      validateStatus: () => true,
    });
    if (health.status !== 200 || looksLikeHtmlPayload(health.data)) {
      return { available: false, reason: 'html_not_api' };
    }
    if (!isHealthyPayload(health.data)) {
      return { available: false, reason: 'bad_response' };
    }

    const snapshot = await companionApiClient.get('/companion/snapshot', {
      params: { token: 'healthcheck' },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (looksLikeHtmlPayload(snapshot.data)) {
      return { available: false, reason: 'html_not_api' };
    }
    if (typeof snapshot.data !== 'object' || snapshot.data === null) {
      return { available: false, reason: 'bad_response' };
    }

    return { available: true, reason: 'ok' };
  } catch {
    return { available: false, reason: 'network' };
  }
}

export async function isCompanionApiAvailable(): Promise<boolean> {
  return (await checkCompanionApiAvailability()).available;
}
