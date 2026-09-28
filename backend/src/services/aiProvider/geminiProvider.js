const axios = require('axios');
const config = require('../../config/env');
const AppError = require('../../utils/AppError');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini structured output schema.
 *
 * This schema is used with the Gemini REST generateContent endpoint:
 * generationConfig.responseMimeType
 * generationConfig.responseSchema
 *
 * REST Schema types:
 * OBJECT, STRING, ARRAY, INTEGER, BOOLEAN, NUMBER
 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',

  properties: {
    reply: {
      type: 'STRING',
      description:
        'Natural, conversational response to the traveler.',
    },

    extractedParams: {
      type: 'OBJECT',

      properties: {
        originCity: {
          type: 'STRING',
          nullable: true,
          description:
            'Free-text city or airport the user is flying from, if mentioned.',
        },

        destinationCountries: {
          type: 'ARRAY',
          items: {
            type: 'STRING',
          },
          description:
            'Country names mentioned as desired destinations, up to 4.',
        },

        departureDate: {
          type: 'STRING',
          nullable: true,
          description:
            'YYYY-MM-DD if a specific departure date was given, otherwise null.',
        },

        returnDate: {
          type: 'STRING',
          nullable: true,
          description:
            'YYYY-MM-DD if a specific return date was given, otherwise null.',
        },

        dateFlexible: {
          type: 'BOOLEAN',
          description:
            'True if the user said their dates are flexible or open.',
        },

        travelers: {
          type: 'INTEGER',
          nullable: true,
          description:
            'Number of travelers if mentioned.',
        },

        budgetInr: {
          type: 'NUMBER',
          nullable: true,
          description:
            'Budget in INR if mentioned, converted approximately from another currency if needed.',
        },

        preference: {
          type: 'STRING',
          nullable: true,
          enum: ['cheapest', 'fastest', 'balanced'],
          description:
            'Search preference if mentioned: cheapest, fastest, or balanced.',
        },

        readyToSearch: {
          type: 'BOOLEAN',
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
    },
  },

  required: ['reply', 'extractedParams'],
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
 * Convert application chat history into Gemini contents format.
 */
function buildContents(history, userMessage) {
  const contents = history.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [
      {
        text: message.content,
      },
    ],
  }));

  contents.push({
    role: 'user',
    parts: [
      {
        text: userMessage,
      },
    ],
  });

  return contents;
}

/**
 * Generate a response from Gemini.
 */
async function generateChatReply({ history = [], userMessage }) {
  // ------------------------------------------------------------
  // 1. Check Gemini configuration
  // ------------------------------------------------------------
  if (!config.ai.gemini.apiKey) {
    throw new AppError(
      'AI chat is not configured. Set GEMINI_API_KEY in .env.',
      500,
      'AI_NOT_CONFIGURED'
    );
  }

  const model = config.ai.gemini.model;

  const url = `${BASE_URL}/models/${model}:generateContent`;

  try {
    // ----------------------------------------------------------
    // 2. Call Gemini
    // ----------------------------------------------------------
    const response = await axios.post(
      url,
      {
        contents: buildContents(history, userMessage),

        systemInstruction: {
          parts: [
            {
              text: SYSTEM_PROMPT,
            },
          ],
        },

        /**
         * IMPORTANT:
         *
         * Do NOT use:
         *
         * responseFormat: {
         *   text: {
         *     mimeType: 'application/json'
         *   }
         * }
         *
         * For this REST generateContent request we use:
         *
         * responseMimeType
         * responseSchema
         */
        generationConfig: {
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',

          // API key is sent through the header instead of URL query params.
          'x-goog-api-key': config.ai.gemini.apiKey,
        },

        timeout: 20000,
      }
    );

    // ----------------------------------------------------------
    // 3. Extract Gemini candidate
    // ----------------------------------------------------------
    const candidate = response.data?.candidates?.[0];

    const finishReason = candidate?.finishReason;

    const parts = candidate?.content?.parts || [];

    // Gemini can potentially return multiple text parts.
    const rawText = parts
      .filter((part) => typeof part?.text === 'string')
      .map((part) => part.text)
      .join('');

    // ----------------------------------------------------------
    // 4. Handle empty response
    // ----------------------------------------------------------
    if (!rawText) {
      if (finishReason === 'SAFETY') {
        throw new AppError(
          'That message could not be processed. Try rephrasing.',
          400,
          'AI_SAFETY_BLOCKED'
        );
      }

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
      console.error('Gemini returned invalid JSON:', {
        model,
        finishReason,
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
      console.error('Gemini returned invalid response structure:', {
        model,
        keys:
          parsed && typeof parsed === 'object'
            ? Object.keys(parsed)
            : [],
      });

      throw new AppError(
        'AI provider returned an invalid response structure.',
        502,
        'AI_PROVIDER_ERROR'
      );
    }

    // ----------------------------------------------------------
    // 7. Return normalized result to aiChatService
    // ----------------------------------------------------------
    return {
      reply: parsed.reply,
      extractedParams: parsed.extractedParams,
    };
  } catch (err) {
    // ----------------------------------------------------------
    // 8. Do not wrap our own AppErrors again
    // ----------------------------------------------------------
    if (err instanceof AppError) {
      throw err;
    }

    // ----------------------------------------------------------
    // 9. Handle Axios/Gemini errors
    // ----------------------------------------------------------
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;

      const providerMessage =
        err.response?.data?.error?.message ||
        err.response?.data?.error?.status ||
        err.message;

      // IMPORTANT:
      // Never log the Gemini API key.
      console.error('Gemini API error:', {
        status,
        message: providerMessage,
        model,
      });

      // --------------------------------------------------------
      // Invalid request
      // --------------------------------------------------------
      if (status === 400) {
        throw new AppError(
          `Gemini rejected the request: ${providerMessage}`,
          502,
          'AI_PROVIDER_ERROR'
        );
      }

      // --------------------------------------------------------
      // Authentication / authorization
      // --------------------------------------------------------
      if (status === 401 || status === 403) {
        throw new AppError(
          'Gemini API authentication failed. Check GEMINI_API_KEY.',
          502,
          'AI_PROVIDER_ERROR'
        );
      }

      // --------------------------------------------------------
      // Rate limit
      // --------------------------------------------------------
      if (status === 429) {
        throw new AppError(
          'Gemini API rate limit reached. Please try again shortly.',
          429,
          'AI_RATE_LIMITED'
        );
      }

      // --------------------------------------------------------
      // Other Gemini errors
      // --------------------------------------------------------
      throw new AppError(
        'Gemini AI provider request failed.',
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