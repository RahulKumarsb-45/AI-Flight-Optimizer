const { scrubEvent, scrubObject } = require('../../src/sentry/scrubEvent');

describe('sentry scrubEvent', () => {
  test('redacts sensitive request headers, cookies, and body fields', () => {
    const event = {
      request: {
        headers: {
          authorization: 'Bearer secret.jwt.token',
          cookie: 'refresh_token=abc123',
          'x-request-id': 'keep-me',
        },
        cookies: { refresh_token: 'abc123', theme: 'dark' },
        data: { password: 'hunter2', email: 'user@example.com' },
        query_string: 'code=oauthsecret&state=xyz',
      },
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.request.headers.authorization).toBe('[Filtered]');
    expect(scrubbed.request.headers.cookie).toBe('[Filtered]');
    expect(scrubbed.request.headers['x-request-id']).toBe('keep-me');
    expect(scrubbed.request.cookies.refresh_token).toBe('[Filtered]');
    expect(scrubbed.request.cookies.theme).toBe('dark');
    expect(scrubbed.request.data.password).toBe('[Filtered]');
    expect(scrubbed.request.data.email).toBe('user@example.com');
    expect(scrubbed.request.query_string).toContain('code=[Filtered]');
    expect(scrubbed.request.query_string).toContain('state=xyz');
  });

  test('redacts nested Razorpay/JWT/API-key style fields inside extra context', () => {
    const event = {
      extra: {
        payment: { razorpay_signature: 'sig', razorpay_order_id: 'order_1', amount: 1000 },
        config: { jwt_access_secret: 'top-secret', port: 5000 },
      },
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed.extra.payment.razorpay_signature).toBe('[Filtered]');
    expect(scrubbed.extra.payment.amount).toBe(1000);
    expect(scrubbed.extra.config.jwt_access_secret).toBe('[Filtered]');
    expect(scrubbed.extra.config.port).toBe(5000);
  });

  test('a whole sub-object is redacted when its own key name looks sensitive (e.g. "auth")', () => {
    // Defense-in-depth: if a key name itself strongly suggests credentials,
    // we redact the entire value rather than only recursing into it — this
    // deliberately errs on the side of over-redacting rather than risking a
    // credential nested under an unanticipated field name.
    const event = { extra: { auth: { accessToken: 'abc', anythingElse: 'x' } } };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.extra.auth).toBe('[Filtered]');
  });

  test('drops PII from event.user but keeps id for correlation', () => {
    const event = { user: { id: 'user-123', email: 'user@example.com', ip_address: '1.2.3.4' } };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.user).toEqual({ id: 'user-123' });
  });

  test('handles missing/undefined event gracefully', () => {
    expect(scrubEvent(undefined)).toBeUndefined();
    expect(scrubEvent(null)).toBeNull();
    expect(scrubEvent({})).toEqual({});
  });

  test('scrubObject recurses through arrays', () => {
    const result = scrubObject([{ token: 'abc' }, { name: 'ok' }]);
    expect(result).toEqual([{ token: '[Filtered]' }, { name: 'ok' }]);
  });
});
