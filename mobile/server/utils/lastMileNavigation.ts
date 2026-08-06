export const LAST_MILE_HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315] as const;
export const LAST_MILE_PANORAMA_FOV_DEGREES = 45;
export const LAST_METERS_EXACT_RADIUS_METERS = 250;
export const LAST_METERS_DESTINATION_REFERENCE_RADIUS_METERS = 75;

export type LastMileTestScenario =
  | "test_a_visible"
  | "test_a_reference"
  | "test_b_approach"
  | "heading_aligned"
  | "destination_unverified";

export type LastMileConfidenceLevel = "high" | "medium" | "low";

export interface LastMileConfidenceInput {
  gpsAccuracyMeters?: number;
  panoramaCurrentViewMatched: boolean;
  compassPanoramaAgrees?: boolean;
  destinationVisuallyMatched: boolean;
  destinationReferenceVerified: boolean;
}

export interface LastMileConfidence {
  score: number;
  level: LastMileConfidenceLevel;
  reasons: string[];
}

/**
 * Combines the independent evidence sources used in the last-meters study.
 * It intentionally does not choose a guidance heading; the compass remains
 * authoritative for that decision.
 */
export function calculateLastMileConfidence(
  input: LastMileConfidenceInput
): LastMileConfidence {
  const reasons: string[] = [];
  // The score starts low: a high-confidence result needs corroboration from
  // several sources, not merely a verified map destination.
  let score = 0.15;

  if (input.gpsAccuracyMeters === undefined) {
    reasons.push("Phone GPS accuracy was not available.");
  } else if (input.gpsAccuracyMeters <= 15) {
    score += 0.2;
  } else if (input.gpsAccuracyMeters <= 40) {
    score += 0.12;
  } else {
    score += 0.03;
    reasons.push(`Phone GPS accuracy is about ${Math.round(input.gpsAccuracyMeters)} meters.`);
  }

  if (input.panoramaCurrentViewMatched) {
    score += 0.2;
  } else {
    reasons.push("The user photo did not independently match the panorama.");
  }

  if (input.compassPanoramaAgrees === true) {
    score += 0.15;
  } else if (input.compassPanoramaAgrees === false) {
    score += 0.02;
    reasons.push("Compass and panorama headings disagree.");
  } else {
    reasons.push("Compass and panorama headings could not be compared.");
  }

  if (input.destinationVisuallyMatched) {
    score += 0.2;
  } else if (input.destinationReferenceVerified) {
    score += 0.12;
    reasons.push("Destination was verified with a separate Street View reference.");
  } else {
    reasons.push("Destination was not visually verified.");
  }

  const boundedScore = Math.max(0, Math.min(1, score));
  return {
    score: boundedScore,
    level: boundedScore >= 0.75 ? "high" : boundedScore >= 0.55 ? "medium" : "low",
    reasons,
  };
}

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

export function compareCompassAndPanoramaHeadings(
  deviceHeading: number | undefined,
  panoramaMatchedHeading: number | null,
  agreementToleranceDegrees = 45
): {
  compassHeading: number | null;
  panoramaMatchedHeading: number | null;
  authoritativeHeading: number | null;
  differenceDegrees?: number;
  agrees?: boolean;
} {
  const compassHeading =
    typeof deviceHeading === "number" && Number.isFinite(deviceHeading)
      ? snapLastMileHeading(deviceHeading)
      : null;
  const differenceDegrees =
    compassHeading !== null && panoramaMatchedHeading !== null
      ? lastMileHeadingDifference(compassHeading, panoramaMatchedHeading)
      : undefined;

  return {
    compassHeading,
    panoramaMatchedHeading,
    // Panorama is logged for evaluation but can never control guidance.
    authoritativeHeading: compassHeading,
    differenceDegrees,
    agrees:
      differenceDegrees === undefined
        ? undefined
        : differenceDegrees <= agreementToleranceDegrees,
  };
}

export function resolveVerifiedTargetHeading(
  visuallyMatchedHeading: number | null,
  expectedMapHeading: number,
  toleranceDegrees = 90
): number | null {
  if (
    !LAST_MILE_HEADINGS.includes(
      expectedMapHeading as (typeof LAST_MILE_HEADINGS)[number]
    )
  ) {
    throw new Error("Expected target heading must be a panorama direction.");
  }
  if (visuallyMatchedHeading === null) return null;
  if (
    !LAST_MILE_HEADINGS.includes(
      visuallyMatchedHeading as (typeof LAST_MILE_HEADINGS)[number]
    )
  ) {
    throw new Error("Visual target heading must be a panorama direction.");
  }
  return lastMileHeadingDifference(
    visuallyMatchedHeading,
    expectedMapHeading
  ) <= toleranceDegrees
    ? expectedMapHeading
    : null;
}

function formatLastMileDistance(distanceMeters: number): string {
  if (distanceMeters >= 1_000) {
    return `${(distanceMeters / 1_609.344).toFixed(1)} miles`;
  }

  const feet = distanceMeters * 3.28084;

  // For very short distances, round to nearest 5 feet
  if (feet <= 30) {
    const minFeet = Math.max(5, Math.round(feet / 5) * 5);
    return `${minFeet} feet`;
  }

  // For 30-100 feet, round to nearest 10 feet
  if (feet <= 100) {
    return `${Math.round(feet / 10) * 10} feet`;
  }

  const roundedFeet = Math.round(feet / 50) * 50;
  return `${roundedFeet.toLocaleString("en-US")} feet`;
}

function formatLastMileDirection(bearing: number): string {
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
  return directionNames[snapLastMileHeading(bearing) / 45];
}

export function shouldUseDestinationReference(distanceMeters: number): boolean {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error("Last Meters distance must be a non-negative finite number.");
  }
  return distanceMeters <= LAST_METERS_DESTINATION_REFERENCE_RADIUS_METERS;
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
  const direction = formatLastMileDirection(bearing);
  const distance = formatLastMileDistance(distanceMeters);

  return (
    `${destination} is roughly ${distance} to the ${direction}. ` +
    "Continue with your primary navigation and use Last Meters again when you are within about 800 feet."
  );
}

export function buildLastMileRetakeInstruction(
  destination: string,
  distanceMeters: number,
  bearing: number
): string {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new Error("Last Meters distance must be a non-negative finite number.");
  }
  return (
    `${destination} is not visible from this block and is roughly ` +
    `${formatLastMileDistance(distanceMeters)} to the ${formatLastMileDirection(bearing)}. ` +
    "Continue with your primary navigation for another block, then stop safely and take a new photo."
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

  let diff = (targetHeading - currentHeading) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  const degrees = Math.abs(diff);

  if (degrees <= 15) {
    return "No turn needed. Keep facing forward.";
  }
  if (degrees >= 165) {
    return "Turn around 180 degrees without moving forward.";
  }

  // Positive diff = Right, Negative diff = Left
  return `Turn ${degrees} degrees to your ${diff > 0 ? "right" : "left"}.`;
}
