/**
 * Safari (iOS + macOS) blocks speech and HTML5 audio unless playback is
 * unlocked during a user gesture. Call from tap handlers before async work.
 */

/** Tiny valid silent MP3 used only to unlock Safari's audio policy. */
const SILENT_MP3 =
  'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjU4LjEwMwAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wA';

let unlockAudio: HTMLAudioElement | null = null;

export function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS|Chromium|OPR/i.test(ua);
}

/** Brave is Chromium-based but Shields can block location/mic without a normal prompt. */
export function isBraveBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Brave/i.test(navigator.userAgent);
}

/** Run synchronously inside onPressIn / onClick — before any await. */
export function unlockWebAudioForPlayback(): void {
  if (typeof window === 'undefined') return;

  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.resume();
    } catch {
      /* ignore */
    }
  }

  try {
    if (!unlockAudio) {
      unlockAudio = new Audio(SILENT_MP3);
      unlockAudio.volume = 0.01;
      unlockAudio.preload = 'auto';
    }
    unlockAudio.currentTime = 0;
    void unlockAudio.play().catch(() => undefined);
  } catch {
    /* ignore */
  }

  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      void ctx.resume().catch(() => undefined);
    }
  } catch {
    /* ignore */
  }
}
