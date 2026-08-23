import axios, { AxiosResponse } from 'axios';
import express, { Application, Request, Response } from 'express';
import { getUpstreamApiRoot } from '../config/serverMode';
import { aiRequestLogService } from '../services/aiRequestLog';
import {
  compressUserPhoto,
  lastMileTestLogService,
} from '../services/lastMileTestLog';

function truncate(value: unknown, max = 800): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function pickForwardHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth) out.Authorization = auth;
  return out;
}

function extractOutputText(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.output === 'string') return record.output;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.text === 'string') return record.text;
  return undefined;
}

async function recordProxyMetrics(
  req: Request,
  upstreamRes: AxiosResponse,
  startedAt: number,
  feature: string
): Promise<void> {
  const body = req.body as Record<string, unknown> | undefined;
  const analytics = (body?.analytics ?? {}) as Record<string, unknown>;
  const inputText = truncate(body?.text);
  const outputText = truncate(extractOutputText(upstreamRes.data));
  const success = upstreamRes.status >= 200 && upstreamRes.status < 300;
  const images = Array.isArray(body?.image) ? body.image : [];

  await aiRequestLogService.record({
    requestId: typeof analytics.requestId === 'string' ? analytics.requestId : undefined,
    installId: typeof analytics.installId === 'string' ? analytics.installId : undefined,
    sessionId: typeof analytics.sessionId === 'string' ? analytics.sessionId : undefined,
    platform: typeof analytics.platform === 'string' ? analytics.platform : undefined,
    appVersion: typeof analytics.appVersion === 'string' ? analytics.appVersion : undefined,
    feature: typeof analytics.feature === 'string' ? analytics.feature : feature,
    inputLength: typeof body?.text === 'string' ? body.text.length : 0,
    inputText,
    outputText,
    hasImage: images.some(Boolean),
    imageCount: images.filter(Boolean).length,
    hasCoords: Boolean(body?.coords),
    success,
    errorCode: success ? undefined : String(upstreamRes.status),
    latencyMs: Date.now() - startedAt,
    outputLength: outputText?.length,
  });
}

async function forwardJson(req: Request, res: Response, upstreamPath: string): Promise<void> {
  const startedAt = Date.now();
  const upstreamRoot = getUpstreamApiRoot();
  const url = `${upstreamRoot}${upstreamPath}`;
  const method = (req.method || 'GET').toUpperCase();
  // Google frontends (buddywalk.app) reject GET requests that include a body /
  // Content-Type: application/json with HTTP 400. Only forward a body on
  // methods that actually carry one.
  const hasBody = method !== 'GET' && method !== 'HEAD' && req.body !== undefined;

  try {
    const upstreamRes = await axios({
      method,
      url,
      ...(hasBody ? { data: req.body } : {}),
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...pickForwardHeaders(req),
      },
      validateStatus: () => true,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120_000,
    });

    if (upstreamPath === '/api/text' || upstreamPath === '/api/parseRequest') {
      await recordProxyMetrics(req, upstreamRes, startedAt, upstreamPath.includes('parse') ? 'parse' : 'text');
    }

    let payload: unknown = upstreamRes.data;
    if (upstreamPath === '/api/last-mile') {
      payload = await recordProxiedLastMile(req, upstreamRes, startedAt);
    }

    res.status(upstreamRes.status);
    if (upstreamRes.headers['content-type']) {
      res.set('Content-Type', upstreamRes.headers['content-type']);
    }
    res.send(payload);
  } catch (error) {
    console.error(`[upstreamProxy] ${upstreamPath} failed:`, error);
    if (upstreamPath === '/api/last-mile') {
      const localId = await recordProxiedLastMileFailure(req, startedAt, error);
      res.status(502).json({
        error: 'Upstream API unavailable',
        testLogId: localId,
      });
      return;
    }
    res.status(502).json({ error: 'Upstream API unavailable' });
  }
}

async function forwardBinary(req: Request, res: Response, upstreamPath: string): Promise<void> {
  const upstreamRoot = getUpstreamApiRoot();
  const url = `${upstreamRoot}${upstreamPath}`;

  try {
    const upstreamRes = await axios({
      method: req.method,
      url,
      data: req.body,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        ...pickForwardHeaders(req),
      },
      responseType: 'arraybuffer',
      validateStatus: () => true,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120_000,
    });

    res.status(upstreamRes.status);
    if (upstreamRes.headers['content-type']) {
      res.set('Content-Type', upstreamRes.headers['content-type']);
    }
    res.send(Buffer.from(upstreamRes.data));
  } catch (error) {
    console.error(`[upstreamProxy] ${upstreamPath} failed:`, error);
    res.status(502).json({ error: 'Upstream API unavailable' });
  }
}

async function forwardRaw(req: Request, res: Response, upstreamPath: string): Promise<void> {
  const upstreamRoot = getUpstreamApiRoot();
  const url = `${upstreamRoot}${upstreamPath}`;
  const body = req.body instanceof Buffer ? req.body : Buffer.from([]);

  try {
    const upstreamRes = await axios({
      method: 'POST',
      url,
      data: body,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/octet-stream',
        ...pickForwardHeaders(req),
      },
      responseType: 'arraybuffer',
      validateStatus: () => true,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120_000,
    });

    res.status(upstreamRes.status);
    if (upstreamRes.headers['content-type']) {
      res.set('Content-Type', upstreamRes.headers['content-type']);
    }
    res.send(Buffer.from(upstreamRes.data));
  } catch (error) {
    console.error(`[upstreamProxy] ${upstreamPath} failed:`, error);
    res.status(502).json({ error: 'Upstream transcribe unavailable' });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Last Meters photos live on THIS host even when the AI/Maps work happens
 * on buddywalk.app. The upstream response never includes the user photo,
 * so we persist it from the request body before returning.
 */
async function recordProxiedLastMile(
  req: Request,
  upstreamRes: AxiosResponse,
  startedAt: number
): Promise<unknown> {
  const body = asRecord(req.body);
  const upstream = asRecord(upstreamRes.data);
  const image = pickString(body.image) ?? '';
  const destination = pickString(body.destination) ?? 'unknown destination';
  const success = upstreamRes.status >= 200 && upstreamRes.status < 300;
  const output = pickString(upstream.output);
  const warning = pickString(upstream.warning);
  const error =
    pickString(upstream.error) ||
    (success ? warning : `Upstream Last Meters returned ${upstreamRes.status}`);

  const userPhoto = image ? await compressUserPhoto(image) : 'data:,';
  const testLogId = await lastMileTestLogService.record({
    destination,
    lat: pickNumber(body.lat) ?? 0,
    lng: pickNumber(body.lng) ?? 0,
    userPhoto,
    panoramaHeadings: [],
    gpsAccuracyMeters: pickNumber(body.gpsAccuracyMeters),
    deviceHeading: pickNumber(body.heading),
    navigationMode:
      upstream.mode === 'approach' || upstream.mode === 'exact' || upstream.mode === 'aligned'
        ? upstream.mode
        : undefined,
    finalOutput: output,
    steps: [
      {
        name: 'proxied_last_mile',
        prompt: 'Forwarded to buddywalk.app. User photo stored locally for the Render dashboard.',
        response: output ?? error ?? '',
        model: 'upstream-proxy',
        success,
        error: success ? undefined : error,
      },
    ],
    success,
    error: success ? undefined : error,
    latencyMs: Date.now() - startedAt,
  });

  await recordProxyMetrics(req, upstreamRes, startedAt, 'last_mile');

  if (Array.isArray(upstreamRes.data) || typeof upstreamRes.data !== 'object' || upstreamRes.data == null) {
    return upstreamRes.data;
  }
  return {
    ...upstream,
    testLogId: testLogId ?? upstream.testLogId,
  };
}

async function recordProxiedLastMileFailure(
  req: Request,
  startedAt: number,
  error: unknown
): Promise<string | undefined> {
  const body = asRecord(req.body);
  const image = pickString(body.image) ?? '';
  const message = error instanceof Error ? error.message : 'Upstream API unavailable';
  return lastMileTestLogService.record({
    destination: pickString(body.destination) ?? 'unknown destination',
    lat: pickNumber(body.lat) ?? 0,
    lng: pickNumber(body.lng) ?? 0,
    userPhoto: image ? await compressUserPhoto(image) : 'data:,',
    panoramaHeadings: [],
    gpsAccuracyMeters: pickNumber(body.gpsAccuracyMeters),
    deviceHeading: pickNumber(body.heading),
    steps: [
      {
        name: 'proxied_last_mile',
        prompt: 'Forwarded to buddywalk.app. User photo stored locally for the Render dashboard.',
        response: message,
        model: 'upstream-proxy',
        success: false,
        error: message,
      },
    ],
    success: false,
    error: message,
    latencyMs: Date.now() - startedAt,
  });
}

/** Text generation and TTS — needs OPENAI_API_KEY / GEMINI_API_KEY locally. */
export function mountAiProxy(app: Application): void {
  console.log(`[server] Proxying AI to ${getUpstreamApiRoot()}; metrics stored locally`);
  app.post('/api/text', (req, res) => forwardJson(req, res, '/api/text'));
  app.post('/api/parseRequest', (req, res) => forwardJson(req, res, '/api/parseRequest'));
  app.post('/api/audio', (req, res) => forwardBinary(req, res, '/api/audio'));
}

/**
 * Last Meters AI/Maps work is done on buddywalk.app. The user photo is still
 * stored on this host so the Render dashboard keeps showing test imagery.
 */
export function mountLastMileProxy(app: Application): void {
  console.log(
    `[server] Proxying Last Meters to ${getUpstreamApiRoot()}; user photos stored locally`
  );
  app.post('/api/last-mile', (req, res) => forwardJson(req, res, '/api/last-mile'));
}

/** Azure Speech — needs AZURE_SUBSCRIPTION_KEY and AZURE_REGION locally. */
export function mountSpeechProxy(app: Application): void {
  console.log(`[server] Proxying speech to ${getUpstreamApiRoot()}`);
  app.get('/api/token/getToken', (req, res) => forwardJson(req, res, '/api/token/getToken'));
  app.post(
    '/api/transcribe',
    express.raw({ type: '*/*', limit: '10mb' }),
    (req, res) => forwardRaw(req, res, '/api/transcribe')
  );
}

/** MTA arrivals — needs MTA_API_KEY locally. */
export function mountMtaProxy(app: Application): void {
  console.log(`[server] Proxying MTA to ${getUpstreamApiRoot()}`);
  app.post('/api/mta', (req, res) => forwardJson(req, res, '/api/mta'));
}
