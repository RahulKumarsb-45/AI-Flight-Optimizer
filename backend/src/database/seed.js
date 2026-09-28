/**
 * Populates the `airports` DB table from the in-memory dataset in
 * providers/airport/airportData.js.
 *
 * NOTE: airportService.js intentionally does NOT query this table for
 * autocomplete/search/nearby — it uses the in-memory array directly, since
 * that's a hot path and a DB round-trip per keystroke would be wasteful for
 * ~180 rows. This DB copy exists for future use cases that want SQL access
 * to airport data (admin dashboards, reporting joins, analytics) without
 * duplicating the dataset by hand.
 */
const { pool, query } = require('./pool');
const { AIRPORTS } = require('../providers/airport/airportData');

async function seedAirports() {
  console.log(`[seed] Inserting/updating ${AIRPORTS.length} airports ...`);

  for (const a of AIRPORTS) {
    await query(
      `INSERT INTO airports (iata_code, name, city, country, country_code, region, latitude, longitude, timezone, rank_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (iata_code) DO UPDATE SET
         name = EXCLUDED.name,
         city = EXCLUDED.city,
         country = EXCLUDED.country,
         country_code = EXCLUDED.country_code,
         region = EXCLUDED.region,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         timezone = EXCLUDED.timezone,
         rank_score = EXCLUDED.rank_score`,
      [a.iata, a.name, a.city, a.country, a.countryCode, a.region, a.lat, a.lon, a.timezone, a.rank]
    );
  }

  console.log('[seed] Airports table seeded successfully.');
}

async function main() {
  try {
    await seedAirports();
  } catch (err) {
    console.error('[seed] Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
