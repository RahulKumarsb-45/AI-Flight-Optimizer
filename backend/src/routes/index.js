const express = require('express');
const authRoutes = require('./authRoutes');
const airportRoutes = require('./airportRoutes');
const countryRoutes = require('./countryRoutes');
const searchRoutes = require('./searchRoutes');
const tripRoutes = require('./tripRoutes');
const paymentRoutes = require('./paymentRoutes');
const aiRoutes = require('./aiRoutes');
const weatherRoutes = require('./weatherRoutes');
const placesRoutes = require('./placesRoutes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'OK', timestamp: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/airports', airportRoutes);
router.use('/countries', countryRoutes);
router.use('/search', searchRoutes);
router.use('/trips', tripRoutes);
router.use('/payments', paymentRoutes);
router.use('/ai', aiRoutes);
router.use('/weather', weatherRoutes);
router.use('/places', placesRoutes);

module.exports = router;
