// Matches key names that indicate a credential/secret of some kind.
// Mirrors the spirit of logger/logger.js's redact list but is intentionally
// broader (regex + a few Sentry/domain-specific extras like razorpay/jwt)
// since Sentry events can carry arbitrary nested request/user data.
const SENSITIVE_KEY_PATTERN =
  /pass|secret|token|auth|apikey|api_key|cookie|jwt|card|cvv|razorpay|signature/i;

const REDACTED = '[Filtered]';

function scrubObject(value) {
  if (Array.isArray(value)) {
    return value.map(scrubObject);
  }
  if (value && typeof value === 'object') {
    const clean = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        clean[key] = REDACTED;
      } else {
        clean[key] = scrubObject(val);
      }
    }
    return clean;
  }
  return value;
}

/**
 * Sentry `beforeSend` / `beforeSendTransaction` hook.
 *
 * Defense-in-depth: strips anything that looks like a credential from the
 * parts of an event that can carry arbitrary request/user data (headers,
 * cookies, body, extra context) before the event ever leaves the process.
 * This does not replace being careful about what gets logged in the first
 * place — it's a last line of defense in case a header, cookie, or body
 * field we didn't anticipate ends up on an event.
 */
function scrubEvent(event) {
  if (!event) return event;

  if (event.request) {
    if (event.request.headers) {
      event.request.headers = scrubObject(event.request.headers);
    }
    if (event.request.cookies) {
      event.request.cookies = scrubObject(event.request.cookies);
    }
    if (event.request.data) {
      event.request.data = scrubObject(event.request.data);
    }
    if (typeof event.request.query_string === 'string') {
      // Query strings can carry secrets too (e.g. an OAuth `?code=...` or
      // `?token=...` param) even though they aren't a nested object.
      event.request.query_string = event.request.query_string.replace(
        /((?:code|token|secret|key|signature)=)[^&]+/gi,
        '$1[Filtered]'
      );
    }
  }

  if (event.extra) {
    event.extra = scrubObject(event.extra);
  }

  if (event.contexts) {
    event.contexts = scrubObject(event.contexts);
  }

  if (event.user) {
    // Keep only an id (useful for correlating reports); drop email/ip/etc.
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }

  return event;
}

module.exports = { scrubEvent, scrubObject, SENSITIVE_KEY_PATTERN };
