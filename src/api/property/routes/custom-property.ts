/**
 * custom property routes
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/properties/:id/availability',
      handler: 'property.checkAvailability',
      config: {
        auth: false, // Public endpoint
      },
    },
  ],
};