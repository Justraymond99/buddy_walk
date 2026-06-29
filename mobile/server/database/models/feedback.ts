import mongoose, { Schema } from "mongoose";

export type feedbackType = "general" | "answer_rating" | "bug";

export interface feedbackInterface {
  installId: string;
  sessionId?: string;
  type: feedbackType;
  rating?: number;
  message?: string;
  context?: Record<string, unknown>;
  platform?: string;
  appVersion?: string;
  date: Date;
}

const FeedbackSchema = new Schema<feedbackInterface>({
  installId: { type: String, required: true, index: true },
  sessionId: { type: String, required: false },
  type: { type: String, required: true, default: "general" },
  rating: { type: Number, required: false },
  message: { type: String, required: false },
  context: { type: Schema.Types.Mixed, required: false },
  platform: { type: String, required: false },
  appVersion: { type: String, required: false },
  date: { type: Date, default: Date.now },
});

export default mongoose.model<feedbackInterface>(
  "Feedback",
  FeedbackSchema,
  "feedback"
);
