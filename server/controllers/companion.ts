import { Request, Response } from "express";
import { CompanionService } from "../services/companion";

const service = new CompanionService();

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export class CompanionController {
  async createSession(req: Request, res: Response): Promise<void> {
    const { displayName } = req.body ?? {};
    if (displayName !== undefined && typeof displayName !== "string") {
      res.status(400).json({ error: "displayName must be a string" });
      return;
    }
    if (typeof displayName === "string" && displayName.length > 60) {
      res.status(400).json({ error: "displayName too long (max 60 chars)" });
      return;
    }
    await service.createSession({ req, res }, displayName);
  }

  async ping(req: Request, res: Response): Promise<void> {
    const { token } = req.params;
    const { ownerSecret, lat, lon, accuracy, heading, speed } = req.body ?? {};

    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "token required" });
      return;
    }
    if (typeof ownerSecret !== "string" || !ownerSecret) {
      res.status(400).json({ error: "ownerSecret required" });
      return;
    }
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
      res.status(400).json({ error: "lat and lon must be finite numbers" });
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      res.status(400).json({ error: "lat/lon out of range" });
      return;
    }
    await service.ping({ req, res }, token, ownerSecret, {
      lat,
      lon,
      accuracy: isFiniteNumber(accuracy) ? accuracy : undefined,
      heading: isFiniteNumber(heading) ? heading : null,
      speed: isFiniteNumber(speed) ? speed : null,
    });
  }

  async stop(req: Request, res: Response): Promise<void> {
    const { token } = req.params;
    const { ownerSecret } = req.body ?? {};
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "token required" });
      return;
    }
    if (typeof ownerSecret !== "string" || !ownerSecret) {
      res.status(400).json({ error: "ownerSecret required" });
      return;
    }
    await service.stop({ req, res }, token, ownerSecret);
  }

  async snapshot(req: Request, res: Response): Promise<void> {
    const { token } = req.params;
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "token required" });
      return;
    }
    await service.snapshot({ req, res }, token);
  }
}
