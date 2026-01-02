import mongoose from 'mongoose';

const { Schema } = mongoose;

// Hardcoded session slots, as per the spec
const sessionSlots = [
  { id: '0830-0915', label: '08:30 to 09:15', limited: true },
  { id: '0915-1000', label: '09:15 to 10:00', limited: true },
  { id: '1000-1045', label: '10:00 to 10:45', limited: false },
  { id: '1045-1130', label: '10:45 to 11:30', limited: false },
  { id: '1130-1215', label: '11:30 to 12:15', limited: false },
  { id: '1215-1300', label: '12:15 to 13:00', limited: false },
  { id: '1300-1345', label: '13:00 to 13:45', limited: false },
  { id: '1415-1500', label: '14:15 to 15:00', limited: false },
  { id: '1500-1545', label: '15:00 to 15:45', limited: false },
  { id: '1545-1630', label: '15:45 to 16:30', limited: false },
  { id: '1630-1715', label: '16:30 to 17:15', limited: false },
  { id: '1715-1800', label: '17:15 to 18:00', limited: false },
  { id: '1800-1845', label: '18:00 to 18:45', limited: true },
  { id: '1845-1930', label: '18:45 to 19:30', limited: true },
  { id: '1930-2015', label: '19:30 to 20:15', limited: true }
];

const sessionSlotSchema = new Schema(
  {
    id: { type: String, required: true },
    slotId: { type: String, required: true },
    label: { type: String, required: true },
    limited: { type: Boolean, default: false },
    count: { type: Number, default: 0, min: 0 }, // How many booked/occupied in this slot for the day
    booked: { 
      type: Number, 
      default: 0, 
      min: 0,
      validate: {
        validator: function(value) {
          // "this" refers to the subdocument (sessionSlot)
          return typeof this.count !== 'number' || value <= this.count;
        },
        message: "Booked must always be less than or equal to count"
      }
    }
  },
  { _id: false }
);

const dailyAvailabilitySchema = new Schema(
  {
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    // Array of session slots, each with count for the day
    sessions: {
      type: [sessionSlotSchema],
      default: () => sessionSlots.map(slot => ({
        id: slot.id,
        slotId: slot.id,
        label: slot.label,
        limited: slot.limited,
        count: 0
      }))
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'daily_availability_slots'
  }
);

const DailyAvailability =
  mongoose.models.DailyAvailability ||
  mongoose.model('DailyAvailability', dailyAvailabilitySchema);

export default DailyAvailability;
