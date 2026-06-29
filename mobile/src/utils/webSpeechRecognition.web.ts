import { createSpeechRecognitionPonyfill } from 'web-speech-cognitive-services';

export interface AzureSpeechAuth {
  token: string;
  region: string;
}

export interface WebSpeechSession {
  stop: () => Promise<string>;
  abort: () => void;
}

type ResultHandler = (text: string) => void;
type ErrorHandler = (message: string) => void;

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }> }) => void) | null;
  onend: (() => void) | null;
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

  let latestTranscript = '';

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i]?.[0]?.transcript ?? '';
    }
    latestTranscript = transcript.trim();
    if (latestTranscript) {
      onInterim(latestTranscript);
      const last = event.results[event.results.length - 1];
      if (last?.isFinal) onFinal(latestTranscript);
    }
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
    stop: () =>
      new Promise<string>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve(latestTranscript.trim());
        };

        recognition.onend = finish;
        const priorOnError = recognition.onerror;
        recognition.onerror = (event) => {
          priorOnError?.(event);
          if (event.error === 'aborted' || event.error === 'no-speech') finish();
        };

        try {
          recognition.stop();
        } catch {
          finish();
        }

        setTimeout(finish, 1200);
      }),
    abort: () => {
      latestTranscript = '';
      try {
        recognition.abort();
      } catch {
        // noop
      }
    },
  };
}
