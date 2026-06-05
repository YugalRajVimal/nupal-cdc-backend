import mongoose from 'mongoose';
const { Schema } = mongoose;

const FinancesSchema = new Schema({
    date: {
        type: Date,
        required: true,
        default: Date.now
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['income', 'expense'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    creditDebitStatus: {
        type: String,
        enum: ['credited', 'debited'],
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['cashfree', 'online', 'cash'],
        required: true,
      },
      utr: { type: [String], default: [] },
}, { timestamps: true });

const Finances = mongoose.model("Finances", FinancesSchema);

export default Finances;
