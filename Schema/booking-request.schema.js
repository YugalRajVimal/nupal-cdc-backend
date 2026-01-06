import mongoose from 'mongoose';
const { Schema } = mongoose;

const SessionSchema = new Schema({
  date: { type: String, required: true },
  time: { type: String, required: false },
  slotId: { type: String, required: true },

  // add more fields as needed
});

const BookingRequestsSchema = new Schema({
  requestId:{
    type: String, 
    required: true 
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
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    required: true
  },
  appointmentId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Booking', 
    required: false,
    default: null
  },
}, { timestamps: true });

const BookingRequests = mongoose.model("BookingRequests", BookingRequestsSchema);

export default BookingRequests;

