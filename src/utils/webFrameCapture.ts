/**
 * Web-only stand-in for video capture: expo-video-thumbnails can't extract
 * frames in a browser, so we sample JPEG frames straight off the live
 * camera preview while the user holds the capture button. Produces the same
 * payload shape as extractVideoFrames (data-URL JPEGs, 1/sec, max 10).
 */

const MAX_FRAMES = 10;
const FRAME_INTERVAL_MS = 1000;
const MAX_FRAME_WIDTH = 1024;

export interface WebFrameSession {
  /** Stops sampling and returns the frames captured so far. */
  stop: () => string[];
}

export function startWebFrameCapture(): WebFrameSession | null {
  if (typeof document === 'undefined') return null;

  // expo-camera's web implementation renders the preview as a <video> element.
  const video = document.querySelector('video');
  if (!video || video.readyState < 2) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const frames: string[] = [];

  const grabFrame = () => {
    if (frames.length >= MAX_FRAMES) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const scale = Math.min(1, MAX_FRAME_WIDTH / w);
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      frames.push(canvas.toDataURL('image/jpeg', 0.5));
    } catch {
      // Tainted canvas or transient decode issue — skip this frame.
    }
  };

  grabFrame();
  const intervalId = setInterval(grabFrame, FRAME_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(intervalId);
      return frames.slice();
    },
  };
}
