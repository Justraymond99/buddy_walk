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
    // Direct upstream first (fast); Render proxy is the fallback so questions
    // still work if the upstream host has an outage.
    let res;
    try {
      res = await aiClient.post('/text', payload, { timeout: 120_000 });
    } catch (directError) {
      console.warn('sendTextRequest: direct AI host failed, falling back to Render', directError);
      res = await withNetworkRetry(() =>
        apiClient.post('/text', payload, { timeout: 120_000 })
      );
    }
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
  image: string;
  destination: string;
}): Promise<{ output?: string; error?: string; testLogId?: string }> {
  // Prefer our API so Last Meters field-test logs are saved when that host has
  // OpenAI + Street View keys. If that route is unavailable, try Dylan's AI
  // host, then degrade to the standard photo Q&A route instead of failing.
  try {
    let res;
    try {
      res = await withNetworkRetry(() =>
        apiClient.post('/last-mile', data, { timeout: 180_000 })
      );
    } catch (apiError) {
      console.warn('sendLastMileRequest: primary API failed, falling back to AI host', apiError);
      res = await aiClient.post('/last-mile', data, { timeout: 180_000 });
    }
    return res.data as { output?: string; error?: string; testLogId?: string };
  } catch (error) {
    console.error('sendLastMileRequest error:', error);
    const fallback = await sendTextRequest({
      text:
        `Last meters navigation to ${data.destination}. ` +
        'Use my current photo and location to give one short, safe orientation instruction. ' +
        'If you are not confident, say that clearly and ask me to retake the photo.',
      image: [data.image],
      coords: {
        latitude: data.lat,
        longitude: data.lng,
        accuracy: 0,
      },
      analytics: {
        feature: 'last_meters_fallback',
      },
    });
    if (fallback?.output) {
      return {
        output:
          'Last Meters test mode is not available on this server, so I used the photo-based fallback. ' +
          fallback.output,
      };
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
