import { api } from '@/lib/apiClient';

export const paymentService = {
  async createOrder(plan) {
    const res = await api.post('/payments/create-order', { plan });
    return res.data;
  },

  async verifyPayment({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
    const res = await api.post('/payments/verify', { razorpayOrderId, razorpayPaymentId, razorpaySignature });
    return res.data.subscription;
  },
};
