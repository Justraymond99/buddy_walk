import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLastMileTurnInstruction,
  parseLastMileHeading,
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
