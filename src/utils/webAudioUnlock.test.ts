import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isSafariBrowser } from './webAudioUnlock.ts';

describe('isSafariBrowser', () => {
  it('detects Safari user agents', () => {
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
      configurable: true,
    });
    assert.equal(isSafariBrowser(), true);
    Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
  });

  it('excludes Chrome-on-iOS', () => {
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
      },
      configurable: true,
    });
    assert.equal(isSafariBrowser(), false);
    Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
  });
});
