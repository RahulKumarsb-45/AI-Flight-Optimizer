const config = require('../config/env');

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function generateDatePairs({ departureDate, returnDate, dateFlexible, minStayDays, maxStayDays }) {
  if (!dateFlexible) {
    return [{ departureDate, returnDate: returnDate || null, flexScore: 0 }];
  }

  const flexDays = config.optimizer.maxDateFlexDays;
  const today = todayStr();
  const departureCandidates = [];
  for (let offset = -flexDays; offset <= flexDays; offset++) {
    const date = toDateStr(addDays(departureDate, offset));
    if (date < today) continue;
    departureCandidates.push({ date, offset: Math.abs(offset) });
  }

  if (!returnDate) {
    return departureCandidates
      .sort((a, b) => a.offset - b.offset)
      .map((d) => ({ departureDate: d.date, returnDate: null, flexScore: d.offset }));
  }

  const requestedStayDays = Math.round(
    (new Date(returnDate) - new Date(departureDate)) / (1000 * 60 * 60 * 24)
  );
  const minStay = minStayDays ?? requestedStayDays;
  const MAX_STAY_RANGE_WIDTH = 7;
  const requestedMaxStay = maxStayDays ?? requestedStayDays;
  const maxStay = Math.min(requestedMaxStay, minStay + MAX_STAY_RANGE_WIDTH);

  const pairs = [];
  for (const dep of departureCandidates) {
    for (let stay = minStay; stay <= maxStay; stay++) {
      const ret = toDateStr(addDays(dep.date, stay));
      pairs.push({
        departureDate: dep.date,
        returnDate: ret,
        flexScore: dep.offset + Math.abs(stay - requestedStayDays),
      });
    }
  }

  return pairs.sort((a, b) => a.flexScore - b.flexScore);
}

module.exports = { generateDatePairs, addDays, toDateStr };