/**
 * property controller
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreController(
  "api::property.property",
  ({ strapi }) => ({
    // Custom method to check availability
   // Custom method to check availability
async checkAvailability(ctx) {
  const { id } = ctx.params;
  const { checkIn, checkOut } = ctx.query;

  // Validate inputs
  if (!checkIn || !checkOut) {
    return ctx.badRequest('checkIn and checkOut dates are required');
  }

  // Convert to strings (TypeScript safety)
  const checkInStr = String(checkIn);
  const checkOutStr = String(checkOut);

  // Validate dates
  const checkInDate = new Date(checkInStr);
  const checkOutDate = new Date(checkOutStr);

  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
    return ctx.badRequest('Invalid date format. Use YYYY-MM-DD');
  }

  if (checkInDate >= checkOutDate) {
    return ctx.badRequest('checkOut must be after checkIn');
  }

  if (checkInDate < new Date()) {
    return ctx.badRequest('checkIn cannot be in the past');
  }

  try {
    // Find blocked dates that overlap with requested dates
    // A booking overlaps if:
    // - It starts before the new booking ends, AND
    // - It ends after the new booking starts
    const blockedDates = await strapi.entityService.findMany(
      'api::blocked-date.blocked-date',
      {
        filters: {
          property: id,
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
        populate: ['booking'],
      }
    );

    console.log(`Checking availability for property ${id}:`);
    console.log(`  Requested: ${checkInStr} to ${checkOutStr}`);
    console.log(`  Found ${blockedDates.length} overlapping blocked dates:`, blockedDates);

    const isAvailable = blockedDates.length === 0;

    return {
      available: isAvailable,
      propertyId: id,
      checkIn: checkInStr,
      checkOut: checkOutStr,
      blockedDates: blockedDates.map((block: any) => ({
        id: block.id,
        startDate: block.startDate,
        endDate: block.endDate,
        reason: block.reason,
      })),
      message: isAvailable 
        ? 'Property is available for these dates' 
        : `Property is not available. Found ${blockedDates.length} conflicting booking(s).`,
    };
  } catch (error) {
    strapi.log.error('Error checking availability:', error);
    return ctx.internalServerError('Failed to check availability');
  }
},
  })
);
