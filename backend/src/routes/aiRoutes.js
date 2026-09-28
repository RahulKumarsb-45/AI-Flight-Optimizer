const express = require('express');
const rateLimit = require('express-rate-limit');
const aiController = require('../controllers/aiController');
const { chatValidator, conversationIdParamValidator } = require('../validators/aiValidators');
const { requireAuth } = require('../middleware/auth');
const config = require('../config/env');

const router = express.Router();

const chatLimiter =
  config.nodeEnv === 'test'
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        max: 15,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          status: 'error',
          errorCode: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many messages. Please wait a moment.',
        },
      });

router.post('/chat', requireAuth, chatLimiter, chatValidator, aiController.chat);
router.get('/conversations', requireAuth, aiController.listConversations);
router.get('/conversations/:conversationId', requireAuth, conversationIdParamValidator, aiController.getConversation);

module.exports = router;
