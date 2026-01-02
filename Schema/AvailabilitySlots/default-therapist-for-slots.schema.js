import mongoose from 'mongoose';

const { Schema } = mongoose;

const defaultTherapistForSlotsSchema = new Schema(
  {
    defaultCapacity: {
      type: Number,
      required: true,
      min: 0,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'default_therapist_for_slots',
  }
);

const DefaultTherapistForSlots =
  mongoose.models.DefaultTherapistForSlots ||
  mongoose.model('DefaultTherapistForSlots', defaultTherapistForSlotsSchema);

export default DefaultTherapistForSlots;
