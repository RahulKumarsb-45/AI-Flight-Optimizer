const airportService = require('../airport/airportService');
const { haversineDistanceKm } = require('../../utils/distance');

const MOCK_AIRLINES = [
  { code: 'AI', name: 'Air India' },
  { code: 'EK', name: 'Emirates' },
  { code: 'QR', name: 'Qatar Airways' },
  { code: 'SQ', name: 'Singapore Airlines' },
  { code: 'LH', name: 'Lufthansa' },
  { code: 'BA', name: 'British Airways' },
  { code: '6E', name: 'IndiGo' },
  { code: 'UK', name: 'Vistara' },
];

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Rough price model: base fare scales with distance, plus randomized variance,
 * plus a multiplier for stops (connections are usually cheaper) and cabin class.
 * This is intentionally simple — good enough to make search/scoring/optimizer
 * demos behave realistically without needing a real pricing engine.
 */
function estimatePriceInr(distanceKm, stops, cabinClass) {
  const basePerKm = 4.2; // INR per km, roughly economy long-haul average
  let price = distanceKm * basePerKm;

  price *= stops === 0 ? 1.15 : 1 - stops * 0.08; // direct flights cost a premium
  price += randomBetween(-0.1, 0.15) * price; // +/- variance

  const cabinMultiplier = { economy: 1, premium_economy: 1.6, business: 3.2, first: 5.5 };
  price *= cabinMultiplier[cabinClass] || 1;

  return Math.max(2500, Math.round(price / 100) * 100); // floor + round to nearest 100
}

function estimateDurationMinutes(distanceKm, stops) {
  const cruiseSpeedKmH = 850;
  const flightMinutes = (distanceKm / cruiseSpeedKmH) * 60;
  const layoverMinutes = stops * randomBetween(60, 150);
  const taxiBuffer = 30 + stops * 20;
  return Math.round(flightMinutes + layoverMinutes + taxiBuffer);
}

function buildSegment(fromIata, toIata, departureTime, durationMinutes) {
  const airline = pick(MOCK_AIRLINES);
  const arrivalTime = new Date(new Date(departureTime).getTime() + durationMinutes * 60000);
  return {
    airline: airline.code,
    flightNumber: `${airline.code}${Math.floor(randomBetween(100, 999))}`,
    fromIata,
    toIata,
    departureTime: new Date(departureTime).toISOString(),
    arrivalTime: arrivalTime.toISOString(),
    durationMinutes,
  };
}

function buildItinerary(fromIata, toIata, dateStr, stops) {
  const distanceKm = distanceBetween(fromIata, toIata);
  const totalDuration = estimateDurationMinutes(distanceKm, stops);

  if (stops === 0) {
    const departure = randomDepartureTime(dateStr);
    return {
      segments: [buildSegment(fromIata, toIata, departure, totalDuration)],
      totalDurationMinutes: totalDuration,
    };
  }

  // one-stop itinerary via a plausible intermediate hub
  const midAirport = pickIntermediateHub(fromIata, toIata);
  const leg1Duration = Math.round(totalDuration * 0.45);
  const layover = Math.round(totalDuration * 0.15);
  const leg2Duration = totalDuration - leg1Duration - layover;

  const departure1 = randomDepartureTime(dateStr);
  const seg1 = buildSegment(fromIata, midAirport, departure1, leg1Duration);
  const departure2 = new Date(new Date(seg1.arrivalTime).getTime() + layover * 60000);
  const seg2 = buildSegment(midAirport, toIata, departure2, leg2Duration);

  return {
    segments: [seg1, seg2],
    totalDurationMinutes: leg1Duration + layover + leg2Duration,
  };
}

function distanceBetween(fromIata, toIata) {
  const from = airportService.getByIata(fromIata);
  const to = airportService.getByIata(toIata);
  if (!from || !to) return 3000; // fallback if either isn't in our static dataset
  return haversineDistanceKm(from.lat, from.lon, to.lat, to.lon);
}

function pickIntermediateHub(fromIata, toIata) {
  const majorHubs = ['DXB', 'DOH', 'IST', 'SIN', 'FRA', 'AMS', 'LHR'].filter(
    (h) => h !== fromIata && h !== toIata
  );
  return pick(majorHubs);
}

function randomDepartureTime(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCHours(Math.floor(randomBetween(0, 23)), Math.floor(randomBetween(0, 59)));
  return date;
}

/**
 * Generates a set of mock offers (mix of direct + 1-stop, varying prices/airlines)
 * for a single origin -> destination -> date combination.
 */
function generateOffersForLeg({ originIata, destinationIata, date, adults = 1, cabinClass = 'economy' }) {
  const distanceKm = distanceBetween(originIata, destinationIata);
  const offerCount = 4 + Math.floor(randomBetween(0, 3));
  const offers = [];

  for (let i = 0; i < offerCount; i++) {
    const stops = i < 2 ? 0 : Math.random() < 0.6 ? 1 : 0; // bias toward some direct options
    const itinerary = buildItinerary(originIata, destinationIata, date, stops);
    const priceInr = estimatePriceInr(distanceKm, stops, cabinClass) * adults;

    offers.push({
      id: `mock_${originIata}${destinationIata}_${date}_${i}`,
      provider: 'mock',
      priceInr,
      currency: 'INR',
      totalDurationMinutes: itinerary.totalDurationMinutes,
      stops,
      outbound: itinerary.segments,
      inbound: null,
      bookableUntil: null,
    });
  }

  return offers.sort((a, b) => a.priceInr - b.priceInr);
}

/**
 * Main entrypoint matching the FlightProviderContract.
 */
async function search({ originIata, destinationIata, departureDate, returnDate, adults = 1, cabinClass = 'economy' }) {
  // simulate realistic network latency so loading states/optimizer timing are testable
  await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 200));

  const outboundOffers = generateOffersForLeg({
    originIata,
    destinationIata,
    date: departureDate,
    adults,
    cabinClass,
  });

  if (!returnDate) {
    return outboundOffers;
  }

  const inboundOffers = generateOffersForLeg({
    originIata: destinationIata,
    destinationIata: originIata,
    date: returnDate,
    adults,
    cabinClass,
  });

  // pair each outbound with a matching inbound (round-trip combination)
  const combined = [];
  const pairs = Math.min(outboundOffers.length, inboundOffers.length);
  for (let i = 0; i < pairs; i++) {
    const out = outboundOffers[i];
    const inb = inboundOffers[i];
    combined.push({
      id: `${out.id}_${inb.id}`,
      provider: 'mock',
      priceInr: out.priceInr + inb.priceInr,
      currency: 'INR',
      totalDurationMinutes: out.totalDurationMinutes + inb.totalDurationMinutes,
      stops: out.stops + inb.stops,
      outbound: out.outbound,
      inbound: inb.outbound,
      bookableUntil: null,
    });
  }

  return combined.sort((a, b) => a.priceInr - b.priceInr);
}

module.exports = { search };
