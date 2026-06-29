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

/** True when GET /api/companion/health succeeds on the companion backend. */
export async function checkCompanionApiAvailability(): Promise<CompanionAvailabilityResult> {
  try {
    const res = await companionApiClient.get('/companion/health', { timeout: 8000 });
    if (res.status !== 200) {
      return { available: false, reason: 'bad_response' };
    }
    if (typeof res.data === 'string') {
      return { available: false, reason: 'html_not_api' };
    }
    return isHealthyPayload(res.data)
      ? { available: true, reason: 'ok' }
      : { available: false, reason: 'bad_response' };
  } catch {
    return { available: false, reason: 'network' };
  }
}

export async function isCompanionApiAvailable(): Promise<boolean> {
  return (await checkCompanionApiAvailability()).available;
}
