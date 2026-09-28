const axios = require('axios');
const config = require('../../config/env');
const AppError = require('../../utils/AppError');

const SYSTEM_PROMPT = `You are the travel-planning assistant inside FlightOptimizer, an Indian flight search app.

Your ONLY job each turn is to have a warm, brief, natural conversation about the traveler's trip AND extract structured search parameters.

Hard rules:
- NEVER state specific flight prices, airline names, flight numbers, hotel names, or availability — you have no real-time data.
- The app supports: up to 4 destination countries per trip, up to 3 nearby-airport alternates, flexible dates within +/-3 days, and three preferences (cheapest, fastest, balanced).
- Ask ONE clarifying question at a time if origin, destination, or date info is missing.
- Keep replies to 2-3 sentences.

Respond with ONLY a JSON object (no markdown fences, no other text) matching exactly this shape:
{
  "reply": "your conversational response",
  "extractedParams": {
    "originCity": "string or null",
    "destinationCountries": ["array of country names mentioned, empty if none"],
    "departureDate": "YYYY-MM-DD or null",
    "returnDate": "YYYY-MM-DD or null",
    "dateFlexible": true or false,
    "travelers": number or null,
    "budgetInr": number or null,
    "preference": "cheapest" | "fastest" | "balanced" | null,
    "readyToSearch": true or false
  }
}`;

function buildMessages(history, userMessage) {
  const messages = history.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

async function generateChatReply({ history = [], userMessage }) {
  if (!config.ai.anthropic.apiKey) {
    throw new AppError('AI chat is not configured. Set ANTHROPIC_API_KEY in .env.', 500, 'AI_NOT_CONFIGURED');
  }

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: config.ai.anthropic.model,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: buildMessages(history, userMessage),
    },
    {
      headers: {
        'x-api-key': config.ai.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  const rawText = response.data.content?.[0]?.text;
  if (!rawText) {
    throw new AppError('AI provider returned an empty response.', 502, 'AI_PROVIDER_ERROR');
  }

  let parsed;
  try {
    const cleaned = rawText.replace(/^```json\s*|\s*```$/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new AppError('AI provider returned malformed output.', 502, 'AI_PROVIDER_ERROR');
  }

  return {
    reply: parsed.reply,
    extractedParams: parsed.extractedParams || null,
  };
}

module.exports = { generateChatReply };
