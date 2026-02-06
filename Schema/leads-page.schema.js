
import mongoose from "mongoose";

// Schema to store dropdown options for the leads page form
// Each field stores an array of strings representing possible dropdown choices

const LeadsFormConfigSchema = new mongoose.Schema(
  {
    staffMembers: {
      type: [String],
      default: [],
      required: true, // staff member taking the call
    },
    findUsOptions: {
      type: [String],
      default: [],
      required: true, // "Where did you find us?" options
    },
    relationships: {
      type: [String],
      default: [],
      required: true // Parent relationship options
    },
    pincodes: {
      type: [String],
      default: [],
      required: true // Possible location pincodes
    },
    // You can add more dropdown settings as needed for future form fields
  },
  { timestamps: true }
);

const LeadsFormConfig =
  mongoose.models.LeadsFormConfig ||
  mongoose.model("LeadsFormConfig", LeadsFormConfigSchema);

export default LeadsFormConfig;

