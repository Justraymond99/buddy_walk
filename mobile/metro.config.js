/** @type {import('expo/metro-config').MetroConfig} */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const WEB_ONLY_MODULES = new Set([
  'web-speech-cognitive-services',
  'microsoft-cognitiveservices-speech-sdk',
]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web' && WEB_ONLY_MODULES.has(moduleName)) {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
