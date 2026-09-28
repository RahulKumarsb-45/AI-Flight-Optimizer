module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  // Provisions (creates if missing + migrates) the test database exactly
  // once, before any test file runs — see tests/globalSetup.js for why
  // this is required rather than optional.
  globalSetup: '<rootDir>/tests/globalSetup.js',
  testMatch: ['**/tests/**/*.test.js'],
  // tests/unit/shareTrip.controller.test.js is written against Node's
  // built-in `node:test` runner, not Jest (see that file's header comment
  // for why). It matches the *.test.js glob above, but Jest never sees it
  // call Jest's own `test`/`it` globals, so Jest reports "Your test suite
  // must contain at least one test" for it. It is NOT excluded to dodge
  // that failure or to inflate the Jest pass count — it's excluded because
  // it genuinely belongs to a different test runner, and it still runs on
  // every `npm test` via the separate `test:node` script (see
  // package.json), so nothing here is silently skipped.
  testPathIgnorePatterns: ['<rootDir>/tests/unit/shareTrip.controller.test.js'],
  verbose: true,
  testTimeout: 15000,
  forceExit: true, // pg pool keeps the process alive otherwise
};
