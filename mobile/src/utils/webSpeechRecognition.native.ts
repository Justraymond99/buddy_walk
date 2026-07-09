export interface AzureSpeechAuth {
  token: string;
  region: string;
}

export interface WebSpeechSession {
  stop: () => Promise<string>;
  abort: () => void;
}

/** Native builds use expo-av recording + Azure STT — browser speech APIs are web-only. */
export function startWebSpeechRecognition(
  _auth: AzureSpeechAuth,
  _onInterim: (text: string) => void,
  _onFinal: (text: string) => void,
  _onError: (message: string) => void
): WebSpeechSession | null {
  return null;
}
