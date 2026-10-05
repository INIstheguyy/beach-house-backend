/**
 * booking controller
 */

import { factories } from "@strapi/strapi";
import axios from "axios";
import { parseDateOnly, todayInTimeZone } from "../../../utils/date-only";

export default factories.createCoreController(
  "api::booking.booking",
  ({ strapi }) => ({
    // Initialize booking and get payment link
    async initializeBooking(ctx) {
      const { propertyId, checkIn, checkOut, guestDetails } = ctx.request.body;

      // Validate required fields
      if (!propertyId || !checkIn || !checkOut || !guestDetails) {
        return ctx.badRequest("Missing required fields");
      }

      if (!guestDetails.name || !guestDetails.email || !guestDetails.phone) {
        return ctx.badRequest("Guest details incomplete");
      }

      const requestedGuestCount = Number(guestDetails.numberOfGuests || 1);
      if (!Number.isInteger(requestedGuestCount) || requestedGuestCount < 1) {
        return ctx.badRequest("numberOfGuests must be a positive whole number");
      }

      // Validate dates
      const checkInDate = parseDateOnly(checkIn);
      const checkOutDate = parseDateOnly(checkOut);

      if (!checkInDate || !checkOutDate) {
        return ctx.badRequest("Invalid date format. Use YYYY-MM-DD");
      }

      if (checkInDate >= checkOutDate) {
        return ctx.badRequest("Check-out must be after check-in");
      }

      if (checkInDate < todayInTimeZone(process.env.BUSINESS_TIMEZONE)) {
        return ctx.badRequest("Check-in cannot be in the past");
      }

      try {
        // Get property details first
        // (propertyId could be documentId from frontend, fetch to get numeric ID)
        const property: any = await strapi.entityService.findOne(
          "api::property.property",
          propertyId,
          { populate: ["property_owner"] },
        );

        if (!property) {
          return ctx.notFound("Property not found");
        }

        // Check availability using numeric property.id for relation filter
        const blockedDates = await strapi.entityService.findMany(
          "api::blocked-date.blocked-date",
          {
            filters: {
              property: property.id,
              $and: [
                {
                  // Blocked period starts before (not on) our checkout date
                  startDate: { $lt: checkOut },
                },
                {
                  // Blocked period ends after (not on) our checkin date
                  endDate: { $gt: checkIn },
                },
              ],
            },
          },
        );

        if (blockedDates.length > 0) {
          return ctx.badRequest("Property not available for selected dates");
        }

        if (!property.isActive) {
          return ctx.badRequest("Property is not available");
        }

        const maximumGuests = Number(property.Number ?? property.maxGuests);
        if (Number.isFinite(maximumGuests) && requestedGuestCount > maximumGuests) {
          return ctx.badRequest(
            `This property accommodates a maximum of ${maximumGuests} guests`,
          );
        }

        if (!process.env.FLUTTERWAVE_SECRET_KEY) {
          strapi.log.error("FLUTTERWAVE_SECRET_KEY is not configured");
          return ctx.internalServerError("Payment service is not configured");
        }

        // Calculate pricing
        const nights = Math.ceil(
          (checkOutDate.getTime() - checkInDate.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        const totalAmount = nights * property.pricePerNight;
        const commissionRate = property.commissionRate || 20; // default 20%
        const agentCommission = Math.round(
          (totalAmount * commissionRate) / 100,
        );
        const ownerAmount = totalAmount - agentCommission;

        // Generate unique reference
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substr(2, 9).toUpperCase();
        const bookingRef = `LBR-${timestamp}-${randomStr}`;

        // Create pending booking
        // Use numeric property.id for relations
        const booking: any = await strapi.entityService.create(
          "api::booking.booking",
          {
            data: {
              bookingReference: bookingRef,
              property: property.id,
              property_owner: property.property_owner?.id,
              guestName: guestDetails.name,
              guestEmail: guestDetails.email,
              guestPhone: guestDetails.phone,
              numberOfGuests: requestedGuestCount,
              checkIn,
              checkOut,
              numberOfNights: nights,
              pricePerNight: property.pricePerNight,
              totalAmount,
              agentCommission,
              propertyOwnerAmount: ownerAmount,
              paymentStatus: "pending",
              bookingStatus: "pending",
              specialRequests: guestDetails.specialRequests || "",
            },
          },
        );

        // Initialize Flutterwave payment
        const flutterwavePayload: any = {
          tx_ref: bookingRef,
          amount: totalAmount,
          currency: "NGN",
          redirect_url: `${process.env.FRONTEND_URL}/booking/verify`,
          payment_options: "card,banktransfer,ussd",
          customer: {
            email: guestDetails.email,
            phonenumber: guestDetails.phone,
            name: guestDetails.name,
          },
          customizations: {
            title: property.title,
            description: `Booking for ${nights} night(s)`,
            logo: "", // Add your logo URL later
          },
          meta: {
            booking_id: booking.id,
            property_id: property.id, // Store numeric ID for payment verification
          },
        };

        // Add split payment if property owner has subaccount
        if (property.property_owner?.flutterwaveSubaccount) {
          flutterwavePayload.subaccounts = [
            {
              id: property.property_owner.flutterwaveSubaccount,
              transaction_charge_type: "flat",
              transaction_charge: agentCommission,
            },
          ];
        }

        try {
          const response = await axios.post(
            "https://api.flutterwave.com/v3/payments",
            flutterwavePayload,
            {
              headers: {
                Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
                "Content-Type": "application/json",
              },
            },
          );

          return {
            success: true,
            bookingId: booking.id,
            bookingReference: bookingRef,
            paymentLink: response.data.data.link,
          };
        } catch (error: any) {
          // Delete the pending booking if payment initialization fails
          await strapi.entityService.delete("api::booking.booking", booking.id);

          strapi.log.error(
            "Flutterwave initialization failed:",
            error.response?.data || error.message,
          );
          return ctx.internalServerError("Payment initialization failed");
        }
      } catch (error: any) {
        strapi.log.error("Booking initialization error:", error);
        return ctx.internalServerError("Failed to initialize booking");
      }
    },

    // Verify payment and confirm booking
    // Verify payment and confirm booking
    async verifyPayment(ctx) {
      const { transaction_id, tx_ref } = ctx.query;

      if (!transaction_id || !tx_ref) {
        return ctx.badRequest("Missing transaction details");
      }

      const transactionIdStr = String(transaction_id);
      const txRefStr = String(tx_ref);

      try {
        // Verify transaction with Flutterwave
        const response = await axios.get(
          `https://api.flutterwave.com/v3/transactions/${transactionIdStr}/verify`,
          {
            headers: {
              Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
            },
          },
        );

        const paymentData = response.data.data;

        if (
          paymentData.status === "successful" &&
          paymentData.tx_ref === txRefStr
        ) {
          // Find booking by reference
          const bookings: any = await strapi.entityService.findMany(
            "api::booking.booking",
            {
              filters: { bookingReference: txRefStr },
              populate: ["property", "property_owner"],
            },
          );

          if (bookings.length === 0) {
            return ctx.notFound("Booking not found");
          }

          const booking = bookings[0];

          const expectedAmount = Number(booking.totalAmount);
          if (
            paymentData.currency !== "NGN" ||
            !Number.isFinite(Number(paymentData.amount)) ||
            Number(paymentData.amount) < expectedAmount
          ) {
            strapi.log.warn("Flutterwave verification rejected due to amount or currency mismatch", {
              bookingReference: txRefStr,
              expectedAmount,
              receivedAmount: paymentData.amount,
              receivedCurrency: paymentData.currency,
            });
            return ctx.badRequest("Payment amount or currency verification failed");
          }

          const transactionMatches: any = await strapi.entityService.findMany(
            "api::booking.booking",
            {
              filters: { flutterwaveTransactionId: transactionIdStr },
            },
          );

          if (
            transactionMatches.some(
              (matchedBooking: any) => matchedBooking.id !== booking.id,
            )
          ) {
            strapi.log.warn("Flutterwave transaction ID was reused", {
              bookingReference: txRefStr,
              transactionId: transactionIdStr,
            });
            return ctx.badRequest("Payment transaction has already been used");
          }

          // Check if already confirmed (prevent double processing)
          if (booking.paymentStatus === "completed") {
            // Still return the booking with proper structure
            const existingBooking = await strapi.entityService.findOne(
              "api::booking.booking",
              booking.id,
              {
                populate: ["property", "property_owner"],
              },
            );
            return {
              success: true,
              booking: existingBooking,
            };
          }

          // Update booking status
          const updatedBooking = await strapi.entityService.update(
            "api::booking.booking",
            booking.id,
            {
              data: {
                paymentStatus: "completed",
                bookingStatus: "confirmed",
                flutterwaveTransactionId: transactionIdStr,
                flutterwaveReference: txRefStr,
                paidAt: new Date().toISOString(),
              },
              populate: ["property", "property_owner"],
            },
          );

          // Get the property ID - try multiple sources
          let propertyId;

          // First, try from the booking relation
          if (booking.property?.id) {
            propertyId = booking.property.id;
          } else if (booking.property?.data?.id) {
            propertyId = booking.property.data.id;
          } else if (typeof booking.property === "number") {
            propertyId = booking.property;
          }

          // If still not found, try from Flutterwave metadata
          if (!propertyId && paymentData.meta?.property_id) {
            propertyId = parseInt(paymentData.meta.property_id);
          }

          if (!propertyId) {
            strapi.log.error(
              "Could not determine property ID from booking:",
              booking,
            );
            strapi.log.error("Flutterwave meta:", paymentData.meta);
            return ctx.internalServerError("Failed to determine property ID");
          }

          // Block the dates

          try {
            const blockedDate = await strapi.entityService.create(
              "api::blocked-date.blocked-date",
              {
                data: {
                  property: propertyId,
                  startDate: booking.checkIn,
                  endDate: booking.checkOut,
                  reason: "booked",
                  booking: booking.id,
                  notes: `Booked by ${booking.guestName}`,
                },
              },
            );

          } catch (blockError: any) {
            strapi.log.error("Failed to create blocked date:", blockError);
            // Don't fail the whole request, booking is still confirmed
          }

          return {
            success: true,
            booking: updatedBooking,
          };
        } else {
          strapi.log.warn("Flutterwave payment verification rejected", {
            bookingReference: txRefStr,
            status: paymentData?.status,
          });
          return ctx.badRequest("Payment verification failed");
        }
      } catch (error: any) {
        strapi.log.error(
          "Payment verification error:",
          error.response?.data || error.message,
        );
        return ctx.internalServerError("Payment verification failed");
      }
    },

    async handleFlutterwaveWebhook(ctx) {
      const expectedSignature = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
      const signature = ctx.get("verif-hash");

      if (!expectedSignature || signature !== expectedSignature) {
        return ctx.unauthorized("Invalid webhook signature");
      }

      const payload: any = ctx.request.body;
      const transactionId = payload?.data?.id;
      const txRef = payload?.data?.tx_ref;

      if (
        payload?.event !== "charge.completed" ||
        payload?.data?.status !== "successful" ||
        !transactionId ||
        !txRef
      ) {
        ctx.body = { received: true, processed: false };
        return;
      }

      try {
        const providerResponse = await axios.get(
          `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
          {
            headers: {
              Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
            },
          },
        );
        const payment = providerResponse.data.data;
        const bookings: any = await strapi.entityService.findMany(
          "api::booking.booking",
          {
            filters: { bookingReference: String(txRef) },
            populate: ["property", "property_owner"],
          },
        );
        const booking = bookings[0];

        if (!booking) {
          strapi.log.warn("Webhook referenced an unknown booking", {
            bookingReference: String(txRef),
          });
          ctx.body = { received: true, processed: false };
          return;
        }

        const isVerified =
          payment?.status === "successful" &&
          payment?.tx_ref === booking.bookingReference &&
          payment?.currency === "NGN" &&
          Number(payment?.amount) >= Number(booking.totalAmount);

        if (!isVerified) {
          strapi.log.warn("Webhook payment verification failed", {
            bookingReference: booking.bookingReference,
          });
          ctx.body = { received: true, processed: false };
          return;
        }

        if (booking.paymentStatus === "completed") {
          ctx.body = { received: true, processed: false, duplicate: true };
          return;
        }

        const existingTransaction: any = await strapi.entityService.findMany(
          "api::booking.booking",
          { filters: { flutterwaveTransactionId: String(transactionId) } },
        );
        if (
          existingTransaction.some(
            (existingBooking: any) => existingBooking.id !== booking.id,
          )
        ) {
          strapi.log.error("Webhook transaction ID was already used", {
            transactionId: String(transactionId),
          });
          ctx.status = 409;
          ctx.body = { received: true, processed: false };
          return;
        }

        const propertyId = booking.property?.id;
        if (!propertyId) {
          throw new Error("Booking is missing its property relation");
        }

        await strapi.entityService.create("api::blocked-date.blocked-date", {
          data: {
            property: propertyId,
            startDate: booking.checkIn,
            endDate: booking.checkOut,
            reason: "booked",
            booking: booking.id,
            notes: `Booked by ${booking.guestName}`,
          },
        });

        await strapi.entityService.update("api::booking.booking", booking.id, {
          data: {
            paymentStatus: "completed",
            bookingStatus: "confirmed",
            flutterwaveTransactionId: String(transactionId),
            flutterwaveReference: booking.bookingReference,
            paidAt: new Date().toISOString(),
          },
        });

        ctx.body = { received: true, processed: true };
      } catch (error: any) {
        strapi.log.error("Flutterwave webhook processing failed", {
          message: error.response?.data || error.message,
        });
        return ctx.internalServerError("Webhook processing failed");
      }
    },
  }),
);
