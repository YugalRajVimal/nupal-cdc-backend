import mongoose from "mongoose";

const SessionUpdateSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    newDate: { type: String, required: true },
    newSlotId: { type: String, required: true },
  },
  { _id: false }
);

const SessionEditRequestSchema = new mongoose.Schema(
  {
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    patientId: { type: String, required: true },
    sessions: {
      type: [SessionUpdateSchema],
      required: true,
      validate: [arr => Array.isArray(arr) && arr.length > 0, 'At least one session edit is required.'],
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

const SessionEditRequest = mongoose.models.SessionEditRequest || mongoose.model("SessionEditRequest", SessionEditRequestSchema);

export default SessionEditRequest;
