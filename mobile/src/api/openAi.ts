import { aiClient, apiClient } from './client';
import { withNetworkRetry } from './retry';
import { withBriefReplyInstruction } from '../utils/briefAiInstruction';
import { RequestData, NavRoute } from '../types';
import { appVersion, getInstallId, platform, sessionId } from '../utils/identity';
import { getConversationId } from '../utils/conversationSession';

export interface TextResponse {
  output: string;
  /** Optional structured walking route from the backend (used for distance sanity checks). */
  route?: NavRoute | null;
}

export async function sendTextRequest(data: RequestData): Promise<TextResponse | undefined> {
  if (!data.text.trim()) return undefined;
  try {
    const installId = await getInstallId();
    const payload: RequestData = {
      ...data,
      text: withBriefReplyInstruction(data.text),
      analytics: {
        ...data.analytics,
        installId,
        sessionId,
        conversationId: getConversationId(),
        platform,
        appVersion,
      },
    };
    const start = Date.now();
    // Render owns verified local routing. Text requests must never fall back to
    // the legacy AI host, even when location is unavailable.
    const res = await withNetworkRetry(() =>
      apiClient.post('/text', payload, { timeout: 120_000 })
    );
    console.log(`Text request completed in ${Date.now() - start}ms`);
    return res.data as TextResponse;
  } catch (e) {
    console.error('sendTextRequest error:', e);
    throw e;
  }
}
export async function sendLastMileRequest(data: {
  lat: number;
  lng: number;
  gpsAccuracyMeters?: number;
  heading?: number;
  image: string;
  destination: string;
}): Promise<{
  output?: string;
  error?: string;
  testLogId?: string;
  mode?: 'approach' | 'exact' | 'aligned';
  warning?: string;
}> {
  // Last Meters is hosted on Render; buddywalk.app does not expose this route.
  try {
    const res = await withNetworkRetry(() =>
      apiClient.post('/last-mile', data, { timeout: 180_000 })
    );
    return res.data as {
      output?: string;
      error?: string;
      testLogId?: string;
      mode?: 'approach' | 'exact' | 'aligned';
      warning?: string;
    };
  } catch (error: any) {
    console.error('sendLastMileRequest error:', error);
    const backendMessage = error?.response?.data?.error;
    if (typeof backendMessage === 'string' && backendMessage.trim()) {
      throw new Error(backendMessage);
    }
    throw error;
  }
}
export async function sendAudioRequest(text: string): Promise<ArrayBuffer | undefined> {
  if (!text.trim()) return undefined;
  try {
    const res = await aiClient.post('/audio', { text }, { responseType: 'arraybuffer' });
    return res.data;
  } catch (directError) {
    console.warn('sendAudioRequest: direct AI host failed, falling back to Render', directError);
    try {
      const res = await apiClient.post('/audio', { text }, { responseType: 'arraybuffer' });
      return res.data;
    } catch (e) {
      console.error('sendAudioRequest error:', e);
      throw e;
    }
  }
}
