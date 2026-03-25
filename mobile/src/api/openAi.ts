import { apiClient } from './client';
import { RequestData } from '../types';

export async function sendTextRequest(data: RequestData): Promise<{ output: string } | undefined> {
  if (!data.text.trim()) return undefined;
  try {
    const start = Date.now();
    const res = await apiClient.post('/text', data);
    console.log(`Text request completed in ${Date.now() - start}ms`);
    return res.data;
  } catch (e) {
    console.error('sendTextRequest error:', e);
    throw e;
  }
}

export async function sendAudioRequest(text: string): Promise<ArrayBuffer | undefined> {
  if (!text.trim()) return undefined;
  try {
    const res = await apiClient.post('/audio', { text }, { responseType: 'arraybuffer' });
    return res.data;
  } catch (e) {
    console.error('sendAudioRequest error:', e);
    throw e;
  }
}
