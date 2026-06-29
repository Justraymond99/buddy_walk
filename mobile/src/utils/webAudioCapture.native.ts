export interface WebAudioSession {
  stop: () => Promise<Blob | null>;
  abort: () => void;
}

export function contentTypeForWebBlob(blob: Blob): string {
  return blob.type || 'audio/webm';
}

export async function startWebAudioCapture(): Promise<WebAudioSession | null> {
  return null;
}
