const axios = require('axios');
const config = require('../../config/env');
const AppError = require('../../utils/AppError');

const BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Shreya AI structured output schema.
 *
 * IMPORTANT:
 * Groq strict structured output is intentionally kept
 * non-nullable here.
 *
 * We use safe sentinel values:
 * - "" for unknown strings
 * - 0 for unknown numbers
 * - "unspecified" for unknown preference
 *
 * These values are normalized back to null after parsing.
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
          type: 'string',
          description:
            'Free-text city or airport the user is flying from. Use empty string "" if not mentioned.',
        },

        destinationCountries: {
          type: 'array',
          items: {
            type: 'string',
          },
          description:
            'Country names mentioned as desired destinations, up to 4. Use an empty array if none are mentioned.',
        },

        departureDate: {
          type: 'string',
          description:
            'YYYY-MM-DD if a specific departure date was given. Use empty string "" if not given.',
        },

        returnDate: {
          type: 'string',
          description:
            'YYYY-MM-DD if a specific return date was given. Use empty string "" if not given.',
        },

        dateFlexible: {
          type: 'boolean',
          description:
            'True if the user said their dates are flexible or open. Otherwise false.',
        },

        travelers: {
          type: 'integer',
          description:
            'Number of travelers if mentioned. Use 0 if not mentioned.',
        },

        budgetInr: {
          type: 'number',
          description:
            'Budget in INR if mentioned. Use 0 if no budget was mentioned.',
        },

        preference: {
          type: 'string',
          enum: [
            'cheapest',
            'fastest',
            'balanced',
            'unspecified',
          ],
          description:
            'Search preference. Use cheapest, fastest, or balanced when specified. Use unspecified when no preference is given.',
        },

        readyToSearch: {
          type: 'boolean',
          description:
            'True only when origin, at least one destination country, and either a date or explicit date flexibility are known.',
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

  required: [
    'reply',
    'extractedParams',
  ],

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
- The app supports: up to 4 destination countries per trip, up to 3 nearby-airport alternates, flexible dates within +/-3 days of a given date, and three ranking preferences (cheapest, fastest, balanced).
- If budget is given in a non-INR currency, convert to an approximate INR figure.
- Ask ONE clarifying question at a time if key info (origin, destination, rough dates or flexibility) is missing.
- Set readyToSearch=true only once you have an origin, at least one destination country, and either a date or explicit flexibility.
- Keep replies to 2-3 sentences.

Structured output rules:
- originCity must always be a string. Use "" when unknown.
- destinationCountries must always be an array. Use [] when unknown.
- departureDate must always be a string. Use "" when unknown.
- returnDate must always be a string. Use "" when unknown.
- dateFlexible must always be true or false.
- travelers must always be an integer. Use 0 when unknown.
- budgetInr must always be a number. Use 0 when unknown.
- preference must always be one of: cheapest, fastest, balanced, unspecified.
- readyToSearch must always be true or false.
- NEVER return null for any extractedParams field.
- Return ONLY the requested JSON structure.`;

/**
 * Convert application chat history into
 * Groq Chat Completions API messages.
 */
function buildMessages(history, userMessage) {
  const messages = [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
  ];

  for (const message of history) {
    messages.push({
      role:
        message.role === 'assistant'
          ? 'assistant'
          : 'user',
      content: message.content,
    });
  }

  messages.push({
    role: 'user',
    content: userMessage,
  });

  return messages;
}

/**
 * Extract text from Groq Chat Completions API response.
 */
function extractResponseText(responseData) {
  const content =
    responseData?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  return '';
}

/**
 * Normalize Groq's strict-schema sentinel values
 * into the application's existing null-based contract.
 */
function normalizeExtractedParams(params) {
  return {
    originCity:
      typeof params.originCity === 'string' &&
      params.originCity.trim() !== ''
        ? params.originCity.trim()
        : null,

    destinationCountries:
      Array.isArray(params.destinationCountries)
        ? params.destinationCountries
        : [],

    departureDate:
      typeof params.departureDate === 'string' &&
      params.departureDate.trim() !== ''
        ? params.departureDate
        : null,

    returnDate:
      typeof params.returnDate === 'string' &&
      params.returnDate.trim() !== ''
        ? params.returnDate
        : null,

    dateFlexible:
      Boolean(params.dateFlexible),

    travelers:
      Number.isInteger(params.travelers) &&
      params.travelers > 0
        ? params.travelers
        : null,

    budgetInr:
      typeof params.budgetInr === 'number' &&
      Number.isFinite(params.budgetInr) &&
      params.budgetInr > 0
        ? params.budgetInr
        : null,

    preference:
      params.preference === 'cheapest' ||
      params.preference === 'fastest' ||
      params.preference === 'balanced'
        ? params.preference
        : null,

    readyToSearch:
      Boolean(params.readyToSearch),
  };
}

/**
 * Generate a response from Groq.
 */
async function generateChatReply({
  history = [],
  userMessage,
}) {
  if (!config.ai.groq.apiKey) {
    throw new AppError(
      'AI chat is not configured. Set GROQ_API_KEY in .env.',
      500,
      'AI_NOT_CONFIGURED'
    );
  }

  const model = config.ai.groq.model;
  const url = `${BASE_URL}/chat/completions`;

  try {
    const payload = {
      model,

      messages: buildMessages(
        history,
        userMessage
      ),

      max_completion_tokens: 2048,

      reasoning_effort: 'medium',

      response_format: {
        type: 'json_schema',

        json_schema: {
          name: 'flight_optimizer_response',
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    };

    const response = await axios.post(
      url,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization:
            `Bearer ${config.ai.groq.apiKey}`,
        },

        timeout: 30000,
      }
    );

    const rawText =
      extractResponseText(response.data);

    if (!rawText) {
      throw new AppError(
        'AI provider returned an empty response.',
        502,
        'AI_PROVIDER_ERROR'
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(rawText);
    } catch (parseError) {
      console.error(
        'Groq returned invalid JSON:',
        {
          model,
          rawText: rawText.slice(0, 1000),
        }
      );

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
      console.error(
        'Groq returned invalid response structure:',
        {
          model,
          keys:
            parsed &&
            typeof parsed === 'object'
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

    const extractedParams =
      normalizeExtractedParams(
        parsed.extractedParams
      );

    return {
      reply: parsed.reply,
      extractedParams,
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

      console.error('Groq API error:', {
        status,
        message: providerMessage,
        model,
      });

      if (status === 400) {
        throw new AppError(
          `Groq rejected the request: ${providerMessage}`,
          502,
          'AI_PROVIDER_ERROR'
        );
      }

      if (status === 401 || status === 403) {
        throw new AppError(
          'Groq API authentication failed. Check GROQ_API_KEY.',
          502,
          'AI_PROVIDER_ERROR'
        );
      }

      if (status === 429) {
        throw new AppError(
          'Groq API rate limit reached. Please try again shortly.',
          429,
          'AI_RATE_LIMITED'
        );
      }

      if (
        status === 500 ||
        status === 502 ||
        status === 503
      ) {
        throw new AppError(
          'Groq AI service is temporarily unavailable. Please try again shortly.',
          503,
          'AI_PROVIDER_UNAVAILABLE'
        );
      }

      throw new AppError(
        'Groq AI provider request failed.',
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