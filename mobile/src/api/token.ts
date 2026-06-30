import { apiClient, API_ROOT } from './client';

const PRODUCTION_API = 'https://buddywalk.app';

export async function getToken(): Promise<{ token: string; region: string }> {
  try {
    const response = await apiClient.get('/token/getToken');
    if (response.data?.token && response.data?.region) {
      return { token: response.data.token, region: response.data.region };
    }
  } catch (e) {
    console.warn('getToken: primary endpoint failed', e);
  }

  // Local dev (LAN IP): fall back to production tokens when the local server has no Azure keys.
  const root = API_ROOT.replace(/\/$/, '');
  if (root !== PRODUCTION_API) {
    try {
      const response = await fetch(`${PRODUCTION_API}/api/token/getToken`);
      if (response.ok) {
        const data = (await response.json()) as { token?: string; region?: string };
        if (data.token && data.region) {
          return { token: data.token, region: data.region };
        }
      }
    } catch (e) {
      console.error('getToken: production fallback failed', e);
    }
  }

  throw new Error('Failed to fetch speech token');
}
