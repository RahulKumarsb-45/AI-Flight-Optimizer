const axios = require('axios');
const config = require('../../config/env');
const AppError = require('../../utils/AppError');

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Forces Gemini to return BOTH a conversational reply AND whatever structured
 * trip-search parameters it can infer so far, in one call — cheaper and
 * simpler than a separate extraction call per turn.
 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING', description: 'Natural, conversational response to the traveler.' },
    extractedParams: {
      type: 'OBJECT',
      properties: {
        originCity: { type: 'STRING', nullable: true, description: 'Free-text city/airport the user is flying from, if mentioned.' },
        destinationCountries: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Country names mentioned as desired destinations, up to 4.' },
        departureDate: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD if a specific date was given, else null.' },
        returnDate: { type: 'STRING', nullable: true },
        dateFlexible: { type: 'BOOLEAN', description: 'True if the user said their dates are flexible or open.' },
        travelers: { type: 'INTEGER', nullable: true },
        budgetInr: { type: 'NUMBER', nullable: true, description: 'Budget in INR if mentioned, converted from other currencies if needed.' },
        preference: { type: 'STRING', enum: ['cheapest', 'fastest', 'balanced'], nullable: true },
        readyToSearch: { type: 'BOOLEAN', description: 'True once origin + at least one destination + some date info are known.' },
      },
      required: ['destinationCountries', 'dateFlexible', 'readyToSearch'],
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
- The app supports: up to 4 destination countries per trip, up to 3 nearby-airport alternates, flexible dates within +/-3 days of a given date, and three ranking preferences (cheapest, fastest, balanced). Don't imply it can do more than this (e.g. don't promise 10-country trips or hotel booking).
- If budget is given in a non-INR currency, convert to an approximate INR figure and say so.
- Ask ONE clarifying question at a time if key info (origin, destination, rough dates or flexibility) is missing — don't interrogate with a checklist.
- Set readyToSearch=true only once you have an origin, at least one destination country, and either a date or explicit flexibility.
- Keep replies to 2-3 sentences. This is a chat widget, not an essay.`;

function buildContents(history, userMessage) {
  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  contents.push({ role: 'user', parts: [{ text: userMessage }] });
  return contents;
}

async function generateChatReply({ history = [], userMessage }) {
  if (!config.ai.gemini.apiKey) {
    throw new AppError('AI chat is not configured. Set GEMINI_API_KEY in .env.', 500, 'AI_NOT_CONFIGURED');
  }

  const url = `${BASE_URL}/models/${config.ai.gemini.model}:generateContent?key=${config.ai.gemini.apiKey}`;

  const response = await axios.post(
    url,
    {
      contents: buildContents(history, userMessage),
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 500,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 20000 }
  );

  const candidate = response.data.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const rawText = candidate?.content?.parts?.[0]?.text;

  if (!rawText) {
    if (finishReason === 'SAFETY') {
      throw new AppError('That message could not be processed. Try rephrasing.', 400, 'AI_SAFETY_BLOCKED');
    }
    throw new AppError('AI provider returned an empty response.', 502, 'AI_PROVIDER_ERROR');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new AppError('AI provider returned malformed output.', 502, 'AI_PROVIDER_ERROR');
  }

  return {
    reply: parsed.reply,
    extractedParams: parsed.extractedParams || null,
  };
}

module.exports = { generateChatReply };
