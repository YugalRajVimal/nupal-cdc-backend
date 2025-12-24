import mongoose from "mongoose";

const TherapyTypeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    default: ""
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

export const TherapyType = mongoose.model("TherapyType", TherapyTypeSchema);
