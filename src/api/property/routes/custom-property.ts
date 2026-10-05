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
      path: "/properties/sync-ical",
      handler: "property.syncAllIcal",
      config: {
        auth: false, // Controller requires the ICAL_SYNC_SECRET bearer token.
      },
    },
    {
      method: "POST",
      path: "/properties/:id/sync-ical",
      handler: "property.syncIcal",
      config: {
        auth: false, // Controller requires the ICAL_SYNC_SECRET bearer token.
      },
    },
  ],
};
