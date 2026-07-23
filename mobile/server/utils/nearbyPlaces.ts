export interface NearbyPlaceCandidate {
  place_id?: string;
  name?: string;
  vicinity?: string;
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
}

export interface NearbyPlaceSelection extends NearbyPlaceCandidate {
  distanceMeters: number;
}

function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

export function normalizeNearbyPlaceQuery(query: string): string {
  return query
    .replace(/\b(?:closest|nearest)\b/gi, "")
    .replace(/\b(?:near|close to)\s+me\b/gi, "")
    .replace(/\bnearby\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractNearbyPlaceQuery(input: string): string | null {
  const text = input.trim();
  const patterns = [
    /(?:directions?|route|navigate|walk|head|take me|get me|bring me)\s+(?:to|toward|towards)\s+(.+)/i,
    /how\s+(?:do|can|would|could)\s+i\s+(?:get|walk|go)\s+(?:to|toward|towards)\s+(.+)/i,
    /(?:nearest|closest)\s+(.+?)(?:\s+(?:to|from)\s+me)?[?.!]*$/i,
    /(?:find|show me|where(?:'s| is))\s+(?:the\s+)?(.+?)(?:\s+(?:near|close to)\s+me|\s+nearby)?[?.!]*$/i,
    /(.+?)\s+(?:near|close to)\s+me[?.!]*$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const query = normalizeNearbyPlaceQuery(
      match[1].replace(/[?.!]+\s*$/, "").replace(/^(?:the|a|an)\s+/i, "")
    );
    if (/^(?:what|which|who|how|is|are)\b/i.test(query)) continue;
    if (query.length >= 2) return query;
  }

  return null;
}

export function selectNearbyPlaceCandidate(
  candidates: NearbyPlaceCandidate[],
  origin: { lat: number; lng: number },
  maxDistanceMeters = 50_000
): NearbyPlaceSelection | null {
  const ranked = candidates
    .map((candidate) => {
      const lat = candidate.geometry?.location?.lat;
      const lng = candidate.geometry?.location?.lng;
      if (
        typeof lat !== "number" ||
        !Number.isFinite(lat) ||
        typeof lng !== "number" ||
        !Number.isFinite(lng)
      ) {
        return null;
      }
      return {
        ...candidate,
        distanceMeters: haversineMeters(origin, { lat, lng }),
      };
    })
    .filter((candidate): candidate is NearbyPlaceSelection => candidate !== null)
    .filter((candidate) => candidate.distanceMeters <= maxDistanceMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return ranked[0] ?? null;
}
