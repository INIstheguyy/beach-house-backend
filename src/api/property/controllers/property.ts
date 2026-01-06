/**
 * property controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::property.property', ({ strapi }) => ({
  
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
      // Find blocked dates for this property that overlap with requested dates
      const blockedDates = await strapi.entityService.findMany(
        'api::blocked-date.blocked-date',
        {
          filters: {
            property: id,
            $or: [
              {
                // New booking starts during an existing block
                startDate: { $lte: checkOutStr },
                endDate: { $gte: checkInStr },
              },
            ],
          },
          populate: ['booking'],
        }
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
      };
    } catch (error) {
      strapi.log.error('Error checking availability:', error);
      return ctx.internalServerError('Failed to check availability');
    }
  },

}));