import { apiClient } from './client';
import { withNetworkRetry } from './retry';

export async function fetchMtaArrivals(
  routeId: string,
  latitude: number,
  longitude: number
): Promise<string> {
  const res = await withNetworkRetry(() =>
    apiClient.post('/mta', { routeId, lat: latitude, lon: longitude }, { timeout: 30_000 })
  );
  const data = res.data as { arrivals?: string; error?: string };
  if (typeof data.arrivals === 'string' && data.arrivals.trim()) {
    return data.arrivals.trim();
  }
  throw new Error(data.error ?? 'MTA lookup failed');
}
