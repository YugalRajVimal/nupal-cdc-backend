import mongoose from 'mongoose';
const { Schema } = mongoose;

const SessionSchema = new Schema({
  date: { type: String, required: true },
  time: { type: String, required: false },
  slotId: { type: String, required: true },

  // add more fields as needed
});

const BookingSchema = new Schema({
  appointmentId:{
    type: String, 
    required: true 
  },
  discountInfo: {
    couponCode: { type: String },
    discount: { type: Number, default: 0 },
    discountEnabled: { type: Boolean, default: false },
    validityDays: { type: Number, default: 1 },
    dateFrom: { type: Date }
  },
  package: { 
    type: Schema.Types.ObjectId, 
    ref: 'Package', 
    required: true 
  },
  patient: { 
    type: Schema.Types.ObjectId, 
    ref: 'Patient', 
    required: true 
  },
  sessions: [SessionSchema],
  therapy: { 
    type: Schema.Types.ObjectId, 
    ref: 'Therapy', 
    required: true 
  }
}, { timestamps: true });


const Booking = mongoose.model("Booking", BookingSchema);

export default Booking;

