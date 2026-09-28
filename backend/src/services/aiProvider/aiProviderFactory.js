const grokProvider = require('./grokProvider');
const anthropicProvider = require('./anthropicProvider');
const config = require('../../config/env');
const logger = require('../../logger/logger');

const PROVIDERS = {
  grok: grokProvider,
  anthropic: anthropicProvider,
};

function getProvider(name = config.ai.provider) {
  const provider = PROVIDERS[name];

  if (!provider) {
    logger.error(`Unknown AI_PROVIDER "${name}"`);
    throw new Error(`Unsupported AI provider: ${name}`);
  }

  return provider;
}

module.exports = { getProvider };