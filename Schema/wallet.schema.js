// Schema/wallet.schema.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const WalletTransactionSchema = new Schema({
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true },
  reason: {
    type: String,
    enum: [
      'advance_payment',          // client overpaid -> credited to wallet
      'session_checkin_debit',    // wallet auto-applied to cover a new checked-in session
      'checkin_reversal_credit',  // undo check-in -> reverses the debit above
      'due_settlement_debit',     // NEW: wallet auto-applied to pay down a DIFFERENT booking's due
      'manual_adjustment'
    ],
    required: true
  },
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  sessionId: { type: String }, // links a debit to the exact session (booking.sessions[i]._id as string)
  balanceAfter: { type: Number, required: true },
  remark: { type: String, default: '' },
}, { timestamps: true });

const WalletSchema = new Schema({
  patient: { type: Schema.Types.ObjectId, ref: 'PatientProfile', required: true, unique: true },
  balance: { type: Number, default: 0 },
  transactions: [WalletTransactionSchema],
}, { timestamps: true });

const Wallet = mongoose.model('Wallet', WalletSchema);
export default Wallet;