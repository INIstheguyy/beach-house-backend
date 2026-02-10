import type { Core } from "@strapi/strapi";
import cron from "node-cron";

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Sync all properties with iCal URLs every 6 hours
    cron.schedule("0 */6 * * *", async () => {
      strapi.log.info("Starting scheduled iCal sync...");

      try {
        const properties = await strapi.entityService.findMany(
          "api::property.property",
          {
            filters: {
              icalUrl: { $notNull: true },
              isActive: true,
            },
          },
        );

        let successCount = 0;
        let failCount = 0;

        for (const property of properties) {
          try {
            // Call sync logic via service
            await strapi
              .service("api::property.ical")
              .syncProperty(property.id);
            successCount++;
          } catch (error) {
            strapi.log.error(`iCal sync failed for ${property.title}:`, error);
            failCount++;
          }
        }
      } catch (error) {
        strapi.log.error("iCal sync cron job failed:", error);
      }
    });

    strapi.log.info("iCal sync cron job scheduled (every 6 hours)");
  },
};
