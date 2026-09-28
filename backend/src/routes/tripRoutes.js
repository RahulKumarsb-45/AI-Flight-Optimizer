const express = require('express');
const tripController = require('../controllers/tripController');
const { optimizeTripValidator } = require('../validators/optimizeValidators');
const { shareTokenParamValidator } = require('../validators/shareValidators');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/trips/optimize — runs the full optimizer pipeline.
// Guest-usable (optionalAuth); if logged in, the result is persisted to `trips`.
router.post('/optimize', optionalAuth, optimizeTripValidator, tripController.optimize);

// GET /api/trips/shared/:shareToken — public Share Trip view. No auth: the
// share_token itself is the credential. Two path segments (unlike the
// single-segment `/:tripId` below), so it can never collide with a trip id.
router.get('/shared/:shareToken', shareTokenParamValidator, tripController.getSharedTrip);

// Everything below requires login.
router.get('/', requireAuth, tripController.listTrips);
router.get('/saved', requireAuth, tripController.listSavedTrips);
router.get('/:tripId', requireAuth, tripController.getTrip);
router.post('/:tripId/save', requireAuth, tripController.saveTrip);
router.delete('/:tripId/save', requireAuth, tripController.unsaveTrip);
router.post('/:tripId/share', requireAuth, tripController.createShare);
router.delete('/:tripId/share', requireAuth, tripController.revokeShare);

module.exports = router;
