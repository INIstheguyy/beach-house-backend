/**
 * property controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController(
  "api::property.property",
  ({ strapi }) => ({
    async checkAvailability(ctx) {
      const { id } = ctx.params;
      const { checkIn, checkOut } = ctx.query;
      console.log(
        "Checking availability for property ID:",
        id,
        "from",
        checkIn,
        "to",
        checkOut,
      );

      // Validate inputs
      if (!checkIn || !checkOut) {
        return ctx.badRequest("checkIn and checkOut dates are required");
      }

      // Convert to strings (TypeScript safety)
      const checkInStr = String(checkIn);
      const checkOutStr = String(checkOut);

      // Validate dates
      const checkInDate = new Date(checkInStr);
      const checkOutDate = new Date(checkOutStr);

      if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
        return ctx.badRequest("Invalid date format. Use YYYY-MM-DD");
      }

      if (checkInDate >= checkOutDate) {
        return ctx.badRequest("checkOut must be after checkIn");
      }

      if (checkInDate < new Date()) {
        return ctx.badRequest("checkIn cannot be in the past");
      }

      try {
        // First, get the property to obtain its numeric ID
        // (id param is documentId from URL, but relations need numeric ID)
        const property: any = await strapi.entityService.findOne(
          "api::property.property",
          id,
        );

        if (!property) {
          return ctx.notFound("Property not found");
        }

        console.log(
          `Property lookup: documentId=${id}, numeric id=${property.id}`,
        );

        // Find blocked dates for this property that overlap with requested dates
        // Use numeric property.id for relation filter
        const blockedDates = await strapi.entityService.findMany(
          "api::blocked-date.blocked-date",
          {
            filters: {
              property: property.id,
              $and: [
                {
                  // Blocked period starts before or on our checkout date
                  startDate: { $lt: checkOutStr },
                },
                {
                  // Blocked period ends after or on our checkin date
                  endDate: { $gt: checkInStr },
                },
              ],
            },
            populate: ["booking"],
          },
        );

        const isAvailable = blockedDates.length === 0;

        return {
          available: isAvailable,
          propertyId: id,
          checkIn: checkInStr,
          checkOut: checkOutStr,
          blockedDates: blockedDates.map((block: any) => ({
            startDate: block.startDate,
            endDate: block.endDate,
            reason: block.reason,
          })),
          message: isAvailable
            ? "Property is available for these dates"
            : `Property is not available. Found ${blockedDates.length} conflicting booking(s).`,
        };
      } catch (error) {
        strapi.log.error("Error checking availability:", error);
        return ctx.internalServerError("Failed to check availability");
      }
    },
  }),
);
