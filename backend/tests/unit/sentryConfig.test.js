describe('config/env sentry settings', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('is disabled when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;
    process.env.NODE_ENV = 'development';
    const config = require('../../src/config/env');
    expect(config.sentry.enabled).toBe(false);
  });

  test('is disabled in test env even if SENTRY_DSN is set', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    process.env.NODE_ENV = 'test';
    const config = require('../../src/config/env');
    expect(config.sentry.enabled).toBe(false);
  });

  test('is disabled when explicitly turned off via SENTRY_ENABLED=false', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    process.env.NODE_ENV = 'production';
    process.env.SENTRY_ENABLED = 'false';
    const config = require('../../src/config/env');
    expect(config.sentry.enabled).toBe(false);
  });

  test('is enabled when a DSN is present outside of test env and not disabled', () => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    process.env.NODE_ENV = 'production';
    delete process.env.SENTRY_ENABLED;
    const config = require('../../src/config/env');
    expect(config.sentry.enabled).toBe(true);
  });

  test('falls back to a default traces sample rate when unset/invalid', () => {
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    let config = require('../../src/config/env');
    expect(config.sentry.tracesSampleRate).toBe(0.1);

    jest.resetModules();
    process.env.SENTRY_TRACES_SAMPLE_RATE = 'not-a-number';
    config = require('../../src/config/env');
    expect(config.sentry.tracesSampleRate).toBe(0.1);

    jest.resetModules();
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';
    config = require('../../src/config/env');
    expect(config.sentry.tracesSampleRate).toBe(0.25);
  });
});
