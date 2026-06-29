export function isSafariBrowser(): boolean {
  return false;
}

export function isBraveBrowser(): boolean {
  return false;
}

export function unlockWebAudioForPlayback(): void {
  // Native uses expo-av / expo-speech — no browser audio unlock needed.
}
