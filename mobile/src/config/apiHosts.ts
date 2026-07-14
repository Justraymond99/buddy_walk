import defaultApi from '../../buddy-walk-default-api.json';

/** Hosts we no longer use — client always redirects these to `apiRoot`. */
const LEGACY_HOSTS: string[] =
  (defaultApi as { legacyApiHosts?: string[] }).legacyApiHosts ?? ['buddywalk.app'];

export const OWNED_API_ROOT = defaultApi.apiRoot.replace(/\/+$/, '').replace(/\/api$/i, '');

function hostnameOf(root: string): string | null {
  try {
    const url = root.match(/^https?:\/\//i) ? root : `https://${root}`;
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

export function isLegacyApiHost(root: string): boolean {
  const host = hostnameOf(root);
  if (!host) return false;
  return LEGACY_HOSTS.some((legacy) => host === legacy.replace(/^www\./i, '').toLowerCase());
}

/** Never send TestFlight / production traffic to abandoned upstream hosts. */
export function applyOwnedApiHostGuardrail(root: string): string {
  if (!root || isLegacyApiHost(root)) {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && root && isLegacyApiHost(root)) {
      console.warn(
        `[Buddy Walk] Blocked legacy API host "${root}" — using ${OWNED_API_ROOT} instead.`
      );
    }
    return OWNED_API_ROOT;
  }
  return root.replace(/\/+$/, '').replace(/\/api$/i, '');
}
