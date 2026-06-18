/** Web-only microphone capture for Tap to Ask (Safari-friendly). */

export interface WebAudioSession {
  stop: () => Promise<Blob | null>;
  abort: () => void;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

function azureContentType(mime: string): string {
  if (mime.includes('webm')) return 'audio/webm; codecs=opus';
  if (mime.includes('mp4') || mime.includes('aac')) return 'audio/mp4';
  return mime;
}

export function contentTypeForWebBlob(blob: Blob): string {
  return azureContentType(blob.type || 'audio/webm');
}

export async function startWebAudioCapture(): Promise<WebAudioSession | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.start(250);

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          if (chunks.length === 0) {
            resolve(null);
            return;
          }
          resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' }));
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else {
          stream.getTracks().forEach((track) => track.stop());
          resolve(null);
        }
      }),
    abort: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // noop
      }
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
