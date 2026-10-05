export default ({ strapi }) => ({
  health(ctx) {
    ctx.body = {
      status: "ok",
      service: "beach-rentals-api",
    };
  },

  async ready(ctx) {
    try {
      await strapi.db.connection.raw("SELECT 1");
      ctx.body = {
        status: "ready",
        database: "ok",
      };
    } catch (error) {
      strapi.log.error("Readiness database check failed", error);
      ctx.status = 503;
      ctx.body = {
        status: "not_ready",
        database: "unavailable",
      };
    }
  },
});
