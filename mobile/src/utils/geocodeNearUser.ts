import * as Location from 'expo-location';

import { haversineMeters } from './navigationMath';

/** Reject geocode hits farther than a practical walking distance from the user. */
const MAX_WALKING_BIAS_M = 12_000;

const NYC_HINT = /new york|brooklyn|queens|manhattan|bronx|staten island|\bny\b/i;

/** Bias bare street addresses toward NYC — most Buddy Walk users are in the metro area. */
export function normalizeAddressForGeocode(query: string): string {
  const trimmed = query.trim();
  if (!trimmed || NYC_HINT.test(trimmed)) return trimmed;
  return `${trimmed}, New York, NY`;
}

/**
 * Geocode a place name and pick the result closest to the user.
 * Reduces wrong-city matches from the platform geocoder.
 */
export async function geocodeNearUser(
  query: string,
  userCoords?: { lat: number; lng: number } | null
): Promise<{ lat: number; lng: number } | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const biased = normalizeAddressForGeocode(trimmed);
    const results = await Location.geocodeAsync(biased);
    if (!Array.isArray(results) || results.length === 0) return null;

    if (!userCoords) {
      const first = results[0];
      return { lat: first.latitude, lng: first.longitude };
    }

    let best: Location.LocationGeocodedLocation | null = null;
    let bestDist = Infinity;
    for (const hit of results) {
      const dist = haversineMeters(userCoords, { lat: hit.latitude, lng: hit.longitude });
      if (dist < bestDist) {
        bestDist = dist;
        best = hit;
      }
    }

    if (!best || bestDist > MAX_WALKING_BIAS_M) return null;
    return { lat: best.latitude, lng: best.longitude };
  } catch {
    return null;
  }
}
