import { apiClient, API_ROOT } from './client';
import { OWNED_API_ROOT } from '../config/apiHosts';

export async function getToken(): Promise<{ token: string; region: string }> {
  try {
    const response = await apiClient.get('/token/getToken');
    if (response.data?.token && response.data?.region) {
      return { token: response.data.token, region: response.data.region };
    }
  } catch (e) {
    console.warn('getToken: primary endpoint failed', e);
  }

  // Local dev (LAN IP): fall back to the owned production API when Azure keys aren't on the LAN server.
  const root = API_ROOT.replace(/\/$/, '');
  if (root !== OWNED_API_ROOT) {
    try {
      const response = await fetch(`${OWNED_API_ROOT}/api/token/getToken`);
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
