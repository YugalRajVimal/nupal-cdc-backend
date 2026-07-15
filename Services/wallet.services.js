// Services/wallet.service.js
import Wallet from "../Schema/wallet.schema.js";

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
 * Effective per-session billing rate for a booking, given its package + discount.
 * costPerSession * (1 - discountPercent/100)
 */
export function getPerSessionRate(pkg, discountPercent) {
  if (!pkg) return 0;
  const base = pkg.costPerSession || (pkg.totalCost && pkg.sessionCount ? pkg.totalCost / pkg.sessionCount : 0);
  const pct = typeof discountPercent === 'number' ? discountPercent : 0;
  return Math.round(base * (1 - pct / 100));
}