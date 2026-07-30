import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAlignedHeadingInstruction,
  buildLastMileApproachInstruction,
  buildLastMileRetakeInstruction,
  buildLastMileTurnInstruction,
  isLastMileHeadingAligned,
  lastMileHeadingDifference,
  LAST_MILE_HEADINGS,
  LAST_MILE_PANORAMA_FOV_DEGREES,
  LAST_METERS_DESTINATION_REFERENCE_RADIUS_METERS,
  parseDestinationVisibility,
  parseLastMileHeading,
  resolveVerifiedTargetHeading,
  shouldUseDestinationReference,
  snapLastMileHeading,
} from "../../server/utils/lastMileNavigation";

test("parseLastMileHeading accepts a single valid panorama heading", () => {
  assert.equal(parseLastMileHeading("315"), 315);
  assert.equal(parseLastMileHeading("The matching view is 45 degrees."), 45);
  assert.equal(parseLastMileHeading("360"), 0);
});

test("parseLastMileHeading rejects uncertain, conflicting, and invalid responses", () => {
  assert.equal(parseLastMileHeading("NOT_VISIBLE"), null);
  assert.equal(parseLastMileHeading("The target is not in view, maybe 315."), null);
  assert.equal(parseLastMileHeading("45 or 90"), null);
  assert.equal(parseLastMileHeading("22"), null);
  assert.equal(parseLastMileHeading(""), null);
});

test("buildLastMileTurnInstruction always chooses the shortest safe turn", () => {
  assert.equal(
    buildLastMileTurnInstruction(225, 315),
    "Turn 90 degrees to your right."
  );
  assert.equal(
    buildLastMileTurnInstruction(315, 0),
    "Turn 45 degrees to your right."
  );
  assert.equal(
    buildLastMileTurnInstruction(45, 315),
    "Turn 90 degrees to your left."
  );
  assert.equal(
    buildLastMileTurnInstruction(0, 180),
    "Turn around 180 degrees without moving forward."
  );
  assert.equal(
    buildLastMileTurnInstruction(90, 90),
    "No turn needed. Keep facing forward."
  );
});

test("buildLastMileTurnInstruction rejects non-panorama headings", () => {
  assert.throws(() => buildLastMileTurnInstruction(Number.NaN, 45));
  assert.throws(() => buildLastMileTurnInstruction(0, 22));
});

test("parseDestinationVisibility only accepts an exact visible result", () => {
  assert.equal(parseDestinationVisibility("VISIBLE"), true);
  assert.equal(parseDestinationVisibility(" visible "), true);
  assert.equal(parseDestinationVisibility("NOT_VISIBLE"), false);
  assert.equal(parseDestinationVisibility("The storefront is visible."), false);
});

test("snapLastMileHeading chooses the nearest panorama direction", () => {
  assert.equal(snapLastMileHeading(12), 0);
  assert.equal(snapLastMileHeading(44), 45);
  assert.equal(snapLastMileHeading(338), 0);
  assert.equal(snapLastMileHeading(-46), 315);
  assert.throws(() => snapLastMileHeading(Number.NaN));
});

test("buildLastMileApproachInstruction gives only rough far-away guidance", () => {
  assert.equal(
    buildLastMileApproachInstruction("Whole Foods", 1_609.344, 47),
    "Whole Foods is roughly 1.0 miles to the northeast. Continue with your primary navigation and use Last Meters again when you are within about 800 feet."
  );
  assert.match(
    buildLastMileApproachInstruction("FedEx", 300, 180),
    /^FedEx is roughly 1,000 feet to the south\./
  );
  assert.throws(() =>
    buildLastMileApproachInstruction("FedEx", Number.NaN, 90)
  );
});

test("heading alignment handles compass wraparound", () => {
  assert.equal(lastMileHeadingDifference(350, 10), 20);
  assert.equal(lastMileHeadingDifference(10, 350), 20);
  assert.equal(isLastMileHeadingAligned(350, 10), true);
  assert.equal(isLastMileHeadingAligned(350, 30), false);
  assert.throws(() => isLastMileHeadingAligned(0, 90, 181));
});

test("verified panorama target preserves precise front-to-behind guidance", () => {
  assert.equal(resolveVerifiedTargetHeading(180, 180), 180);
  assert.equal(resolveVerifiedTargetHeading(135, 180), 180);
  assert.equal(resolveVerifiedTargetHeading(0, 180), null);
  assert.equal(buildLastMileTurnInstruction(0, 180), "Turn around 180 degrees without moving forward.");
});

test("buildAlignedHeadingInstruction keeps aligned guidance rough", () => {
  assert.equal(
    buildAlignedHeadingInstruction("Whole Foods", 320),
    "Whole Foods is roughly 1,050 feet ahead on your current heading. Keep this heading and continue with your primary navigation."
  );
});

test("close aligned guidance does not inflate the distance to 50 feet", () => {
  assert.equal(
    buildAlignedHeadingInstruction("CVS", 3),
    "CVS is roughly 10 feet ahead on your current heading. Keep this heading and continue with your primary navigation."
  );
  assert.equal(
    buildAlignedHeadingInstruction("Starbucks", 6),
    "Starbucks is roughly 20 feet ahead on your current heading. Keep this heading and continue with your primary navigation."
  );
});

test("panorama sectors cover 360 degrees once without overlap", () => {
  assert.equal(LAST_MILE_HEADINGS.length * LAST_MILE_PANORAMA_FOV_DEGREES, 360);
  for (let index = 1; index < LAST_MILE_HEADINGS.length; index += 1) {
    assert.equal(
      LAST_MILE_HEADINGS[index] - LAST_MILE_HEADINGS[index - 1],
      LAST_MILE_PANORAMA_FOV_DEGREES
    );
  }
});

test("destination references are limited to the same frontage", () => {
  assert.equal(
    shouldUseDestinationReference(
      LAST_METERS_DESTINATION_REFERENCE_RADIUS_METERS - 1
    ),
    true
  );
  assert.equal(
    shouldUseDestinationReference(
      LAST_METERS_DESTINATION_REFERENCE_RADIUS_METERS
    ),
    true
  );
  assert.equal(
    shouldUseDestinationReference(
      LAST_METERS_DESTINATION_REFERENCE_RADIUS_METERS + 1
    ),
    false
  );
  assert.throws(() => shouldUseDestinationReference(Number.NaN));
});

test("Test B guidance asks the user to move one block and retake", () => {
  assert.equal(
    buildLastMileRetakeInstruction("Whole Foods", 120, 90),
    "Whole Foods is not visible from this block and is roughly 400 feet to the east. Continue with your primary navigation for another block, then stop safely and take a new photo."
  );
});
