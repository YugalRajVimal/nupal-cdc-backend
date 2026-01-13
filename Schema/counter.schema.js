// models/counter.model.js
import mongoose from "mongoose";

/**
 * Valid names:
 * - 'patient'              => For Patient Code: P0001, P0002, ... (3 zeros before 1)
 * - 'appointment'          => For Appointment Code: APT000001, APT000002, ... (5 zeros before 1)
 * - 'lead'                 => For Lead Code: L00001, L00002, ... (4 zeros before 1)
 * - 'therapist'            => For Therapist/Employee Code: NPL001, NPL002, ... (2 zeros before 1)
 * - 'payment'              => For Payment ID: INV-2024-00001, INV-2024-00002, ... (Format: INV-YYYY-#####)
 * - 'request'              => For Request ID (format as per requirement)
 * - 'session-edit-request' => For Session Edit Request counter (format as per requirement)
 * 
 */
const ALLOWED_NAMES = ["patient", "appointment", "lead", "therapist", "payment", "request","session-edit-request"];

const counterSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    unique: true,
    validate: {
      validator: function(value) {
        return ALLOWED_NAMES.includes(value);
      },
      message: props => `${props.value} is not a valid counter name. Allowed names are: ${ALLOWED_NAMES.join(", ")}`
    }
  },
  seq: { type: Number, default: 0 }
});

export default mongoose.model("Counter", counterSchema);
