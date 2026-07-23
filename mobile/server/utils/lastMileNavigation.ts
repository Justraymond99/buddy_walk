export const LAST_MILE_HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315] as const;
export const LAST_METERS_EXACT_RADIUS_METERS = 250;

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

export function parseDestinationVisibility(response: string): boolean {
  return response.trim().toUpperCase() === "VISIBLE";
}

export function snapLastMileHeading(heading: number): number {
  if (!Number.isFinite(heading)) {
    throw new Error("Last Meters heading must be a finite number.");
  }
  const normalized = ((heading % 360) + 360) % 360;
  return LAST_MILE_HEADINGS[
    Math.round(normalized / 45) % LAST_MILE_HEADINGS.length
  ];
}

export function lastMileHeadingDifference(
  currentHeading: number,
  targetHeading: number
): number {
  if (!Number.isFinite(currentHeading) || !Number.isFinite(targetHeading)) {
    throw new Error("Last Meters headings must be finite numbers.");
  }
  return Math.abs(((targetHeading - currentHeading + 540) % 360) - 180);
}

export function isLastMileHeadingAligned(
  currentHeading: number,
  targetHeading: number,
  toleranceDegrees = 30
): boolean {
  if (!Number.isFinite(toleranceDegrees) || toleranceDegrees < 0 || toleranceDegrees > 180) {
    throw new Error("Last Meters heading tolerance must be between 0 and 180 degrees.");
  }
  return lastMileHeadingDifference(currentHeading, targetHeading) <= toleranceDegrees;
}

function formatLastMileDistance(distanceMeters: number): string {
  return distanceMeters >= 1_000
    ? `${(distanceMeters / 1_609.344).toFixed(1)} miles`
    : `${Math.max(
        50,
        Math.round((distanceMeters * 3.28084) / 50) * 50
      ).toLocaleString("en-US")} feet`;
}

export function buildAlignedHeadingInstruction(
  destination: string,
  distanceMeters: number
): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error("Last Meters distance must be a non-negative finite number.");
  }
  return (
    `${destination} is roughly ${formatLastMileDistance(distanceMeters)} ahead on your current heading. ` +
    "Keep this heading and continue with your primary navigation."
  );
}

export function buildLastMileApproachInstruction(
  destination: string,
  distanceMeters: number,
  bearing: number
): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error("Last Meters distance must be a non-negative finite number.");
  }
  const directionNames = [
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest",
  ];
  const direction = directionNames[snapLastMileHeading(bearing) / 45];
  const distance = formatLastMileDistance(distanceMeters);

  return (
    `${destination} is roughly ${distance} to the ${direction}. ` +
    "Continue with your primary navigation and use Last Meters again when you are within about 800 feet."
  );
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
