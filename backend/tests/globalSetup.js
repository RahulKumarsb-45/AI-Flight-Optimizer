/**
 * Jest `globalSetup` — runs exactly ONCE, in its own process, before any
 * test file/worker starts (see https://jestjs.io/docs/configuration#globalsetup-string).
 *
 * Its only job: make the test database deterministic. Whatever machine
 * this runs on (a fresh dev checkout, CI, whatever), and regardless of
 * whether anyone has ever manually created or migrated it before,
 * `npm test` now guarantees the test database:
 *   1. exists, and
 *   2. has the CURRENT schema.sql applied (including `trip_shares`)
 * before a single integration test executes.
 *
 * This replaces the old, fragile expectation (previously only documented
 * in the README) that a developer manually creates + migrates a
 * dedicated test database before running `npm test`. It also fixes the
 * actual bug behind "relation trip_shares does not exist": `npm run
 * migrate`, run directly as the docs instructed, only ever loaded plain
 * `.env` (see src/config/env.js's history) — never `.env.test` — so
 * running it by hand against "the test database" silently applied
 * schema.sql to the DEV database instead. Jest's tests, meanwhile,
 * correctly loaded `.env.test` (via tests/setupEnv.js) and connected to a
 * database schema.sql had never actually touched.
 *
 * schema.sql itself is 100% additive/idempotent (`CREATE TABLE IF NOT
 * EXISTS`, `CREATE INDEX IF NOT EXISTS`, guarded `ALTER TABLE`/triggers),
 * so re-applying it here on every run is always safe and cheap, and never
 * touches production data — this only ever runs under NODE_ENV=test,
 * against whatever database DATABASE_URL/.env.test point at.
 */
process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const testEnvPath = path.join(__dirname, '..', '.env.test');
if (fs.existsSync(testEnvPath)) {
  dotenv.config({ path: testEnvPath });
} else {
  dotenv.config();
}

module.exports = async function globalSetup() {
  // Required lazily, after the env vars above are loaded, since
  // src/config/env.js reads process.env at require-time.
  const { Pool } = require('pg');
  const config = require('../src/config/env');
  const { ensureDatabaseExists, applySchema } = require('../src/database/migrate');

  if (!config.db.url) {
    throw new Error(
      '[tests/globalSetup] DATABASE_URL is not set. Copy backend/.env.test.example to ' +
        'backend/.env.test (or otherwise set DATABASE_URL) so the tests know which ' +
        'Postgres database to provision and connect to.'
    );
  }

  await ensureDatabaseExists(config.db.url);

  const pool = new Pool({
    connectionString: config.db.url,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  });
  try {
    await applySchema(pool);
  } finally {
    await pool.end();
  }
};
