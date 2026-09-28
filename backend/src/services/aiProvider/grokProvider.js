const axios = require('axios');
const config = require('../../config/env');
const AppError = require('../../utils/AppError');

const BASE_URL = 'https://api.x.ai/v1';

/**
 * Shreya AI structured output schema.
 *
 * Grok returns exactly this JSON structure.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description:
        'Natural, conversational response to the traveler.',
    },

    extractedParams: {
      type: 'object',

      properties: {
        originCity: {
          type: ['string', 'null'],
          description:
            'Free-text city or airport the user is flying from, if mentioned.',
        },

        destinationCountries: {
          type: 'array',
          items: {
            type: 'string',
          },
          description:
            'Country names mentioned as desired destinations, up to 4.',
        },

        departureDate: {
          type: ['string', 'null'],
          description:
            'YYYY-MM-DD if a specific departure date was given, otherwise null.',
        },

        returnDate: {
          type: ['string', 'null'],
          description:
            'YYYY-MM-DD if a specific return date was given, otherwise null.',
        },

        dateFlexible: {
          type: 'boolean',
          description:
            'True if the user said their dates are flexible or open.',
        },

        travelers: {
          type: ['integer', 'null'],
          description:
            'Number of travelers if mentioned.',
        },

        budgetInr: {
          type: ['number', 'null'],
          description:
            'Budget in INR if mentioned, converted approximately from another currency if needed.',
        },

        preference: {
          type: ['string', 'null'],
          enum: ['cheapest', 'fastest', 'balanced'],
          description:
            'Search preference if mentioned.',
        },

        readyToSearch: {
          type: 'boolean',
          description:
            'True once origin, at least one destination country, and either a date or explicit flexibility are known.',
        },
      },

      required: [
        'originCity',
        'destinationCountries',
        'departureDate',
        'returnDate',
        'dateFlexible',
        'travelers',
        'budgetInr',
        'preference',
        'readyToSearch',
      ],

      additionalProperties: false,
    },
  },

  required: ['reply', 'extractedParams'],

  additionalProperties: false,
};

/**
 * System prompt for Shreya AI.
 */
const SYSTEM_PROMPT = `You are the travel-planning assistant inside FlightOptimizer, an Indian flight search app.

Your ONLY job each turn is to:
1. Have a warm, brief, natural conversation about the traveler's trip.
2. Extract whatever structured search parameters you can confidently infer into extractedParams.

Hard rules:
- NEVER state specific flight prices, airline names, flight numbers, hotel names, or availability — you have no real-time data. The app's own search engine handles that separately once the person runs a search.
- The app supports: up to 4 destination countries per trip, up to 3 nearby-airport alternates, flexible dates within +/-3 days of a given date, and three ranking preferences (cheapest, fastest, balanced). Don't imply it can do more than this.
- If budget is given in a non-INR currency, convert to an approximate INR figure.
- Ask ONE clarifying question at a time if key info (origin, destination, rough dates or flexibility) is missing.
- Set readyToSearch=true only once you have an origin, at least one destination country, and either a date or explicit flexibility.
- Keep replies to 2-3 sentences.
- Return ONLY the requested JSON structure.`;

/**
 * Convert application chat history into xAI Responses API input.
 */
function buildInput(history, userMessage) {
  const input = [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
  ];

  for (const message of history) {
    input.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    });
  }

  input.push({
    role: 'user',
    content: userMessage,
  });

  return input;
}

/**
 * Extract text from xAI Responses API output.
 */
function extractResponseText(responseData) {
  if (typeof responseData?.output_text === 'string') {
    return responseData.output_text;
  }

  const output = responseData?.output || [];

  for (const item of output) {
    if (item?.type !== 'message') {
      continue;
    }

    const content = item?.content || [];

    for (const part of content) {
      if (
        part?.type === 'output_text' &&
        typeof part?.text === 'string'
      ) {
        return part.text;
      }
    }
  }

  return '';
}

/**
 * Generate a response from Grok.
 */
async function generateChatReply({
  history = [],
  userMessage,
}) {
  // ------------------------------------------------------------
  // 1. Check Grok configuration
  // ------------------------------------------------------------
  if (!config.ai.grok.apiKey) {
    throw new AppError(
      'AI chat is not configured. Set GROK_API_KEY in .env.',
      500,
      'AI_NOT_CONFIGURED'
    );
  }

  const model = config.ai.grok.model;

  const url = `${BASE_URL}/responses`;

  try {
    // ----------------------------------------------------------
    // 2. Build request
    // ----------------------------------------------------------
    const payload = {
      model,

      input: buildInput(history, userMessage),

      text: {
        format: {
          type: 'json_schema',
          name: 'flight_optimizer_response',
          schema: RESPONSE_SCHEMA,
          strict: true,
        },
      },

      store: false,
    };

    // ----------------------------------------------------------
    // 3. Call Grok
    // ----------------------------------------------------------
    const response = await axios.post(
      url,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.ai.grok.apiKey}`,
        },

        timeout: 30000,
      }
    );

    // ----------------------------------------------------------
    // 4. Extract response text
    // ----------------------------------------------------------
    const rawText = extractResponseText(response.data);

    if (!rawText) {
      throw new AppError(
        'AI provider returned an empty response.',
        502,
        'AI_PROVIDER_ERROR'
      );
    }

    // ----------------------------------------------------------
    // 5. Parse JSON
    // ----------------------------------------------------------
    let parsed;

    try {
      parsed = JSON.parse(rawText);
    } catch (parseError) {
      console.error('Grok returned invalid JSON:', {
        model,
        rawText: rawText.slice(0, 1000),
      });

      throw new AppError(
        'AI provider returned malformed output.',
        502,
        'AI_PROVIDER_ERROR'
      );
    }

    // ----------------------------------------------------------
    // 6. Validate response structure
    // ----------------------------------------------------------
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.reply !== 'string' ||
      !parsed.extractedParams ||
      typeof parsed.extractedParams !== 'object'
    ) {
      console.error(
        'Grok returned invalid response structure:',
        {
          model,
          keys:
            parsed && typeof parsed === 'object'
              ? Object.keys(parsed)
              : [],
        }
      );

      throw new AppError(
        'AI provider returned an invalid response structure.',
        502,
        'AI_PROVIDER_ERROR'
      );
    }

    // ----------------------------------------------------------
    // 7. Return normalized result
    // ----------------------------------------------------------
    return {
      reply: parsed.reply,
      extractedParams: parsed.extractedParams,
    };
  } catch (err) {
    // ----------------------------------------------------------
    // 8. Preserve our own AppErrors
    // ----------------------------------------------------------
    if (err instanceof AppError) {
      throw err;
    }

    // ----------------------------------------------------------
    // 9. Handle Axios / xAI errors
    // ----------------------------------------------------------
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;

      const providerMessage =
        err.response?.data?.error?.message ||
        err.response?.data?.error?.status ||
        err.message;

      // Never log the API key.
      console.error('Grok API error:', {
        status,
        message: providerMessage,
        model,
      });

      // --------------------------------------------------------
      // Invalid request
      // --------------------------------------------------------
      if (status === 400) {
        throw new AppError(
          `Grok rejected the request: ${providerMessage}`,
          502,
          'AI_PROVIDER_ERROR'
        );
      }

      // --------------------------------------------------------
      // Authentication / authorization
      // --------------------------------------------------------
      if (status === 401 || status === 403) {
        throw new AppError(
          'Grok API authentication failed. Check GROK_API_KEY.',
          502,
          'AI_PROVIDER_ERROR'
        );
      }

      // --------------------------------------------------------
      // Rate limit
      // --------------------------------------------------------
      if (status === 429) {
        throw new AppError(
          'Grok API rate limit reached. Please try again shortly.',
          429,
          'AI_RATE_LIMITED'
        );
      }

      // --------------------------------------------------------
      // Service unavailable
      // --------------------------------------------------------
      if (status === 500 || status === 502 || status === 503) {
        throw new AppError(
          'Grok AI service is temporarily unavailable. Please try again shortly.',
          503,
          'AI_PROVIDER_UNAVAILABLE'
        );
      }

      // --------------------------------------------------------
      // Other provider errors
      // --------------------------------------------------------
      throw new AppError(
        'Grok AI provider request failed.',
        502,
        'AI_PROVIDER_ERROR'
      );
    }

    // ----------------------------------------------------------
    // 10. Unknown error
    // ----------------------------------------------------------
    throw err;
  }
}

module.exports = {
  generateChatReply,
};