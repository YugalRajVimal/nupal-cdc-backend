// scripts/backfill-invoice-wallet.js
//
// One-time script: computes `invoiceAmount` for every EXISTING booking based
// on its own package + discount + current count of CheckedIn sessions.
//
// This does NOT touch payment.amountPaid, does NOT create any wallet
// transactions, and does NOT touch booking.sessions in any way. It only sets
// the new `invoiceAmount` field so old bookings are consistent with the new
// running-invoice model going forward.
//
// Run once: `node scripts/backfill-invoice-wallet.js`
// Safe to re-run — it's idempotent (recomputes from source data each time).

import mongoose from "mongoose";
import dotenv from "dotenv";
import Booking from "../Schema/booking.schema.js";
import Package from "../Schema/packages.schema.js";
import DiscountModel from "../Schema/discount.schema.js";
import { getPerSessionRate } from "../Services/wallet.services.js";

dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("[backfill] Connected to DB");

  const bookings = await Booking.find({}).lean();
  console.log(`[backfill] Found ${bookings.length} bookings`);

  // Cache packages & discounts to avoid refetching per booking
  const packageCache = new Map();
  const discountCache = new Map();

  let updated = 0;
  let skipped = 0;

  for (const booking of bookings) {
    try {
      if (!booking.package) {
        skipped++;
        continue;
      }

      const pkgId = String(booking.package);
      if (!packageCache.has(pkgId)) {
        packageCache.set(pkgId, await Package.findById(booking.package).lean());
      }
      const pkg = packageCache.get(pkgId);
      if (!pkg) {
        skipped++;
        continue;
      }

      let discountPercent = 0;
      if (booking.discountInfo && booking.discountInfo.coupon) {
        const couponId = String(booking.discountInfo.coupon);
        if (!discountCache.has(couponId)) {
          discountCache.set(couponId, await DiscountModel.findById(booking.discountInfo.coupon).lean());
        }
        const coupon = discountCache.get(couponId);
        if (coupon && typeof coupon.discount === "number") {
          discountPercent = coupon.discount;
        }
      }

      const perSessionRate = getPerSessionRate(pkg, discountPercent);
      const checkedInCount = Array.isArray(booking.sessions)
        ? booking.sessions.filter((s) => s.status === "CheckedIn").length
        : 0;

      const invoiceAmount = perSessionRate * checkedInCount;

      await Booking.updateOne(
        { _id: booking._id },
        { $set: { invoiceAmount } }
      );
      updated++;
    } catch (err) {
      console.error(`[backfill] Failed for booking ${booking._id}:`, err.message);
      skipped++;
    }
  }

  console.log(`[backfill] Done. Updated: ${updated}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});