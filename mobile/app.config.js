/** Loads `.env` if present; otherwise uses buddy-walk-default-api.json. */
require('dotenv').config();

const appJson = require('./app.json');
const { apiRoot: defaultApiRoot } = require('./buddy-walk-default-api.json');

const easProfile = process.env.EAS_BUILD_PROFILE;
const isStoreBuild = easProfile === 'production' || easProfile === 'preview';

// EAS TestFlight builds must not bake in a developer's LAN/Tailscale .env overrides.
if (process.env.EAS_BUILD === 'true' && isStoreBuild) {
  delete process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_COMPANION_API_URL;
  delete process.env.EXPO_PUBLIC_COMPANION_SHARE_URL;
}

const resolvedApiRoot =
  (typeof process.env.EXPO_PUBLIC_API_URL === 'string' &&
    process.env.EXPO_PUBLIC_API_URL.trim()) ||
  defaultApiRoot;

const bypassAuth =
  typeof process.env.EXPO_PUBLIC_BYPASS_AUTH === 'string' &&
  ['1', 'true', 'yes'].includes(process.env.EXPO_PUBLIC_BYPASS_AUTH.trim().toLowerCase());

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra ?? {}),
      eas: {
        projectId: '3bd29606-f38c-40be-aa61-9ff255f47deb',
      },
      buddyWalkApiUrl: resolvedApiRoot,
      bypassAuth,
      firebase: {
        apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      },
    },
  },
};
