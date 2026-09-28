/**
 * Unit tests for the Q3 AI Chat Agent's provider layer:
 *   services/aiProvider/geminiProvider.js
 *   services/aiProvider/anthropicProvider.js
 *   services/aiProvider/aiProviderFactory.js
 *
 * These call the REAL provider modules directly (no HTTP layer, no
 * database) and mock only `axios`, which is the exact boundary each
 * provider uses to reach the external AI API. No real API key or network
 * call is ever used. This lets the provider-level error handling
 * (malformed output, empty output, missing config, timeouts/network
 * failures) be exercised deterministically and without a live DB.
 *
 * Kept separate from tests/integration/aiAgent.test.js (which exercises
 * the full HTTP route -> controller -> service stack) so provider-level
 * behavior can be verified even in environments without Postgres.
 */

jest.mock('axios');
const axios = require('axios');

const config = require('../../src/config/env');
const geminiProvider = require('../../src/services/aiProvider/geminiProvider');
const anthropicProvider = require('../../src/services/aiProvider/anthropicProvider');
const aiProviderFactory = require('../../src/services/aiProvider/aiProviderFactory');

const ORIGINAL_AI_CONFIG = JSON.parse(JSON.stringify(config.ai));

afterEach(() => {
  jest.clearAllMocks();
  // Deep-restore so a mutation in one test (e.g. clearing an apiKey) never
  // leaks into the next test.
  config.ai.provider = ORIGINAL_AI_CONFIG.provider;
  config.ai.gemini = { ...ORIGINAL_AI_CONFIG.gemini };
  config.ai.anthropic = { ...ORIGINAL_AI_CONFIG.anthropic };
});

function geminiSuccessResponse({ reply = 'Sure, where are you flying from?', extractedParams = null } = {}) {
  return {
    data: {
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: JSON.stringify({ reply, extractedParams }) }] },
        },
      ],
    },
  };
}

function anthropicSuccessResponse({ reply = 'Sure, where are you flying from?', extractedParams = null } = {}) {
  return {
    data: {
      content: [{ type: 'text', text: JSON.stringify({ reply, extractedParams }) }],
    },
  };
}

// ---------------------------------------------------------------------
// aiProviderFactory
// ---------------------------------------------------------------------
describe('aiProviderFactory.getProvider', () => {
  test('returns the gemini provider module for "gemini"', () => {
    expect(aiProviderFactory.getProvider('gemini')).toBe(geminiProvider);
  });

  test('returns the anthropic provider module for "anthropic"', () => {
    expect(aiProviderFactory.getProvider('anthropic')).toBe(anthropicProvider);
  });

  test('falls back to gemini for an unknown/misconfigured provider name', () => {
    expect(aiProviderFactory.getProvider('some-unknown-provider')).toBe(geminiProvider);
  });

  test('defaults to config.ai.provider when no name is passed', () => {
    config.ai.provider = 'anthropic';
    expect(aiProviderFactory.getProvider()).toBe(anthropicProvider);
  });
});

// ---------------------------------------------------------------------
// geminiProvider.generateChatReply
// ---------------------------------------------------------------------
describe('geminiProvider.generateChatReply', () => {
  test('fails closed (AI_NOT_CONFIGURED, 500) when GEMINI_API_KEY is missing, and never calls the network', async () => {
    config.ai.gemini.apiKey = undefined;

    await expect(geminiProvider.generateChatReply({ userMessage: 'hi' })).rejects.toMatchObject({
      errorCode: 'AI_NOT_CONFIGURED',
      statusCode: 500,
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('returns the parsed reply and extractedParams on a well-formed provider response', async () => {
    config.ai.gemini.apiKey = 'fake-test-gemini-key';
    const extractedParams = { originCity: 'Delhi', destinationCountries: ['Japan'], readyToSearch: false };
    axios.post.mockResolvedValueOnce(geminiSuccessResponse({ reply: 'Great, where to?', extractedParams }));

    const result = await geminiProvider.generateChatReply({ history: [], userMessage: 'I want to visit Japan' });

    expect(result).toEqual({ reply: 'Great, where to?', extractedParams });
  });

  test('sends the configured model, API key, and the new user message to the correct Gemini endpoint', async () => {
    config.ai.gemini.apiKey = 'fake-test-gemini-key';
    config.ai.gemini.model = 'gemini-test-model';
    axios.post.mockResolvedValueOnce(geminiSuccessResponse());

    await geminiProvider.generateChatReply({
      history: [{ role: 'user', content: 'earlier message' }],
      userMessage: 'new message',
    });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent?key=fake-test-gemini-key'
    );
    expect(body.contents[body.contents.length - 1]).toEqual({ role: 'user', parts: [{ text: 'new message' }] });
  });

  test('never includes the raw API key in the request body (only in the URL, per current implementation)', async () => {
    config.ai.gemini.apiKey = 'fake-test-gemini-key';
    axios.post.mockResolvedValueOnce(geminiSuccessResponse());

    await geminiProvider.generateChatReply({ userMessage: 'hi' });

    const [, body] = axios.post.mock.calls[0];
    expect(JSON.stringify(body)).not.toContain('fake-test-gemini-key');
  });

  test('throws AI_PROVIDER_ERROR (502) when the provider response has no candidates/text and was not safety-blocked', async () => {
    config.ai.gemini.apiKey = 'fake-test-gemini-key';
    axios.post.mockResolvedValueOnce({ data: { candidates: [] } });

    await expect(geminiProvider.generateChatReply({ userMessage: 'hi' })).rejects.toMatchObject({
      errorCode: 'AI_PROVIDER_ERROR',
      statusCode: 502,
    });
  });

  test('throws AI_SAFETY_BLOCKED (400) when Gemini returns no text with finishReason SAFETY', async () => {
    config.ai.gemini.apiKey = 'fake-test-gemini-key';
    axios.post.mockResolvedValueOnce({ data: { candidates: [{ finishReason: 'SAFETY', content: undefined }] } });

    await expect(geminiProvider.generateChatReply({ userMessage: 'anything' })).rejects.toMatchObject({
      errorCode: 'AI_SAFETY_BLOCKED',
      statusCode: 400,
    });
  });

  test('throws AI_PROVIDER_ERROR (502) when the returned text is not valid JSON', async () => {
    config.ai.gemini.apiKey = 'fake-test-gemini-key';
    axios.post.mockResolvedValueOnce({
      data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json at all' }] } }] },
    });

    await expect(geminiProvider.generateChatReply({ userMessage: 'hi' })).rejects.toMatchObject({
      errorCode: 'AI_PROVIDER_ERROR',
      statusCode: 502,
    });
  });

  test('propagates the raw axios error as-is on timeout (current code does not catch/wrap network errors)', async () => {
    config.ai.gemini.apiKey = 'fake-test-gemini-key';
    const timeoutError = new Error('timeout of 20000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    axios.post.mockRejectedValueOnce(timeoutError);

    await expect(geminiProvider.generateChatReply({ userMessage: 'hi' })).rejects.toBe(timeoutError);
  });

  test('propagates the raw axios error as-is on an HTTP error status from the provider (e.g. rate limit)', async () => {
    config.ai.gemini.apiKey = 'fake-test-gemini-key';
    const rateLimitError = new Error('Request failed with status code 429');
    rateLimitError.response = { status: 429, data: { error: { message: 'rate limited' } } };
    axios.post.mockRejectedValueOnce(rateLimitError);

    await expect(geminiProvider.generateChatReply({ userMessage: 'hi' })).rejects.toBe(rateLimitError);
  });
});

// ---------------------------------------------------------------------
// anthropicProvider.generateChatReply
// ---------------------------------------------------------------------
describe('anthropicProvider.generateChatReply', () => {
  test('fails closed (AI_NOT_CONFIGURED, 500) when ANTHROPIC_API_KEY is missing, and never calls the network', async () => {
    config.ai.anthropic.apiKey = undefined;

    await expect(anthropicProvider.generateChatReply({ userMessage: 'hi' })).rejects.toMatchObject({
      errorCode: 'AI_NOT_CONFIGURED',
      statusCode: 500,
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('returns the parsed reply and extractedParams on a well-formed provider response', async () => {
    config.ai.anthropic.apiKey = 'fake-test-anthropic-key';
    const extractedParams = { originCity: 'Mumbai', destinationCountries: [], readyToSearch: false };
    axios.post.mockResolvedValueOnce(anthropicSuccessResponse({ reply: 'When would you like to travel?', extractedParams }));

    const result = await anthropicProvider.generateChatReply({ history: [], userMessage: 'I want a trip' });

    expect(result).toEqual({ reply: 'When would you like to travel?', extractedParams });
  });

  test('sends the API key only in the x-api-key header, never in the request body or URL', async () => {
    config.ai.anthropic.apiKey = 'fake-test-anthropic-key';
    axios.post.mockResolvedValueOnce(anthropicSuccessResponse());

    await anthropicProvider.generateChatReply({ userMessage: 'hi' });

    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.stringify(body)).not.toContain('fake-test-anthropic-key');
    expect(options.headers['x-api-key']).toBe('fake-test-anthropic-key');
  });

  test('strips a ```json code fence before parsing, if present', async () => {
    config.ai.anthropic.apiKey = 'fake-test-anthropic-key';
    const payload = JSON.stringify({ reply: 'ok', extractedParams: null });
    axios.post.mockResolvedValueOnce({ data: { content: [{ type: 'text', text: '```json\n' + payload + '\n```' }] } });

    const result = await anthropicProvider.generateChatReply({ userMessage: 'hi' });

    expect(result).toEqual({ reply: 'ok', extractedParams: null });
  });

  test('throws AI_PROVIDER_ERROR (502) when the response has no text content', async () => {
    config.ai.anthropic.apiKey = 'fake-test-anthropic-key';
    axios.post.mockResolvedValueOnce({ data: { content: [] } });

    await expect(anthropicProvider.generateChatReply({ userMessage: 'hi' })).rejects.toMatchObject({
      errorCode: 'AI_PROVIDER_ERROR',
      statusCode: 502,
    });
  });

  test('throws AI_PROVIDER_ERROR (502) when the returned text is not valid JSON', async () => {
    config.ai.anthropic.apiKey = 'fake-test-anthropic-key';
    axios.post.mockResolvedValueOnce({ data: { content: [{ type: 'text', text: 'definitely not json' }] } });

    await expect(anthropicProvider.generateChatReply({ userMessage: 'hi' })).rejects.toMatchObject({
      errorCode: 'AI_PROVIDER_ERROR',
      statusCode: 502,
    });
  });

  test('propagates the raw axios error as-is on timeout (current code does not catch/wrap network errors)', async () => {
    config.ai.anthropic.apiKey = 'fake-test-anthropic-key';
    const timeoutError = new Error('timeout of 20000ms exceeded');
    timeoutError.code = 'ECONNABORTED';
    axios.post.mockRejectedValueOnce(timeoutError);

    await expect(anthropicProvider.generateChatReply({ userMessage: 'hi' })).rejects.toBe(timeoutError);
  });

  test('propagates the raw axios error as-is on an HTTP error status from the provider (e.g. invalid key / auth failure)', async () => {
    config.ai.anthropic.apiKey = 'fake-test-anthropic-key';
    const authError = new Error('Request failed with status code 401');
    authError.response = { status: 401, data: { error: { message: 'invalid x-api-key' } } };
    axios.post.mockRejectedValueOnce(authError);

    await expect(anthropicProvider.generateChatReply({ userMessage: 'hi' })).rejects.toBe(authError);
  });
});
