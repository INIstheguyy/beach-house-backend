/**
 * custom property routes
 */

module.exports = {
  routes: [
    {
      method: "GET",
      path: "/properties/:id/availability",
      handler: "property.checkAvailability",
      config: {
        auth: false, // Public endpoint
      },
    },
    {
      method: "POST",
      path: "/properties/:id/sync-ical",
      handler: "property.syncIcal",
      config: {
        auth: false, // Change to true with proper auth in production
      },
    },
  ],
};
