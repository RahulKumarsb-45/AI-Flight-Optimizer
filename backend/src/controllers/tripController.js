const { optimizeTrip } = require('../optimizer/optimizer');
const { query } = require('../database/pool');
const AppError = require('../utils/AppError');
const config = require('../config/env');
const { generateShareToken } = require('../utils/tokens');

async function optimize(req, res, next) {
  try {
    const result = await optimizeTrip(req.body);

    let tripId = null;
    if (req.user) {
      const insertResult = await query(
        `INSERT INTO trips (
           user_id, origin_iata, destination_countries, departure_date, return_date,
           date_flexible, travelers, budget_inr, preference, status, result_json
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'optimized',$10)
         RETURNING id`,
        [
          req.user.id,
          req.body.originIata,
          req.body.destinationCountries,
          req.body.departureDate,
          req.body.returnDate || null,
          !!req.body.dateFlexible,
          req.body.travelers || 1,
          req.body.budgetInr || null,
          req.body.preference || 'balanced',
          JSON.stringify(result),
        ]
      );
      tripId = insertResult.rows[0].id;
    }

    res.status(200).json({ status: 'success', data: { tripId, ...result } });
  } catch (err) {
    next(err);
  }
}

async function listTrips(req, res, next) {
  try {
    const result = await query(
      `SELECT id, origin_iata, destination_countries, departure_date, return_date,
              travelers, budget_inr, preference, status, created_at
       FROM trips WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.status(200).json({ status: 'success', data: { trips: result.rows } });
  } catch (err) {
    next(err);
  }
}

async function getTrip(req, res, next) {
  try {
    const result = await query(
      `SELECT * FROM trips WHERE id = $1 AND user_id = $2`,
      [req.params.tripId, req.user.id]
    );
    if (result.rows.length === 0) {
      throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND');
    }
    res.status(200).json({ status: 'success', data: { trip: result.rows[0] } });
  } catch (err) {
    next(err);
  }
}

async function saveTrip(req, res, next) {
  try {
    const tripCheck = await query(
      `SELECT id FROM trips WHERE id = $1 AND user_id = $2`,
      [req.params.tripId, req.user.id]
    );
    if (tripCheck.rows.length === 0) {
      throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND');
    }

    await query(
      `INSERT INTO saved_trips (user_id, trip_id, notes) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, trip_id) DO UPDATE SET notes = EXCLUDED.notes`,
      [req.user.id, req.params.tripId, req.body.notes || null]
    );

    res.status(200).json({ status: 'success', message: 'Trip saved' });
  } catch (err) {
    next(err);
  }
}

async function listSavedTrips(req, res, next) {
  try {
    const result = await query(
      `SELECT st.id AS saved_id, st.notes, st.created_at AS saved_at, t.*
       FROM saved_trips st
       JOIN trips t ON t.id = st.trip_id
       WHERE st.user_id = $1
       ORDER BY st.created_at DESC`,
      [req.user.id]
    );
    res.status(200).json({ status: 'success', data: { savedTrips: result.rows } });
  } catch (err) {
    next(err);
  }
}

async function unsaveTrip(req, res, next) {
  try {
    await query(`DELETE FROM saved_trips WHERE user_id = $1 AND trip_id = $2`, [req.user.id, req.params.tripId]);
    res.status(200).json({ status: 'success', message: 'Trip removed from saved list' });
  } catch (err) {
    next(err);
  }
}

/**
 * Creates (or, if one already exists, reuses) a public share link for a
 * trip the requesting user owns. Idempotent per (trip, user): repeated
 * clicks on "Share" don't pile up abandoned tokens for the same trip —
 * they keep returning the same active link — until it's explicitly
 * revoked, after which a fresh call mints a new one.
 */
async function createShare(req, res, next) {
  try {
    const tripCheck = await query(`SELECT id FROM trips WHERE id = $1 AND user_id = $2`, [
      req.params.tripId,
      req.user.id,
    ]);
    if (tripCheck.rows.length === 0) {
      throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND');
    }

    const existing = await query(
      `SELECT share_token FROM trip_shares
       WHERE trip_id = $1 AND user_id = $2 AND revoked = false
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.tripId, req.user.id]
    );

    let shareToken;
    if (existing.rows.length > 0) {
      shareToken = existing.rows[0].share_token;
    } else {
      shareToken = generateShareToken();
      await query(`INSERT INTO trip_shares (trip_id, user_id, share_token) VALUES ($1, $2, $3)`, [
        req.params.tripId,
        req.user.id,
        shareToken,
      ]);
    }

    res.status(200).json({
      status: 'success',
      data: { shareToken, shareUrl: `${config.frontendUrl}/shared/${shareToken}` },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Revokes any active share link(s) for a trip the requesting user owns.
 * Soft-delete (`revoked = true`) rather than a row DELETE, so a revoked
 * link can never be reused even if the row is later inspected/restored,
 * and so there's a record of the link having existed.
 */
async function revokeShare(req, res, next) {
  try {
    const tripCheck = await query(`SELECT id FROM trips WHERE id = $1 AND user_id = $2`, [
      req.params.tripId,
      req.user.id,
    ]);
    if (tripCheck.rows.length === 0) {
      throw new AppError('Trip not found', 404, 'TRIP_NOT_FOUND');
    }

    await query(
      `UPDATE trip_shares SET revoked = true, revoked_at = now()
       WHERE trip_id = $1 AND user_id = $2 AND revoked = false`,
      [req.params.tripId, req.user.id]
    );

    res.status(200).json({ status: 'success', message: 'Share link revoked' });
  } catch (err) {
    next(err);
  }
}

/**
 * Public read of a shared trip — no auth required, and never looks a trip
 * up by its own id. The share_token is the sole key, a revoked link 404s
 * exactly like a non-existent one (doesn't leak "this used to exist"), and
 * the SELECT list is an explicit column allowlist rather than `SELECT *`
 * so a future column added to `trips` (or `users` via the join) is never
 * accidentally exposed here — in particular `user_id` (the owner) is never
 * returned to an anonymous viewer.
 */
async function getSharedTrip(req, res, next) {
  try {
    const result = await query(
      `SELECT t.origin_iata, t.destination_countries, t.departure_date, t.return_date,
              t.travelers, t.budget_inr, t.preference, t.status, t.result_json, t.created_at
       FROM trip_shares ts
       JOIN trips t ON t.id = ts.trip_id
       WHERE ts.share_token = $1 AND ts.revoked = false`,
      [req.params.shareToken]
    );

    if (result.rows.length === 0) {
      throw new AppError('This share link is invalid or has expired', 404, 'SHARE_NOT_FOUND');
    }

    res.status(200).json({ status: 'success', data: { trip: result.rows[0] } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  optimize,
  listTrips,
  getTrip,
  saveTrip,
  listSavedTrips,
  unsaveTrip,
  createShare,
  revokeShare,
  getSharedTrip,
};
