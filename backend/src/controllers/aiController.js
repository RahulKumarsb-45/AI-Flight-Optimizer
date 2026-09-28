const aiChatService = require('../services/aiChatService');

async function chat(req, res, next) {
  try {
    const { message, conversationId } = req.body;
    const result = await aiChatService.sendMessage({ userId: req.user.id, conversationId, message });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

async function listConversations(req, res, next) {
  try {
    const conversations = await aiChatService.listConversations(req.user.id);
    res.status(200).json({ status: 'success', data: { conversations } });
  } catch (err) {
    next(err);
  }
}

async function getConversation(req, res, next) {
  try {
    const conversation = await aiChatService.getConversationWithMessages({
      userId: req.user.id,
      conversationId: req.params.conversationId,
    });
    res.status(200).json({ status: 'success', data: { conversation } });
  } catch (err) {
    next(err);
  }
}

module.exports = { chat, listConversations, getConversation };
