/**
 * Per-capability routing between local handlers and the upstream proxy.
 *
 * Each capability is served locally only when ITS OWN credentials are present,
 * and proxied upstream otherwise. A single flag keyed off the AI keys used to
 * decide this for every service at once, which meant adding an OPENAI_API_KEY
 * silently moved the Azure speech token off the working proxy and onto an
 * unconfigured local route — taking voice input down with it.
 */
const DEFAULT_UPSTREAM = 'https://buddywalk.app';

function anyPresent(...names: string[]): boolean {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

function allPresent(...names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

/** OpenAI / Gemini: /api/text, /api/parseRequest, /api/audio, /api/last-mile. */
export function hasOwnAiKeys(): boolean {
  return anyPresent('OPENAI_API_KEY', 'GEMINI_API_KEY');
}

/** Azure Speech: /api/token/getToken and /api/transcribe. Both keys required. */
export function hasOwnSpeechKeys(): boolean {
  return allPresent('AZURE_SUBSCRIPTION_KEY', 'AZURE_REGION');
}

/** MTA arrivals: /api/mta. */
export function hasOwnMtaKey(): boolean {
  return allPresent('MTA_API_KEY');
}

export function getUpstreamApiRoot(): string {
  const raw = (process.env.UPSTREAM_API_ROOT || DEFAULT_UPSTREAM).trim();
  return raw.replace(/\/+$/, '').replace(/\/api$/i, '');
}

export type ServiceRoute = 'local' | 'proxy';

export type ServiceRouting = {
  ai: ServiceRoute;
  speech: ServiceRoute;
  mta: ServiceRoute;
};

function route(hasKeys: boolean): ServiceRoute {
  return hasKeys ? 'local' : 'proxy';
}

/**
 * ZERO_CONFIG forces every capability one way, which is useful for testing the
 * proxy path on a host that does have keys. Left unset, each capability is
 * decided independently on its own credentials.
 */
export function getServiceRouting(): ServiceRouting {
  const flag = process.env.ZERO_CONFIG?.trim().toLowerCase();
  if (flag === '1' || flag === 'true') {
    return { ai: 'proxy', speech: 'proxy', mta: 'proxy' };
  }
  if (flag === '0' || flag === 'false') {
    return { ai: 'local', speech: 'local', mta: 'local' };
  }
  return {
    ai: route(hasOwnAiKeys()),
    speech: route(hasOwnSpeechKeys()),
    mta: route(hasOwnMtaKey()),
  };
}

/** True when at least one capability still depends on the upstream proxy. */
export function isZeroConfigMode(): boolean {
  const routing = getServiceRouting();
  return (
    routing.ai === 'proxy' ||
    routing.speech === 'proxy' ||
    routing.mta === 'proxy'
  );
}

export function describeServerMode(): {
  mode: 'zero-config' | 'self-hosted' | 'mixed';
  upstream?: string;
  routing: ServiceRouting;
  storage: 'mongo' | 'memory';
} {
  const routing = getServiceRouting();
  const values = [routing.ai, routing.speech, routing.mta];
  const allProxy = values.every((value) => value === 'proxy');
  const allLocal = values.every((value) => value === 'local');

  return {
    mode: allProxy ? 'zero-config' : allLocal ? 'self-hosted' : 'mixed',
    upstream: allLocal ? undefined : getUpstreamApiRoot(),
    routing,
    storage: 'memory', // updated in index.ts after mongo connect attempt
  };
}
