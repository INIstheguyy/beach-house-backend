// const axios = require('axios');
// const ical = require('ical');

// module.exports = {
//   async syncAllProperties() {
//     const properties = await strapi.entityService.findMany('api::property.property', {
//       filters: { icalUrl: { $notNull: true } },
//     });

//     for (const property of properties) {
//       try {
//         await this.syncProperty(property);
//       } catch (error) {
//         strapi.log.error(`Failed to sync property ${property.id}:`, error);
//       }
//     }
//   },

//   async syncProperty(property) {
//     if (!property.icalUrl) return;

//     // Fetch iCal data
//     const response = await axios.get(property.icalUrl);
//     const events = ical.parseICS(response.data);

//     // Clear existing external blocks for this property
//     const existingBlocks = await strapi.entityService.findMany(
//       'api::blocked-date.blocked-date',
//       {
//         filters: {
//           property: property.id,
//           reason: { $ne: 'booked' }, // Don't delete our own bookings
//         },
//       }
//     );

//     for (const block of existingBlocks) {
//       await strapi.entityService.delete('api::blocked-date.blocked-date', block.id);
//     }

//     // Add new blocks from iCal
//     for (const event of Object.values(events)) {
//       if (event.type === 'VEVENT') {
//         await strapi.entityService.create('api::blocked-date.blocked-date', {
//           data: {
//             property: property.id,
//             startDate: event.start,
//             endDate: event.end,
//             reason: 'manual-block',
//             notes: `Synced from external calendar: ${event.summary || 'Blocked'}`,
//           },
//         });
//       }
//     }

//     strapi.log.info(`Synced property ${property.id} successfully`);
//   },
// };