const axios = require('axios');
const config = require('../../config/env');
const AppError = require('../../utils/AppError');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini structured output schema.
 *
 * IMPORTANT:
 * - JSON Schema types must be lowercase.
 * - Nullable values use ["type", "null"].
 * - The schema is sent through generationConfig.responseFormat.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'Natural, conversational response to the traveler.',
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
          description: 'Number of travelers if mentioned.',
        },

        budgetInr: {
          type: ['number', 'null'],
          description:
            'Budget in INR if mentioned, converted approximately from another currency if needed.',
        },

        preference: {
          type: ['string', 'null'],
          enum: ['cheapest', 'fastest', 'balanced', null],
          description:
            'Search preference if mentioned: cheapest, fastest, or balanced.',
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
    },
  },

  required: ['reply', 'extractedParams'],
};

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

function buildContents(history, userMessage) {
  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  return contents;
}

async function generateChatReply({ history = [], userMessage }) {
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

        generationConfig: {
          maxOutputTokens: 500,

          responseFormat: {
            text: {
              mimeType: 'application/json',
              schema: RESPONSE_SCHEMA,
            },
          },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.ai.gemini.apiKey,
        },
        timeout: 20000,
      }
    );

    const candidate = response.data?.candidates?.[0];

    const finishReason = candidate?.finishReason;

    const parts = candidate?.content?.parts || [];

    const rawText = parts
      .filter((part) => typeof part?.text === 'string')
      .map((part) => part.text)
      .join('');

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

    let parsed;

    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      throw new AppError(
        'AI provider returned malformed output.',
        502,
        'AI_PROVIDER_ERROR'
      );
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.reply !== 'string' ||
      !parsed.extractedParams ||
      typeof parsed.extractedParams !== 'object'
    ) {
      throw new AppError(
        'AI provider returned an invalid response structure.',
        502,
        'AI_PROVIDER_ERROR'
      );
    }

    return {
      reply: parsed.reply,
      extractedParams: parsed.extractedParams,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }

    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const providerMessage =
        err.response?.data?.error?.message ||
        err.response?.data?.error?.status ||
        err.message;

      // Log provider details without logging the API key.
      console.error('Gemini API error:', {
        status,
        message: providerMessage,
        model,
      });

      if (status === 400) {
        throw new AppError(
          `Gemini rejected the request: ${providerMessage}`,
          502,
          'AI_PROVIDER_ERROR'
        );
      }

      if (status === 401 || status === 403) {
        throw new AppError(
          'Gemini API authentication failed. Check GEMINI_API_KEY.',
          502,
          'AI_PROVIDER_ERROR'
        );
      }

      if (status === 429) {
        throw new AppError(
          'Gemini API rate limit reached. Please try again shortly.',
          429,
          'AI_RATE_LIMITED'
        );
      }

      throw new AppError(
        'Gemini AI provider request failed.',
        502,
        'AI_PROVIDER_ERROR'
      );
    }

    throw err;
  }
}

module.exports = {
  generateChatReply,
};