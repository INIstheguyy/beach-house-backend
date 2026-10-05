import ical from "node-ical";
import axios from "axios";

const ICAL_TIMEOUT_MS = 10_000;
const ICAL_MAX_BYTES = 1_000_000;
const ICAL_MAX_EVENTS = 5_000;

export default ({ strapi }) => ({
  /**
   * Fetch and parse iCal feed from URL
   */
  async fetchIcalFeed(icalUrl: string) {
    try {
      const response = await axios.get(icalUrl, {
        timeout: ICAL_TIMEOUT_MS,
        maxContentLength: ICAL_MAX_BYTES,
        maxBodyLength: ICAL_MAX_BYTES,
        responseType: "text",
      });

      if (typeof response.data !== "string") {
        throw new Error("iCal feed did not return text content");
      }

      const events = await ical.async.parseICS(response.data);
      if (Object.keys(events).length > ICAL_MAX_EVENTS) {
        throw new Error(`iCal feed exceeds the ${ICAL_MAX_EVENTS} event limit`);
      }
      return events;
    } catch (error: any) {
      throw new Error(`Failed to fetch iCal feed: ${error.message}`);
    }
  },

  /**
   * Extract blocked dates from iCal events
   */
  extractBlockedDates(events: any) {
    const blockedDates: Array<{
      startDate: string;
      endDate: string;
      externalId: string;
      source: string;
    }> = [];

    for (const [, event] of Object.entries(events) as [string, any][]) {
      if (event.type !== "VEVENT") continue;

      const startDate = event.start;
      const endDate = event.end;

      if (!startDate || !endDate) continue;

      // Convert to YYYY-MM-DD format
      const start = this.formatDateForStrapi(startDate);
      const end = this.formatDateForStrapi(endDate);

      // A missing UID cannot be matched reliably on a retry, so skip it instead
      // of creating duplicate external blocks on every synchronization.
      if (!event.uid) continue;

      blockedDates.push({
        startDate: start,
        endDate: end,
        externalId: event.uid || "",
        source: this.detectSource(event),
      });
    }

    return blockedDates;
  },

  formatDateForStrapi(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  detectSource(event: any): string {
    const summary = event.summary?.toLowerCase() || "";
    const description = event.description?.toLowerCase() || "";
    const uid = event.uid?.toLowerCase() || "";

    if (uid.includes("airbnb") || summary.includes("airbnb")) {
      return "airbnb";
    }
    if (uid.includes("booking.com") || description.includes("booking.com")) {
      return "booking.com";
    }
    if (uid.includes("vrbo") || summary.includes("vrbo")) {
      return "vrbo";
    }
    return "external";
  },

  /**
   * Sync property with iCal feed
   */
  async syncProperty(propertyId: number | string) {
    // Get property with icalUrl
    const property: any = await strapi.entityService.findOne(
      "api::property.property",
      propertyId,
    );

    if (!property) {
      throw new Error("Property not found");
    }

    if (!property.icalUrl) {
      throw new Error("Property does not have an iCal URL configured");
    }

    // Fetch and parse iCal feed
    const events = await this.fetchIcalFeed(property.icalUrl);
    const blockedDates = this.extractBlockedDates(events);

    // Get existing external blocked dates for this property
    const existingBlocks = await strapi.entityService.findMany(
      "api::blocked-date.blocked-date",
      {
        filters: {
          property: property.id,
          reason: "external-booking",
        },
      },
    );

    // Create map of existing blocks by externalId
    const existingMap = new Map(
      existingBlocks.map((block: any) => [block.externalId, block]),
    );

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Sync each blocked date
    for (const blockedDate of blockedDates) {
      const existing: any = existingMap.get(blockedDate.externalId);

      if (existing) {
        // Check if dates changed
        if (
          existing.startDate !== blockedDate.startDate ||
          existing.endDate !== blockedDate.endDate
        ) {
          await strapi.entityService.update(
            "api::blocked-date.blocked-date",
            existing.id,
            {
              data: {
                startDate: blockedDate.startDate,
                endDate: blockedDate.endDate,
              },
            },
          );
          updated++;
        } else {
          skipped++;
        }
        existingMap.delete(blockedDate.externalId);
      } else {
        // Create new blocked date
        await strapi.entityService.create("api::blocked-date.blocked-date", {
          data: {
            property: property.id,
            startDate: blockedDate.startDate,
            endDate: blockedDate.endDate,
            reason: "external-booking",
            externalId: blockedDate.externalId,
            source: blockedDate.source,
            notes: `Imported from ${blockedDate.source} via iCal sync`,
          },
        });
        created++;
      }
    }

    return {
      success: true,
      propertyId: property.id,
      propertyTitle: property.title,
      synced: {
        created,
        updated,
        skipped,
        total: blockedDates.length,
      },
      lastSyncedAt: new Date().toISOString(),
    };
  },

  /**
   * Synchronize every active property independently. A broken remote feed must
   * never prevent the remaining properties from being synchronized.
   */
  async syncAllProperties() {
    const properties: any[] = await strapi.entityService.findMany(
      "api::property.property",
      {
        filters: {
          icalUrl: { $notNull: true },
          isActive: true,
        },
        fields: ["id"],
      },
    );

    const results: Array<{
      propertyId: number;
      success: boolean;
      synced?: unknown;
      error?: string;
    }> = [];

    for (const property of properties) {
      try {
        const synced = await this.syncProperty(property.id);
        results.push({ propertyId: property.id, success: true, synced });
      } catch (error: any) {
        // Do not include private calendar URLs or request details in logs/results.
        const message = error instanceof Error ? error.message : "Unknown iCal sync error";
        strapi.log.warn(`iCal sync failed for property ${property.id}: ${message}`);
        results.push({ propertyId: property.id, success: false, error: message });
      }
    }

    const succeeded = results.filter((result) => result.success).length;
    const failed = results.length - succeeded;
    strapi.log.info(
      `iCal sync summary: properties=${results.length}, succeeded=${succeeded}, failed=${failed}`,
    );

    return {
      success: failed === 0,
      total: results.length,
      succeeded,
      failed,
      results,
      completedAt: new Date().toISOString(),
    };
  },
});
