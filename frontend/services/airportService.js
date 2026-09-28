import { api } from '@/lib/apiClient';

export const airportService = {
  async search(query, limit = 8) {
    if (!query || query.trim().length === 0) return [];
    const res = await api.get(`/airports?q=${encodeURIComponent(query)}&limit=${limit}`);
    return res.data.results;
  },

  async getByCode(iataCode) {
    const res = await api.get(`/airports/${iataCode}`);
    return res.data.airport;
  },

  async getNearby(iataCode, limit) {
    const qs = limit ? `?limit=${limit}` : '';
    const res = await api.get(`/airports/${iataCode}/nearby${qs}`);
    return res.data.nearby;
  },

  async listCountries() {
    const res = await api.get('/countries');
    return res.data.countries;
  },

  async listRegions() {
    const res = await api.get('/airports/regions');
    return res.data.regions;
  },
};
