import { factories } from "@strapi/strapi";
import axios from "axios";

export default factories.createCoreController(
  "api::booking.booking",
  ({ strapi }) => ({
    // Initialize booking and get payment link
    async initializeBooking(ctx) {
      // Handle both direct body and wrapped data formats
      const body = ctx.request.body || {};
      const requestData = body.data || body;
      const { propertyId, checkIn, checkOut, guestDetails } = requestData;

      // Validate required fields
      if (!propertyId || !checkIn || !checkOut || !guestDetails) {
        return ctx.badRequest("Missing required fields");
      }

      if (!guestDetails.name || !guestDetails.email || !guestDetails.phone) {
        return ctx.badRequest("Guest details incomplete");
      }

      // Validate dates
      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);

      if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
        return ctx.badRequest("Invalid date format");
      }

      if (checkInDate >= checkOutDate) {
        return ctx.badRequest("Check-out must be after check-in");
      }

      if (checkInDate < new Date()) {
        return ctx.badRequest("Check-in cannot be in the past");
      }

      try {
        // Check availability
        const blockedDates = await strapi.entityService.findMany(
          "api::blocked-date.blocked-date",
          {
            filters: {
              property: propertyId,
              startDate: { $lte: checkOut },
              endDate: { $gte: checkIn },
            },
          }
        );

        if (blockedDates.length > 0) {
          return ctx.badRequest("Property not available for selected dates");
        }

        // Get property details
        const property: any = await strapi.entityService.findOne(
          "api::property.property",
          propertyId,
          { populate: ["property_owner"] }
        );

        if (!property) {
          return ctx.notFound("Property not found");
        }

        if (!property.isActive) {
          return ctx.badRequest("Property is not available");
        }

        // Calculate pricing
        const nights = Math.ceil(
          (checkOutDate.getTime() - checkInDate.getTime()) /
            (1000 * 60 * 60 * 24)
        );
        const totalAmount = nights * property.pricePerNight;
        const commissionRate = property.commissionRate || 20; // default 20%
        const agentCommission = Math.round(
          (totalAmount * commissionRate) / 100
        );
        const ownerAmount = totalAmount - agentCommission;

        // Generate unique reference
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substr(2, 9).toUpperCase();
        const bookingRef = `LBR-${timestamp}-${randomStr}`;

        // Create pending booking
        const booking: any = await strapi.entityService.create(
          "api::booking.booking",
          {
            data: {
              bookingReference: bookingRef,
              property: propertyId,
              property_owner: property.property_owner?.id,
              guestName: guestDetails.name,
              guestEmail: guestDetails.email,
              guestPhone: guestDetails.phone,
              numberOfGuests: guestDetails.numberOfGuests || 1,
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
          }
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
            property_id: propertyId,
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
            }
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
            error.response?.data || error.message
          );
          return ctx.internalServerError("Payment initialization failed");
        }
      } catch (error: any) {
        strapi.log.error("Booking initialization error:", error);
        return ctx.internalServerError("Failed to initialize booking");
      }
    },

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
          }
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
              populate: ["property"],
            }
          );

          if (bookings.length === 0) {
            return ctx.notFound("Booking not found");
          }

          const booking = bookings[0];

          // Check if already confirmed (prevent double processing)
          if (booking.paymentStatus === "completed") {
            return booking;
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
            }
          );

          // Block the dates
          await strapi.entityService.create("api::blocked-date.blocked-date", {
            data: {
              property: booking.property.id,
              startDate: booking.checkIn,
              endDate: booking.checkOut,
              reason: "booked",
              booking: booking.id,
              notes: `Booked by ${booking.guestName}`,
            },
          });

          // TODO: Send confirmation emails here (we'll add this later)

          return {
            success: true,
            booking: updatedBooking,
          };
        } else {
          return ctx.badRequest("Payment verification failed");
        }
      } catch (error: any) {
        strapi.log.error(
          "Payment verification error:",
          error.response?.data || error.message
        );
        return ctx.internalServerError("Payment verification failed");
      }
    },
  })
);
