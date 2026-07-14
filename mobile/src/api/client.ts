import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import defaultApi from '../../buddy-walk-default-api.json';
import { applyOwnedApiHostGuardrail } from '../config/apiHosts';

export function isPrivateDevHost(url: string): boolean {
  return /localhost|127\.|192\.168\.|10\.|100\.|\b172\.(1[6-9]|2\d|3[01])\./i.test(url);
}

/** True when companion sessions are stored on a LAN / Tailscale host (not public buddywalk.app). */
export function isLocalCompanionApi(): boolean {
  if (readEnvRoot('EXPO_PUBLIC_COMPANION_API_URL')) return true;
  return isPrivateDevHost(resolveCompanionApiRoot());
}

function isLoopbackHost(url: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(url);
}

function normalizeApiRoot(raw: string): string {
  return raw.replace(/\/+$/, '').replace(/\/api$/i, '');
}

const PRODUCTION_API_ROOT = applyOwnedApiHostGuardrail(
  defaultApi.apiRoot.replace(/\/+$/, '').replace(/\/api$/i, '')
);

/** Physical phones cannot reach a dev machine via localhost — use production or a LAN IP. */
function applyPhysicalDeviceApiRootFix(root: string): string {
  if (Platform.OS === 'web' || !Constants.isDevice || !isLoopbackHost(root)) {
    return root;
  }
  if (__DEV__) {
    console.warn(
      '[Buddy Walk] EXPO_PUBLIC_API_URL points to localhost on a physical device; ' +
        `using ${PRODUCTION_API_ROOT} instead. For a local backend, set your computer's LAN IP ` +
        '(e.g. http://192.168.1.50:8000).'
    );
  }
  return PRODUCTION_API_ROOT;
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
  if (inlined) {
    const root = Platform.OS === 'web' ? inlined : applyPhysicalDeviceApiRootFix(inlined);
    return applyOwnedApiHostGuardrail(root);
  }
  const fromExtra = Constants.expoConfig?.extra?.buddyWalkApiUrl;
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) {
    const root = normalizeApiRoot(fromExtra.trim());
    const resolved = Platform.OS === 'web' ? root : applyPhysicalDeviceApiRootFix(root);
    return applyOwnedApiHostGuardrail(resolved);
  }
  return PRODUCTION_API_ROOT;
}

/** Companion API root — defaults to API_ROOT; set EXPO_PUBLIC_COMPANION_API_URL for local companion only. */
export function resolveCompanionApiRoot(): string {
  const custom = readEnvRoot('EXPO_PUBLIC_COMPANION_API_URL');
  if (custom) return applyOwnedApiHostGuardrail(custom);
  if (Platform.OS === 'web') return resolveApiRoot();
  const fromDefault = (defaultApi as { companionApiRoot?: string }).companionApiRoot;
  if (typeof fromDefault === 'string' && fromDefault.trim().length > 0) {
    return applyOwnedApiHostGuardrail(normalizeApiRoot(fromDefault.trim()));
  }
  return resolveApiRoot();
}

/**
 * Base URL for caretaker share links (`/companion-viewer.html?token=…`).
 * LAN / Tailscale companion servers serve the viewer on the same host as the API.
 * Public production uses GitHub Pages (see buddy-walk-default-api.json).
 */
export function resolveCompanionShareBaseUrl(): string {
  const custom = readEnvRoot('EXPO_PUBLIC_COMPANION_SHARE_URL');
  if (custom) return applyOwnedApiHostGuardrail(custom);
  if (Platform.OS === 'web') return resolveApiRoot();

  const companionApi = resolveCompanionApiRoot();
  const companionOverride = readEnvRoot('EXPO_PUBLIC_COMPANION_API_URL');

  // Express serves companion-viewer.html on the same host as /api/companion/*.
  if (companionOverride || isPrivateDevHost(companionApi)) {
    return companionApi;
  }

  const fromDefault = (defaultApi as { companionShareBaseUrl?: string }).companionShareBaseUrl;
  if (typeof fromDefault === 'string' && fromDefault.trim().length > 0) {
    return applyOwnedApiHostGuardrail(normalizeApiRoot(fromDefault.trim()));
  }

  if (/^https?:\/\//i.test(companionApi)) {
    return companionApi;
  }
  return PRODUCTION_API_ROOT;
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
