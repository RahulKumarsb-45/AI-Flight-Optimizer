const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config/env');

function loadSchemaSql() {
  return fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
}

function poolOptions(connectionString) {
  return {
    connectionString,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  };
}

/**
 * Creates the target database on the same Postgres server if it doesn't
 * exist yet. Postgres has no `CREATE DATABASE IF NOT EXISTS`, so this
 * connects to the server's always-present `postgres` maintenance database,
 * checks `pg_database`, and only issues `CREATE DATABASE` when needed.
 *
 * This is what lets a fresh dev machine or CI runner go from "a bare
 * Postgres server is reachable" to "the app's database exists" without a
 * developer having to run `createdb` by hand first — one more piece of
 * "manually prepared state" this project no longer depends on.
 */
async function ensureDatabaseExists(connectionString) {
  const target = new URL(connectionString);
  const targetDb = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!targetDb) {
    throw new Error(`DATABASE_URL has no database name: ${connectionString}`);
  }

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const adminPool = new Pool(poolOptions(adminUrl.toString()));
  try {
    const { rows } = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
    if (rows.length === 0) {
      // Identifier, not a bind-able value — CREATE DATABASE can't be
      // parameterized. Safe here: targetDb comes from our own
      // DATABASE_URL config, never from user or network input.
      const safeName = targetDb.replace(/"/g, '""');
      console.log(`[migrate] Database "${targetDb}" does not exist yet — creating it ...`);
      await adminPool.query(`CREATE DATABASE "${safeName}"`);
    }
  } finally {
    await adminPool.end();
  }
}

async function applySchema(pool) {
  await pool.query(loadSchemaSql());
}

async function migrate() {
  if (!config.db.url) {
    throw new Error('[migrate] DATABASE_URL is not set — nothing to migrate.');
  }

  await ensureDatabaseExists(config.db.url);

  const pool = new Pool(poolOptions(config.db.url));
  try {
    console.log('[migrate] Applying schema.sql ...');
    await applySchema(pool);
    console.log('[migrate] Done. Schema is up to date.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error('[migrate] Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { migrate, ensureDatabaseExists, applySchema, loadSchemaSql };
