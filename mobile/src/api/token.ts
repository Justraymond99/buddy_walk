import { apiClient } from './client';

export async function getToken(): Promise<{ token: string; region: string } | undefined> {
  try {
    const response = await apiClient.get('/token/getToken');
    if (response.data) {
      return { token: response.data.token, region: response.data.region };
    }
  } catch (e) {
    console.error('getToken error:', e);
    throw new Error('Failed to fetch token');
  }
}
