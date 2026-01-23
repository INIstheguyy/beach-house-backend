/**
 * custom property routes
 */

module.exports =  {
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