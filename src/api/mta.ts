import { apiClient } from './client';

export async function fetchMtaArrivals(
  routeId: string,
  latitude: number,
  longitude: number
): Promise<string> {
  const res = await apiClient.post('/mta', { routeId, lat: latitude, lon: longitude });
  const data = res.data as { arrivals?: string; error?: string };
  if (typeof data.arrivals === 'string' && data.arrivals.trim()) {
    return data.arrivals.trim();
  }
  throw new Error(data.error ?? 'MTA lookup failed');
}
