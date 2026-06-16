import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';

const MAX_FRAMES = 10;
const FRAME_INTERVAL_MS = 1000;

/** Sample up to one JPEG frame per second for the vision API (same idea as the web client). */
export async function extractVideoFrames(videoUri: string): Promise<string[]> {
  const frames: string[] = [];

  for (let i = 0; i < MAX_FRAMES; i++) {
    const time = i * FRAME_INTERVAL_MS;
    try {
      const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time,
        quality: 0.5,
      });
      const base64 = await FileSystem.readAsStringAsync(thumbUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      frames.push(`data:image/jpeg;base64,${base64}`);
    } catch {
      break;
    }
  }

  return frames;
}
