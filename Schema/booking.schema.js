import mongoose from 'mongoose';
const { Schema } = mongoose;

const SessionSchema = new Schema({
  date: { type: String, required: true },
  time: { type: String, required: false },
  slotId: { type: String, required: true },
  therapist: { 
    type: Schema.Types.ObjectId, 
    ref: 'TherapistProfile', 
    required: true 
  },
  therapyTypeId: { 
    type: Schema.Types.ObjectId, 
    ref: 'TherapyType' 
  },
  isCheckedIn: { 
    type: Boolean, 
    default: false 
  }
  // add more fields as needed
});

const BookingSchema = new Schema({
  appointmentId: {
    type: String, 
    required: true 
  },
  discountInfo: {
    coupon: { type: Schema.Types.ObjectId, ref: 'Discount' },
    time: { type: Date }
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
  therapist: { 
    type: Schema.Types.ObjectId, 
    ref: 'TherapistProfile', 
    required: true 
  },
  sessions: [SessionSchema],
  therapy: { 
    type: Schema.Types.ObjectId, 
    ref: 'Therapy', 
    required: true 
  },
  payment: { 
    type: Schema.Types.ObjectId, 
    ref: 'Payment'
  },
  remark: { 
    type: String 
  }
}, { timestamps: true });

const Booking = mongoose.model("Booking", BookingSchema);

export default Booking;

