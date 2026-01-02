import mongoose from "mongoose";

const LeadSchema = new mongoose.Schema(
  {
    leadId: { type: String, required: true },
    callDate: { type: Date, required: false },
    staff: { type: String, required: false },
    staffOther: { type: String, required: false },
    referralSource: { type: String, required: false },
    parentName: { type: String, required: true },
    parentRelationship: { type: String, required: false },
    parentMobile: { type: String, required: true },
    parentEmail: { type: String, required: false },
    parentArea: { type: String, required: false },
    childName: { type: String, required: true },
    childDOB: { type: Date, required: false },
    childGender: { type: String, required: false },
    therapistAlready: { type: String, required: false },
    diagnosis: { type: String, required: false },
    visitFinalized: { type: String, required: false }, // e.g., "yes", "no"
    appointmentDate: { type: Date, required: false },
    appointmentTime: { type: String, required: false },
    status: { type: String, default: "pending" }, // e.g., "pending", "converted"
    remarks: { type: String, required: false }, // Added remarks field
  },
  { timestamps: true }
);

const Lead = mongoose.models.Lead || mongoose.model("Lead", LeadSchema);

export default Lead;
