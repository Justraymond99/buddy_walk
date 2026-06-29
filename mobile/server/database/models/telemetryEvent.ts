import mongoose, { Schema } from "mongoose";

export interface telemetryEventInterface {
  installId: string;
  sessionId: string;
  name: string;
  props?: Record<string, unknown>;
  screen?: string;
  platform?: string;
  appVersion?: string;
  // Client-reported event time (ms epoch); serverTs is when we stored it.
  clientTs?: number;
  serverTs: Date;
}

const TelemetryEventSchema = new Schema<telemetryEventInterface>({
  installId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true, index: true },
  name: { type: String, required: true, index: true },
  props: { type: Schema.Types.Mixed, required: false },
  screen: { type: String, required: false },
  platform: { type: String, required: false },
  appVersion: { type: String, required: false },
  clientTs: { type: Number, required: false },
  serverTs: { type: Date, default: Date.now },
});

export default mongoose.model<telemetryEventInterface>(
  "TelemetryEvent",
  TelemetryEventSchema,
  "telemetry_events"
);
