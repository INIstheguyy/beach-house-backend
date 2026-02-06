module.exports = {
  // Run every 30 minutes
  '*/30 * * * *': async ({ strapi }) => {
    await strapi.service('api::ical-sync').syncAllProperties();
  },
};