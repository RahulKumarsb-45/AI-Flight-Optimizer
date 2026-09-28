import { api } from '@/lib/apiClient';

export const tripService = {
  async optimize(searchParams) {
    const res = await api.post('/trips/optimize', searchParams);
    return res.data;
  },

  async listTrips() {
    const res = await api.get('/trips');
    return res.data.trips;
  },

  async getTrip(tripId) {
    const res = await api.get(`/trips/${tripId}`);
    return res.data.trip;
  },

  async listSaved() {
    const res = await api.get('/trips/saved');
    return res.data.savedTrips;
  },

  async saveTrip(tripId, notes) {
    return api.post(`/trips/${tripId}/save`, { notes });
  },

  async unsaveTrip(tripId) {
    return api.delete(`/trips/${tripId}/save`);
  },

  async shareTrip(tripId) {
    const res = await api.post(`/trips/${tripId}/share`);
    return res.data; // { shareToken, shareUrl }
  },

  async revokeShare(tripId) {
    return api.delete(`/trips/${tripId}/share`);
  },

  async getSharedTrip(shareToken) {
    const res = await api.get(`/trips/shared/${shareToken}`);
    return res.data.trip;
  },
};
