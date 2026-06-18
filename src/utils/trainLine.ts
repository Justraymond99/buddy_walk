/** NYC subway lines supported by our MTA feed lookup. */
const VALID_ROUTES = new Set([
  '1', '2', '3', '4', '5', '6', '7',
  'A', 'C', 'E', 'B', 'D', 'F', 'M', 'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W',
]);

const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
};

function normalizeRoute(raw: string): string | null {
  const route = raw.trim().toUpperCase();
  return VALID_ROUTES.has(route) ? route : null;
}

/** True when the user is asking about subway arrival times. */
export function isTrainArrivalQuestion(text: string): boolean {
  const t = text.toLowerCase();
  return /train|subway|mta/.test(t) && /arriv|coming|when|next|how long|wait/.test(t);
}

/**
 * Pull the requested subway line from natural-language text.
 * Prefers explicit mentions in the user's words over model guesses.
 */
export function extractTrainLineFromText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;

  const patterns: RegExp[] = [
    /\b([1-7])\s*-?\s*(?:train|line)\b/i,
    /\b(?:train|line)\s*([1-7])\b/i,
    /\b([A-Z])\s*-?\s*(?:train|line)\b/i,
    /\b(?:train|line)\s*([A-Z])\b/i,
    /\b(one|two|three|four|five|six|seven)\s+(?:train|line)\b/i,
    // Speech-to-text often hears "four train" as "for train".
    /\bfor\s+(?:the\s+)?(?:train|line)\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(t);
    if (!match) continue;

    if (pattern.source.includes('for')) return '4';

    const token = match[1];
    if (!token) continue;

    const fromWord = NUMBER_WORDS[token.toLowerCase()];
    if (fromWord) return fromWord;

    const route = normalizeRoute(token);
    if (route) return route;
  }

  // Bare "when is the 4 arriving" / "next 4"
  const bareDigit = /\b([1-7])\b/.exec(t);
  if (bareDigit && /train|subway|mta|arriv|coming|next/.test(t.toLowerCase())) {
    return bareDigit[1];
  }

  return null;
}

/** Attach authoritative live MTA data so the AI answers the correct line. */
export function buildTrainQuestionWithLiveData(
  userText: string,
  route: string,
  mtaData: string
): string {
  return (
    `${userText}\n\n` +
    `[The user asked specifically about the ${route} train. ` +
    `Use ONLY this live MTA data for the ${route} train. ` +
    `Do not mention other train lines. ` +
    `Lead with the nearest station, then direction and minutes until each arrival: ` +
    `${mtaData}]`
  );
}
