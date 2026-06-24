/* ================================
   1. USERS COLLECTION (AUTH SOURCE)
   ================================ */

// models/User.js
import mongoose from "mongoose";

const NullableFile = { type: mongoose.Schema.Types.Mixed, default: null };

const UserSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["patient", "therapist", "admin", "superadmin"],
      required: true,
    },
    // Name is only mandatory for patient users
    name: { 
      type: String,
      required: function () { return this.role === "patient"; }
    },
    email: { type: String, sparse: true },
    // Only mandatory for patient users
    phone: {
      type: String,
      default: "",
      required: function () { return this.role === "patient"; }
    },
    authProvider: {
      type: String,
      enum: ["otp", "password"],
      required: true,
    },
    // For superadmin ONLY: passwordHash is required.
    // For others, passwordHash remains undefined/not used.
    passwordHash: { 
      type: String,
      required: function () { return this.role === "superadmin"; }
    },
    // OTP fields are available for all users.
    otp: { type: String }, // Last sent OTP
    otpExpiresAt: { type: Date }, // Expiry time for current OTP
    otpGeneratedAt: { type: Date }, // When was the OTP generated
    otpAttempts: { type: Number, default: 0 }, // Attempts for the current OTP

    phoneVerified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["active", "suspended", "deleted"],
      default: "active",
    },
    isDisabled: { type: Boolean, default: false },

    // Fields for managing OTP during signup flow (separate from login OTP fields)
    signUpOTP: { type: String, default: null },
    signUpOTPExpiresAt: { type: Date, default: null },
    signUpOTPSentAt: { type: Date, default: null },
    signUpOTPAttempts: { type: Number, default: 0 },
    signUpOTPLastUsedAt: { type: Date, default: null },
    incompleteTherapistProfile:{ type: Boolean, default: true },
    incompleteParentProfile:{ type: Boolean, default: true },
    manualSignUp:{ type: Boolean, default: false },
    


  },
  { timestamps: true }
);


/* ================================
   2. ROLE-SPECIFIC PROFILE TABLES
   ================================ */

// Children Profile (extended with child/Children details)
const PatientProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  // Child name, required
  name: { type: String, required: true },
  patientId:{type: String, required: true, },
  gender: { type: String, default: "" },
  childDOB: { type: String, default: "" },
  fatherFullName: { type: String, default: "" },
  plannedSessionsPerMonth: { type: String, default: "" },
  package: { type: String, default: "" },
  motherFullName: { type: String, default: "" },
  parentEmail: { type: String, default: "" },
  // Only mobile1 is required
  mobile1: { type: String, required: true },
  mobile1Verified: { type: Boolean, default: false },
  mobile2: { type: String, default: "" },
  // Address is required
  address: { type: String, required: true },
  pincode: { type: String, default: "" },
  areaName: { type: String, default: "" },
  diagnosisInfo: { type: String, default: "" },
  childReference: { type: String, default: "" },
  parentOccupation: { type: String, default: "" },
  motherOccupation: { type: String, default: "" }, // Added field as instructed
  remarks: { type: String, default: "" },
  profilePhoto: { type: mongoose.Schema.Types.Mixed, default: undefined },
  otherDocument: { type: mongoose.Schema.Types.Mixed, default: undefined },
  usedCouponCodes: [{ type: String }],
});



// Therapist Profile
const TherapistProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  therapistId:{type: String },


  // ADDED FIELDS AS REQUESTED
  fathersName:     { type: String, default: "" },
  mobile1:         { type: String, default: "" },
  mobile2:         { type: String, default: "" },
  address:         { type: String, default: "" },
  reference:       { type: String, default: "" },

  aadhaarFront:    NullableFile,
  aadhaarBack:     NullableFile,
  photo:           NullableFile,
  resume:          NullableFile,
  certificate:     NullableFile,

  accountHolder:   { type: String, default: "" },
  bankName:        { type: String, default: "" },
  ifsc:            { type: String, default: "" },
  accountNumber:   { type: String, default: "" },
  upi:             { type: String, default: "" },

  linkedin:        { type: String, default: "" },
  twitter:         { type: String, default: "" },
  facebook:        { type: String, default: "" },
  instagram:       { type: String, default: "" },
  youtube:         { type: String, default: "" },
  website:         { type: String, default: "" },
  portfolio:       { type: String, default: "" },
  blog:            { type: String, default: "" },

  remarks:         { type: String, default: "" },

  earnings: [
    {
      amount: { type: Number, required: true },
      type: { type: String, enum: ["salary", "contract"], required: true },
      fromDate: { type: Date, required: true },
      toDate: { type: Date, required: true },
      remark: { type: String, default: "" },
      paidOn: { type: Date },
      paymentMethod: {
        type: String,
        enum: [ 'online', 'cash'],
        required: true,
      },
      utr: { type: String, default: "" }, // Added UTR
    }
  ],

  // original fields from previous TherapistProfileSchema:
  specializations: { type: String, default: "" },
  experienceYears: Number,
  // Indicates if therapist panel is accessible for this therapist
  isPanelAccessible: { type: Boolean, default: true }, 

  // Therapist holidays: Array of objects { date: Date, reason: String }
  holidays: [
    {
      date: { type: String, required: true },
      reason: { type: String, default: "" },
      // Optional: restrict to certain slots or mark full-day
      slots: [
        {
          slotId:  { type: String }, // E.g. "0830-0915"
          label:   { type: String }, // E.g. "08:30 to 09:15"
        }
      ],
      isFullDay: { type: Boolean, default: true } // true if the whole day is holiday, false if only slots[]
    }
  ],
  
});

// Admin Profile
const AdminProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  phoneNo: { type: String, default: "" },
  department: String,
});

// Super Admin Profile
const SuperAdminProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  phoneNo: { type: String, default: "" },
  securityLevel: { type: Number, default: 10 },
  lastLoginIp: String,
});

export const User = mongoose.model("User", UserSchema);
export const PatientProfile = mongoose.model("PatientProfile", PatientProfileSchema);
export const TherapistProfile = mongoose.model("TherapistProfile", TherapistProfileSchema);
export const AdminProfile = mongoose.model("AdminProfile", AdminProfileSchema);
export const SuperAdminProfile = mongoose.model("SuperAdminProfile", SuperAdminProfileSchema);