import * as Crypto from 'expo-crypto';

import { sessionId } from './identity';

function genId(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Isolates AI context per testing run (rotated via "New Test" on the main screen). */
let activeConversationId = sessionId;

export function getConversationId(): string {
  return activeConversationId;
}

/** Start a clean AI session — server history for the prior id is left behind. */
export function rotateConversationId(): string {
  activeConversationId = genId();
  return activeConversationId;
}
