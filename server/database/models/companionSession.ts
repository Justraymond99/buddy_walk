import mongoose, { Schema } from "mongoose";

export interface companionSessionInterface {
  token: string;
  ownerSecret: string;
  displayName?: string;
  active: boolean;
  lastLat?: number;
  lastLon?: number;
  lastAccuracy?: number;
  lastHeading?: number;
  lastSpeed?: number;
  lastUpdate?: Date;
  createdAt: Date;
  expiresAt: Date;
  pingCount: number;
}

const CompanionSessionSchema = new Schema<companionSessionInterface>({
  token: { type: String, required: true, unique: true, index: true },
  ownerSecret: { type: String, required: true },
  displayName: { type: String, required: false },
  active: { type: Boolean, default: true },
  lastLat: { type: Number, required: false },
  lastLon: { type: Number, required: false },
  lastAccuracy: { type: Number, required: false },
  lastHeading: { type: Number, required: false },
  lastSpeed: { type: Number, required: false },
  lastUpdate: { type: Date, required: false },
  createdAt: { type: Date, default: Date.now },
  // MongoDB TTL: docs disappear automatically once expiresAt is in the past
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  pingCount: { type: Number, default: 0 },
});

export default mongoose.model<companionSessionInterface>(
  "CompanionSession",
  CompanionSessionSchema,
  "companion_sessions"
);
