import { api } from '@/lib/apiClient';

export const aiService = {
  async sendMessage({ message, conversationId }) {
  const payload = { message };

  if (conversationId) {
    payload.conversationId = conversationId;
  }

  const res = await api.post('/ai/chat', payload);
  return res.data;
},

  async listConversations() {
    const res = await api.get('/ai/conversations');
    return res.data.conversations;
  },

  async getConversation(conversationId) {
    const res = await api.get(`/ai/conversations/${conversationId}`);
    return res.data.conversation;
  },
};
