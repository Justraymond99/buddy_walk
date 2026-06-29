import crypto from "crypto";
import companionSessionModel from "../database/models/companionSession";
import { AppContext } from "../types";

// How long a session lives without any pings before TTL cleans it up.
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Extend window each time the device pings, so the link stays alive
// while the wearer is actively walking.
const PING_EXTENSION_MS = 60 * 60 * 1000; // 1 hour

function generateToken(bytes = 6): string {
  // ~12 hex chars; short enough to share verbally but still hard to guess
  return crypto.randomBytes(bytes).toString("hex");
}

function generateSecret(): string {
  // longer secret kept on the device only; used to authorize pings/stop
  return crypto.randomBytes(24).toString("hex");
}

export interface PingPayload {
  lat: number;
  lon: number;
  accuracy?: number;
  heading?: number | null;
  speed?: number | null;
}

export class CompanionService {
  async createSession(ctx: AppContext, displayName?: string) {
    const { res } = ctx;
    try {
      // ensure token uniqueness; collisions extremely unlikely but guard anyway
      let token = generateToken();
      for (let i = 0; i < 5; i++) {
        const exists = await companionSessionModel.exists({ token });
        if (!exists) break;
        token = generateToken();
      }

      const ownerSecret = generateSecret();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

      const doc = await companionSessionModel.create({
        token,
        ownerSecret,
        displayName: displayName?.trim() || undefined,
        active: true,
        createdAt: now,
        expiresAt,
        pingCount: 0,
      });

      res.status(201).json({
        token: doc.token,
        ownerSecret: doc.ownerSecret,
        displayName: doc.displayName,
        expiresAt: doc.expiresAt,
      });
    } catch (e: any) {
      console.error("[CompanionService] createSession error:", e);
      res.status(500).json({ error: e.message || "Could not create session" });
    }
  }

  async ping(
    ctx: AppContext,
    token: string,
    ownerSecret: string,
    payload: PingPayload
  ) {
    const { res } = ctx;
    try {
      const session = await companionSessionModel.findOne({ token });
      if (!session) {
        res.status(404).json({ error: "Session not found or expired" });
        return;
      }
      if (session.ownerSecret !== ownerSecret) {
        res.status(403).json({ error: "Bad secret" });
        return;
      }
      if (!session.active) {
        res.status(410).json({ error: "Session already ended" });
        return;
      }

      const now = new Date();
      session.lastLat = payload.lat;
      session.lastLon = payload.lon;
      session.lastAccuracy = payload.accuracy;
      session.lastHeading = payload.heading ?? undefined;
      session.lastSpeed = payload.speed ?? undefined;
      session.lastUpdate = now;
      session.pingCount = (session.pingCount ?? 0) + 1;
      session.expiresAt = new Date(now.getTime() + PING_EXTENSION_MS);
      await session.save();

      res.status(200).json({ ok: true, expiresAt: session.expiresAt });
    } catch (e: any) {
      console.error("[CompanionService] ping error:", e);
      res.status(500).json({ error: e.message || "Could not save ping" });
    }
  }

  async stop(ctx: AppContext, token: string, ownerSecret: string) {
    const { res } = ctx;
    try {
      const session = await companionSessionModel.findOne({ token });
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      if (session.ownerSecret !== ownerSecret) {
        res.status(403).json({ error: "Bad secret" });
        return;
      }
      session.active = false;
      // collapse expiry so the doc is cleaned up fairly quickly
      session.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await session.save();
      res.status(200).json({ ok: true });
    } catch (e: any) {
      console.error("[CompanionService] stop error:", e);
      res.status(500).json({ error: e.message || "Could not end session" });
    }
  }

  async snapshot(ctx: AppContext, token: string) {
    const { res } = ctx;
    try {
      const session = await companionSessionModel.findOne({ token });
      if (!session) {
        res.status(404).json({ active: false, error: "not_found" });
        return;
      }
      // Never echo the ownerSecret back through the public endpoint.
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
    } catch (e: any) {
      console.error("[CompanionService] snapshot error:", e);
      res.status(500).json({ error: e.message || "Could not load snapshot" });
    }
  }
}
