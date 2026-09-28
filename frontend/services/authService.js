import { api, setAccessToken } from '@/lib/apiClient';

export const authService = {
  async register({ name, email, password }) {
    return api.post('/auth/register', { name, email, password });
  },

  async login({ email, password }) {
    const res = await api.post('/auth/login', { email, password });
    setAccessToken(res.data.accessToken);
    return res.data.user;
  },

  async logout() {
    setAccessToken(null);
    return api.post('/auth/logout');
  },

  async me() {
    const res = await api.get('/auth/me');
    return { user: res.data.user, subscription: res.data.subscription };
  },

  async silentRefresh() {
    const token = await api.refreshAccessToken();
    return token;
  },
};
