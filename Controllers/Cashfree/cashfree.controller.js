import crypto from "crypto";
import { Cashfree as CashfreePG } from "cashfree-pg";

CashfreePG.XClientId = process.env.CASHFREE_CLIENT_ID;
CashfreePG.XClientSecret = process.env.CASHFREE_CLIENT_SECRET;
CashfreePG.XEnvironment = CashfreePG.Environment.SANDBOX;

import Payment from "../../Schema/payment.schema.js";
import Booking from "../../Schema/booking.schema.js";
import { PatientProfile } from "../../Schema/user.schema.js";

class CashfreeController {
  // Function to generate a unique (human-readable) order/payment ID
  generateOrderId = async () => {
    // Example ID: INV-2026-001
    const year = new Date().getFullYear();
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();
    // increment or UUID could be used for more uniqueness, here keeping random for brevity
    return `INV-${year}-${random}`;
  };

  // Generates a Cashfree order, creates payment & attaches to booking (if provided)
  generateSessionId = async (req, res) => {
    console.log("Get Cashfree Session ID: Started");
    const { paymentId } = req.body;

    try {
      // Fetch the payment using paymentId
      if (!paymentId) {
        return res.status(400).json({ error: "paymentId is required in the body" });
      }

      const payment = await Payment.findOne({ paymentId });
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      // Early exit: If payment already marked as paid, do not create sessionId/order
      if (payment.status && payment.status.toLowerCase() === "paid") {
        return res.status(200).json({
          message: "Payment has already been completed for this paymentId.",
          alreadyPaid: true,
          paymentId: payment.paymentId,
          paymentDbId: payment._id,
          cashfree: payment.cashfree || null
        });
      }

      // Try to find related booking
      const booking = await Booking.findOne({ payment: payment._id }).populate({
        path: 'patient',
        model: PatientProfile,
      });

      let Children = null;
      if (booking && booking.patient) {
        // Children in booking refers to PatientProfile
        Children = await PatientProfile.findById(booking.patient._id || booking.patient);
      }

      // Always generate a new unique orderId
      const orderId = await this.generateOrderId();
      const amount = payment.amount;
      const remark = payment.remark || (booking
        ? `Online payment initiated for appointment ${booking.appointmentId}`
        : `Manual payment`);

      // Gather customer details
      let customer_name = '';
      let customer_phone = '';
      let customer_email = '';
      let customer_id = '';

      if (patient) {
        customer_name = patient.name || '';
        customer_phone = patient.mobile1 || '';
        customer_email = patient.parentEmail || '';
        customer_id = patient.patientId || `guest-${orderId}`;
      } else if (booking && booking.patient) {
        // fallback: booking's Children field populated
        if (typeof booking.Children === 'object') {
          customer_name = booking.patient.name || '';
          customer_phone = booking.patient.mobile1 || '';
          customer_email = booking.patient.parentEmail || '';
          customer_id = booking.patient.patientId || `guest-${orderId}`;
        }
      } else {
        customer_id = `guest-${orderId}`;
      }

      // Compose Cashfree order payload including order_meta
      let request = {
        order_id: orderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: customer_id,
          customer_name: customer_name,
          customer_phone: customer_phone,
          customer_email: customer_email,
        },
        order_note: remark,
        order_meta: {
          return_url: "https://nupalcdcserver.devyugal.in/api/cashfree/booking-payment-webhook",
          notify_url: "https://nupalcdcserver.devyugal.in/api/cashfree/booking-payment-webhook"
        }
      };

      const response = await CashfreePG.PGCreateOrder("2023-08-01", request);

      // Save CashfreeSchema details to payment when session/order is created
      // See payment.schema.js@CashfreeSchema and its structure
      if (response?.data) {
        // Build CashfreeSchema-compliant object
        const cashfreeDetails = {
          cf_order_id: response.data.cf_order_id || response.data.order_id || null, // fallback for cf_order_id if not present
          order_id: orderId,
          payment_session_id: response.data.payment_session_id || null,
          order_status: response.data.order_status || null,
          order_amount: response.data.order_amount || amount,
          order_currency: response.data.order_currency || "INR",
          order_note: remark,
          order_expiry_time: response.data.order_expiry_time ? new Date(response.data.order_expiry_time) : undefined,
          created_at: response.data.created_at ? new Date(response.data.created_at) : new Date(),
          customer: {
            customer_id: customer_id,
            name: customer_name,
            email: customer_email,
            phone: customer_phone,
          },
          order_meta: {
            return_url: (request.order_meta && request.order_meta.return_url) || "",
            notify_url: (request.order_meta && request.order_meta.notify_url) || ""
          }
        };

        // Save to payment.cashfree and persist
        payment.cashfree = cashfreeDetails;
        await payment.save();
      }

      console.log("Cashfree order created:", response.data);

      res.status(200).json({
        ...response.data,
        paymentId: payment.paymentId,
        orderId: orderId, // return both for clarity
        paymentDbId: payment._id,
        bookingId: booking?._id
      });
    } catch (error) {
      console.error("Error creating Cashfree order", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };

  // Handler for Cashfree Webhook (called by Cashfree for status update)
  handleWebhook = async (req, res) => {
    console.log("Cashfree Webhook: Started");
    try {
      // Cashfree webhook data is in req.body
      const body = req.body;
      const order_id = body?.data?.order?.order_id;
      const payment_status = body?.data?.payment?.payment_status;
      const transaction_amount = Number(body?.data?.payment?.payment_amount || 0);
      const payment_time = body?.data?.payment?.payment_time
        ? new Date(body.data.payment.payment_time)
        : new Date();

      // NOTE: Here, we can't link Cashfree's order_id to our Payment record directly anymore,
      // unless orderId is stored in Payment for cross-reference at order creation.
      // If NOT stored, you need to map order_id -> paymentId in some other way.
      // Here, still trying with paymentId=order_id for backward-compatibility/fallback.

      // Find the payment based on Cashfree order_id (not our paymentId)
      const payment = await Payment.findOne({ "cashfree.order_id": order_id });
      if (!payment) {
        console.warn("Payment not found for cashfree order_id", order_id);
        return res.status(404).send("Payment record not found");
      }

      if (payment_status === "SUCCESS") {
        payment.status = "paid";
        payment.amountPaid = transaction_amount;
        payment.paymentTime = payment_time;
        await payment.save();

        // Link back to booking (if any): update status, etc.
        const booking = await Booking.findOne({ payment: payment._id });
        if (booking) {
          // Optionally update booking state
          // E.g. booking.status = "paid"; (if you have such field)
          await booking.save();
        }
        console.log(`Payment ${order_id}: marked as paid`);
      } else if (payment_status === "FAILED") {
        payment.status = "failed";
        await payment.save();
        console.log(`Payment ${order_id}: marked as failed`);
      } else {
        // Possibly handle pending/partiallypaid/etc. cases
        payment.status = payment_status.toLowerCase();
        await payment.save();
        console.log(`Payment ${order_id}: updated status ${payment_status}`);
      }

      res.status(200).send("Webhook processed successfully");
    } catch (error) {
      console.error("Error handling Cashfree webhook", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };
}

export default CashfreeController;
