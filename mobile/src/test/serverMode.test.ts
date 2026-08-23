import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  describeServerMode,
  getServiceRouting,
  getUpstreamApiRoot,
  isZeroConfigMode,
} from '../../server/config/serverMode';

const CREDENTIAL_VARS = [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'AZURE_SUBSCRIPTION_KEY',
  'AZURE_REGION',
  'MTA_API_KEY',
  'ZERO_CONFIG',
];

function clearCredentials(): void {
  for (const name of CREDENTIAL_VARS) delete process.env[name];
}

describe('serverMode', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('proxies every capability when no keys are set', () => {
    clearCredentials();
    assert.deepEqual(getServiceRouting(), {
      ai: 'proxy',
      speech: 'proxy',
      mta: 'proxy',
    });
    assert.equal(describeServerMode().mode, 'zero-config');
    assert.equal(isZeroConfigMode(), true);
  });

  it('serves every capability locally when all keys are set', () => {
    clearCredentials();
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AZURE_SUBSCRIPTION_KEY = 'azure-test';
    process.env.AZURE_REGION = 'eastus';
    process.env.MTA_API_KEY = 'mta-test';
    assert.deepEqual(getServiceRouting(), {
      ai: 'local',
      speech: 'local',
      mta: 'local',
    });
    assert.equal(describeServerMode().mode, 'self-hosted');
    assert.equal(isZeroConfigMode(), false);
  });

  // Regression: an OpenAI key used to flip a single global flag that also
  // pulled speech off the upstream proxy and onto an unconfigured local
  // route, returning 500 for every speech token and breaking voice input.
  it('keeps speech on the proxy when only an AI key is present', () => {
    clearCredentials();
    process.env.OPENAI_API_KEY = 'sk-test';
    const routing = getServiceRouting();
    assert.equal(routing.ai, 'local');
    assert.equal(routing.speech, 'proxy');
    assert.equal(routing.mta, 'proxy');
    assert.equal(describeServerMode().mode, 'mixed');
  });

  it('keeps AI on the proxy when only speech keys are present', () => {
    clearCredentials();
    process.env.AZURE_SUBSCRIPTION_KEY = 'azure-test';
    process.env.AZURE_REGION = 'eastus';
    const routing = getServiceRouting();
    assert.equal(routing.speech, 'local');
    assert.equal(routing.ai, 'proxy');
  });

  it('requires both Azure key and region before serving speech locally', () => {
    clearCredentials();
    process.env.AZURE_SUBSCRIPTION_KEY = 'azure-test';
    assert.equal(getServiceRouting().speech, 'proxy');

    process.env.AZURE_REGION = '   ';
    assert.equal(getServiceRouting().speech, 'proxy');

    process.env.AZURE_REGION = 'eastus';
    assert.equal(getServiceRouting().speech, 'local');
  });

  it('lets ZERO_CONFIG force proxying even when keys exist', () => {
    clearCredentials();
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AZURE_SUBSCRIPTION_KEY = 'azure-test';
    process.env.AZURE_REGION = 'eastus';
    process.env.ZERO_CONFIG = 'true';
    assert.deepEqual(getServiceRouting(), {
      ai: 'proxy',
      speech: 'proxy',
      mta: 'proxy',
    });
  });

  it('lets ZERO_CONFIG=false force local handlers', () => {
    clearCredentials();
    process.env.ZERO_CONFIG = 'false';
    assert.deepEqual(getServiceRouting(), {
      ai: 'local',
      speech: 'local',
      mta: 'local',
    });
  });

  it('reports the upstream whenever anything is still proxied', () => {
    clearCredentials();
    process.env.OPENAI_API_KEY = 'sk-test';
    assert.equal(describeServerMode().upstream, 'https://buddywalk.app');
  });

  it('normalizes upstream root', () => {
    process.env.UPSTREAM_API_ROOT = 'https://buddywalk.app/api/';
    assert.equal(getUpstreamApiRoot(), 'https://buddywalk.app');
  });
});

export {};
