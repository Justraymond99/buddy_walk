import mongoose from "mongoose";
import { telemetryEventInterface } from "./models/telemetryEvent";
import { feedbackInterface } from "./models/feedback";
import { aiRequestLogInterface } from "./models/aiRequestLog";

/**
 * Usage analytics and feedback should keep working during testing even when
 * MongoDB is unavailable. When not connected, we buffer in process memory so the
 * endpoints still accept data and the team can read it back from the same
 * process.
 */
export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

const MAX_MEMORY_EVENTS = 5000;
const MAX_MEMORY_FEEDBACK = 2000;
const MAX_MEMORY_AI_REQUESTS = 3000;

export const memoryEvents: telemetryEventInterface[] = [];
export const memoryFeedback: feedbackInterface[] = [];
export const memoryAiRequests: aiRequestLogInterface[] = [];

export function pushMemoryEvents(events: telemetryEventInterface[]): void {
  memoryEvents.push(...events);
  if (memoryEvents.length > MAX_MEMORY_EVENTS) {
    memoryEvents.splice(0, memoryEvents.length - MAX_MEMORY_EVENTS);
  }
}

export function pushMemoryFeedback(entry: feedbackInterface): void {
  memoryFeedback.push(entry);
  if (memoryFeedback.length > MAX_MEMORY_FEEDBACK) {
    memoryFeedback.splice(0, memoryFeedback.length - MAX_MEMORY_FEEDBACK);
  }
}

export function pushMemoryAiRequest(entry: aiRequestLogInterface): void {
  memoryAiRequests.push(entry);
  if (memoryAiRequests.length > MAX_MEMORY_AI_REQUESTS) {
    memoryAiRequests.splice(0, memoryAiRequests.length - MAX_MEMORY_AI_REQUESTS);
  }
}
