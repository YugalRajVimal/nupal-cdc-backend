import mongoose from 'mongoose';
const { Schema } = mongoose;

const PaymentSchema = new Schema({
  paymentId: {
    type: String,
    required: true,
    unique: true, // Unique, human-readable ID (INV-2026-001)
  },
  totalAmount: {
    type: Number,
    required: true, // Total (undiscounted) amount before discounts
  },
  discountInfo: {
    code: { type: String, default: null },        // Discount/coupon code used, if any
    percent: { type: Number, default: 0 },        // Discount value, e.g., 10 (for 10%)
    amount: { type: Number, default: 0 },         // Actual discount amount (currency)
  },
  amount: {
    type: Number,
    required: true, // Final payment amount after discount
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending', // Payment status
  },
  paymentTime: {
    type: Date, // When payment was completed
  },
  paymentMethod: {
    type: String,
    enum: ['card', 'upi', 'netbanking', 'cash', 'wallet'],
    required: true, // Payment method
  },
  remark: {
    type: String,
  }
}, { timestamps: true });

const Payment = mongoose.model('Payment', PaymentSchema);

export default Payment;
