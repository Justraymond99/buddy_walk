import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { epochSeconds } from '../../server/services/mta.ts';

describe('epochSeconds', () => {
  it('normalizes unix seconds and milliseconds', () => {
    assert.equal(epochSeconds(1781806357), 1781806357);
    assert.equal(epochSeconds(1781806357000), 1781806357);
  });

  it('reads protobuf-style long objects', () => {
    assert.equal(epochSeconds({ low: 1781806357, high: 0 }), 1781806357);
    assert.equal(epochSeconds({ toNumber: () => 1781806357 }), 1781806357);
  });
});
