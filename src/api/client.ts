import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import defaultApi from '../../buddy-walk-default-api.json';

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
  const inlined = readEnvRoot('EXPO_PUBLIC_API_URL');
  if (inlined) return inlined;
  // On web, default to a same-origin relative root ('' -> requests go to
  // `/api`). A Vercel rewrite proxies `/api/*` to the real backend, so the
  // browser never makes a cross-origin call and CORS is a non-issue.
  if (Platform.OS === 'web') return '';
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
 * On web, the Vercel deployment serves the viewer on the same origin.
 */
export function resolveCompanionShareBaseUrl(): string {
  const custom = readEnvRoot('EXPO_PUBLIC_COMPANION_SHARE_URL');
  if (custom) return custom;
  if (Platform.OS === 'web') return resolveApiRoot();
  const fromDefault = (defaultApi as { companionApiRoot?: string }).companionApiRoot;
  if (typeof fromDefault === 'string' && fromDefault.trim().length > 0) {
    return normalizeApiRoot(fromDefault.trim());
  }
  return resolveCompanionApiRoot();
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
