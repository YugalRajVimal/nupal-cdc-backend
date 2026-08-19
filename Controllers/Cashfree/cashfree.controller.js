// import crypto from "crypto";
// import { Cashfree as CashfreePG } from "cashfree-pg";

// CashfreePG.XClientId = process.env.CASHFREE_CLIENT_ID;
// CashfreePG.XClientSecret = process.env.CASHFREE_CLIENT_SECRET;
// CashfreePG.XEnvironment = process.env.NODE_ENV === "production"
//   ? CashfreePG.Environment.PRODUCTION
//   : CashfreePG.Environment.DEVELOPMENT;

// import Payment from "../../Schema/payment.schema.js";
// import Booking from "../../Schema/booking.schema.js";
// import { PatientProfile } from "../../Schema/user.schema.js";

// class CashfreeController {
//   // Function to generate a unique (human-readable) order/payment ID
//   generateOrderId = async () => {
//     // Example ID: INV-2026-001
//     const year = new Date().getFullYear();
//     const random = crypto.randomBytes(3).toString("hex").toUpperCase();
//     // increment or UUID could be used for more uniqueness, here keeping random for brevity
//     return `INV-${year}-${random}`;
//   };

//   // Generates a Cashfree order, creates payment & attaches to booking (if provided)
//   generateSessionId = async (req, res) => {
//     const { paymentId } = req.body;

//     try {
//       if (!paymentId) {
//         return res.status(400).json({ error: "paymentId is required in the body" });
//       }

//       // Fetch Payment
//       const payment = await Payment.findOne({ paymentId });
//       if (!payment) {
//         return res.status(404).json({ error: "Payment not found" });
//       }

//       // Early exit: already PAID
//       if (payment.status && payment.status.toLowerCase() === "paid") {
//         return res.status(200).json({
//           message: "Payment has already been completed for this paymentId.",
//           alreadyPaid: true,
//           paymentId: payment.paymentId,
//           paymentDbId: payment._id,
//           cashfree: payment.cashfree || null
//         });
//       }

//       // Fetch associated booking and deeply populate discountInfo.coupon and patient
//       const booking = await Booking.findOne({ payment: payment._id })
//         .populate({
//           path: 'patient',
//           model: PatientProfile,
//         })
//         .populate({
//           path: 'discountInfo.coupon',
//           model: "Discount"
//         })
//         .populate({
//           path: 'package'
//         });

//       let patient = null;
//       if (booking && booking.patient) {
//         patient = await PatientProfile.findById(booking.patient._id || booking.patient);
//       }

//       // Calculate invoiceOriginal (before any discount)
//       let invoiceOriginal = (payment.totalAmount != null)
//         ? payment.totalAmount
//         : (booking && booking.package && typeof booking.package.price === "number"
//             ? booking.package.price
//             : booking && booking.totalAmount != null
//                 ? booking.totalAmount
//                 : payment.amount
//           );

//       // ---- DISCOUNT RESOLUTION LOGIC ----
//       // Try to get discount from booking.discountInfo.coupon if available and enabled
//       let discountAmount = 0;
//       if (
//         booking &&
//         booking.discountInfo &&
//         booking.discountInfo.coupon &&
//         booking.discountInfo.coupon.discountEnabled === true &&
//         typeof booking.discountInfo.coupon.discount === "number" &&
//         booking.discountInfo.coupon.discount > 0
//       ) {
//         // Percentage-based discount (as per discount.schema.js)
//         discountAmount = Math.floor(
//           invoiceOriginal * (booking.discountInfo.coupon.discount / 100)
//         );
//       } else if (
//         booking &&
//         booking.discountInfo &&
//         typeof booking.discountInfo.discountAmount === "number" &&
//         booking.discountInfo.discountAmount > 0
//       ) {
//         discountAmount = booking.discountInfo.discountAmount;
//       } else if (
//         payment.discountInfo &&
//         typeof payment.discountInfo.amount === "number" &&
//         payment.discountInfo.amount > 0
//       ) {
//         discountAmount = payment.discountInfo.amount;
//       }

//       let invoiceAfterDiscount =
//         invoiceOriginal != null
//           ? Math.max(0, Math.round(invoiceOriginal - discountAmount))
//           : null;

//       let totalPaid = 0;
//       // payment.amountPaid may represent what has been paid (partial payments)
//       if (payment.amountPaid && !isNaN(payment.amountPaid)) {
//         totalPaid = Number(payment.amountPaid);
//       }
//       // Ensure not to double-count in case of partial payments; only count for this Payment, not all payments

//       let dueAmount = invoiceAfterDiscount != null ? invoiceAfterDiscount - totalPaid : null;
//       if (dueAmount != null) dueAmount = Math.max(0, Math.round(dueAmount));

//       if (dueAmount === 0) {
//         return res.status(200).json({
//           message: "Nothing due for this paymentId (already paid or overpaid).",
//           alreadyPaid: true,
//           dueAmount: dueAmount,
//           paymentId: payment.paymentId,
//           paymentDbId: payment._id,
//           cashfree: payment.cashfree || null
//         });
//       }

//       // Always generate a new unique orderId for Cashfree
//       const orderId = await this.generateOrderId();
//       const amount = dueAmount;
//       const remark = payment.remark || (booking
//         ? `Online payment initiated for appointment ${booking.appointmentId}`
//         : `Manual payment`);

//       // Gather customer data
//       let customer_name = '';
//       let customer_phone = '';
//       let customer_email = '';
//       let customer_id = '';

//       if (patient) {
//         customer_name = patient.name || '';
//         customer_phone = patient.mobile1 || '';
//         customer_email = patient.parentEmail || '';
//         customer_id = patient.patientId || `guest-${orderId}`;
//       } else if (booking && booking.patient) {
//         customer_name = booking.patient.name || '';
//         customer_phone = booking.patient.mobile1 || '';
//         customer_email = booking.patient.parentEmail || '';
//         customer_id = booking.patient.patientId || `guest-${orderId}`;
//       } else {
//         customer_id = `guest-${orderId}`;
//       }

//       // Compose order payload for due amount
//       let request = {
//         order_id: orderId,
//         order_amount: amount,
//         order_currency: "INR",
//         customer_details: {
//           customer_id: customer_id,
//           customer_name: customer_name,
//           customer_phone: customer_phone,
//           customer_email: customer_email,
//         },
//         order_note: remark,
//         order_meta: {
//           return_url: "https://api.nupalcdc.com/api/cashfree/booking-payment-webhook",
//           notify_url: "https://api.nupalcdc.com/api/cashfree/booking-payment-webhook"
//         }
//       };

//       const response = await CashfreePG.PGCreateOrder("2023-08-01", request);

//       // Save to payment.cashfree block in schema (override on session create)
//       if (response?.data) {
//         const cashfreeDetails = {
//           cf_order_id: response.data.cf_order_id || response.data.order_id || null,
//           order_id: orderId,
//           payment_session_id: response.data.payment_session_id || null,
//           order_status: response.data.order_status || null,
//           order_amount: response.data.order_amount || amount,
//           order_currency: response.data.order_currency || "INR",
//           order_note: remark,
//           order_expiry_time: response.data.order_expiry_time ? new Date(response.data.order_expiry_time) : undefined,
//           created_at: response.data.created_at ? new Date(response.data.created_at) : new Date(),
//           customer: {
//             customer_id: customer_id,
//             name: customer_name,
//             email: customer_email,
//             phone: customer_phone,
//           },
//           order_meta: {
//             return_url: request.order_meta && request.order_meta.return_url || "",
//             notify_url: request.order_meta && request.order_meta.notify_url || "",
//           }
//         };

//         payment.cashfree = cashfreeDetails;
//         await payment.save();
//       }

//       res.status(200).json({
//         ...response.data,
//         paymentId: payment.paymentId,
//         orderId: orderId,
//         paymentDbId: payment._id,
//         bookingId: booking?._id,
//         invoiceOriginal,
//         discountAmount,
//         invoiceAfterDiscount,
//         totalPaid,
//         dueAmount
//       });
//     } catch (error) {
//       // Keep this error log as it is general error handling,
//       // but remove all other detailed logs per instruction above
//       console.error("Error creating Cashfree order", error);
//       res.status(500).json({ error: "Internal Server Error" });
//     }
//   };

//   // Handler to confirm order status with Cashfree
 
//   // confirmStatus = async (req, res) => {
//   //   const { order_id } = req.params;

//   //   if (!order_id) {
//   //     return res.status(400).json({ error: "order_id is required in the URL params" });
//   //   }

//   //   const headers = {
//   //     "accept": "application/json",
//   //     "x-api-version": "2025-01-01",
//   //     "x-client-id": process.env.CASHFREE_CLIENT_ID,
//   //     "x-client-secret": process.env.CASHFREE_CLIENT_SECRET
//   //   };

//   //   try {
//   //     const url = `https://api.cashfree.com/pg/orders/${order_id}`;
//   //     const response = await fetch(url, { method: "GET", headers });
//   //     const data = await response.json();

//   //     if (!response.ok) {
//   //       return res.status(response.status).json({
//   //         error: data?.message || "Failed to fetch order status from Cashfree",
//   //         details: data
//   //       });
//   //     }

//   //     // Import models
//   //     const Payment = (await import('../../Schema/payment.schema.js')).default;
//   //     const Finances = (await import('../../Schema/finances.schema.js')).default;

//   //     // Find payment by cashfree.order_id
//   //     const payment = await Payment.findOne({ 'cashfree.order_id': order_id });

//   //     let financeRecord = null;

//   //     if (payment && data?.order_status) {
//   //       // 'PAID' → create the finances record directly (never check existence)
//   //       switch (data.order_status) {
//   //         case 'PAID': {
//   //           payment.status = 'paid';
//   //           payment.amountPaid = data.order_amount || payment.amountPaid || 0;
//   //           payment.paymentTime = data.payment_time ? new Date(data.payment_time) : new Date();

//   //           // Gather childrenName / childrenId from cashfree.customer
//   //           const childrenName = payment.childrenName || payment.cashfree?.customer?.name || undefined;
//   //           const childrenId = payment.childrenId || payment.cashfree?.customer?.customer_id || undefined;

//   //           // Booking display id (e.g. B00095) parsed from order_note, fallback to cashfree order_id
//   //           let bookingDisplayId = order_id;
//   //           const noteMatch = data?.order_note?.match(/\b([A-Z]\d{5,})\b/);
//   //           if (noteMatch) {
//   //             bookingDisplayId = noteMatch[1];
//   //           }

//   //           const description = payment.remark || `Cashfree Payment for Booking ${bookingDisplayId}`;

//   //           financeRecord = await Finances.create({
//   //             date: payment.paymentTime || new Date(),
//   //             description,
//   //             type: 'income',
//   //             amount: payment.amountPaid || payment.amount,
//   //             creditDebitStatus: 'credited',
//   //             paymentMethod: 'cashfree',
//   //             utr: payment.utr && payment.utr.length ? payment.utr : [order_id],
//   //             childrenName,
//   //             childrenId
//   //           });
//   //           break;
//   //         }
//   //         case 'FAILED':
//   //           payment.status = 'failed';
//   //           break;
//   //         case 'EXPIRED':
//   //           payment.status = 'failed';
//   //           break;
//   //         case 'ACTIVE':
//   //           payment.status = 'pending';
//   //           break;
//   //         default:
//   //           break;
//   //       }
//   //       // always update latest cashfree details
//   //       payment.cashfree = {
//   //         ...(payment.cashfree || {}),
//   //         ...data,
//   //       };
//   //       await payment.save();
//   //     }

//   //     return res.status(200).json({
//   //       orderStatus: data,
//   //       paymentStatusMarked: payment ? payment.status : null,
//   //       financeRecord: financeRecord
//   //         ? {
//   //           _id: financeRecord._id,
//   //           amount: financeRecord.amount,
//   //           type: financeRecord.type,
//   //           date: financeRecord.date,
//   //           paymentMethod: financeRecord.paymentMethod
//   //         }
//   //         : null
//   //     });
//   //   } catch (error) {
//   //     console.error("Error confirming Cashfree order status:", error);
//   //     return res.status(500).json({ error: "Internal Server Error" });
//   //   }
//   // };

//   confirmStatus = async (req, res) => {
//     const { order_id } = req.params;
  
//     if (!order_id) {
//       return res.status(400).json({ error: "order_id is required in the URL params" });
//     }
  
//     const headers = {
//       "accept": "application/json",
//       "x-api-version": "2025-01-01",
//       "x-client-id": process.env.CASHFREE_CLIENT_ID,
//       "x-client-secret": process.env.CASHFREE_CLIENT_SECRET
//     };
  
//     try {
//       const url = `https://api.cashfree.com/pg/orders/${order_id}`;
//       const response = await fetch(url, { method: "GET", headers });
//       const data = await response.json();
  
//       if (!response.ok) {
//         return res.status(response.status).json({
//           error: data?.message || "Failed to fetch order status from Cashfree",
//           details: data
//         });
//       }
  
//       const Payment = (await import('../../Schema/payment.schema.js')).default;
//       const Finances = (await import('../../Schema/finances.schema.js')).default;
  
//       const payment = await Payment.findOne({ 'cashfree.order_id': order_id });
  
//       let financeRecord = null;
  
//       if (payment && data?.order_status) {
//         if (!Array.isArray(payment.transactions)) payment.transactions = [];
  
//         switch (data.order_status) {
//           case 'PAID': {
//             const paidAmount = data.order_amount || payment.amountPaid || 0;
//             payment.status = 'paid';
//             payment.amountPaid = paidAmount;
//             payment.paymentTime = data.payment_time ? new Date(data.payment_time) : new Date();
  
//             const childrenName = payment.childrenName || payment.cashfree?.customer?.name || undefined;
//             const childrenId = payment.childrenId || payment.cashfree?.customer?.customer_id || undefined;
  
//             let bookingDisplayId = order_id;
//             const noteMatch = data?.order_note?.match(/\b([A-Z]\d{5,})\b/);
//             if (noteMatch) {
//               bookingDisplayId = noteMatch[1];
//             }
  
//             const description = payment.remark || `Cashfree Payment for Booking ${bookingDisplayId}`;
//             const utrForRecord = payment.utr && payment.utr.length ? payment.utr : [order_id];
  
//             financeRecord = await Finances.create({
//               date: payment.paymentTime || new Date(),
//               description,
//               type: 'income',
//               amount: paidAmount || payment.amount,
//               creditDebitStatus: 'credited',
//               paymentMethod: 'cashfree',
//               utr: utrForRecord,
//               childrenName,
//               childrenId
//             });
  
//             payment.transactions.push({
//               amount: paidAmount || payment.amount,
//               paymentMethod: 'cashfree',
//               utr: utrForRecord,
//               paymentTime: payment.paymentTime,
//               type: 'full',
//               remark: description,
//               financeRecord: financeRecord._id,
//             });
//             break;
//           }
//           case 'FAILED':
//             payment.status = 'failed';
//             break;
//           case 'EXPIRED':
//             payment.status = 'failed';
//             break;
//           case 'ACTIVE':
//             payment.status = 'pending';
//             break;
//           default:
//             break;
//         }
//         payment.cashfree = {
//           ...(payment.cashfree || {}),
//           ...data,
//         };
//         await payment.save();
//       }
  
//       return res.status(200).json({
//         orderStatus: data,
//         paymentStatusMarked: payment ? payment.status : null,
//         financeRecord: financeRecord
//           ? {
//             _id: financeRecord._id,
//             amount: financeRecord.amount,
//             type: financeRecord.type,
//             date: financeRecord.date,
//             paymentMethod: financeRecord.paymentMethod
//           }
//           : null
//       });
//     } catch (error) {
//       console.error("Error confirming Cashfree order status:", error);
//       return res.status(500).json({ error: "Internal Server Error" });
//     }
//   };
//   // Handler for Cashfree Webhook (called by Cashfree for status update)
//   // handleWebhook = async (req, res) => {
//   //   console.log("Cashfree Webhook: Started");
//   //   try {
//   //     // Cashfree webhook data is in req.body
//   //     const body = req.body;
//   //     const order_id = body?.data?.order?.order_id;
//   //     const payment_status = body?.data?.payment?.payment_status;
//   //     const transaction_amount = Number(body?.data?.payment?.payment_amount || 0);
//   //     const payment_time = body?.data?.payment?.payment_time
//   //       ? new Date(body.data.payment.payment_time)
//   //       : new Date();

//   //     // NOTE: Here, we can't link Cashfree's order_id to our Payment record directly anymore,
//   //     // unless orderId is stored in Payment for cross-reference at order creation.
//   //     // If NOT stored, you need to map order_id -> paymentId in some other way.
//   //     // Here, still trying with paymentId=order_id for backward-compatibility/fallback.

//   //     // Find the payment based on Cashfree order_id (not our paymentId)
//   //     const payment = await Payment.findOne({ "cashfree.order_id": order_id });
//   //     if (!payment) {
//   //       console.warn("Payment not found for cashfree order_id", order_id);
//   //       return res.status(404).send("Payment record not found");
//   //     }

//   //     if (payment_status === "SUCCESS") {
//   //       payment.status = "paid";
//   //       payment.amountPaid = transaction_amount;
//   //       payment.paymentTime = payment_time;
//   //       await payment.save();

//   //       // Link back to booking (if any): update status, etc.
//   //       const booking = await Booking.findOne({ payment: payment._id });
//   //       if (booking) {
//   //         // Optionally update booking state
//   //         // E.g. booking.status = "paid"; (if you have such field)
//   //         await booking.save();
//   //       }
//   //       console.log(`Payment ${order_id}: marked as paid`);
//   //     } else if (payment_status === "FAILED") {
//   //       payment.status = "failed";
//   //       await payment.save();
//   //       console.log(`Payment ${order_id}: marked as failed`);
//   //     } else {
//   //       // Possibly handle pending/partiallypaid/etc. cases
//   //       payment.status = payment_status.toLowerCase();
//   //       await payment.save();
//   //       console.log(`Payment ${order_id}: updated status ${payment_status}`);
//   //     }

//   //     res.status(200).send("Webhook processed successfully");
//   //   } catch (error) {
//   //     console.error("Error handling Cashfree webhook", error);
//   //     res.status(500).json({ error: "Internal Server Error" });
//   //   }
//   // };

//   handleWebhook = async (req, res) => {
//     console.log("Cashfree Webhook: Started");
//     try {
//       const body = req.body;
//       const order_id = body?.data?.order?.order_id;
//       const payment_status = body?.data?.payment?.payment_status;
//       const transaction_amount = Number(body?.data?.payment?.payment_amount || 0);
//       const payment_time = body?.data?.payment?.payment_time
//         ? new Date(body.data.payment.payment_time)
//         : new Date();
//       const cf_payment_id = body?.data?.payment?.cf_payment_id;
  
//       const payment = await Payment.findOne({ "cashfree.order_id": order_id });
//       if (!payment) {
//         console.warn("Payment not found for cashfree order_id", order_id);
//         return res.status(404).send("Payment record not found");
//       }
  
//       if (!Array.isArray(payment.transactions)) payment.transactions = [];
  
//       if (payment_status === "SUCCESS") {
//         payment.status = "paid";
//         payment.amountPaid = transaction_amount;
//         payment.paymentTime = payment_time;
  
//         payment.transactions.push({
//           amount: transaction_amount,
//           paymentMethod: "cashfree",
//           utr: cf_payment_id ? [String(cf_payment_id)] : (payment.utr && payment.utr.length ? payment.utr : [order_id]),
//           paymentTime: payment_time,
//           type: "full",
//           remark: `Cashfree webhook SUCCESS for order ${order_id}`,
//         });
  
//         await payment.save();
  
//         const booking = await Booking.findOne({ payment: payment._id });
//         if (booking) {
//           await booking.save();
//         }
//         console.log(`Payment ${order_id}: marked as paid`);
//       } else if (payment_status === "FAILED") {
//         payment.status = "failed";
//         await payment.save();
//         console.log(`Payment ${order_id}: marked as failed`);
//       } else {
//         payment.status = payment_status.toLowerCase();
//         await payment.save();
//         console.log(`Payment ${order_id}: updated status ${payment_status}`);
//       }
  
//       res.status(200).send("Webhook processed successfully");
//     } catch (error) {
//       console.error("Error handling Cashfree webhook", error);
//       res.status(500).json({ error: "Internal Server Error" });
//     }
//   };
// }

// export default CashfreeController;


import crypto from "crypto";
import { Cashfree as CashfreePG } from "cashfree-pg";

CashfreePG.XClientId = process.env.CASHFREE_CLIENT_ID;
CashfreePG.XClientSecret = process.env.CASHFREE_CLIENT_SECRET;
CashfreePG.XEnvironment = process.env.NODE_ENV === "production"
  ? CashfreePG.Environment.PRODUCTION
  : CashfreePG.Environment.DEVELOPMENT;

import mongoose from "mongoose";
import Payment from "../../Schema/payment.schema.js";
import Booking from "../../Schema/booking.schema.js";
import Finances from "../../Schema/finances.schema.js";
import { PatientProfile } from "../../Schema/user.schema.js";
import { creditWallet, sweepWalletToOtherDues } from "../../Services/wallet.services.js";
import { allocatePaymentOldestFirst } from "../../Services/wallet.services.js";

/**
 * Shared "a Cashfree payment succeeded" handler — used by BOTH confirmStatus
 * (polling) and handleWebhook (push), so the two entry points can never
 * drift apart again. Mirrors collectPayment's "full" branch:
 *  - clamps what's applied to the invoice's outstanding due (never overwrites
 *    amountPaid, only adds to it)
 *  - routes any overflow to the wallet and immediately sweeps it across the
 *    patient's OTHER bookings that still have something due
 *  - stamps every Finances row from this one payment with the SAME date/utr
 *    and a shared transactionRef so they can be displayed as one split payment
 *
 * @param {Object} opts
 * @param {string} opts.orderId - Cashfree order_id, used to find the Payment
 * @param {number} opts.grossAmount - total amount Cashfree says was paid
 * @param {Date} [opts.paymentTime]
 * @param {string[]} [opts.utr] - e.g. [cf_payment_id]
 * @param {string} [opts.remarkPrefix]
 * @param {Object} [req]
 * @returns {Promise<{payment: Object, booking: Object, financeRecord: Object|null, sweepResults: Array}|null>}
 */
// async function applyCashfreePaymentSuccess(
//   { orderId, grossAmount, paymentTime, utr, remarkPrefix },
//   req
// ) {
//   const session = await mongoose.startSession();
//   session.startTransaction();
//   try {
//     const payment = await Payment.findOne({ "cashfree.order_id": orderId }).session(session);
//     if (!payment) {
//       await session.abortTransaction();
//       session.endSession();
//       return null;
//     }

//     // Idempotency guard: webhook + confirmStatus (and Cashfree retries) can all
//     // fire for the same order. Once we've fully applied a payment, don't apply
//     // the same money twice — the original bug here silently double-processed
//     // dues whenever both the poll and the webhook landed.
//     if (payment.status === "paid") {
//       await session.abortTransaction();
//       session.endSession();
//       return { payment, booking: null, financeRecord: null, sweepResults: [], alreadyProcessed: true };
//     }

//     const booking = await Booking.findOne({ payment: payment._id })
//       .populate([
//         {
//           path: "patient",
//           model: "PatientProfile",
//           select: "name mobile1 patientId",
//         },
//       ])
//       .session(session);

//     if (!Array.isArray(payment.transactions)) payment.transactions = [];
//     if (!Array.isArray(payment.utr)) payment.utr = payment.utr ? [payment.utr] : [];

//     const effectiveUtr = Array.isArray(utr) ? utr.filter(Boolean) : utr ? [utr] : [];
//     const effectivePaymentTime = paymentTime || new Date();
//     const transactionRef = `CF-${orderId}`;

//     // How much is actually still due on THIS booking's current invoice —
//     // never blindly overwrite amountPaid, only ever add to it.
//     const currentInvoice = booking?.invoiceAmount || payment.amount || 0;
//     const alreadyPaid = payment.amountPaid || 0;
//     const amountToCollect = Math.max(0, currentInvoice - alreadyPaid);
//     const appliedToInvoice = Math.min(grossAmount, amountToCollect);
//     const overflowToWallet = grossAmount - appliedToInvoice;

//     payment.amountPaid = alreadyPaid + appliedToInvoice;
//     payment.status = payment.amountPaid >= currentInvoice ? "paid" : "partiallypaid";
//     payment.paymentTime = effectivePaymentTime;
//     payment.paymentMethod = "cashfree";
//     if (effectiveUtr.length) payment.utr.push(...effectiveUtr);

//     const childrenName = booking?.patient?.name || payment.childrenName || payment.cashfree?.customer?.name || "";
//     const childrenId = booking?.patient?.patientId || payment.childrenId || "";
//     const description = `${remarkPrefix || "Cashfree Payment"}${booking ? ` for Booking #${booking.appointmentId}` : ""}`;

//     let financeRecord = null;
//     if (appliedToInvoice > 0) {
//       const [created] = await Finances.create(
//         [
//           {
//             date: effectivePaymentTime,
//             description,
//             type: "income",
//             amount: appliedToInvoice,
//             creditDebitStatus: "credited",
//             paymentMethod: "cashfree",
//             utr: effectiveUtr.length ? effectiveUtr : payment.utr,
//             childrenName,
//             childrenId,
//             booking: booking?._id,
//             transactionRef,
//           },
//         ],
//         { session }
//       );
//       financeRecord = created;

//       payment.transactions.push({
//         amount: appliedToInvoice,
//         paymentMethod: "cashfree",
//         utr: effectiveUtr.length ? effectiveUtr : payment.utr,
//         paymentTime: effectivePaymentTime,
//         type: "full",
//         remark: description,
//         financeRecord: financeRecord._id,
//       });
//     }

//     let sweepResults = [];
//     if (overflowToWallet > 0 && booking?.patient) {
//       // This is the fix for "Cashfree payment doesn't clear previous booking
//       // dues": route the overflow to the wallet and sweep it, exactly like
//       // collectPayment's manual/cash flow already does.
//       payment.transactions.push({
//         amount: overflowToWallet,
//         paymentMethod: "cashfree",
//         utr: effectiveUtr.length ? effectiveUtr : payment.utr,
//         paymentTime: effectivePaymentTime,
//         type: "advance",
//         remark: `Overpayment during Cashfree collection${booking ? ` for Booking #${booking.appointmentId}` : ""} (routed to wallet)`,
//       });

//       await creditWallet(
//         {
//           patientId: booking.patient._id,
//           amount: overflowToWallet,
//           reason: "advance_payment",
//           booking: booking._id,
//           remark: `Overpayment during Cashfree collection for Booking #${booking.appointmentId}`,
//         },
//         session
//       );

//       sweepResults = await sweepWalletToOtherDues(
//         {
//           patientId: booking.patient._id,
//           patientDisplayId: booking.patient.patientId,
//           patientName: booking.patient.name,
//           excludeBookingId: booking._id,
//           paymentTime: effectivePaymentTime,
//           utr: effectiveUtr.length ? effectiveUtr : payment.utr,
//           paymentMethod: "cashfree",
//           transactionRef,
//         },
//         session,
//         req
//       );
//     }

//     await payment.save({ session });

//     if (booking) {
//       booking.paymentStatus = payment.status;
//       await booking.save({ session });
//     }

//     await session.commitTransaction();
//     session.endSession();

//     return { payment, booking, financeRecord, sweepResults };
//   } catch (err) {
//     await session.abortTransaction();
//     session.endSession();
//     throw err;
//   }
// }

async function applyCashfreePaymentSuccess(
  { orderId, grossAmount, paymentTime, utr, remarkPrefix },
  req
) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const payment = await Payment.findOne({ "cashfree.order_id": orderId }).session(session);
    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return null;
    }

    if (payment.status === "paid") {
      await session.abortTransaction();
      session.endSession();
      return { payment, booking: null, applications: [], alreadyProcessed: true };
    }

    const booking = await Booking.findOne({ payment: payment._id })
      .populate([{ path: "patient", model: "PatientProfile", select: "name mobile1 patientId" }])
      .session(session);

    if (!booking?.patient) {
      // No linked booking/patient — fall back to crediting this Payment record
      // directly, same as before, since there's no patient to allocate across.
      const effectiveUtr = Array.isArray(utr) ? utr.filter(Boolean) : utr ? [utr] : [];
      payment.amountPaid = (payment.amountPaid || 0) + grossAmount;
      payment.status = "paid";
      payment.paymentTime = paymentTime || new Date();
      payment.paymentMethod = "cashfree";
      if (!Array.isArray(payment.utr)) payment.utr = [];
      if (effectiveUtr.length) payment.utr.push(...effectiveUtr);
      await payment.save({ session });
      await session.commitTransaction();
      session.endSession();
      return { payment, booking, applications: [] };
    }

    const effectiveUtr = Array.isArray(utr) ? utr.filter(Boolean) : utr ? [utr] : [];
    const effectivePaymentTime = paymentTime || new Date();
    const transactionRef = `CF-${orderId}`;

    const { applications, remainingToWallet, walletBalanceUsed } = await allocatePaymentOldestFirst(
      {
        patientId: booking.patient._id,
        patientDisplayId: booking.patient.patientId,
        patientName: booking.patient.name,
        amount: grossAmount,
        currentBookingId: booking._id,
        paymentTime: effectivePaymentTime,
        utr: effectiveUtr,
        paymentMethod: "cashfree",
        transactionRef,
        txnTypeForCurrentBooking: "full",
      },
      session,
      req
    );

    // Mirror the overall Cashfree order status onto the Payment record itself
    // (this Payment doc is what generateSessionId/UI checks for "already paid").
    const currentApp = applications.find(a => a.isCurrentBooking);
    payment.paymentTime = effectivePaymentTime;
    payment.paymentMethod = "cashfree";
    if (!Array.isArray(payment.utr)) payment.utr = [];
    if (effectiveUtr.length) payment.utr.push(...effectiveUtr);
    payment.amountPaid = (payment.amountPaid || 0) + (currentApp?.amountApplied || 0);
    const refreshedBookingForStatus = await Booking.findById(booking._id).session(session);
    const refreshedPaymentForStatus = await Payment.findById(payment._id).session(session);
    payment.status = refreshedPaymentForStatus.amountPaid >= (refreshedBookingForStatus.invoiceAmount || payment.amount)
      ? "paid"
      : (currentApp ? "partiallypaid" : payment.status);
    await payment.save({ session });

    await session.commitTransaction();
    session.endSession();

    return { payment, booking, applications, remainingToWallet, walletBalanceUsed };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

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
    const { paymentId } = req.body;

    try {
      if (!paymentId) {
        return res.status(400).json({ error: "paymentId is required in the body" });
      }

      // Fetch Payment
      const payment = await Payment.findOne({ paymentId });
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }

      // Early exit: already PAID
      if (payment.status && payment.status.toLowerCase() === "paid") {
        return res.status(200).json({
          message: "Payment has already been completed for this paymentId.",
          alreadyPaid: true,
          paymentId: payment.paymentId,
          paymentDbId: payment._id,
          cashfree: payment.cashfree || null
        });
      }

      // Fetch associated booking and deeply populate discountInfo.coupon and patient
      const booking = await Booking.findOne({ payment: payment._id })
        .populate({
          path: 'patient',
          model: PatientProfile,
        })
        .populate({
          path: 'discountInfo.coupon',
          model: "Discount"
        })
        .populate({
          path: 'package'
        });

      let patient = null;
      if (booking && booking.patient) {
        patient = await PatientProfile.findById(booking.patient._id || booking.patient);
      }

      // Calculate invoiceOriginal (before any discount)
      let invoiceOriginal = (payment.totalAmount != null)
        ? payment.totalAmount
        : (booking && booking.package && typeof booking.package.price === "number"
            ? booking.package.price
            : booking && booking.totalAmount != null
                ? booking.totalAmount
                : payment.amount
          );

      // ---- DISCOUNT RESOLUTION LOGIC ----
      // Try to get discount from booking.discountInfo.coupon if available and enabled
      let discountAmount = 0;
      if (
        booking &&
        booking.discountInfo &&
        booking.discountInfo.coupon &&
        booking.discountInfo.coupon.discountEnabled === true &&
        typeof booking.discountInfo.coupon.discount === "number" &&
        booking.discountInfo.coupon.discount > 0
      ) {
        // Percentage-based discount (as per discount.schema.js)
        discountAmount = Math.floor(
          invoiceOriginal * (booking.discountInfo.coupon.discount / 100)
        );
      } else if (
        booking &&
        booking.discountInfo &&
        typeof booking.discountInfo.discountAmount === "number" &&
        booking.discountInfo.discountAmount > 0
      ) {
        discountAmount = booking.discountInfo.discountAmount;
      } else if (
        payment.discountInfo &&
        typeof payment.discountInfo.amount === "number" &&
        payment.discountInfo.amount > 0
      ) {
        discountAmount = payment.discountInfo.amount;
      }

      let invoiceAfterDiscount =
        invoiceOriginal != null
          ? Math.max(0, Math.round(invoiceOriginal - discountAmount))
          : null;

      let totalPaid = 0;
      // payment.amountPaid may represent what has been paid (partial payments)
      if (payment.amountPaid && !isNaN(payment.amountPaid)) {
        totalPaid = Number(payment.amountPaid);
      }
      // Ensure not to double-count in case of partial payments; only count for this Payment, not all payments

      let dueAmount = invoiceAfterDiscount != null ? invoiceAfterDiscount - totalPaid : null;
      if (dueAmount != null) dueAmount = Math.max(0, Math.round(dueAmount));

      if (dueAmount === 0) {
        return res.status(200).json({
          message: "Nothing due for this paymentId (already paid or overpaid).",
          alreadyPaid: true,
          dueAmount: dueAmount,
          paymentId: payment.paymentId,
          paymentDbId: payment._id,
          cashfree: payment.cashfree || null
        });
      }

      // Always generate a new unique orderId for Cashfree
      const orderId = await this.generateOrderId();
      const amount = dueAmount;
      const remark = payment.remark || (booking
        ? `Online payment initiated for appointment ${booking.appointmentId}`
        : `Manual payment`);

      // Gather customer data
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
        customer_name = booking.patient.name || '';
        customer_phone = booking.patient.mobile1 || '';
        customer_email = booking.patient.parentEmail || '';
        customer_id = booking.patient.patientId || `guest-${orderId}`;
      } else {
        customer_id = `guest-${orderId}`;
      }

      // Compose order payload for due amount
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
          return_url: "https://api.nupalcdc.com/api/cashfree/booking-payment-webhook",
          notify_url: "https://api.nupalcdc.com/api/cashfree/booking-payment-webhook"
        }
      };

      const response = await CashfreePG.PGCreateOrder("2023-08-01", request);

      // Save to payment.cashfree block in schema (override on session create)
      if (response?.data) {
        const cashfreeDetails = {
          cf_order_id: response.data.cf_order_id || response.data.order_id || null,
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
            return_url: request.order_meta && request.order_meta.return_url || "",
            notify_url: request.order_meta && request.order_meta.notify_url || "",
          }
        };

        payment.cashfree = cashfreeDetails;
        await payment.save();
      }

      res.status(200).json({
        ...response.data,
        paymentId: payment.paymentId,
        orderId: orderId,
        paymentDbId: payment._id,
        bookingId: booking?._id,
        invoiceOriginal,
        discountAmount,
        invoiceAfterDiscount,
        totalPaid,
        dueAmount
      });
    } catch (error) {
      // Keep this error log as it is general error handling,
      // but remove all other detailed logs per instruction above
      console.error("Error creating Cashfree order", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };

  // Handler to confirm order status with Cashfree
 
  // confirmStatus = async (req, res) => {
  //   const { order_id } = req.params;

  //   if (!order_id) {
  //     return res.status(400).json({ error: "order_id is required in the URL params" });
  //   }

  //   const headers = {
  //     "accept": "application/json",
  //     "x-api-version": "2025-01-01",
  //     "x-client-id": process.env.CASHFREE_CLIENT_ID,
  //     "x-client-secret": process.env.CASHFREE_CLIENT_SECRET
  //   };

  //   try {
  //     const url = `https://api.cashfree.com/pg/orders/${order_id}`;
  //     const response = await fetch(url, { method: "GET", headers });
  //     const data = await response.json();

  //     if (!response.ok) {
  //       return res.status(response.status).json({
  //         error: data?.message || "Failed to fetch order status from Cashfree",
  //         details: data
  //       });
  //     }

  //     // Import models
  //     const Payment = (await import('../../Schema/payment.schema.js')).default;
  //     const Finances = (await import('../../Schema/finances.schema.js')).default;

  //     // Find payment by cashfree.order_id
  //     const payment = await Payment.findOne({ 'cashfree.order_id': order_id });

  //     let financeRecord = null;

  //     if (payment && data?.order_status) {
  //       // 'PAID' → create the finances record directly (never check existence)
  //       switch (data.order_status) {
  //         case 'PAID': {
  //           payment.status = 'paid';
  //           payment.amountPaid = data.order_amount || payment.amountPaid || 0;
  //           payment.paymentTime = data.payment_time ? new Date(data.payment_time) : new Date();

  //           // Gather childrenName / childrenId from cashfree.customer
  //           const childrenName = payment.childrenName || payment.cashfree?.customer?.name || undefined;
  //           const childrenId = payment.childrenId || payment.cashfree?.customer?.customer_id || undefined;

  //           // Booking display id (e.g. B00095) parsed from order_note, fallback to cashfree order_id
  //           let bookingDisplayId = order_id;
  //           const noteMatch = data?.order_note?.match(/\b([A-Z]\d{5,})\b/);
  //           if (noteMatch) {
  //             bookingDisplayId = noteMatch[1];
  //           }

  //           const description = payment.remark || `Cashfree Payment for Booking ${bookingDisplayId}`;

  //           financeRecord = await Finances.create({
  //             date: payment.paymentTime || new Date(),
  //             description,
  //             type: 'income',
  //             amount: payment.amountPaid || payment.amount,
  //             creditDebitStatus: 'credited',
  //             paymentMethod: 'cashfree',
  //             utr: payment.utr && payment.utr.length ? payment.utr : [order_id],
  //             childrenName,
  //             childrenId
  //           });
  //           break;
  //         }
  //         case 'FAILED':
  //           payment.status = 'failed';
  //           break;
  //         case 'EXPIRED':
  //           payment.status = 'failed';
  //           break;
  //         case 'ACTIVE':
  //           payment.status = 'pending';
  //           break;
  //         default:
  //           break;
  //       }
  //       // always update latest cashfree details
  //       payment.cashfree = {
  //         ...(payment.cashfree || {}),
  //         ...data,
  //       };
  //       await payment.save();
  //     }

  //     return res.status(200).json({
  //       orderStatus: data,
  //       paymentStatusMarked: payment ? payment.status : null,
  //       financeRecord: financeRecord
  //         ? {
  //           _id: financeRecord._id,
  //           amount: financeRecord.amount,
  //           type: financeRecord.type,
  //           date: financeRecord.date,
  //           paymentMethod: financeRecord.paymentMethod
  //         }
  //         : null
  //     });
  //   } catch (error) {
  //     console.error("Error confirming Cashfree order status:", error);
  //     return res.status(500).json({ error: "Internal Server Error" });
  //   }
  // };

  confirmStatus = async (req, res) => {
    const { order_id } = req.params;
  
    if (!order_id) {
      return res.status(400).json({ error: "order_id is required in the URL params" });
    }
  
    const headers = {
      "accept": "application/json",
      "x-api-version": "2025-01-01",
      "x-client-id": process.env.CASHFREE_CLIENT_ID,
      "x-client-secret": process.env.CASHFREE_CLIENT_SECRET
    };
  
    try {
      const url = `https://api.cashfree.com/pg/orders/${order_id}`;
      const response = await fetch(url, { method: "GET", headers });
      const data = await response.json();
  
      if (!response.ok) {
        return res.status(response.status).json({
          error: data?.message || "Failed to fetch order status from Cashfree",
          details: data
        });
      }
  
      const payment = await Payment.findOne({ 'cashfree.order_id': order_id });
      let result = null;

      if (payment && data?.order_status === 'PAID') {
        const paidAmount = data.order_amount || payment.amountPaid || 0;
        result = await applyCashfreePaymentSuccess(
          {
            orderId: order_id,
            grossAmount: paidAmount,
            paymentTime: data.payment_time ? new Date(data.payment_time) : new Date(),
            utr: [order_id],
            remarkPrefix: payment.remark || 'Cashfree Payment',
          },
          req
        );
      } else if (payment && data?.order_status) {
        // Non-success terminal/intermediate states don't touch invoices/wallet,
        // just mirror Cashfree's status onto the Payment record.
        switch (data.order_status) {
          case 'FAILED':
          case 'EXPIRED':
            payment.status = 'failed';
            break;
          case 'ACTIVE':
            payment.status = 'pending';
            break;
          default:
            break;
        }
        payment.cashfree = { ...(payment.cashfree || {}), ...data };
        await payment.save();
      }

      const finalPayment = result?.payment || payment;

      // in confirmStatus:
return res.status(200).json({
  orderStatus: data,
  paymentStatusMarked: finalPayment ? finalPayment.status : null,
  appliedAcrossBookings: result?.applications || [],
  remainingToWallet: result?.remainingToWallet || 0,
});

      // return res.status(200).json({
      //   orderStatus: data,
      //   paymentStatusMarked: finalPayment ? finalPayment.status : null,
      //   appliedToOtherBookings: result?.sweepResults || [],
      //   financeRecord: result?.financeRecord
      //     ? {
      //       _id: result.financeRecord._id,
      //       amount: result.financeRecord.amount,
      //       type: result.financeRecord.type,
      //       date: result.financeRecord.date,
      //       paymentMethod: result.financeRecord.paymentMethod
      //     }
      //     : null
      // });
    } catch (error) {
      console.error("Error confirming Cashfree order status:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };
  // Handler for Cashfree Webhook (called by Cashfree for status update)
  // handleWebhook = async (req, res) => {
  //   console.log("Cashfree Webhook: Started");
  //   try {
  //     // Cashfree webhook data is in req.body
  //     const body = req.body;
  //     const order_id = body?.data?.order?.order_id;
  //     const payment_status = body?.data?.payment?.payment_status;
  //     const transaction_amount = Number(body?.data?.payment?.payment_amount || 0);
  //     const payment_time = body?.data?.payment?.payment_time
  //       ? new Date(body.data.payment.payment_time)
  //       : new Date();

  //     // NOTE: Here, we can't link Cashfree's order_id to our Payment record directly anymore,
  //     // unless orderId is stored in Payment for cross-reference at order creation.
  //     // If NOT stored, you need to map order_id -> paymentId in some other way.
  //     // Here, still trying with paymentId=order_id for backward-compatibility/fallback.

  //     // Find the payment based on Cashfree order_id (not our paymentId)
  //     const payment = await Payment.findOne({ "cashfree.order_id": order_id });
  //     if (!payment) {
  //       console.warn("Payment not found for cashfree order_id", order_id);
  //       return res.status(404).send("Payment record not found");
  //     }

  //     if (payment_status === "SUCCESS") {
  //       payment.status = "paid";
  //       payment.amountPaid = transaction_amount;
  //       payment.paymentTime = payment_time;
  //       await payment.save();

  //       // Link back to booking (if any): update status, etc.
  //       const booking = await Booking.findOne({ payment: payment._id });
  //       if (booking) {
  //         // Optionally update booking state
  //         // E.g. booking.status = "paid"; (if you have such field)
  //         await booking.save();
  //       }
  //       console.log(`Payment ${order_id}: marked as paid`);
  //     } else if (payment_status === "FAILED") {
  //       payment.status = "failed";
  //       await payment.save();
  //       console.log(`Payment ${order_id}: marked as failed`);
  //     } else {
  //       // Possibly handle pending/partiallypaid/etc. cases
  //       payment.status = payment_status.toLowerCase();
  //       await payment.save();
  //       console.log(`Payment ${order_id}: updated status ${payment_status}`);
  //     }

  //     res.status(200).send("Webhook processed successfully");
  //   } catch (error) {
  //     console.error("Error handling Cashfree webhook", error);
  //     res.status(500).json({ error: "Internal Server Error" });
  //   }
  // };

  handleWebhook = async (req, res) => {
    console.log("Cashfree Webhook: Started");
    try {
      const body = req.body;
      const order_id = body?.data?.order?.order_id;
      const payment_status = body?.data?.payment?.payment_status;
      const transaction_amount = Number(body?.data?.payment?.payment_amount || 0);
      const payment_time = body?.data?.payment?.payment_time
        ? new Date(body.data.payment.payment_time)
        : new Date();
      const cf_payment_id = body?.data?.payment?.cf_payment_id;
  
      const payment = await Payment.findOne({ "cashfree.order_id": order_id });
      if (!payment) {
        console.warn("Payment not found for cashfree order_id", order_id);
        return res.status(404).send("Payment record not found");
      }
  
      if (payment_status === "SUCCESS") {
        // Same shared path confirmStatus uses — clamps to invoice due, credits
        // overflow to wallet, sweeps other bookings' dues, creates the Finances
        // row (previously missing here entirely), and is idempotent against
        // confirmStatus/webhook firing twice for the same order.
        const result = await applyCashfreePaymentSuccess(
          {
            orderId: order_id,
            grossAmount: transaction_amount,
            paymentTime: payment_time,
            utr: cf_payment_id ? [String(cf_payment_id)] : [order_id],
            remarkPrefix: `Cashfree webhook payment`,
          },
          req
        );
      // in handleWebhook, the log line:
console.log(
  result?.alreadyProcessed
    ? `Payment ${order_id}: already processed, skipped`
    : `Payment ${order_id}: applied across ${result?.applications?.length || 0} booking(s)`
);
      } else if (payment_status === "FAILED") {
        payment.status = "failed";
        await payment.save();
        console.log(`Payment ${order_id}: marked as failed`);
      } else {
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