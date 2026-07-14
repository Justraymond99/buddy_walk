/**
 * Zero-config mode: no API keys or MongoDB required on Render.
 * AI / speech / MTA requests are proxied upstream; telemetry, feedback,
 * chat logs, and companion sessions are stored locally (in memory).
 */
const DEFAULT_UPSTREAM = 'https://buddywalk.app';

function hasOwnAiKeys(): boolean {
  return Boolean(
    (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) ||
      (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim())
  );
}

export function getUpstreamApiRoot(): string {
  const raw = (process.env.UPSTREAM_API_ROOT || DEFAULT_UPSTREAM).trim();
  return raw.replace(/\/+$/, '').replace(/\/api$/i, '');
}

/** True when we should proxy AI routes instead of calling OpenAI/Gemini locally. */
export function isZeroConfigMode(): boolean {
  if (process.env.ZERO_CONFIG === '1' || process.env.ZERO_CONFIG === 'true') {
    return true;
  }
  if (process.env.ZERO_CONFIG === '0' || process.env.ZERO_CONFIG === 'false') {
    return false;
  }
  return !hasOwnAiKeys();
}

export function describeServerMode(): {
  mode: 'zero-config' | 'self-hosted';
  upstream?: string;
  storage: 'mongo' | 'memory';
} {
  const zeroConfig = isZeroConfigMode();
  return {
    mode: zeroConfig ? 'zero-config' : 'self-hosted',
    upstream: zeroConfig ? getUpstreamApiRoot() : undefined,
    storage: 'memory', // updated in index.ts after mongo connect attempt
  };
}
