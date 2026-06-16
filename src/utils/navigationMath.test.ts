import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  haversineMeters,
  hasUsableDestination,
  metersToFeetText,
  stepHasUsableCoords,
} from './navigationMath.ts';
import type { NavRoute, NavStep } from '../types';

function routeWithDestination(destination: NavRoute['destination']): NavRoute {
  return { destination, steps: [] };
}

function navStep(startLocation: NavStep['startLocation'], endLocation: NavStep['endLocation']): NavStep {
  return {
    index: 0,
    instruction: 'Continue straight',
    distance: { text: '', value: 0 },
    duration: { text: '', value: 0 },
    maneuver: 'straight',
    startLocation,
    endLocation,
  };
}

describe('navigationMath', () => {
  it('calculates nearby distances in meters', () => {
    assert.equal(haversineMeters({ lat: 40, lng: -73 }, { lat: 40, lng: -73 }), 0);

    const oneLatitudeDegree = haversineMeters({ lat: 40, lng: -73 }, { lat: 41, lng: -73 });
    assert.ok(oneLatitudeDegree > 111000);
    assert.ok(oneLatitudeDegree < 112000);
  });

  it('formats distance recaps for speech', () => {
    assert.equal(metersToFeetText(Number.NaN), '');
    assert.equal(metersToFeetText(3), 'a few feet');
    assert.equal(metersToFeetText(10), '35 feet');
    assert.equal(metersToFeetText(60), '200 feet');
  });

  it('recognizes placeholder route coordinates', () => {
    assert.equal(stepHasUsableCoords(undefined), false);
    assert.equal(
      stepHasUsableCoords(navStep({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })),
      false
    );
    assert.equal(
      stepHasUsableCoords(navStep({ lat: 40.1, lng: -73.1 }, { lat: 40.2, lng: -73.2 })),
      true
    );
  });

  it('recognizes a usable destination coordinate', () => {
    assert.equal(hasUsableDestination(null), false);
    assert.equal(hasUsableDestination(undefined), false);
    assert.equal(hasUsableDestination(routeWithDestination({ lat: 0, lng: 0 })), false);
    assert.equal(
      hasUsableDestination(routeWithDestination({ lat: Number.NaN, lng: -73 })),
      false
    );
    assert.equal(
      hasUsableDestination(routeWithDestination({ lat: 40.73, lng: -73.99 })),
      true
    );
  });
});
