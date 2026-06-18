import { apiClient, API_ROOT } from './client';

const FALLBACK_TOKEN_ROOT = 'https://buddywalk.app';

export async function getToken(): Promise<{ token: string; region: string } | undefined> {
  try {
    const response = await apiClient.get('/token/getToken');
    if (response.data?.token && response.data?.region) {
      return { token: response.data.token, region: response.data.region };
    }
  } catch (e) {
    console.warn('getToken: primary endpoint failed, trying fallback', e);
  }

  // Vercel may not have Azure keys configured; buddywalk.app issues STT tokens.
  if (API_ROOT.replace(/\/$/, '') !== FALLBACK_TOKEN_ROOT) {
    try {
      const response = await fetch(`${FALLBACK_TOKEN_ROOT}/api/token/getToken`);
      if (response.ok) {
        const data = (await response.json()) as { token?: string; region?: string };
        if (data.token && data.region) {
          return { token: data.token, region: data.region };
        }
      }
    } catch (e) {
      console.error('getToken fallback error:', e);
    }
  }

  throw new Error('Failed to fetch token');
}
