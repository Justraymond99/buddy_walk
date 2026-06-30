export interface AzureSpeechAuth {
  token: string;
  region: string;
}

export interface WebSpeechSession {
  stop: () => Promise<string>;
  abort: () => void;
}

/** Native builds use expo-av recording + Azure STT — browser speech APIs are web-only. */
export function startWebSpeechRecognition(): WebSpeechSession | null {
  return null;
}
