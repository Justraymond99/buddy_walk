import { API_ROOT, apiClient } from './client';

const VERCEL_TRANSCRIBE = 'https://buddy-walk-mobile.vercel.app/api/transcribe';

export interface TranscribeResult {
  transcript: string;
  status: string;
}

async function parseTranscribeResponse(response: Response): Promise<TranscribeResult | null> {
  if (!response.ok) {
    console.error('transcribe HTTP error:', response.status, await response.text());
    return null;
  }
  const data = (await response.json()) as TranscribeResult;
  return data;
}

export async function transcribeAudio(
  audioBody: Blob | ArrayBuffer,
  contentType: string
): Promise<TranscribeResult | null> {
  const endpoints = [
    `${apiClient.defaults.baseURL}/transcribe`,
    ...(API_ROOT.replace(/\/$/, '') !== 'https://buddy-walk-mobile.vercel.app'
      ? [VERCEL_TRANSCRIBE]
      : []),
  ];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: audioBody,
      });
      const parsed = await parseTranscribeResponse(response);
      if (parsed) return parsed;
    } catch (error) {
      console.warn(`transcribe failed for ${url}:`, error);
    }
  }

  return null;
}
