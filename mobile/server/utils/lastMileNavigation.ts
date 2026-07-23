export const LAST_MILE_HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315] as const;

const NOT_VISIBLE_PATTERN =
  /\b(?:not visible|not in view|cannot (?:identify|locate|match|see)|can't (?:identify|locate|match|see)|unknown|no match)\b/i;

export function parseLastMileHeading(response: string): number | null {
  const text = response.trim();
  if (!text || NOT_VISIBLE_PATTERN.test(text) || /\bNOT_VISIBLE\b/i.test(text)) {
    return null;
  }

  const validHeadings = new Set<number>(LAST_MILE_HEADINGS);
  const matches = [...text.matchAll(/\b\d{1,3}\b/g)]
    .map((match) => Number(match[0]))
    .map((heading) => (heading === 360 ? 0 : heading))
    .filter((heading) => validHeadings.has(heading));
  const uniqueMatches = [...new Set(matches)];

  return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
}

export function buildLastMileTurnInstruction(
  currentHeading: number,
  targetHeading: number
): string {
  if (
    !LAST_MILE_HEADINGS.includes(currentHeading as (typeof LAST_MILE_HEADINGS)[number]) ||
    !LAST_MILE_HEADINGS.includes(targetHeading as (typeof LAST_MILE_HEADINGS)[number])
  ) {
    throw new Error("Last Meters headings must be one of the eight panorama directions.");
  }

  const difference = ((targetHeading - currentHeading + 540) % 360) - 180;
  const degrees = Math.abs(difference);

  if (degrees === 0) {
    return "No turn needed. Keep facing forward.";
  }
  if (degrees === 180) {
    return "Turn around 180 degrees without moving forward.";
  }

  return `Turn ${degrees} degrees to your ${difference > 0 ? "right" : "left"}.`;
}
