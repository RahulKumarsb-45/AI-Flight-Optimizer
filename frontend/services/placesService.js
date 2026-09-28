import { api } from '@/lib/apiClient';

export const placesService = {
  async getHotels(iataCode) {
    const res = await api.get(`/places/${iataCode}/hotels`);
    return res.data;
  },
  async getRestaurants(iataCode) {
    const res = await api.get(`/places/${iataCode}/restaurants`);
    return res.data;
  },
  async getAttractions(iataCode) {
    const res = await api.get(`/places/${iataCode}/attractions`);
    return res.data;
  },
};
