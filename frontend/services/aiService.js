import { api } from '@/lib/apiClient';

export const aiService = {
  async sendMessage({ message, conversationId }) {
    const res = await api.post('/ai/chat', { message, conversationId });
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
