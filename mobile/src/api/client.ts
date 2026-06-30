import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import defaultApi from '../../buddy-walk-default-api.json';

function isPrivateDevHost(url: string): boolean {
  return /localhost|127\.|192\.168\.|10\.|100\.|\b172\.(1[6-9]|2\d|3[01])\./i.test(url);
}

function normalizeApiRoot(raw: string): string {
  return raw.replace(/\/+$/, '').replace(/\/api$/i, '');
}

function readEnvRoot(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return normalizeApiRoot(raw.trim());
  }
  return undefined;
}

/** Backend API root for Q&A, audio, tokens (see buddy-walk-default-api.json). */
function resolveApiRoot(): string {
  // Web always uses same-origin /api (Vercel serverless). Do not let a build-time
  // EXPO_PUBLIC_API_URL override this — the Vercel dashboard may still set it.
  if (Platform.OS === 'web') return '';
  const inlined = readEnvRoot('EXPO_PUBLIC_API_URL');
  if (inlined) return inlined;
  const fromExtra = Constants.expoConfig?.extra?.buddyWalkApiUrl;
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) {
    return normalizeApiRoot(fromExtra.trim());
  }
  return normalizeApiRoot(defaultApi.apiRoot);
}

/** Companion API root — defaults to API_ROOT; set EXPO_PUBLIC_COMPANION_API_URL for local companion only. */
export function resolveCompanionApiRoot(): string {
  const custom = readEnvRoot('EXPO_PUBLIC_COMPANION_API_URL');
  if (custom) return custom;
  if (Platform.OS === 'web') return resolveApiRoot();
  const fromDefault = (defaultApi as { companionApiRoot?: string }).companionApiRoot;
  if (typeof fromDefault === 'string' && fromDefault.trim().length > 0) {
    return normalizeApiRoot(fromDefault.trim());
  }
  return resolveApiRoot();
}

/**
 * Base URL for caretaker share links (`/companion/:token` viewer page).
 * Must match the host that stores companion sessions (same as COMPANION_API_ROOT).
 */
export function resolveCompanionShareBaseUrl(): string {
  const custom = readEnvRoot('EXPO_PUBLIC_COMPANION_SHARE_URL');
  if (custom) return custom;
  if (Platform.OS === 'web') return resolveApiRoot();
  const apiRoot = resolveCompanionApiRoot();
  if (/^https?:\/\//i.test(apiRoot) && !isPrivateDevHost(apiRoot)) {
    return apiRoot;
  }
  // Local dev: share links need a public URL — set EXPO_PUBLIC_COMPANION_SHARE_URL.
  return normalizeApiRoot(defaultApi.apiRoot);
}

/** Root of the Buddy Walk backend (no `/api` suffix). */
export const API_ROOT = resolveApiRoot();

/** Root used for companion create/ping/share (no `/api` suffix). */
export const COMPANION_API_ROOT = resolveCompanionApiRoot();

export const apiClient = axios.create({
  baseURL: `${API_ROOT}/api`,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});
