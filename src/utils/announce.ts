import { AccessibilityInfo } from 'react-native';
import { speakText } from './speakText';

// Cached screen-reader state so callers can branch synchronously. Kept in sync
// via the AccessibilityInfo listener below.
let screenReaderOn = false;

AccessibilityInfo.isScreenReaderEnabled()
  .then((enabled) => {
    screenReaderOn = enabled;
  })
  .catch(() => {});

AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
  screenReaderOn = enabled;
});

/** True when VoiceOver / TalkBack is currently active. */
export function isScreenReaderActive(): boolean {
  return screenReaderOn;
}

/**
 * Speak a message to the user through exactly ONE channel to avoid the
 * double-narration that happens when the app's own TTS and the OS screen
 * reader both read the same text.
 *
 * - Screen reader ON  → hand off to the screen reader (announceForAccessibility).
 * - Screen reader OFF → use the app's text-to-speech (server voice / expo-speech).
 */
export function announce(text: string, options?: { preferDevice?: boolean }): void {
  const trimmed = text?.trim();
  if (!trimmed) return;

  if (screenReaderOn) {
    AccessibilityInfo.announceForAccessibility(trimmed);
  } else {
    void speakText(trimmed, options);
  }
}
