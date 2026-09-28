const geminiProvider = require('./geminiProvider');
const anthropicProvider = require('./anthropicProvider');
const config = require('../../config/env');
const logger = require('../../logger/logger');

const PROVIDERS = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
};

function getProvider(name = config.ai.provider) {
  const provider = PROVIDERS[name];
  if (!provider) {
    logger.warn(`Unknown AI_PROVIDER "${name}", falling back to gemini`);
    return PROVIDERS.gemini;
  }
  return provider;
}

module.exports = { getProvider };
