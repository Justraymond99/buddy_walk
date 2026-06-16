import { createSpeechRecognitionPonyfill } from 'web-speech-cognitive-services';

export interface AzureSpeechAuth {
  token: string;
  region: string;
}

export interface WebSpeechSession {
  stop: () => void;
  abort: () => void;
}

type ResultHandler = (text: string) => void;
type ErrorHandler = (message: string) => void;

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getNativeSpeechRecognition(): BrowserSpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionCtor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Browser speech-to-text backed by Azure; updates live as the user speaks. */
export function startWebSpeechRecognition(
  auth: AzureSpeechAuth,
  onInterim: ResultHandler,
  onFinal: ResultHandler,
  onError: ErrorHandler
): WebSpeechSession | null {
  const NativeSpeechRecognition = getNativeSpeechRecognition();
  if (!NativeSpeechRecognition) {
    onError('Speech recognition is not supported in this browser.');
    return null;
  }

  const ponyfill = createSpeechRecognitionPonyfill({
    credentials: {
      region: auth.region,
      authorizationToken: auth.token,
    },
  });

  const SpeechRecognition =
    (ponyfill?.SpeechRecognition as unknown as BrowserSpeechRecognitionCtor | undefined) ??
    NativeSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const chunk = result?.[0]?.transcript ?? '';
      if (result?.isFinal) finalText += chunk;
      else interim += chunk;
    }
    const live = (finalText || interim).trim();
    if (live) onInterim(live);
    if (finalText.trim()) onFinal(finalText.trim());
  };

  recognition.onerror = (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    onError(event.error || 'Speech recognition failed');
  };

  try {
    recognition.start();
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Could not start speech recognition');
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        // noop
      }
    },
    abort: () => {
      try {
        recognition.abort();
      } catch {
        // noop
      }
    },
  };
}
