import mongoose from 'mongoose';

const discountSchema = new mongoose.Schema({
  discountEnabled: {
    type: Boolean,
    default: false
  },
  discount: {
    type: Number,
    min: 0,
    max: 100
  },
  couponCode: {
    type: String,
    required: true,
    unique: true
  },
  validityDays: {
    type: Number,
    min: 1,
    default: 1
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // Optionally, associate coupon with patient, booking, or package, etc.
  // patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
  // bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }
});

const DiscountModel = mongoose.model("Discount", discountSchema);
export default DiscountModel;
