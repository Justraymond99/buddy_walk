import mongoose, { Schema } from "mongoose";

export interface aiRequestLogInterface {
  requestId?: string;
  installId?: string;
  sessionId?: string;
  platform?: string;
  appVersion?: string;
  feature?: string;
  toolUsed?: string;
  inputLength: number;
  /** Truncated prompt text (memory / zero-config proxy mode). */
  inputText?: string;
  /** Truncated answer text (memory / zero-config proxy mode). */
  outputText?: string;
  hasImage: boolean;
  imageCount: number;
  hasCoords: boolean;
  success: boolean;
  errorCode?: string;
  latencyMs: number;
  outputLength?: number;
  tokenCount?: number;
  serverTs: Date;
}

const AiRequestLogSchema = new Schema<aiRequestLogInterface>({
  requestId: { type: String, index: true },
  installId: { type: String, index: true },
  sessionId: { type: String },
  platform: { type: String },
  appVersion: { type: String },
  feature: { type: String, index: true },
  toolUsed: { type: String },
  inputLength: { type: Number, required: true },
  inputText: { type: String, required: false },
  outputText: { type: String, required: false },
  hasImage: { type: Boolean, default: false },
  imageCount: { type: Number, default: 0 },
  hasCoords: { type: Boolean, default: false },
  success: { type: Boolean, required: true },
  errorCode: { type: String },
  latencyMs: { type: Number, required: true },
  outputLength: { type: Number },
  tokenCount: { type: Number },
  serverTs: { type: Date, default: Date.now, index: true },
});

export default mongoose.model<aiRequestLogInterface>(
  "AiRequestLog",
  AiRequestLogSchema,
  "ai_request_log"
);
