import { api } from '@/lib/apiClient';

export const weatherService = {
  async getCurrent(iataCode) {
    const res = await api.get(`/weather/${iataCode}/current`);
    return res.data;
  },

  async getForecast(iataCode) {
    const res = await api.get(`/weather/${iataCode}/forecast`);
    return res.data;
  },

  async getSeason(iataCode, month) {
    const params = month ? `?month=${month}` : '';
    const res = await api.get(`/weather/${iataCode}/season${params}`);
    return res.data;
  },
};
