export interface WebFrameSession {
  stop: () => string[];
}

export function startWebFrameCapture(): WebFrameSession | null {
  return null;
}
