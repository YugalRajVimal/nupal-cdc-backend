import mongoose from 'mongoose';
const { Schema } = mongoose;

// Embedded block for Cashfree session/order linkage
const CashfreeSchema = new Schema({
  cf_order_id: { type: String }, // Cashfree's order_id (opaque, required for refunds/webhooks)
  order_id:    { type: String }, // Your unique order id sent TO cashfree (required for mapping)
  payment_session_id: { type: String }, // Provided by Cashfree (session supports retries)
  order_status: { 
    type: String,
    enum: ['ACTIVE', 'PAID', 'EXPIRED', 'FAILED'],
  },
  order_amount: Number,
  order_currency: String,
  order_note: String,
  order_expiry_time: Date,
  created_at: Date, // 'created_at' of Cashfree order (not mongo _id)
  customer: {
    customer_id: String,
    name: String,
    email: String,
    phone: String
  },
  order_meta: {
    return_url: String,
    notify_url: String,
  }
}, { _id: false });

const PaymentSchema = new Schema({
  paymentId: {
    type: String,
    required: true,
    unique: true, // Your business-side payment ID (INV-2026-001)
  },
  totalAmount: {
    type: Number,
    required: true, // Undiscounted total
  },
  discountInfo: {
    code: { type: String, default: null },
    percent: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
  },
  amount: {
    type: Number,
    required: true,
  },
  amountPaid: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'partiallypaid', 'paid', 'failed', 'refunded'],
    default: 'pending',
  },
  paymentTime: { type: Date },
  paymentMethod: {
    type: String,
    enum: ['cashfree', 'online', 'cash'],
    required: true,
  },
  utr: { type: [String], default: [] },
  remark: { type: String },

  // --- Cashfree critical bridge block (do not remove) ---
  cashfree: { type: CashfreeSchema, default: undefined }
}, { timestamps: true });

const Payment = mongoose.model('Payment', PaymentSchema);

export default Payment;
