const { query, withTransaction } = require('../database/pool');
const aiProviderFactory = require('./aiProvider/aiProviderFactory');
const AppError = require('../utils/AppError');
const logger = require('../logger/logger');

const MAX_HISTORY_MESSAGES = 20;

async function verifyConversationOwnership({ userId, conversationId }) {
  const result = await query(
    `SELECT id FROM ai_conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  if (result.rows.length === 0) {
    throw new AppError('Conversation not found', 404, 'AI_CONVERSATION_NOT_FOUND');
  }
}

async function getHistory(conversationId) {
  if (!conversationId) return [];
  const result = await query(
    `SELECT role, content FROM ai_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, MAX_HISTORY_MESSAGES]
  );
  return result.rows;
}

/**
 * Sends a user message, gets an AI reply, persists both, and returns the
 * reply plus whatever structured search params the AI extracted.
 *
 * Deliberately does NOT create the conversation row (for a fresh chat) until
 * AFTER the AI provider call succeeds — otherwise a failed/rate-limited
 * first message would leave an empty, titleless "ghost" conversation behind
 * with nothing in it. Existing conversations are verified up front since
 * there's nothing to roll back there.
 */
async function sendMessage({ userId, conversationId, message }) {
  if (conversationId) {
    await verifyConversationOwnership({ userId, conversationId });
  }

  const history = await getHistory(conversationId);
  const provider = aiProviderFactory.getProvider();
  const { reply, extractedParams } = await provider.generateChatReply({ history, userMessage: message });

  const finalConversationId = await withTransaction(async (client) => {
    let convId = conversationId;
    if (!convId) {
      const created = await client.query(
        `INSERT INTO ai_conversations (user_id, title) VALUES ($1, $2) RETURNING id`,
        [userId, message.slice(0, 60)]
      );
      convId = created.rows[0].id;
    } else {
      await client.query(`UPDATE ai_conversations SET updated_at = now() WHERE id = $1`, [convId]);
    }

    await client.query(
      `INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [convId, message]
    );
    await client.query(
      `INSERT INTO ai_messages (conversation_id, role, content, structured_params) VALUES ($1, 'assistant', $2, $3)`,
      [convId, reply, extractedParams ? JSON.stringify(extractedParams) : null]
    );

    return convId;
  });

  logger.info('AI chat message processed', { userId, conversationId: finalConversationId });

  return { conversationId: finalConversationId, reply, extractedParams };
}

async function listConversations(userId) {
  const result = await query(
    `SELECT id, title, created_at, updated_at FROM ai_conversations
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
    [userId]
  );
  return result.rows;
}

async function getConversationWithMessages({ userId, conversationId }) {
  const convResult = await query(
    `SELECT id, title, created_at FROM ai_conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  if (convResult.rows.length === 0) {
    throw new AppError('Conversation not found', 404, 'AI_CONVERSATION_NOT_FOUND');
  }

  const messages = await query(
    `SELECT id, role, content, structured_params, created_at FROM ai_messages
     WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );

  return { ...convResult.rows[0], messages: messages.rows };
}

module.exports = { sendMessage, listConversations, getConversationWithMessages };
