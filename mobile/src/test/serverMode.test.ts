import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { describeServerMode, getUpstreamApiRoot, isZeroConfigMode } from '../../server/config/serverMode';

describe('serverMode', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('defaults to zero-config when no AI keys are set', () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ZERO_CONFIG;
    assert.equal(isZeroConfigMode(), true);
    assert.equal(describeServerMode().mode, 'zero-config');
  });

  it('uses self-hosted mode when OpenAI key is present', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.ZERO_CONFIG;
    assert.equal(isZeroConfigMode(), false);
    assert.equal(describeServerMode().mode, 'self-hosted');
  });

  it('does not let zero-config override existing AI keys', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ZERO_CONFIG = 'true';
    assert.equal(isZeroConfigMode(), false);
    assert.equal(describeServerMode().mode, 'self-hosted');
  });

  it('normalizes upstream root', () => {
    process.env.UPSTREAM_API_ROOT = 'https://buddywalk.app/api/';
    assert.equal(getUpstreamApiRoot(), 'https://buddywalk.app');
  });
});

export {};
