import mongoose from 'mongoose';
const { Schema } = mongoose;

const ConsultationBookingSchema = new Schema({
  consultationAppointmentId: {
    type: String,
    required: true
  },

  client: {
    type: Schema.Types.ObjectId,
    ref: 'PatientProfile',
    required: true
  },

  consultant: {
    type: Schema.Types.ObjectId,
    ref: 'TherapistProfile',
  },

  therapy: {
    type: Schema.Types.ObjectId,
    ref: 'TherapyType',
    required: true
  },

  // 🔹 Basic scheduling info
  scheduledAt: {
    type: Date,
    required: true
  },

  // Add a time field for explicit time (if desired separate from scheduledAt)
  time: {
    type: String, // Format: "HH:mm" (eg: "14:30"), or use a Library for time management if needed
    required: false
  },

  durationMinutes: {
    type: Number,
    default: 60
  },

  // INSERT_YOUR_CODE
  // Fields to track if an admin updated scheduling info due to availability constraints
  adminUpdatedScheduledAt: {
    type: Date
  },
  adminUpdatedTime: {
    type: String // Format "HH:mm"
  },
  adminUpdatedDurationMinutes: {
    type: Number
  },
  adminUpdateReason: {
    type: String
  },

  // 🔹 Session type
  sessionType: {
    type: String,
    enum: ['online', 'in-person'],
    required: true
  },

  // 🔹 Booking status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    default: 'pending'
  },


  remark: {
    type: String
  }

}, { timestamps: true });

const ConsultationBooking = mongoose.model("ConsultationBooking", ConsultationBookingSchema);

export default ConsultationBooking;
