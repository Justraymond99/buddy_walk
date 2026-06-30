import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildCompanionShareUrl } from './companionUrl.ts';

describe('buildCompanionShareUrl', () => {
  it('builds caretaker URLs with encoded tokens', () => {
    assert.equal(
      buildCompanionShareUrl('abc 123/a', 'https://buddywalk.example.com/'),
      'https://buddywalk.example.com/companion-viewer.html?token=abc%20123%2Fa'
    );
  });

  it('works with base URLs that have no trailing slash', () => {
    assert.equal(
      buildCompanionShareUrl('token', 'http://localhost:8000'),
      'http://localhost:8000/companion-viewer.html?token=token'
    );
  });
});
