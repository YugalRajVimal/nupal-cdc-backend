/**
 * backfill_payment_transactions.js
 *
 * One-time script: populates payment.transactions[] for old Payment docs
 * that don't have any, using the matching Finances records (joined via Booking).
 *
 * Usage:
 *   node backfill_payment_transactions.js            (dry run, no writes)
 *   node backfill_payment_transactions.js --commit    (actually writes)
 */

import mongoose from "mongoose";
import Payment from "../Schema/payment.schema.js";
import Booking from "../Schema/booking.schema.js";
import Finances from "../Schema/finances.schema.js";

const MONGO_URI = process.env.MONGODB_URI || "";
const COMMIT = process.argv.includes("--commit");

const typeFromAmount = (amount, invoiceAmount) => {
  if (typeof invoiceAmount === "number" && invoiceAmount > 0 && amount >= invoiceAmount) {
    return "full";
  }
  return "partial";
};

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected. Mode: ${COMMIT ? "COMMIT (writing)" : "DRY RUN (no writes)"}`);

  // Only touch payments that have no transactions yet
  const payments = await Payment.find({
    $or: [
      { transactions: { $exists: false } },
      { transactions: { $size: 0 } },
    ],
  });

  console.log(`Found ${payments.length} payments with no transactions.`);

  let updatedCount = 0;
  let skippedNoBooking = 0;
  let skippedNoFinance = 0;
  let mismatchWarnings = [];

  for (const payment of payments) {
    // A payment can be linked from Booking.payment -> find the booking(s) using it
    const bookings = await Booking.find({ payment: payment._id }).select("_id appointmentId invoiceAmount");

    if (!bookings.length) {
      skippedNoBooking++;
      continue;
    }

    const bookingIds = bookings.map((b) => b._id);

    const financeRecords = await Finances.find({ booking: { $in: bookingIds } }).sort({ date: 1 });

    if (!financeRecords.length) {
      skippedNoFinance++;
      continue;
    }

    const invoiceAmount = bookings[0]?.invoiceAmount;

    const transactions = financeRecords.map((f) => ({
      amount: f.amount,
      paymentMethod: f.paymentMethod,
      utr: Array.isArray(f.utr) ? f.utr : (f.utr ? [f.utr] : []),
      paymentTime: f.date,
      type: typeFromAmount(f.amount, invoiceAmount),
      remark: f.description,
      financeRecord: f._id,
    }));

    // Sanity check: sum of finance amounts vs payment.amountPaid
    const financeSum = financeRecords.reduce((sum, f) => sum + (f.amount || 0), 0);
    if (payment.amountPaid != null && Math.abs(financeSum - payment.amountPaid) > 1) {
      mismatchWarnings.push({
        paymentId: payment.paymentId || payment._id.toString(),
        amountPaid: payment.amountPaid,
        financeSum,
        financeCount: financeRecords.length,
      });
    }

    if (COMMIT) {
      payment.transactions = transactions;
      await payment.save();
    }

    updatedCount++;
  }

  console.log("---- Summary ----");
  console.log(`Payments updated${COMMIT ? "" : " (would update)"}: ${updatedCount}`);
  console.log(`Skipped (no booking found): ${skippedNoBooking}`);
  console.log(`Skipped (no finance records found): ${skippedNoFinance}`);

  if (mismatchWarnings.length) {
    console.log(`\n⚠️  ${mismatchWarnings.length} payments where sum(finance amounts) != payment.amountPaid:`);
    mismatchWarnings.forEach((w) =>
      console.log(
        `   paymentId=${w.paymentId} amountPaid=${w.amountPaid} financeSum=${w.financeSum} (${w.financeCount} records)`
      )
    );
    console.log("   These were still backfilled from Finances, but worth a manual spot-check.");
  }

  await mongoose.disconnect();
  console.log("Done.");
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});