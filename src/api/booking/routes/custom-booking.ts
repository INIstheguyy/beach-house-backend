/**
 * custom booking routes
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/bookings/initialize',
      handler: 'api::booking.booking.initializeBooking',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/bookings/verify',
      handler: 'api::booking.booking.verifyPayment',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};