import { resolveCompanionShareBaseUrl } from './client';
import { companionApiClient } from './companionClient';
import { buildCompanionShareUrl } from './companionUrl';

export interface CompanionSession {
  token: string;
  ownerSecret: string;
  displayName?: string | null;
  expiresAt: string;
}

export interface CompanionPing {
  lat: number;
  lon: number;
  accuracy?: number;
  heading?: number | null;
  speed?: number | null;
}

/** Public URL the wearer shares with their caretaker. */
export function buildShareUrl(token: string, baseUrl = resolveCompanionShareBaseUrl()): string {
  return buildCompanionShareUrl(token, baseUrl);
}

export async function createCompanionSession(displayName?: string): Promise<CompanionSession> {
  const res = await companionApiClient.post('/companion/create', {
    displayName: displayName?.trim() || undefined,
  });
  return res.data as CompanionSession;
}

export async function pingCompanionSession(
  token: string,
  ownerSecret: string,
  payload: CompanionPing
): Promise<{ ok: true; expiresAt: string }> {
  const res = await companionApiClient.post('/companion/ping', {
    token,
    ownerSecret,
    ...payload,
  });
  return res.data;
}

export async function stopCompanionSession(token: string, ownerSecret: string): Promise<void> {
  await companionApiClient.post('/companion/stop', { token, ownerSecret });
}
