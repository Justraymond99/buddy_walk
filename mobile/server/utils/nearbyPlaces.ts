export interface NearbyPlaceCandidate {
  place_id?: string;
  name?: string;
  vicinity?: string;
  types?: string[];
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

export const MAX_LOCAL_PLACE_DISTANCE_METERS = 5_000;

export function nearbyPlaceDistanceMeters(
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

const PLACE_TYPE_ALIASES: Record<string, string[]> = {
  atm: ["atm"],
  bank: ["bank"],
  bar: ["bar"],
  cafe: ["cafe"],
  coffee: ["cafe"],
  "coffee shop": ["cafe"],
  gas: ["gas_station"],
  "gas station": ["gas_station"],
  grocery: ["grocery_or_supermarket", "supermarket"],
  "grocery store": ["grocery_or_supermarket", "supermarket"],
  hospital: ["hospital"],
  hotel: ["lodging"],
  pharmacy: ["drugstore", "pharmacy"],
  "post office": ["post_office"],
  restaurant: ["restaurant"],
  supermarket: ["grocery_or_supermarket", "supermarket"],
};

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isNearbyPlaceCandidateRelevant(
  candidate: NearbyPlaceCandidate,
  query: string
): boolean {
  const normalizedQuery = normalizeMatchText(normalizeNearbyPlaceQuery(query));
  if (!normalizedQuery) return false;

  const normalizedName = normalizeMatchText(candidate.name || "");
  const normalizedAddress = normalizeMatchText(candidate.vicinity || "");
  if (
    normalizedName.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedName) && normalizedName.length >= 4
  ) {
    return true;
  }

  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length >= 2);
  const nameTokens = new Set(normalizedName.split(" "));
  if (queryTokens.length > 0 && queryTokens.every((token) => nameTokens.has(token))) {
    return true;
  }

  const aliases = PLACE_TYPE_ALIASES[normalizedQuery] ?? [];
  if (aliases.some((type) => candidate.types?.includes(type))) {
    return true;
  }

  const queryNumbers = queryTokens.filter((token) => /^\d+$/.test(token));
  return (
    queryNumbers.length > 0 &&
    queryNumbers.every((number) => normalizedAddress.split(" ").includes(number))
  );
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
  maxDistanceMeters = MAX_LOCAL_PLACE_DISTANCE_METERS
): NearbyPlaceSelection | null {
  return selectNearbyPlaceCandidates(candidates, origin, maxDistanceMeters)[0] ?? null;
}

export function selectNearbyPlaceCandidates(
  candidates: NearbyPlaceCandidate[],
  origin: { lat: number; lng: number },
  maxDistanceMeters = MAX_LOCAL_PLACE_DISTANCE_METERS
): NearbyPlaceSelection[] {
  return candidates
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
        distanceMeters: nearbyPlaceDistanceMeters(origin, { lat, lng }),
      };
    })
    .filter((candidate): candidate is NearbyPlaceSelection => candidate !== null)
    .filter((candidate) => candidate.distanceMeters <= maxDistanceMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
