import { User, PatientProfile } from "../../Schema/user.schema.js";
import mongoose from "mongoose";
import Counter from "../../Schema/counter.schema.js";

// Utility: Get next patient sequence for PatientID generation
const getNextSequence = async (name) => {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

// Format patient ID as P + 4-digit padded number (e.g., P0001, P0056)
const generatePatientId = (seq) => {
  return `P${seq.toString().padStart(4, "0")}`;
};

class PatientAdminController {
  // Add new patient (user + patient profile)
  async addPatient(req, res) {
    try {
      const {
        email,
        childFullName,
        gender,
        childDOB,
        fatherFullName,
        plannedSessionsPerMonth, // optional
        package: packageName,    // optional
        motherFullName,
        parentEmail,
        mobile1,
        mobile2,                 // optional
        address,
        areaName,
        pincode,                 // now mandatory
        diagnosisInfo,
        childReference,
        parentOccupation,
        remarks,                 // optional
      } = req.body;

      let otherDocumentPath = "";
      if (req.file && req.file.path) {
        otherDocumentPath = req.file.path;
      } else if (req.body.otherDocument && typeof req.body.otherDocument === "string") {
        otherDocumentPath = req.body.otherDocument;
      }

      // Required fields array (all except: mobile2, plannedSessionsPerMonth, package, remarks)
      const requiredFields = [
        { key: "email", value: email },
        { key: "childFullName", value: childFullName },
        { key: "gender", value: gender },
        { key: "childDOB", value: childDOB },
        { key: "fatherFullName", value: fatherFullName },
        { key: "motherFullName", value: motherFullName },
        { key: "parentEmail", value: parentEmail },
        { key: "mobile1", value: mobile1 },
        { key: "address", value: address },
        { key: "areaName", value: areaName },
        { key: "pincode", value: pincode }, // now required
        { key: "diagnosisInfo", value: diagnosisInfo },
        { key: "childReference", value: childReference },
        { key: "parentOccupation", value: parentOccupation },
      ];

      // Gather missing required fields
      const missingRequired = requiredFields
        .filter(f => !f.value || (typeof f.value === "string" && f.value.trim() === ""))
        .map(f => f.key);

      if (missingRequired.length > 0) {
        console.log("Required fields missing:", missingRequired);
        return res.status(400).json({
          message: `Missing required fields: ${missingRequired.join(", ")}.`
        });
      }

      // Prepare trimmed input for comparisons
      const emailTrimmed = email.trim();
      const mobile1Trimmed = mobile1.trim();
      const pincodeValue = typeof pincode === "string" ? pincode.trim() : "";

      // Check for existing associations
      const existingUserByEmail = await User.findOne({ email: emailTrimmed, role: "patient" });
      const existingUserByMobile = await PatientProfile.findOne({ mobile1: mobile1Trimmed });

      console.log("Check existingUserByEmail:", existingUserByEmail ? existingUserByEmail.email : null);
      console.log("Check existingUserByMobile:", existingUserByMobile ? existingUserByMobile.mobile1 : null);

      let emailAssociatedMobile = null;
      let emailAssociatedMobileFull = null;
      let mobileAssociatedEmail = null;
      let mobileAssociatedEmailFull = null;

      if (existingUserByEmail) {
        const patientProfileForEmail = await PatientProfile.findOne({ userId: existingUserByEmail._id });
        if (patientProfileForEmail) {
          emailAssociatedMobile = (patientProfileForEmail.mobile1 || "").trim();
          emailAssociatedMobileFull = patientProfileForEmail.mobile1 || "";
        }
      }

      console.log("emailAssociatedMobile for existingUserByEmail:", emailAssociatedMobile);

      if (existingUserByMobile) {
        const userForMobile = await User.findById(existingUserByMobile.userId);
        if (userForMobile) {
          mobileAssociatedEmail = (userForMobile.email || "").trim();
          mobileAssociatedEmailFull = userForMobile.email || "";
        }
      }

      console.log("mobileAssociatedEmail for existingUserByMobile:", mobileAssociatedEmail);

      // Helper to get last 4 digits of phone number (or full if less than 4)
      function getLast4Digits(phone) {
        if (!phone) return "";
        const str = phone.toString();
        return str.length > 4 ? str.substring(str.length - 4) : str;
      }

      // Violation 1: Trying to register same email with a different mobile1
      if (
        existingUserByEmail &&
        emailAssociatedMobile &&
        emailAssociatedMobile !== mobile1Trimmed
      ) {
        console.log(
          "Violation 1 - Email already registered with different phone:",
          { email: emailTrimmed, existingPhone: emailAssociatedMobile, inputPhone: mobile1Trimmed }
        );
        return res.status(409).json({
          success: false,
          message: `This email is already registered with a different phone number (ending ${(emailAssociatedMobile)}).`,
          phoneEnding: getLast4Digits(emailAssociatedMobile),
          phoneFull: emailAssociatedMobileFull,
          email: emailTrimmed,
        });
      }

      // Violation 2: Trying to register same mobile1 with a different email
      if (
        existingUserByMobile &&
        mobileAssociatedEmail &&
        mobileAssociatedEmail !== emailTrimmed
      ) {
        console.log(
          "Violation 2 - Phone already registered with different email:",
          { phone: mobile1Trimmed, existingEmail: mobileAssociatedEmail, inputEmail: emailTrimmed }
        );
        return res.status(409).json({
          success: false,
          message: `This phone number (${(mobile1Trimmed)}) is already registered with a different email.`,
          phoneEnding: getLast4Digits(mobile1Trimmed),
          phoneFull: mobile1Trimmed,
          email: mobileAssociatedEmailFull,
        });
      }

      // CASE: If both email and mobile1 are paired together in a previous patient, only create PatientProfile, do not create User
      let user;
      let reusedExistingUser = false;
      if (
        existingUserByEmail &&
        emailAssociatedMobile &&
        emailAssociatedMobile === mobile1Trimmed
      ) {
        // Check for PatientProfile with both matching
        user = existingUserByEmail;
        reusedExistingUser = true;
      } else if (
        existingUserByMobile &&
        mobileAssociatedEmail &&
        mobileAssociatedEmail === emailTrimmed
      ) {
        // Defensive, in case only mobile->email found
        user = await User.findOne({ _id: existingUserByMobile.userId });
        reusedExistingUser = true;
      } else {
        // No match for BOTH, so create new User as before
        // Get next patient sequence and generate patientId
        const nextSeq = await getNextSequence("patient");
        const patientId = generatePatientId(nextSeq);

        user = new User({
          role: "patient",
          name: childFullName,
          email: emailTrimmed,
          authProvider: "otp",
          phoneVerified: false,
          emailVerified: false,
          status: "active",
          phone: mobile1Trimmed // <--- Save mobile1 to User.phone
        });
        await user.save();

        // Create PatientProfile below using generated patientId
        const patientProfile = new PatientProfile({
          userId: user._id,
          patientId, // <-- Add generated patientId
          name: childFullName, // <-- Store child's name here
          gender,
          childDOB,
          fatherFullName,
          plannedSessionsPerMonth, // optional
          package: packageName,    // optional
          motherFullName,
          parentEmail,
          mobile1: mobile1Trimmed,
          mobile2,                 // optional
          address,
          areaName,
          pincode: pincodeValue,   // mandatory, set from trimmed input
          diagnosisInfo,
          childReference,
          parentOccupation,
          remarks,                 // optional
          otherDocument: otherDocumentPath,
        });
        await patientProfile.save();

        console.log("Patient successfully created for:", { email: emailTrimmed, mobile1: mobile1Trimmed, patientId });

        return res.status(201).json({
          success: true,
          message: "Patient created successfully.",
          patient: {
            ...patientProfile.toObject(),
            userId: user,
          },
        });
      }

      // If here, reuse user and create PatientProfile (do not create User)
      // Still need to generate a new patientId for this PatientProfile
      const nextSeq = await getNextSequence("patient");
      const patientId = generatePatientId(nextSeq);

      const patientProfile = new PatientProfile({
        userId: user._id,
        patientId, // <-- Add generated patientId
        name: childFullName, // <-- Store child's name here
        gender,
        childDOB,
        fatherFullName,
        plannedSessionsPerMonth, // optional
        package: packageName,    // optional
        motherFullName,
        parentEmail,
        mobile1: mobile1Trimmed,
        mobile2,                 // optional
        address,
        areaName,
        pincode: pincodeValue,   // mandatory, set from trimmed input
        diagnosisInfo,
        childReference,
        parentOccupation,
        remarks,                 // optional
        otherDocument: otherDocumentPath,
      });
      await patientProfile.save();

      console.log(
        "PatientProfile created for existing user:",
        { email: emailTrimmed, mobile1: mobile1Trimmed, patientId, reusedExistingUser }
      );

      return res.status(201).json({
        success: true,
        message: "Patient created successfully.",
        patient: {
          ...patientProfile.toObject(),
          userId: user,
        },
        usedExistingUser: true,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Error creating patient.", error: error.message });
    }
  }

  // Fetch all patients (join with User)
  async getAllPatients(req, res) {
    try {
      // Populates userId reference from User collection
      const patients = await PatientProfile.find().populate("userId");
      return res.json({ success: true, patients });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to fetch patients.", error: error.message });
    }
  }

  // Fetch single patient by ID (patient profile)
  async getPatientById(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid patient ID." });
      }
      const profile = await PatientProfile.findById(id).populate("userId");
      if (!profile) {
        return res.status(404).json({ message: "Patient not found." });
      }
      return res.json({ success: true, patient: profile });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Error fetching patient.", error: error.message });
    }
  }

  // Update/edit patient profile (and update child name on User if present)
  async editPatient(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid patient ID." });
      }
      const update = req.body;

      // Remove email (can't update directly here)
      delete update.email;

      const patientProfile = await PatientProfile.findById(id);
      if (!patientProfile) {
        return res.status(404).json({ message: "Patient not found." });
      }

      // Fetch current association for comparison
      const oldMobile = patientProfile.mobile1 ? patientProfile.mobile1.trim() : "";
      const user = await User.findById(patientProfile.userId);
      const oldEmail = user && user.email ? user.email.trim() : "";

      // Prepare input values
      const newEmail = (update.parentEmail || oldEmail).trim();
      const newMobile = (update.mobile1 || oldMobile).trim();

      // Only proceed if parentEmail or mobile1 are being updated
      let associationCheckNeeded = false;
      if (update.parentEmail && update.parentEmail.trim() !== oldEmail) {
        associationCheckNeeded = true;
      }
      if (update.mobile1 && update.mobile1.trim() !== oldMobile) {
        associationCheckNeeded = true;
      }

      if (associationCheckNeeded) {
        // Check for an existing patient with newEmail as parentEmail and newMobile as mobile1
        const patientWithBoth = await PatientProfile.findOne({
          email: newEmail,
          mobile1: newMobile,
          _id: { $ne: patientProfile._id }
        });

        // Check for any patient with newEmail and another phone
        const patientWithEmail = await PatientProfile.findOne({
          email: newEmail,
          _id: { $ne: patientProfile._id }
        });

        // Check for any patient with newMobile and another email
        const patientWithMobile = await PatientProfile.findOne({
          mobile1: newMobile,
          _id: { $ne: patientProfile._id }
        });

        // If new association exists as a pair, allow; otherwise, error if either is already associated differently
        if (!patientWithBoth) {
          // If email exists but with another mobile number, error
          if (patientWithEmail && patientWithEmail.mobile1 !== newMobile) {
            return res.status(400).json({
              success: false,
              message: "This email is already associated with another phone number.",
              fullEmail: newEmail,
              fullPhoneNo: patientWithEmail.mobile1,
            });
          }
          // If phone exists but with another email, error
          if (patientWithMobile && patientWithMobile.parentEmail !== newEmail) {
            return res.status(400).json({
              success: false,
              message: "This phone number is already associated with another email.",
              fullEmail: patientWithMobile.parentEmail,
              fullPhoneNo: newMobile,
            });
          }
        }
        // If both are already associated together on another record, that's fine; allow update to those values
      }

      // If updating childFullName, also update User.name
      if (update.childFullName && patientProfile.userId) {
        await User.findByIdAndUpdate(patientProfile.userId, { name: update.childFullName });
      }
      // If updating parentEmail, also update User.email
      if (update.parentEmail && user) {
        await User.findByIdAndUpdate(patientProfile.userId, { email: update.parentEmail.trim() });
      }
      // If updating mobile1, also update User.phone
      if (update.mobile1 && patientProfile.userId) {
        await User.findByIdAndUpdate(patientProfile.userId, { phone: update.mobile1.trim() });
      }

      // Only update allowed fields on PatientProfile
      for (const key of [
        "childFullName",
        "gender",
        "childDOB",
        "fatherFullName",
        "plannedSessionsPerMonth",
        "package",
        "motherFullName",
        "parentEmail",
        "mobile1",
        "mobile2",
        "address",
        "areaName",
        "pincode", // <-- pincode added here
        "diagnosisInfo",
        "childReference",
        "parentOccupation",
        "remarks",
        "otherDocument",
      ]) {
        if (update[key] !== undefined) {
          patientProfile[key] = update[key];
        }
      }

      // Also update 'name' field in PatientProfile if childFullName is present (so 'name' always matches childFullName)
      if (update.childFullName !== undefined) {
        patientProfile.name = update.childFullName;
      }

      await patientProfile.save();
      const updated = await PatientProfile.findById(id).populate("userId");

      return res.json({ success: true, message: "Patient updated successfully.", patient: updated });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to update patient.", error: error.message });
    }
  }

  // Delete patient (both patient profile and user)
  async deletePatient(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid patient ID." });
      }
      const patientProfile = await PatientProfile.findById(id);
      if (!patientProfile) {
        return res.status(404).json({ success: false, message: "Patient not found." });
      }
      // Delete PatientProfile
      await PatientProfile.findByIdAndDelete(id);
      // Delete User
      if (patientProfile.userId) {
        await User.findByIdAndDelete(patientProfile.userId);
      }
      return res.json({ success: true, message: "Patient deleted successfully." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to delete patient.", error: error.message });
    }
  }
}

export default PatientAdminController;
