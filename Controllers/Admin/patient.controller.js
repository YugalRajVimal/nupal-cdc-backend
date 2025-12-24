import { User, PatientProfile } from "../../Schema/user.schema.js";
import mongoose from "mongoose";

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
        plannedSessionsPerMonth,
        package: packageName,
        motherFullName,
        parentEmail,
        mobile1,
        mobile2,
        address,
        areaName,
        diagnosisInfo,
        childReference,
        parentOccupation,
        remarks,
      } = req.body;

      // "otherDocument" is a file path, so obtain it from req.file or req.body depending on how your uploading middleware works
      // For now, accept it as req.body.otherDocument (string filepath) OR, if using multer, req.file.path
      let otherDocumentPath = "";
      // If uploaded as multipart, get from req.file; else from req.body (string path)
      if (req.file && req.file.path) {
        otherDocumentPath = req.file.path;
      } else if (req.body.otherDocument && typeof req.body.otherDocument === "string") {
        otherDocumentPath = req.body.otherDocument;
      }

      // Email is used for User document
      if (!email || !childFullName || !mobile1) {
        return res.status(400).json({ message: "email, childFullName, and mobile1 are required." });
      }

      // Enforce unique email
      let existingUser = await User.findOne({ email: email.trim(), role: "patient" });
      if (existingUser) {
        return res.status(409).json({ message: "A patient with this email already exists." });
      }

      // Create User (role: patient, authProvider: otp, etc)
      const user = new User({
        role: "patient",
        name: childFullName,
        email: email.trim(),
        authProvider: "otp",
        phoneVerified: false,
        emailVerified: false,
        status: "active",
      });
      await user.save();

      const patientProfile = new PatientProfile({
        userId: user._id,
        gender,
        childDOB,
        fatherFullName,
        plannedSessionsPerMonth,
        package: packageName,
        motherFullName,
        parentEmail,
        mobile1,
        mobile2,
        address,
        areaName,
        diagnosisInfo,
        childReference,
        parentOccupation,
        remarks,
        otherDocument: otherDocumentPath,
      });
      await patientProfile.save();

      return res.status(201).json({
        success: true,
        message: "Patient created successfully.",
        patient: {
          ...patientProfile.toObject(),
          userId: user,
        },
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

      // If updating childFullName, also update User.name
      if (update.childFullName && patientProfile.userId) {
        await User.findByIdAndUpdate(patientProfile.userId, { name: update.childFullName });
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
