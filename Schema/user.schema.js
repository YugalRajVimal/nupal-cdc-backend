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
    name: { type: String, required: true },
    email: { type: String, sparse: true },
    phone:{type: String, default: ""},
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
  },
  { timestamps: true }
);


/* ================================
   2. ROLE-SPECIFIC PROFILE TABLES
   ================================ */

// Patient Profile (extended with child/patient details)
const PatientProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name: { type: String, required: true },
  patientId:{type: String, required: true, },
  gender: { type: String, default: "" },
  childDOB: { type: String, default: "" },
  fatherFullName: { type: String, default: "" },
  plannedSessionsPerMonth: { type: String, default: "" },
  package: { type: String, default: "" },
  motherFullName: { type: String, default: "" },
  parentEmail: { type: String, default: "" },
  mobile1: { type: String, default: "" },
  mobile1Verified: { type: Boolean, default: false },
  mobile2: { type: String, default: "" },
  address: { type: String, default: "" },
  areaName: { type: String, default: "" },
  diagnosisInfo: { type: String, default: "" },
  childReference: { type: String, default: "" },
  parentOccupation: { type: String, default: "" },
  remarks: { type: String, default: "" },
  otherDocument: { type: mongoose.Schema.Types.Mixed, default: undefined },
});

// Therapist Profile
const TherapistProfileSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  therapistId:{type: String,  required: true },


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

  // original fields from previous TherapistProfileSchema:
  specializations: { type: String, default: "" },
  experienceYears: Number,
  
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