import mongoose, { Schema } from "mongoose";
import type { LastMileTestScenario } from "../../utils/lastMileNavigation";

export interface lastMileTestStepInterface {
  name: string;
  prompt: string;
  response?: string;
  parsedHeading?: number;
  model: string;
  success: boolean;
  error?: string;
  tokenCount?: number;
}

export interface lastMileTestLogInterface {
  destination: string;
  lat: number;
  lng: number;
  userPhoto: string;
  panoramaPhoto?: string;
  panoramaDate?: string;
  panoramaStatus?: string;
  panoramaHeadings: number[];
  destinationPhoto?: string;
  destinationPhotoDate?: string;
  destinationPhotoStatus?: string;
  destinationPlaceName?: string;
  destinationPlaceAddress?: string;
  destinationTypes?: string[];
  destinationDistanceMeters?: number;
  gpsAccuracyMeters?: number;
  destinationBearing?: number;
  deviceHeading?: number;
  headingDifferenceDegrees?: number;
  headingAligned?: boolean;
  compassHeading?: number;
  panoramaMatchedHeading?: number;
  headingComparisonDifference?: number;
  headingComparisonAgrees?: boolean;
  confidenceScore?: number;
  confidenceLevel?: "high" | "medium" | "low";
  confidenceReasons?: string[];
  destinationReferenceUsed?: boolean;
  navigationMode?: "approach" | "exact" | "aligned";
  testScenario?: LastMileTestScenario;
  currentHeading?: number;
  targetHeading?: number;
  turnInstruction?: string;
  finalOutput?: string;
  steps: lastMileTestStepInterface[];
  reviewerStatus?: "untested" | "pass" | "partial" | "fail";
  reviewerNotes?: string;
  reviewedAt?: Date;
  success: boolean;
  error?: string;
  latencyMs: number;
  serverTs: Date;
}

const LastMileTestStepSchema = new Schema<lastMileTestStepInterface>(
  {
    name: { type: String, required: true },
    prompt: { type: String, required: true },
    response: { type: String },
    parsedHeading: { type: Number },
    model: { type: String, required: true },
    success: { type: Boolean, required: true },
    error: { type: String },
    tokenCount: { type: Number },
  },
  { _id: false }
);

const LastMileTestLogSchema = new Schema<lastMileTestLogInterface>({
  destination: { type: String, required: true, index: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  userPhoto: { type: String, required: true },
  panoramaPhoto: { type: String },
  panoramaDate: { type: String },
  panoramaStatus: { type: String },
  panoramaHeadings: [{ type: Number }],
  destinationPhoto: { type: String },
  destinationPhotoDate: { type: String },
  destinationPhotoStatus: { type: String },
  destinationPlaceName: { type: String },
  destinationPlaceAddress: { type: String },
  destinationTypes: [{ type: String }],
  destinationDistanceMeters: { type: Number },
  gpsAccuracyMeters: { type: Number },
  destinationBearing: { type: Number },
  deviceHeading: { type: Number },
  headingDifferenceDegrees: { type: Number },
  headingAligned: { type: Boolean },
  compassHeading: { type: Number },
  panoramaMatchedHeading: { type: Number },
  headingComparisonDifference: { type: Number },
  headingComparisonAgrees: { type: Boolean },
  confidenceScore: { type: Number },
  confidenceLevel: { type: String, enum: ["high", "medium", "low"] },
  confidenceReasons: [{ type: String }],
  destinationReferenceUsed: { type: Boolean, default: false },
  navigationMode: { type: String, enum: ["approach", "exact", "aligned"] },
  testScenario: {
    type: String,
    enum: [
      "test_a_visible",
      "test_a_reference",
      "test_b_approach",
      "heading_aligned",
      "destination_unverified",
    ],
    index: true,
  },
  currentHeading: { type: Number },
  targetHeading: { type: Number },
  turnInstruction: { type: String },
  finalOutput: { type: String },
  steps: [LastMileTestStepSchema],
  reviewerStatus: {
    type: String,
    enum: ["untested", "pass", "partial", "fail"],
    default: "untested",
    index: true,
  },
  reviewerNotes: { type: String },
  reviewedAt: { type: Date },
  success: { type: Boolean, required: true, index: true },
  error: { type: String },
  latencyMs: { type: Number, required: true },
  serverTs: { type: Date, default: Date.now, index: true },
});

export default mongoose.model<lastMileTestLogInterface>(
  "LastMileTestLog",
  LastMileTestLogSchema,
  "last_mile_test_log"
);
