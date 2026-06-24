import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withBriefReplyInstruction } from './briefAiInstruction.ts';

describe('withBriefReplyInstruction', () => {
  it('appends brevity guidance once', () => {
    const out = withBriefReplyInstruction('When is the 4 train arriving?');
    assert.match(out, /1-3 short sentences/);
    assert.equal(withBriefReplyInstruction(out), out);
  });

  it('leaves empty text unchanged', () => {
    assert.equal(withBriefReplyInstruction(''), '');
  });
});
