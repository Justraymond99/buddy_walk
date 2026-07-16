import axios from 'axios';
import { API_ROOT } from './client';

function isRetryableAxiosError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return true;
  if (error.code === 'ECONNABORTED') return true;
  if (error.message === 'Network Error') return true;
  const status = error.response.status;
  return status === 408 || status === 429 || (status >= 502 && status <= 504);
}

/** Wake the Render free-tier service before the first real API call. */
export async function warmApiBackend(): Promise<void> {
  try {
    await axios.get(`${API_ROOT}/api/health`, { timeout: 45_000 });
  } catch {
    // Best effort — real requests still retry if this fails.
  }
}

export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number }
): Promise<T> {
  const retries = options?.retries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 2000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableAxiosError(error) || attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (attempt + 1)));
      if (!axios.isAxiosError(error) || !error.response) {
        await warmApiBackend();
      }
    }
  }

  throw lastError;
}
