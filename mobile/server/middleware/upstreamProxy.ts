import axios, { AxiosResponse } from 'axios';
import express, { Application, Request, Response } from 'express';
import { getUpstreamApiRoot } from '../config/serverMode';
import { aiRequestLogService } from '../services/aiRequestLog';

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

    res.status(upstreamRes.status);
    if (upstreamRes.headers['content-type']) {
      res.set('Content-Type', upstreamRes.headers['content-type']);
    }
    res.send(upstreamRes.data);
  } catch (error) {
    console.error(`[upstreamProxy] ${upstreamPath} failed:`, error);
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

/** Mount proxy routes for AI, speech token, and MTA when running without local keys. */
export function mountUpstreamProxy(app: Application): void {
  const upstreamRoot = getUpstreamApiRoot();
  console.log(
    `[server] Zero-config mode — proxying AI/speech/MTA to ${upstreamRoot}; metrics stored locally`
  );

  app.post('/api/text', (req, res) => forwardJson(req, res, '/api/text'));
  app.post('/api/parseRequest', (req, res) => forwardJson(req, res, '/api/parseRequest'));
  app.post('/api/audio', (req, res) => forwardBinary(req, res, '/api/audio'));
  app.post(
    '/api/transcribe',
    express.raw({ type: '*/*', limit: '10mb' }),
    (req, res) => forwardRaw(req, res, '/api/transcribe')
  );
  app.get('/api/token/getToken', (req, res) => forwardJson(req, res, '/api/token/getToken'));
  app.post('/api/mta', (req, res) => forwardJson(req, res, '/api/mta'));
}
