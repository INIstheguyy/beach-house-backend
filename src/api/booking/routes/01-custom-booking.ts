module.exports = {
  routes: [
    {
      method: "POST",
      path: "/bookings/initialize",
      handler: "api::booking.booking.initializeBooking",
      config: {
        auth: false,
      },
    },
    {
      method: "GET",
      path: "/bookings/verify",
      handler: "api::booking.booking.verifyPayment",
      config: {
        auth: false,
      },
    },
    {
      method: "POST",
      path: "/bookings/webhook",
      handler: "api::booking.booking.handleFlutterwaveWebhook",
      config: {
        auth: false,
      },
    },
  ],
};
