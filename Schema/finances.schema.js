// import mongoose from 'mongoose';
// const { Schema } = mongoose;

// const FinancesSchema = new Schema({
//     date: {
//         type: Date,
//         required: true,
//         default: Date.now
//     },
//     description: {
//         type: String,
//         required: true,
//         trim: true
//     },
//     type: {
//         type: String,
//         enum: ['income', 'expense'],
//         required: true
//     },
//     amount: {
//         type: Number,
//         required: true
//     },
//     creditDebitStatus: {
//         type: String,
//         enum: ['credited', 'debited'],
//         required: true
//     },
//     paymentMethod: {
//         type: String,
//         enum: ['cashfree', 'online', 'cash','wallet'],
//         required: true,
//     },
//     utr: { 
//         type: [String], 
//         default: [] 
//     },
//     childrenName: {
//         type: String,
//         trim: true
//     },
//     childrenId: {
//         type: String,
//         trim: true
//     },
//     booking: {
//         type: Schema.Types.ObjectId,
//         ref: 'Booking'
//     },
// }, { timestamps: true });

// const Finances = mongoose.model("Finances", FinancesSchema);

// export default Finances;


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
        enum: ['cashfree', 'online', 'cash','wallet'],
        required: true,
    },
    utr: { 
        type: [String], 
        default: [] 
    },
    childrenName: {
        type: String,
        trim: true
    },
    childrenId: {
        type: String,
        trim: true
    },
    booking: {
        type: Schema.Types.ObjectId,
        ref: 'Booking'
    },
    // Groups multiple Finances rows that came from ONE payment collection action
    // (e.g. Rs.10,000 collected, Rs.6,000 applied to this booking, Rs.4,000 swept
    // to clear a due on another booking). All rows sharing a transactionRef were
    // part of the same real-world payment and should be shown together in the UI.
    transactionRef: {
        type: String,
        index: true
    },
}, { timestamps: true });

const Finances = mongoose.model("Finances", FinancesSchema);

export default Finances;