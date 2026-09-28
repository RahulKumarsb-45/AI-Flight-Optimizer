/**
 * Unit tests for the AI Chat Agent's provider layer:
 *   services/aiProvider/groqProvider.js
 *   services/aiProvider/anthropicProvider.js
 *   services/aiProvider/aiProviderFactory.js
 *
 * These tests call the REAL provider modules directly.
 * Only axios is mocked, so no real API key or network call is used.
 */

jest.mock('axios');

const axios = require('axios');

const config = require('../../src/config/env');
const groqProvider = require('../../src/services/aiProvider/groqProvider');
const anthropicProvider = require('../../src/services/aiProvider/anthropicProvider');
const aiProviderFactory = require('../../src/services/aiProvider/aiProviderFactory');

const ORIGINAL_AI_CONFIG = JSON.parse(
  JSON.stringify(config.ai)
);

beforeAll(() => {
  /*
   * axios is fully mocked by Jest.
   * The providers use axios.isAxiosError() to distinguish
   * provider/network errors from normal application errors.
   */
  axios.isAxiosError.mockImplementation(
    (error) => !!error?.isAxiosError
  );
});

afterEach(() => {
  jest.clearAllMocks();

  /*
   * Restore AI configuration after every test so one test
   * cannot affect another.
   */
  config.ai.provider = ORIGINAL_AI_CONFIG.provider;

  config.ai.groq = {
    ...ORIGINAL_AI_CONFIG.groq,
  };

  config.ai.anthropic = {
    ...ORIGINAL_AI_CONFIG.anthropic,
  };
});

/**
 * ------------------------------------------------------------
 * Mock response helpers
 * ------------------------------------------------------------
 */

function groqSuccessResponse({
  reply = 'Sure, where are you flying from?',
  extractedParams = {},
} = {}) {
  return {
    data: {
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify({
              reply,
              extractedParams,
            }),
          },
          finish_reason: 'stop',
        },
      ],
    },
  };
}

function anthropicSuccessResponse({
  reply = 'Sure, where are you flying from?',
  extractedParams = {},
} = {}) {
  return {
    data: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            reply,
            extractedParams,
          }),
        },
      ],
    },
  };
}

function createAxiosError({
  status,
  message = 'Request failed',
  data = {},
} = {}) {
  const error = new Error(message);

  error.isAxiosError = true;

  error.response = {
    status,
    data,
  };

  return error;
}

/**
 * ============================================================
 * aiProviderFactory
 * ============================================================
 */

describe('aiProviderFactory.getProvider', () => {
  test('returns the Groq provider module for "groq"', () => {
    expect(
      aiProviderFactory.getProvider('groq')
    ).toBe(groqProvider);
  });

  test('returns the Anthropic provider module for "anthropic"', () => {
    expect(
      aiProviderFactory.getProvider('anthropic')
    ).toBe(anthropicProvider);
  });

  test('throws for an unknown provider name', () => {
    expect(() =>
      aiProviderFactory.getProvider(
        'some-unknown-provider'
      )
    ).toThrow(
      'Unsupported AI provider: some-unknown-provider'
    );
  });

  test('defaults to config.ai.provider when no name is passed', () => {
    config.ai.provider = 'groq';

    expect(
      aiProviderFactory.getProvider()
    ).toBe(groqProvider);

    config.ai.provider = 'anthropic';

    expect(
      aiProviderFactory.getProvider()
    ).toBe(anthropicProvider);
  });
});

/**
 * ============================================================
 * groqProvider.generateChatReply
 * ============================================================
 */

describe('groqProvider.generateChatReply', () => {
  test(
    'fails closed (AI_NOT_CONFIGURED, 500) when GROQ_API_KEY is missing, and never calls the network',
    async () => {
      config.ai.groq.apiKey = undefined;

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode: 'AI_NOT_CONFIGURED',
        statusCode: 500,
      });

      expect(axios.post).not.toHaveBeenCalled();
    }
  );

  test(
    'returns the parsed reply and extractedParams on a well-formed Groq response',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      const extractedParams = {
        originCity: 'Delhi',
        destinationCountries: ['Japan'],
        departureDate: null,
        returnDate: null,
        dateFlexible: false,
        travelers: null,
        budgetInr: null,
        preference: null,
        readyToSearch: false,
      };

      axios.post.mockResolvedValueOnce(
        groqSuccessResponse({
          reply: 'Great, where are you flying from?',
          extractedParams,
        })
      );

      const result =
        await groqProvider.generateChatReply({
          history: [],
          userMessage:
            'I want to visit Japan',
        });

      expect(result).toEqual({
        reply:
          'Great, where are you flying from?',
        extractedParams,
      });
    }
  );

  test(
    'sends the configured model, Groq API key, history, and new user message to the correct endpoint',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      config.ai.groq.model =
        'openai/gpt-oss-120b';

      axios.post.mockResolvedValueOnce(
        groqSuccessResponse()
      );

      await groqProvider.generateChatReply({
        history: [
          {
            role: 'user',
            content: 'I want to travel to Japan',
          },
          {
            role: 'assistant',
            content: 'Sure, when would you like to go?',
          },
        ],
        userMessage: 'Next month',
      });

      expect(axios.post).toHaveBeenCalledTimes(1);

      const [
        url,
        body,
        options,
      ] = axios.post.mock.calls[0];

      expect(url).toBe(
        'https://api.groq.com/openai/v1/chat/completions'
      );

      expect(body.model).toBe(
        'openai/gpt-oss-120b'
      );

      expect(body.messages).toEqual([
        {
          role: 'system',
          content: expect.any(String),
        },
        {
          role: 'user',
          content:
            'I want to travel to Japan',
        },
        {
          role: 'assistant',
          content:
            'Sure, when would you like to go?',
        },
        {
          role: 'user',
          content: 'Next month',
        },
      ]);

      expect(
        body.response_format
      ).toEqual({
        type: 'json_schema',
        json_schema: {
          name:
            'flight_optimizer_response',
          strict: true,
          schema:
            expect.objectContaining({
              type: 'object',
              required: [
                'reply',
                'extractedParams',
              ],
            }),
        },
      });

      expect(
        body.reasoning_effort
      ).toBe('medium');

      expect(
        body.max_completion_tokens
      ).toBe(2048);

      expect(
        options.headers.Authorization
      ).toBe(
        'Bearer fake-test-groq-key'
      );

      expect(
        options.headers['Content-Type']
      ).toBe('application/json');
    }
  );

  test(
    'never includes the raw API key in the request body',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-secret-key';

      axios.post.mockResolvedValueOnce(
        groqSuccessResponse()
      );

      await groqProvider.generateChatReply({
        userMessage: 'hi',
      });

      const [
        ,
        body,
      ] = axios.post.mock.calls[0];

      expect(
        JSON.stringify(body)
      ).not.toContain(
        'fake-test-groq-secret-key'
      );
    }
  );

  test(
    'throws AI_PROVIDER_ERROR (502) when the provider response has no usable content',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      axios.post.mockResolvedValueOnce({
        data: {
          choices: [],
        },
      });

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_ERROR',
        statusCode: 502,
      });
    }
  );

  test(
    'throws AI_PROVIDER_ERROR (502) when Groq returns invalid JSON',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      axios.post.mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content:
                  'this is not valid JSON',
              },
            },
          ],
        },
      });

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_ERROR',
        statusCode: 502,
      });
    }
  );

  test(
    'throws AI_PROVIDER_ERROR (502) when Groq returns an invalid response structure',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      axios.post.mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  invalid: true,
                }),
              },
            },
          ],
        },
      });

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_ERROR',
        statusCode: 502,
      });
    }
  );

  test(
    'preserves a normal non-Axios network error',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      const timeoutError = new Error(
        'timeout of 30000ms exceeded'
      );

      timeoutError.code =
        'ECONNABORTED';

      axios.post.mockRejectedValueOnce(
        timeoutError
      );

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toBe(timeoutError);
    }
  );

  test(
    'wraps Groq 400 errors as AI_PROVIDER_ERROR',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      const error = createAxiosError({
        status: 400,
        message:
          'Request failed with status code 400',
        data: {
          error: {
            message:
              'Invalid request',
          },
        },
      });

      axios.post.mockRejectedValueOnce(
        error
      );

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_ERROR',
        statusCode: 502,
        message:
          'Groq rejected the request: Invalid request',
      });
    }
  );

  test(
    'wraps Groq 401 authentication errors',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      const error = createAxiosError({
        status: 401,
        data: {
          error: {
            message:
              'Invalid API key',
          },
        },
      });

      axios.post.mockRejectedValueOnce(
        error
      );

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_ERROR',
        statusCode: 502,
        message:
          'Groq API authentication failed. Check GROQ_API_KEY.',
      });
    }
  );

  test(
    'wraps Groq 403 authorization errors',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      const error = createAxiosError({
        status: 403,
        data: {
          error: {
            message:
              'Forbidden',
          },
        },
      });

      axios.post.mockRejectedValueOnce(
        error
      );

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_ERROR',
        statusCode: 502,
      });
    }
  );

  test(
    'wraps Groq 429 errors as AI_RATE_LIMITED',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      const error = createAxiosError({
        status: 429,
        data: {
          error: {
            message:
              'Rate limit reached',
          },
        },
      });

      axios.post.mockRejectedValueOnce(
        error
      );

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_RATE_LIMITED',
        statusCode: 429,
      });
    }
  );

  test(
    'wraps Groq 500 errors as AI_PROVIDER_UNAVAILABLE',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      const error = createAxiosError({
        status: 500,
        data: {
          error: {
            message:
              'Internal server error',
          },
        },
      });

      axios.post.mockRejectedValueOnce(
        error
      );

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_UNAVAILABLE',
        statusCode: 503,
      });
    }
  );

  test(
    'wraps Groq 502 errors as AI_PROVIDER_UNAVAILABLE',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      const error = createAxiosError({
        status: 502,
      });

      axios.post.mockRejectedValueOnce(
        error
      );

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_UNAVAILABLE',
        statusCode: 503,
      });
    }
  );

  test(
    'wraps Groq 503 errors as AI_PROVIDER_UNAVAILABLE',
    async () => {
      config.ai.groq.apiKey =
        'fake-test-groq-key';

      const error = createAxiosError({
        status: 503,
      });

      axios.post.mockRejectedValueOnce(
        error
      );

      await expect(
        groqProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_UNAVAILABLE',
        statusCode: 503,
      });
    }
  );
});

/**
 * ============================================================
 * anthropicProvider.generateChatReply
 * ============================================================
 */

describe('anthropicProvider.generateChatReply', () => {
  test(
    'fails closed (AI_NOT_CONFIGURED, 500) when ANTHROPIC_API_KEY is missing, and never calls the network',
    async () => {
      config.ai.anthropic.apiKey =
        undefined;

      await expect(
        anthropicProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_NOT_CONFIGURED',
        statusCode: 500,
      });

      expect(
        axios.post
      ).not.toHaveBeenCalled();
    }
  );

  test(
    'returns the parsed reply and extractedParams on a well-formed provider response',
    async () => {
      config.ai.anthropic.apiKey =
        'fake-test-anthropic-key';

      const extractedParams = {
        originCity: 'Mumbai',
        destinationCountries: [],
        readyToSearch: false,
      };

      axios.post.mockResolvedValueOnce(
        anthropicSuccessResponse({
          reply:
            'When would you like to travel?',
          extractedParams,
        })
      );

      const result =
        await anthropicProvider.generateChatReply({
          history: [],
          userMessage:
            'I want a trip',
        });

      expect(result).toEqual({
        reply:
          'When would you like to travel?',
        extractedParams,
      });
    }
  );

  test(
    'sends the API key only in the x-api-key header, never in the request body or URL',
    async () => {
      config.ai.anthropic.apiKey =
        'fake-test-anthropic-key';

      axios.post.mockResolvedValueOnce(
        anthropicSuccessResponse()
      );

      await anthropicProvider.generateChatReply({
        userMessage: 'hi',
      });

      const [
        url,
        body,
        options,
      ] = axios.post.mock.calls[0];

      expect(url).toBe(
        'https://api.anthropic.com/v1/messages'
      );

      expect(
        JSON.stringify(body)
      ).not.toContain(
        'fake-test-anthropic-key'
      );

      expect(
        options.headers['x-api-key']
      ).toBe(
        'fake-test-anthropic-key'
      );
    }
  );

  test(
    'strips a ```json code fence before parsing, if present',
    async () => {
      config.ai.anthropic.apiKey =
        'fake-test-anthropic-key';

      const payload = JSON.stringify({
        reply: 'ok',
        extractedParams: null,
      });

      axios.post.mockResolvedValueOnce({
        data: {
          content: [
            {
              type: 'text',
              text:
                '```json\n' +
                payload +
                '\n```',
            },
          ],
        },
      });

      const result =
        await anthropicProvider.generateChatReply({
          userMessage: 'hi',
        });

      expect(result).toEqual({
        reply: 'ok',
        extractedParams: null,
      });
    }
  );

  test(
    'throws AI_PROVIDER_ERROR (502) when the response has no text content',
    async () => {
      config.ai.anthropic.apiKey =
        'fake-test-anthropic-key';

      axios.post.mockResolvedValueOnce({
        data: {
          content: [],
        },
      });

      await expect(
        anthropicProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_ERROR',
        statusCode: 502,
      });
    }
  );

  test(
    'throws AI_PROVIDER_ERROR (502) when the returned text is not valid JSON',
    async () => {
      config.ai.anthropic.apiKey =
        'fake-test-anthropic-key';

      axios.post.mockResolvedValueOnce({
        data: {
          content: [
            {
              type: 'text',
              text:
                'definitely not json',
            },
          ],
        },
      });

      await expect(
        anthropicProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toMatchObject({
        errorCode:
          'AI_PROVIDER_ERROR',
        statusCode: 502,
      });
    }
  );

  test(
    'propagates the raw axios error as-is on timeout',
    async () => {
      config.ai.anthropic.apiKey =
        'fake-test-anthropic-key';

      const timeoutError = new Error(
        'timeout of 20000ms exceeded'
      );

      timeoutError.code =
        'ECONNABORTED';

      axios.post.mockRejectedValueOnce(
        timeoutError
      );

      await expect(
        anthropicProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toBe(timeoutError);
    }
  );

  test(
    'propagates the raw axios error as-is on an HTTP error status',
    async () => {
      config.ai.anthropic.apiKey =
        'fake-test-anthropic-key';

      const authError = new Error(
        'Request failed with status code 401'
      );

      authError.response = {
        status: 401,
        data: {
          error: {
            message:
              'invalid x-api-key',
          },
        },
      };

      axios.post.mockRejectedValueOnce(
        authError
      );

      await expect(
        anthropicProvider.generateChatReply({
          userMessage: 'hi',
        })
      ).rejects.toBe(authError);
    }
  );
});