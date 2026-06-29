import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import {
  companionStore,
  PING_EXTENSION_MS,
  SESSION_TTL_MS,
} from './companionStore';

function generateToken(bytes = 6): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateSecret(): string {
  return crypto.randomBytes(24).toString('hex');
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function nowIso(): string {
  return new Date().toISOString();
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function setCompanionCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function handleCompanionHealth(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({ ok: true });
}

export function handleCompanionCreate(req: VercelRequest, res: VercelResponse): void {
  const { displayName } = req.body ?? {};
  if (displayName !== undefined && typeof displayName !== 'string') {
    res.status(400).json({ error: 'displayName must be a string' });
    return;
  }
  if (typeof displayName === 'string' && displayName.length > 60) {
    res.status(400).json({ error: 'displayName too long (max 60 chars)' });
    return;
  }

  let token = generateToken();
  for (let i = 0; i < 5; i++) {
    if (!companionStore.exists(token)) break;
    token = generateToken();
  }

  const ownerSecret = generateSecret();
  const createdAt = nowIso();
  const expiresAt = addMs(createdAt, SESSION_TTL_MS);
  const display = typeof displayName === 'string' ? displayName.trim() || undefined : undefined;

  const doc = companionStore.create({
    token,
    ownerSecret,
    displayName: display,
    active: true,
    createdAt,
    expiresAt,
  });

  res.status(201).json({
    token: doc.token,
    ownerSecret: doc.ownerSecret,
    displayName: doc.displayName,
    expiresAt: doc.expiresAt,
  });
}

export function handleCompanionPing(
  req: VercelRequest,
  res: VercelResponse,
  token: string
): void {
  const { ownerSecret, lat, lon, accuracy, heading, speed } = req.body ?? {};

  if (!token) {
    res.status(400).json({ error: 'token required' });
    return;
  }
  if (typeof ownerSecret !== 'string' || !ownerSecret) {
    res.status(400).json({ error: 'ownerSecret required' });
    return;
  }
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
    res.status(400).json({ error: 'lat and lon must be finite numbers' });
    return;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400).json({ error: 'lat/lon out of range' });
    return;
  }

  const session = companionStore.findOne(token);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }
  if (session.ownerSecret !== ownerSecret) {
    res.status(403).json({ error: 'Bad secret' });
    return;
  }
  if (!session.active) {
    res.status(410).json({ error: 'Session already ended' });
    return;
  }

  const updatedAt = nowIso();
  session.lastLat = lat;
  session.lastLon = lon;
  session.lastAccuracy = isFiniteNumber(accuracy) ? accuracy : undefined;
  session.lastHeading = isFiniteNumber(heading) ? heading : undefined;
  session.lastSpeed = isFiniteNumber(speed) ? speed : undefined;
  session.lastUpdate = updatedAt;
  session.pingCount = (session.pingCount ?? 0) + 1;
  session.expiresAt = addMs(updatedAt, PING_EXTENSION_MS);
  companionStore.save(session);

  res.status(200).json({ ok: true, expiresAt: session.expiresAt });
}

export function handleCompanionStop(
  req: VercelRequest,
  res: VercelResponse,
  token: string
): void {
  const { ownerSecret } = req.body ?? {};

  if (!token) {
    res.status(400).json({ error: 'token required' });
    return;
  }
  if (typeof ownerSecret !== 'string' || !ownerSecret) {
    res.status(400).json({ error: 'ownerSecret required' });
    return;
  }

  const session = companionStore.findOne(token);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.ownerSecret !== ownerSecret) {
    res.status(403).json({ error: 'Bad secret' });
    return;
  }

  session.active = false;
  session.expiresAt = addMs(nowIso(), 5 * 60 * 1000);
  companionStore.save(session);
  res.status(200).json({ ok: true });
}

export function handleCompanionSnapshot(
  _req: VercelRequest,
  res: VercelResponse,
  token: string
): void {
  if (!token) {
    res.status(400).json({ error: 'token required' });
    return;
  }

  const session = companionStore.findOne(token);
  if (!session) {
    res.status(404).json({ active: false, error: 'not_found' });
    return;
  }

  res.status(200).json({
    active: session.active,
    displayName: session.displayName ?? null,
    lat: session.lastLat ?? null,
    lon: session.lastLon ?? null,
    accuracy: session.lastAccuracy ?? null,
    heading: session.lastHeading ?? null,
    speed: session.lastSpeed ?? null,
    lastUpdate: session.lastUpdate ?? null,
    expiresAt: session.expiresAt,
    pingCount: session.pingCount ?? 0,
  });
}

export function dispatchCompanionRoute(
  req: VercelRequest,
  res: VercelResponse,
  pathParts: string[]
): void {
  setCompanionCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (pathParts.length === 1 && pathParts[0] === 'health' && req.method === 'GET') {
    handleCompanionHealth(req, res);
    return;
  }

  if (pathParts.length === 1 && pathParts[0] === 'create' && req.method === 'POST') {
    handleCompanionCreate(req, res);
    return;
  }

  if (pathParts.length === 1 && pathParts[0] === 'ping' && req.method === 'POST') {
    const token = String(req.body?.token ?? req.query.token ?? '');
    handleCompanionPing(req, res, token);
    return;
  }

  if (pathParts.length === 1 && pathParts[0] === 'stop' && req.method === 'POST') {
    const token = String(req.body?.token ?? req.query.token ?? '');
    handleCompanionStop(req, res, token);
    return;
  }

  if (pathParts.length === 1 && pathParts[0] === 'snapshot' && req.method === 'GET') {
    const raw = req.query.token;
    const token = Array.isArray(raw) ? raw[0] : raw || '';
    handleCompanionSnapshot(req, res, String(token));
    return;
  }

  if (pathParts.length === 2 && pathParts[1] === 'ping' && req.method === 'POST') {
    handleCompanionPing(req, res, pathParts[0]);
    return;
  }

  if (pathParts.length === 2 && pathParts[1] === 'stop' && req.method === 'POST') {
    handleCompanionStop(req, res, pathParts[0]);
    return;
  }

  if (pathParts.length === 2 && pathParts[1] === 'snapshot' && req.method === 'GET') {
    handleCompanionSnapshot(req, res, pathParts[0]);
    return;
  }

  res.status(404).json({ error: 'Not found' });
}
