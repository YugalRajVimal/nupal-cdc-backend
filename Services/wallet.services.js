// // Services/wallet.service.js
// import Wallet from "../Schema/wallet.schema.js";

// /**
//  * Fetch a patient's wallet, creating an empty one if it doesn't exist yet.
//  * Must be called with a mongoose transaction session when used inside a tx.
//  */
// export async function getOrCreateWallet(patientId, session) {
//   let wallet = await Wallet.findOne({ patient: patientId }).session(session);
//   if (!wallet) {
//     const created = await Wallet.create([{ patient: patientId, balance: 0, transactions: [] }], { session });
//     wallet = created[0];
//   }
//   return wallet;
// }

// /**
//  * Credit (add money to) a patient's wallet. Returns the updated wallet.
//  */
// export async function creditWallet({ patientId, amount, reason, booking, sessionId, remark }, session) {
//   if (!amount || amount <= 0) return getOrCreateWallet(patientId, session);
//   const wallet = await getOrCreateWallet(patientId, session);
//   wallet.balance += amount;
//   wallet.transactions.push({
//     type: 'credit',
//     amount,
//     reason,
//     booking: booking || undefined,
//     sessionId: sessionId || undefined,
//     balanceAfter: wallet.balance,
//     remark: remark || '',
//   });
//   await wallet.save({ session });
//   return wallet;
// }

// /**
//  * Debit (spend from) a patient's wallet, clamped to whatever balance is available.
//  * Returns { wallet, amountDebited } — amountDebited may be less than requested
//  * if the wallet didn't have enough.
//  */
// export async function debitWallet({ patientId, amount, reason, booking, sessionId, remark }, session) {
//   const wallet = await getOrCreateWallet(patientId, session);
//   const amountDebited = Math.min(amount, wallet.balance);
//   if (amountDebited <= 0) return { wallet, amountDebited: 0 };

//   wallet.balance -= amountDebited;
//   wallet.transactions.push({
//     type: 'debit',
//     amount: amountDebited,
//     reason,
//     booking: booking || undefined,
//     sessionId: sessionId || undefined,
//     balanceAfter: wallet.balance,
//     remark: remark || '',
//   });
//   await wallet.save({ session });
//   return { wallet, amountDebited };
// }

// /**
//  * Find a specific session_checkin_debit transaction for a given booking+sessionId,
//  * so it can be reversed exactly (used by markSessionNotCheckedIn).
//  * Returns the transaction subdocument or null.
//  */
// export async function findCheckinDebitTransaction(patientId, bookingId, sessionId, session) {
//   const wallet = await Wallet.findOne({ patient: patientId }).session(session);
//   if (!wallet) return { wallet: null, txn: null };
//   const txn = wallet.transactions.find(
//     (t) =>
//       t.reason === 'session_checkin_debit' &&
//       String(t.booking) === String(bookingId) &&
//       String(t.sessionId) === String(sessionId)
//   );
//   return { wallet, txn: txn || null };
// }

// /**
//  * Reverse a previously-applied checkin debit: credits the wallet back by the
//  * same amount and logs it as checkin_reversal_credit, referencing the original.
//  */
// export async function reverseCheckinDebit(wallet, txn, session) {
//   if (!wallet || !txn) return { amountReversed: 0 };
//   wallet.balance += txn.amount;
//   wallet.transactions.push({
//     type: 'credit',
//     amount: txn.amount,
//     reason: 'checkin_reversal_credit',
//     booking: txn.booking,
//     sessionId: txn.sessionId,
//     balanceAfter: wallet.balance,
//     remark: `Reversal of check-in debit`,
//   });
//   await wallet.save({ session });
//   return { amountReversed: txn.amount };
// }

// /**
//  * Effective per-session billing rate for a booking, given its package + discount.
//  * costPerSession * (1 - discountPercent/100)
//  */
// export function getPerSessionRate(pkg, discountPercent) {
//   if (!pkg) return 0;
//   const base = pkg.costPerSession || (pkg.totalCost && pkg.sessionCount ? pkg.totalCost / pkg.sessionCount : 0);
//   const pct = typeof discountPercent === 'number' ? discountPercent : 0;
//   return Math.round(base * (1 - pct / 100));
// }

// Services/wallet.service.js
import Wallet from "../Schema/wallet.schema.js";
import Booking from "../Schema/booking.schema.js";
import Finances from "../Schema/finances.schema.js";
import AuditLogService from "../Controllers/AuditLogs/audit-logs.controller.js";

/**
 * Fetch a patient's wallet, creating an empty one if it doesn't exist yet.
 * Must be called with a mongoose transaction session when used inside a tx.
 */
export async function getOrCreateWallet(patientId, session) {
  let wallet = await Wallet.findOne({ patient: patientId }).session(session);
  if (!wallet) {
    const created = await Wallet.create([{ patient: patientId, balance: 0, transactions: [] }], { session });
    wallet = created[0];
  }
  return wallet;
}

/**
 * Credit (add money to) a patient's wallet. Returns the updated wallet.
 */
export async function creditWallet({ patientId, amount, reason, booking, sessionId, remark }, session) {
  if (!amount || amount <= 0) return getOrCreateWallet(patientId, session);
  const wallet = await getOrCreateWallet(patientId, session);
  wallet.balance += amount;
  wallet.transactions.push({
    type: 'credit',
    amount,
    reason,
    booking: booking || undefined,
    sessionId: sessionId || undefined,
    balanceAfter: wallet.balance,
    remark: remark || '',
  });
  await wallet.save({ session });
  return wallet;
}

/**
 * Debit (spend from) a patient's wallet, clamped to whatever balance is available.
 * Returns { wallet, amountDebited } — amountDebited may be less than requested
 * if the wallet didn't have enough.
 */
export async function debitWallet({ patientId, amount, reason, booking, sessionId, remark }, session) {
  const wallet = await getOrCreateWallet(patientId, session);
  const amountDebited = Math.min(amount, wallet.balance);
  if (amountDebited <= 0) return { wallet, amountDebited: 0 };

  wallet.balance -= amountDebited;
  wallet.transactions.push({
    type: 'debit',
    amount: amountDebited,
    reason,
    booking: booking || undefined,
    sessionId: sessionId || undefined,
    balanceAfter: wallet.balance,
    remark: remark || '',
  });
  await wallet.save({ session });
  return { wallet, amountDebited };
}

/**
 * Find a specific session_checkin_debit transaction for a given booking+sessionId,
 * so it can be reversed exactly (used by markSessionNotCheckedIn).
 * Returns the transaction subdocument or null.
 */
export async function findCheckinDebitTransaction(patientId, bookingId, sessionId, session) {
  const wallet = await Wallet.findOne({ patient: patientId }).session(session);
  if (!wallet) return { wallet: null, txn: null };
  const txn = wallet.transactions.find(
    (t) =>
      t.reason === 'session_checkin_debit' &&
      String(t.booking) === String(bookingId) &&
      String(t.sessionId) === String(sessionId)
  );
  return { wallet, txn: txn || null };
}

/**
 * Reverse a previously-applied checkin debit: credits the wallet back by the
 * same amount and logs it as checkin_reversal_credit, referencing the original.
 */
export async function reverseCheckinDebit(wallet, txn, session) {
  if (!wallet || !txn) return { amountReversed: 0 };
  wallet.balance += txn.amount;
  wallet.transactions.push({
    type: 'credit',
    amount: txn.amount,
    reason: 'checkin_reversal_credit',
    booking: txn.booking,
    sessionId: txn.sessionId,
    balanceAfter: wallet.balance,
    remark: `Reversal of check-in debit`,
  });
  await wallet.save({ session });
  return { amountReversed: txn.amount };
}

/**
 * Sweep a patient's wallet balance across their OTHER bookings that still have
 * something due (oldest first), debiting the wallet and crediting each
 * booking's Payment/Booking + a matching Finances record.
 *
 * This is the ONE place "clear previous dues" logic lives — call it from
 * every payment-collection entry point (manual collectPayment, Cashfree
 * confirmStatus, Cashfree webhook, etc.) so behavior never drifts between them.
 *
 * @param {Object} opts
 * @param {ObjectId|string} opts.patientId
 * @param {string} [opts.patientDisplayId] - patient.patientId, for the Finances record
 * @param {string} [opts.patientName] - patient.name, for the Finances record
 * @param {ObjectId|string} opts.excludeBookingId - booking the money was originally collected against
 * @param {Date} [opts.paymentTime] - use the SAME timestamp as the triggering payment
 *        (falls back to now if not given) so both Finances rows show one date.
 * @param {string[]} [opts.utr] - the SAME utr(s) as the triggering payment, so both
 *        Finances rows show the same UTR instead of the sweep row being blank.
 * @param {string} [opts.paymentMethod] - payment method of the triggering payment
 *        (falls back to 'wallet' if not given).
 * @param {string} [opts.transactionRef] - a shared reference id so the UI can group
 *        "one payment split across N bookings" together (see finances.schema.js).
 * @param {mongoose.ClientSession} session
 * @param {Object} [req] - for audit log ip/user-agent/user, optional
 */
export async function sweepWalletToOtherDues(
  {
    patientId,
    patientDisplayId,
    patientName,
    excludeBookingId,
    paymentTime,
    utr,
    paymentMethod,
    transactionRef,
  },
  session,
  req
) {
  const applied = [];
  if (!patientId) return applied;

  const effectiveDate = paymentTime || new Date();
  const effectiveUtr = Array.isArray(utr) ? utr : utr ? [utr] : [];
  const effectivePaymentMethod = paymentMethod || "wallet";

  // Find this patient's other bookings that still have something due.
  const otherBookings = await Booking.find({
    patient: patientId,
    _id: { $ne: excludeBookingId },
  })
    .populate({ path: "payment", model: "Payment" })
    .sort({ createdAt: 1 }) // oldest booking's due gets settled first
    .session(session);

  for (const otherBooking of otherBookings) {
    // Re-check wallet balance fresh each iteration since debitWallet mutates it.
    const wallet = await getOrCreateWallet(patientId, session);
    if (!wallet || wallet.balance <= 0) break;

    const otherPayment = otherBooking.payment;
    if (!otherPayment) continue;

    const invoiceAmount = otherBooking.invoiceAmount || 0;
    const alreadyPaid = otherPayment.amountPaid || 0;
    const due = Math.max(0, invoiceAmount - alreadyPaid);
    if (due <= 0) continue;

    const { amountDebited } = await debitWallet(
      {
        patientId,
        amount: due,
        reason: "due_settlement_debit",
        booking: otherBooking._id,
        remark: `Auto-applied from wallet advance to settle due on Booking #${otherBooking.appointmentId}`,
      },
      session
    );
    if (amountDebited <= 0) continue;

    // Update the OTHER booking's payment record
    otherPayment.amountPaid = alreadyPaid + amountDebited;
    otherPayment.status = otherPayment.amountPaid >= invoiceAmount ? "paid" : "partiallypaid";
    // Keep the same UTR(s) visible on the payment that actually received the money,
    // not just on the Finances row, so the payment record and Finances agree.
    if (effectiveUtr.length) {
      if (!Array.isArray(otherPayment.utr)) otherPayment.utr = [];
      otherPayment.utr.push(...effectiveUtr);
    }
    await otherPayment.save({ session });

    otherBooking.paymentStatus = otherPayment.status;
    await otherBooking.save({ session });

    // Finance record for this settlement — SAME date + SAME utr as the
    // triggering payment, so both rows in Finances read as one transaction.
    const [financeRecord] = await Finances.create(
      [
        {
          date: effectiveDate,
          description: `Wallet advance applied to Booking #${otherBooking.appointmentId} (due settlement)`,
          type: "income",
          amount: amountDebited,
          creditDebitStatus: "credited",
          paymentMethod: effectivePaymentMethod,
          utr: effectiveUtr,
          childrenName: patientName || "",
          childrenId: patientDisplayId || "",
          booking: otherBooking._id,
          ...(transactionRef ? { transactionRef } : {}),
        },
      ],
      { session }
    );

    // Audit log (best-effort — do not fail the whole sweep if logging fails)
    try {
      await AuditLogService.addLog(
        {
          action: "BOOKING_PAYMENT_UPDATE",
          user: req?.user?.id,
          role: "admin",
          resource: "Booking",
          resourceId: otherBooking._id,
          details: {
            patientId,
            appointmentId: otherBooking.appointmentId,
            message: `Wallet advance auto-applied to settle due of Rs.${amountDebited} on Booking #${otherBooking.appointmentId}.`,
            amountApplied: amountDebited,
            source: "wallet_sweep",
          },
          ipAddress: req?.ip,
          userAgent: req?.headers?.["user-agent"],
        },
        session
      );
    } catch (logErr) {
      console.error("[sweepWalletToOtherDues] Audit log failed (non-fatal):", logErr);
    }

    applied.push({
      bookingId: otherBooking._id,
      appointmentId: otherBooking.appointmentId,
      amountApplied: amountDebited,
      financeRecordId: financeRecord?._id,
    });
  }

  return applied;
}

/**
 * Effective per-session billing rate for a booking, given its package + discount.
 * costPerSession * (1 - discountPercent/100)
 */
export function getPerSessionRate(pkg, discountPercent) {
  if (!pkg) return 0;
  const base = pkg.costPerSession || (pkg.totalCost && pkg.sessionCount ? pkg.totalCost / pkg.sessionCount : 0);
  const pct = typeof discountPercent === 'number' ? discountPercent : 0;
  return Math.round(base * (1 - pct / 100));
}