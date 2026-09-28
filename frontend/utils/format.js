/**
 * Formats a number as Indian Rupees with Indian digit grouping
 * (e.g. 1250000 -> "₹12,50,000", not the Western "₹1,250,000").
 */
export function formatInr(amount, { decimals = 0 } = {}) {
  if (amount == null || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(amount);
}

/**
 * Formats a number with Indian digit grouping, no currency symbol.
 */
export function formatIndianNumber(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-IN').format(value);
}

/**
 * Formats a date in Indian convention: "15 Aug 2026".
 */
export function formatIndianDate(dateStr, { withWeekday = false } = {}) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    weekday: withWeekday ? 'short' : undefined,
  }).format(date);
}

/**
 * Formats a time from an ISO timestamp: "14:35".
 */
export function formatTime(isoTimestamp) {
  if (!isoTimestamp) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoTimestamp));
}

/**
 * Formats minutes as "10h 5m" / "45m".
 */
export function formatDuration(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
