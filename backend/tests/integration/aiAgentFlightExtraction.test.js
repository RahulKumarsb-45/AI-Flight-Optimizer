/**
 * Q3 AI Chat Agent — Batch 2: flight-search EXTRACTION and tool/service-call
 * coverage, layered on top of Batch 1 (tests/integration/aiAgent.test.js,
 * tests/unit/aiProvider.test.js, tests/integration/aiAgentRealDb.test.js).
 *
 * SCOPE NOTE — read before extending this file:
 * The actual natural-language extraction (turning "2 people, business class,
 * Delhi to Tokyo" into structured fields) is performed entirely by the
 * external Gemini/Anthropic model, per the schema/prompt in
 * services/aiProvider/{gemini,anthropic}Provider.js. This repo's code never
 * re-parses, validates, or re-derives those fields — aiChatService.js only
 * stores and echoes back exactly whatever `extractedParams` object the
 * (mocked, in these tests) provider call returns. Per the task's own "do not
 * invent extraction rules / do not call real AI APIs" constraints, this
 * suite therefore verifies the thing that IS actually production code and IS
 * actually testable:
 *   - for a realistic user message, whatever extractedParams shape the
 *     configured provider schema is DESIGNED to return for that message is
 *     passed through the HTTP layer, persisted, and echoed back byte-for-byte
 *     (no silent mutation, dropping, or renaming of fields)
 *   - fields the current schema does NOT define (e.g. cabin/class, a
 *     multi-leg/multi-city itinerary) are neither fabricated by the app nor
 *     stripped if a provider ever sent them — there is simply no
 *     app-side allow-list
 *   - malformed/unusual field values (bad date strings, negative traveler
 *     counts, etc.) are stored/returned as-is — there is no app-side
 *     re-validation of provider-extracted fields beyond `chatValidator`'s
 *     checks on the raw incoming `message`/`conversationId`
 *   - the agent never fabricates flight results itself and never calls the
 *     app's actual flight-search machinery (verified by asserting
 *     `fetchFlightsForCandidates`, the real flight-provider-calling
 *     function used by the /search pipeline in
 *     src/optimizer/stages/flightFetchStage.js, is untouched by any of
 *     these /api/ai/chat requests)
 *
 * CONFIRMED BY READING CURRENT CODE (do not re-derive elsewhere):
 *   - RESPONSE_SCHEMA / SYSTEM_PROMPT (geminiProvider.js, anthropicProvider.js)
 *     define exactly: originCity, destinationCountries (array, up to 4
 *     COUNTRY names — not airports/cities and not ordered legs), departureDate,
 *     returnDate, dateFlexible, travelers, budgetInr, preference
 *     ('cheapest'|'fastest'|'balanced'), readyToSearch.
 *   - There is NO cabin/class field anywhere in the schema or prompt. Cabin
 *     class is therefore NOT a currently supported extraction field, and no
 *     test here asserts the app derives one.
 *   - There is NO multi-city/multi-leg itinerary support — the closest is
 *     `destinationCountries` accepting multiple country names in one flat
 *     array (up to 4 per the prompt's stated app capability), not a
 *     sequenced multi-city route.
 *   - aiChatService.sendMessage() never calls any flight-search/tool
 *     module. The only outbound call it makes is
 *     `provider.generateChatReply()` (-> axios.post to the external AI API,
 *     mocked below). The real flight-search call graph
 *     (optimizer.js -> flightFetchStage.js -> providers/flight/*) is a
 *     completely separate code path reached only via the /search feature,
 *     confirmed by grep — aiChatService.js does not import it.
 *   - aiChatService/aiController perform NO validation or normalization of
 *     `extractedParams` — `JSON.stringify(extractedParams)` is stored
 *     as-is and `result.extractedParams` (whatever object the provider
 *     layer returned) is returned as-is in the HTTP response.
 *
 * CORRECTION (this revision): the extraction tests below no longer only
 * assert pass-through of the mocked provider's *response*. They now also
 * assert the actual outbound *request* the production code builds and
 * sends to the provider — the current user message, the current
 * conversation-history mapping, and the current SYSTEM_PROMPT/
 * RESPONSE_SCHEMA (Gemini) / SYSTEM_PROMPT (Anthropic) structured-output
 * configuration — via `assertGeminiRequestShape`/`assertAnthropicRequestShape`
 * below. See the "REQUEST-SHAPE GROUND TRUTH" comment further down for how
 * those expected values were sourced (copied verbatim from production, not
 * invented) and section 1b for the added request-construction tests.
 */

jest.mock('axios');
const axios = require('axios');

jest.mock('../../src/database/pool', () => {
  const client = { query: jest.fn(), release: jest.fn() };
  return {
    query: jest.fn(),
    withTransaction: jest.fn(async (cb) => cb(client)),
    pool: {},
    __client: client,
  };
});

// Real module, real function reference — spied on (not replaced) so we can
// assert the AI chat flow never touches it, while any other suite that
// actually exercises /search is unaffected.
const flightFetchStage = require('../../src/optimizer/stages/flightFetchStage');

const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config/env');
const dbMock = require('../../src/database/pool');
const { generateAccessToken } = require('../../src/utils/tokens');

/**
 * REQUEST-SHAPE GROUND TRUTH — copied verbatim, not reinvented.
 *
 * `SYSTEM_PROMPT`/`RESPONSE_SCHEMA` in geminiProvider.js and `SYSTEM_PROMPT`
 * in anthropicProvider.js are internal, unexported consts — production code
 * is NOT modified to export them for testing. Instead these constants are
 * copied byte-for-byte from the current provider source files (verified by
 * `view`/`grep` against src/services/aiProvider/geminiProvider.js and
 * anthropicProvider.js at the time this suite was written) and used only as
 * the EXPECTED value in assertions below.
 *
 * This is intentionally a drift guard, not a new schema: if a future change
 * to either provider file edits the prompt or schema, these tests fail loudly
 * instead of the request-construction behavior silently going untested. If
 * that happens, update these constants to match the new production text —
 * never invent new fields here.
 */
const GEMINI_SYSTEM_PROMPT = `You are the travel-planning assistant inside FlightOptimizer, an Indian flight search app.

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

const GEMINI_RESPONSE_SCHEMA = {
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

const ANTHROPIC_SYSTEM_PROMPT = `You are the travel-planning assistant inside FlightOptimizer, an Indian flight search app.

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

/** Asserts the mocked Gemini call used the current production request shape. */
function assertGeminiRequestShape({ callIndex = 0, expectedLastContent, expectedContentsLength } = {}) {
  const [url, body] = axios.post.mock.calls[callIndex];
  expect(url).toBe(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.ai.gemini.model}:generateContent?key=${config.ai.gemini.apiKey}`
  );
  expect(body.systemInstruction).toEqual({ parts: [{ text: GEMINI_SYSTEM_PROMPT }] });
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.responseSchema).toEqual(GEMINI_RESPONSE_SCHEMA);
  if (expectedLastContent) {
    expect(body.contents[body.contents.length - 1]).toEqual(expectedLastContent);
  }
  if (expectedContentsLength !== undefined) {
    expect(body.contents).toHaveLength(expectedContentsLength);
  }
  return body;
}

/** Asserts the mocked Anthropic call used the current production request shape. */
function assertAnthropicRequestShape({ callIndex = 0, expectedLastMessage, expectedMessagesLength } = {}) {
  const [url, body, options] = axios.post.mock.calls[callIndex];
  expect(url).toBe('https://api.anthropic.com/v1/messages');
  expect(body.model).toBe(config.ai.anthropic.model);
  expect(body.system).toBe(ANTHROPIC_SYSTEM_PROMPT);
  expect(options.headers['x-api-key']).toBe(config.ai.anthropic.apiKey);
  if (expectedLastMessage) {
    expect(body.messages[body.messages.length - 1]).toEqual(expectedLastMessage);
  }
  if (expectedMessagesLength !== undefined) {
    expect(body.messages).toHaveLength(expectedMessagesLength);
  }
  return body;
}

const USER_A = { id: '11111111-1111-1111-1111-111111111111', email: 'alice@example.com' };

function authed(req) {
  return req.set('Authorization', `Bearer ${generateAccessToken(USER_A)}`);
}

const ORIGINAL_AI_CONFIG = JSON.parse(JSON.stringify(config.ai));

let fetchFlightsSpy;

beforeEach(() => {
  jest.resetAllMocks();
  dbMock.withTransaction.mockImplementation(async (cb) => cb(dbMock.__client));
  dbMock.query.mockImplementation(async () => ({ rows: [] }));
  dbMock.__client.query.mockImplementation(async (text) => {
    if (text.startsWith('INSERT INTO ai_conversations')) return { rows: [{ id: '99999999-9999-4999-8999-999999999999' }] };
    return { rows: [] };
  });
  config.ai.provider = 'gemini';
  config.ai.gemini = { apiKey: 'fake-test-gemini-key', model: 'gemini-test-model' };
  fetchFlightsSpy = jest.spyOn(flightFetchStage, 'fetchFlightsForCandidates');
});

afterEach(() => {
  config.ai.provider = ORIGINAL_AI_CONFIG.provider;
  config.ai.gemini = { ...ORIGINAL_AI_CONFIG.gemini };
  config.ai.anthropic = { ...ORIGINAL_AI_CONFIG.anthropic };
  fetchFlightsSpy.mockRestore();
});

function geminiSuccess({ reply = 'Got it.', extractedParams = null } = {}) {
  return {
    data: {
      candidates: [
        { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ reply, extractedParams }) }] } },
      ],
    },
  };
}

async function sendChat(message) {
  return authed(request(app).post('/api/ai/chat')).send({ message });
}

// ---------------------------------------------------------------------
// 1. Flight-search extraction — realistic messages, schema-shaped params
// ---------------------------------------------------------------------
// Each case mocks the provider with the extractedParams shape that the
// documented RESPONSE_SCHEMA is designed to produce for that kind of
// message, then asserts the HTTP layer returns and persists it unchanged.
describe('POST /api/ai/chat — flight-search extraction (schema pass-through)', () => {
  const cases = [
    {
      name: 'origin + destination only',
      message: 'I want to fly from Delhi to Japan',
      extractedParams: {
        originCity: 'Delhi',
        destinationCountries: ['Japan'],
        departureDate: null,
        returnDate: null,
        dateFlexible: false,
        travelers: null,
        budgetInr: null,
        preference: null,
        readyToSearch: false,
      },
    },
    {
      name: 'one-way flight request (explicit "one way", no returnDate)',
      message: 'One way trip from Mumbai to Thailand on 2026-11-05',
      extractedParams: {
        originCity: 'Mumbai',
        destinationCountries: ['Thailand'],
        departureDate: '2026-11-05',
        returnDate: null,
        dateFlexible: false,
        travelers: 1,
        budgetInr: null,
        preference: null,
        readyToSearch: true,
      },
    },
    {
      name: 'round-trip flight request (both dates present)',
      message: 'Round trip from Bengaluru to Singapore, leaving 2026-12-01 and coming back 2026-12-10',
      extractedParams: {
        originCity: 'Bengaluru',
        destinationCountries: ['Singapore'],
        departureDate: '2026-12-01',
        returnDate: '2026-12-10',
        dateFlexible: false,
        travelers: 1,
        budgetInr: null,
        preference: null,
        readyToSearch: true,
      },
    },
    {
      name: 'passenger count extracted',
      message: 'Planning a trip for 4 people from Chennai to the UAE',
      extractedParams: {
        originCity: 'Chennai',
        destinationCountries: ['United Arab Emirates'],
        departureDate: null,
        returnDate: null,
        dateFlexible: true,
        travelers: 4,
        budgetInr: null,
        preference: null,
        readyToSearch: false,
      },
    },
    {
      name: 'multi-city (multiple destination countries, within the documented 4-country cap)',
      message: 'From Delhi, I want to see France, Italy and Switzerland this summer',
      extractedParams: {
        originCity: 'Delhi',
        destinationCountries: ['France', 'Italy', 'Switzerland'],
        departureDate: null,
        returnDate: null,
        dateFlexible: true,
        travelers: 1,
        budgetInr: null,
        preference: null,
        readyToSearch: true,
      },
    },
    {
      name: 'incomplete flight query (destination only, no origin/date)',
      message: 'I want to go to Vietnam',
      extractedParams: {
        originCity: null,
        destinationCountries: ['Vietnam'],
        departureDate: null,
        returnDate: null,
        dateFlexible: false,
        travelers: null,
        budgetInr: null,
        preference: null,
        readyToSearch: false,
      },
    },
    {
      name: 'ambiguous flight information (no concrete origin/destination yet)',
      message: "I don't care about exact dates, just somewhere with beaches",
      extractedParams: {
        originCity: null,
        destinationCountries: [],
        departureDate: null,
        returnDate: null,
        dateFlexible: true,
        travelers: null,
        budgetInr: null,
        preference: null,
        readyToSearch: false,
      },
    },
    {
      name: 'budget given in a foreign currency, converted to INR per the prompt',
      message: 'I have $1000 and want to see Europe',
      extractedParams: {
        originCity: null,
        destinationCountries: ['France'],
        departureDate: null,
        returnDate: null,
        dateFlexible: true,
        travelers: 1,
        budgetInr: 83000,
        preference: null,
        readyToSearch: false,
      },
    },
    {
      name: 'cabin/class mentioned by the user but NOT part of the current schema — no cabin field appears',
      message: 'Business class from Delhi to London, flexible on dates',
      extractedParams: {
        originCity: 'Delhi',
        destinationCountries: ['United Kingdom'],
        departureDate: null,
        returnDate: null,
        dateFlexible: true,
        travelers: 1,
        budgetInr: null,
        preference: null,
        readyToSearch: true,
      },
    },
  ];

  test.each(cases)('$name', async ({ message, extractedParams }) => {
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Noted.', extractedParams }));

    const res = await sendChat(message);

    expect(res.status).toBe(200);
    // Pass-through fidelity: exactly what the provider returned, nothing
    // added, nothing dropped, nothing renamed.
    expect(res.body.data.extractedParams).toEqual(extractedParams);
    // Cabin/class is not a field the current schema defines — assert the
    // app doesn't fabricate one even when the user mentions cabin class.
    expect(res.body.data.extractedParams).not.toHaveProperty('cabinClass');
    expect(res.body.data.extractedParams).not.toHaveProperty('cabin');
    expect(res.body.data.extractedParams).not.toHaveProperty('class');

    // Persisted structured_params (assistant row) match exactly too.
    const assistantInsert = dbMock.__client.query.mock.calls.find(
      (c) => c[0].includes('INSERT INTO ai_messages') && c[0].includes("'assistant'")
    );
    expect(JSON.parse(assistantInsert[1][2])).toEqual(extractedParams);

    // --- Request-construction assertions (this is the actual correction) ---
    // Exactly one outbound call, no hidden multi-step tool round trip.
    expect(axios.post).toHaveBeenCalledTimes(1);
    // The user's raw message text reaches the provider unmodified, as the
    // last entry in `contents`, and — since no conversationId was sent —
    // it's the ONLY entry (no fabricated prior turns for a fresh chat).
    assertGeminiRequestShape({
      expectedLastContent: { role: 'user', parts: [{ text: message }] },
      expectedContentsLength: 1,
    });
  });

  test('invalid/unparseable date string from the provider is stored and returned as-is (no app-side date validation)', async () => {
    const extractedParams = {
      originCity: 'Pune',
      destinationCountries: ['Nepal'],
      departureDate: 'next Tuesday', // not YYYY-MM-DD — current app does not validate this
      returnDate: null,
      dateFlexible: false,
      travelers: 1,
      budgetInr: null,
      preference: null,
      readyToSearch: true,
    };
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Got it.', extractedParams }));

    const res = await sendChat('Fly to Nepal next Tuesday from Pune');

    expect(res.status).toBe(200);
    expect(res.body.data.extractedParams.departureDate).toBe('next Tuesday');
  });

  test('a returnDate earlier than departureDate is not rejected or corrected — passed through as-is (no cross-field validation exists)', async () => {
    const extractedParams = {
      originCity: 'Hyderabad',
      destinationCountries: ['Sri Lanka'],
      departureDate: '2026-08-20',
      returnDate: '2026-08-10', // before departureDate
      dateFlexible: false,
      travelers: 2,
      budgetInr: null,
      preference: null,
      readyToSearch: true,
    };
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Got it.', extractedParams }));

    const res = await sendChat('Leaving Hyderabad Aug 20 2026 for Sri Lanka, back Aug 10 2026');

    expect(res.status).toBe(200);
    expect(res.body.data.extractedParams).toEqual(extractedParams);
  });

  test('more destination countries than the documented 4-country cap are not trimmed by the app (prompt-only limit, not code-enforced)', async () => {
    const extractedParams = {
      originCity: 'Delhi',
      destinationCountries: ['France', 'Italy', 'Switzerland', 'Germany', 'Spain'],
      departureDate: null,
      returnDate: null,
      dateFlexible: true,
      travelers: 1,
      budgetInr: null,
      preference: null,
      readyToSearch: true,
    };
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Got it.', extractedParams }));

    const res = await sendChat('From Delhi I want to see France, Italy, Switzerland, Germany and Spain');

    expect(res.status).toBe(200);
    expect(res.body.data.extractedParams.destinationCountries).toHaveLength(5);
  });

  test('a null extractedParams (provider had nothing to extract yet) is handled without error', async () => {
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Hi! Where would you like to fly from?', extractedParams: null }));

    const res = await sendChat('hey');

    expect(res.status).toBe(200);
    expect(res.body.data.extractedParams).toBeNull();
  });

  test('works identically through the Anthropic provider for the same kind of message (provider-agnostic pass-through)', async () => {
    config.ai.provider = 'anthropic';
    config.ai.anthropic = { apiKey: 'fake-test-anthropic-key', model: 'claude-test-model' };
    const extractedParams = {
      originCity: 'Kolkata',
      destinationCountries: ['Thailand'],
      departureDate: '2026-10-15',
      returnDate: '2026-10-22',
      dateFlexible: false,
      travelers: 2,
      budgetInr: 60000,
      preference: 'cheapest',
      readyToSearch: true,
    };
    axios.post.mockResolvedValueOnce({
      data: { content: [{ type: 'text', text: JSON.stringify({ reply: 'Sounds good.', extractedParams }) }] },
    });

    const message = 'Cheapest round trip Kolkata to Thailand, Oct 15-22 2026, 2 travelers, budget 60000';
    const res = await sendChat(message);

    expect(res.status).toBe(200);
    expect(res.body.data.extractedParams).toEqual(extractedParams);
    expect(axios.post).toHaveBeenCalledTimes(1);
    assertAnthropicRequestShape({
      expectedLastMessage: { role: 'user', content: message },
      expectedMessagesLength: 1,
    });
  });
});

// ---------------------------------------------------------------------
// 1b. Extraction REQUEST construction — instructions/schema + history
// ---------------------------------------------------------------------
// Verifies the actual request sent TO the provider (not just what comes
// back), against the production prompt/schema copied verbatim above:
// current extraction instructions, the structured-output (JSON schema)
// configuration, the user's message, and — when continuing an existing
// conversation — prior turns included in the correct order/shape.
describe('POST /api/ai/chat — extraction request construction (prompt/schema/history sent to the provider)', () => {
  test('a fresh conversation sends ONLY the current message as contents, plus the current schema/instructions — no fabricated history', async () => {
    dbMock.query.mockImplementation(async () => ({ rows: [] }));
    axios.post.mockResolvedValueOnce(
      geminiSuccess({ reply: 'Sure — when would you like to travel?', extractedParams: { originCity: 'Delhi', destinationCountries: ['Japan'], dateFlexible: false, readyToSearch: false } })
    );

    await sendChat('Delhi to Japan');

    assertGeminiRequestShape({
      expectedLastContent: { role: 'user', parts: [{ text: 'Delhi to Japan' }] },
      expectedContentsLength: 1,
    });
  });

  test('a date-specific one-way message (Mumbai to Thailand) is sent verbatim, with the same production schema/instructions', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Got it.',
        extractedParams: { originCity: 'Mumbai', destinationCountries: ['Thailand'], departureDate: '2026-11-05', dateFlexible: false, readyToSearch: true },
      })
    );

    const message = 'One way trip from Mumbai to Thailand on 2026-11-05';
    await sendChat(message);

    assertGeminiRequestShape({
      expectedLastContent: { role: 'user', parts: [{ text: message }] },
      expectedContentsLength: 1,
    });
  });

  test('a passenger-count message ("4 people") is sent verbatim in the request contents', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Got it, 4 travelers.',
        extractedParams: { originCity: 'Chennai', destinationCountries: ['United Arab Emirates'], travelers: 4, dateFlexible: true, readyToSearch: false },
      })
    );

    const message = 'Planning a trip for 4 people from Chennai to the UAE';
    await sendChat(message);

    const body = assertGeminiRequestShape({ expectedLastContent: { role: 'user', parts: [{ text: message }] } });
    expect(body.contents[body.contents.length - 1].parts[0].text).toContain('4 people');
  });

  test('an incomplete query is still sent to the provider as-is (the app does not withhold or pre-filter short/incomplete messages)', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({ reply: 'Where are you flying from?', extractedParams: { originCity: null, destinationCountries: ['Vietnam'], dateFlexible: false, readyToSearch: false } })
    );

    const message = 'I want to go to Vietnam';
    await sendChat(message);

    assertGeminiRequestShape({ expectedLastContent: { role: 'user', parts: [{ text: message }] }, expectedContentsLength: 1 });
  });

  test('a multi-city message (multiple countries) is sent verbatim — the app does not split it into separate per-city requests', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Nice trip!',
        extractedParams: { originCity: 'Delhi', destinationCountries: ['France', 'Italy', 'Switzerland'], dateFlexible: true, readyToSearch: true },
      })
    );

    const message = 'From Delhi, I want to see France, Italy and Switzerland this summer';
    await sendChat(message);

    expect(axios.post).toHaveBeenCalledTimes(1); // one request for the whole multi-country message, not one per country
    assertGeminiRequestShape({ expectedLastContent: { role: 'user', parts: [{ text: message }] }, expectedContentsLength: 1 });
  });

  test('a round-trip message with both dates is sent verbatim with the same schema requesting both departureDate and returnDate', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Got it.',
        extractedParams: { originCity: 'Bengaluru', destinationCountries: ['Singapore'], departureDate: '2026-12-01', returnDate: '2026-12-10', dateFlexible: false, readyToSearch: true },
      })
    );

    const message = 'Round trip from Bengaluru to Singapore, leaving 2026-12-01 and coming back 2026-12-10';
    await sendChat(message);

    const body = assertGeminiRequestShape({ expectedLastContent: { role: 'user', parts: [{ text: message }] } });
    // The schema sent to the provider defines both departureDate and
    // returnDate as extractable fields (it's the provider's job to fill
    // them in) — confirms the app isn't using a one-way-only schema variant.
    expect(body.generationConfig.responseSchema.properties.extractedParams.properties).toHaveProperty('departureDate');
    expect(body.generationConfig.responseSchema.properties.extractedParams.properties).toHaveProperty('returnDate');
  });

  test('continuing an existing flight-search conversation includes prior turns (mapped assistant->model) AND the new message last, using the same schema/instructions', async () => {
    const conversationId = '88888888-8888-4888-8888-888888888888';
    dbMock.query.mockImplementation(async (text, params) => {
      if (text.includes('FROM ai_conversations WHERE id')) {
        return params[0] === conversationId && params[1] === USER_A.id ? { rows: [{ id: conversationId }] } : { rows: [] };
      }
      if (text.includes('FROM ai_messages')) {
        return {
          rows: [
            { role: 'user', content: 'I want to go to Japan' },
            { role: 'assistant', content: 'Great — where are you flying from?' },
          ],
        };
      }
      return { rows: [] };
    });
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Ready to search!',
        extractedParams: { originCity: 'Delhi', destinationCountries: ['Japan'], dateFlexible: true, readyToSearch: true },
      })
    );

    await authed(request(app).post('/api/ai/chat')).send({ message: 'From Delhi', conversationId });

    const body = assertGeminiRequestShape({
      expectedLastContent: { role: 'user', parts: [{ text: 'From Delhi' }] },
      expectedContentsLength: 3, // 2 history turns + the new message
    });
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'I want to go to Japan' }] });
    expect(body.contents[1]).toEqual({ role: 'model', parts: [{ text: 'Great — where are you flying from?' }] }); // 'assistant' -> 'model' per current buildContents()
  });

  test('conversation history is also included correctly (as Anthropic role-mapped messages) when the Anthropic provider is configured', async () => {
    config.ai.provider = 'anthropic';
    config.ai.anthropic = { apiKey: 'fake-test-anthropic-key', model: 'claude-test-model' };
    const conversationId = '77777777-7777-4777-8777-777777777777';
    dbMock.query.mockImplementation(async (text, params) => {
      if (text.includes('FROM ai_conversations WHERE id')) {
        return params[0] === conversationId && params[1] === USER_A.id ? { rows: [{ id: conversationId }] } : { rows: [] };
      }
      if (text.includes('FROM ai_messages')) {
        return { rows: [{ role: 'user', content: 'I want to go to Japan' }, { role: 'assistant', content: 'Where from?' }] };
      }
      return { rows: [] };
    });
    axios.post.mockResolvedValueOnce({
      data: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              reply: 'Ready!',
              extractedParams: { originCity: 'Delhi', destinationCountries: ['Japan'], dateFlexible: true, readyToSearch: true },
            }),
          },
        ],
      },
    });

    await authed(request(app).post('/api/ai/chat')).send({ message: 'From Delhi', conversationId });

    const body = assertAnthropicRequestShape({
      expectedLastMessage: { role: 'user', content: 'From Delhi' },
      expectedMessagesLength: 3,
    });
    expect(body.messages[0]).toEqual({ role: 'user', content: 'I want to go to Japan' });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'Where from?' }); // Anthropic keeps 'assistant' as-is, unlike Gemini's 'model' remap
  });

  test('tool/service behavior is unchanged: still exactly one provider call per message, no separate extraction call and no flight-search call', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Ready to search!',
        extractedParams: { originCity: 'Delhi', destinationCountries: ['Japan'], departureDate: '2026-11-01', returnDate: '2026-11-10', dateFlexible: false, readyToSearch: true },
      })
    );

    await sendChat('Delhi to Japan, Nov 1 to Nov 10 2026');

    expect(axios.post).toHaveBeenCalledTimes(1); // one combined reply+extraction call, per current single-call design
    expect(fetchFlightsSpy).not.toHaveBeenCalled(); // still no internal flight-search tool call
  });
});

// ---------------------------------------------------------------------
// 2. Tool / internal flight-search service calling
// ---------------------------------------------------------------------
// The current AI Agent implementation does NOT call any internal
// flight-search tool/service — aiChatService.sendMessage() only calls the
// AI provider layer (mocked axios) and the database. There is no
// tool-selection, no tool-argument-building, and no tool-response-handling
// code in the AI chat path to test. These tests verify that boundary
// explicitly (the app never fabricates a search on the agent's behalf),
// rather than inventing tool-calling tests for behavior that doesn't exist.
describe('POST /api/ai/chat — no internal flight-search tool is called by the AI agent', () => {
  test('a "ready to search" extraction does not trigger a real flight-search fetch — only the AI provider is called', async () => {
    const extractedParams = {
      originCity: 'Delhi',
      destinationCountries: ['Japan'],
      departureDate: '2026-11-01',
      returnDate: '2026-11-10',
      dateFlexible: false,
      travelers: 1,
      budgetInr: null,
      preference: 'balanced',
      readyToSearch: true,
    };
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Ready to search!', extractedParams }));

    const res = await sendChat('Delhi to Japan, Nov 1 to Nov 10 2026, balanced please');

    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1); // only the external AI provider call
    expect(fetchFlightsSpy).not.toHaveBeenCalled(); // the real flight-search machinery is untouched
    expect(res.body.data).not.toHaveProperty('flights');
    expect(res.body.data).not.toHaveProperty('results');
    expect(res.body.data).not.toHaveProperty('offers');
  });

  test('an ambiguous/incomplete extraction also never triggers a flight-search fetch', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Happy to help — where are you flying from?',
        extractedParams: { originCity: null, destinationCountries: [], dateFlexible: true, readyToSearch: false },
      })
    );

    const res = await sendChat('somewhere nice please');

    expect(res.status).toBe(200);
    expect(fetchFlightsSpy).not.toHaveBeenCalled();
  });

  test('a provider failure never triggers a fallback flight-search fetch', async () => {
    const providerError = new Error('Request failed with status code 500');
    providerError.response = { status: 500, data: { error: { message: 'internal error' } } };
    axios.post.mockRejectedValueOnce(providerError);

    const res = await sendChat('Delhi to Japan please');

    expect(res.status).toBe(500);
    expect(fetchFlightsSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// 3. AI + flight-search "integration" (message -> extraction -> response)
// ---------------------------------------------------------------------
// Since there is no in-app tool call between extraction and response (see
// section 2), the full current integration surface IS the HTTP round trip
// already covered above. These tests add the multi-turn angle: params
// accumulating/changing across turns of the SAME conversation, which is
// the one integration behavior this feature actually has.
describe('POST /api/ai/chat — multi-turn extraction integration', () => {
  test('a later message with more detail can update readyToSearch from false to true within the same conversation', async () => {
    // Turn 1: incomplete.
    dbMock.query.mockImplementation(async () => ({ rows: [] }));
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Where are you flying from?',
        extractedParams: { originCity: null, destinationCountries: ['Japan'], dateFlexible: false, readyToSearch: false },
      })
    );
    const turn1 = await sendChat('I want to go to Japan');
    expect(turn1.body.data.extractedParams.readyToSearch).toBe(false);

    // Turn 2: continuing the same conversation with an origin now supplied.
    const conversationId = turn1.body.data.conversationId;
    dbMock.query.mockImplementation(async (text, params) => {
      if (text.includes('FROM ai_conversations WHERE id')) {
        return params[0] === conversationId && params[1] === USER_A.id ? { rows: [{ id: conversationId }] } : { rows: [] };
      }
      if (text.includes('FROM ai_messages')) {
        return { rows: [{ role: 'user', content: 'I want to go to Japan' }, { role: 'assistant', content: 'Where are you flying from?' }] };
      }
      return { rows: [] };
    });
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Great, ready to search!',
        extractedParams: { originCity: 'Delhi', destinationCountries: ['Japan'], dateFlexible: true, readyToSearch: true },
      })
    );

    const turn2 = await authed(request(app).post('/api/ai/chat')).send({ message: 'From Delhi', conversationId });

    expect(turn2.status).toBe(200);
    expect(turn2.body.data.extractedParams.readyToSearch).toBe(true);
    expect(turn2.body.data.extractedParams.originCity).toBe('Delhi');
  });
});

// ---------------------------------------------------------------------
// 4. Error handling around extraction
// ---------------------------------------------------------------------
describe('POST /api/ai/chat — extraction-related error handling', () => {
  test('missing required flight parameters (nothing extracted yet) is a normal 200, not an error', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({ reply: 'Tell me more about your trip!', extractedParams: { destinationCountries: [], dateFlexible: false, readyToSearch: false } })
    );

    const res = await sendChat('hi there');

    expect(res.status).toBe(200);
    expect(res.body.data.extractedParams.readyToSearch).toBe(false);
  });

  test('malformed AI output (extraction failure) surfaces as 502 AI_PROVIDER_ERROR, not a 200 with guessed params', async () => {
    axios.post.mockResolvedValueOnce({
      data: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{ this is not valid json for extractedParams' }] } }] },
    });

    const res = await sendChat('Delhi to Japan');

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('AI_PROVIDER_ERROR');
    expect(fetchFlightsSpy).not.toHaveBeenCalled();
  });

  test('an extractedParams that is present but not an object (invalid structured output) is still forwarded as given — no app-side type coercion or crash', async () => {
    axios.post.mockResolvedValueOnce(geminiSuccess({ reply: 'Hmm.', extractedParams: 'not-an-object' }));

    const res = await sendChat('Delhi to Japan');

    expect(res.status).toBe(200);
    expect(res.body.data.extractedParams).toBe('not-an-object');
  });
});

// ---------------------------------------------------------------------
// 5. No hallucinated flight results
// ---------------------------------------------------------------------
describe('POST /api/ai/chat — no hallucinated flight results', () => {
  test('when required flight information is unavailable (ambiguous query), the response contains no flight/price/airline data fields', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: "I'd love to help! Where are you flying from and where would you like to go?",
        extractedParams: { originCity: null, destinationCountries: [], dateFlexible: false, readyToSearch: false },
      })
    );

    const res = await sendChat('find me a flight');

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('flights');
    expect(res.body.data).not.toHaveProperty('price');
    expect(res.body.data).not.toHaveProperty('airline');
    expect(res.body.data.extractedParams.readyToSearch).toBe(false);
  });

  test('readyToSearch=true still never accompanies an actual flight/offer/price payload — the app only hands off params, never results', async () => {
    axios.post.mockResolvedValueOnce(
      geminiSuccess({
        reply: 'Ready to search!',
        extractedParams: { originCity: 'Delhi', destinationCountries: ['Japan'], dateFlexible: false, readyToSearch: true },
      })
    );

    const res = await sendChat('Delhi to Japan, flexible dates, find me a flight');

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('flights');
    expect(res.body.data).not.toHaveProperty('offers');
    expect(fetchFlightsSpy).not.toHaveBeenCalled();
  });
});
