import { User, TherapistProfile } from "../../Schema/user.schema.js";
import mongoose from "mongoose";

class TherapistAdminController {
  // Add therapist
  addTherapist = async (req, res) => {
    try {
      console.log("Received addTherapist request with body:", req.body);

      const {
        fullName,
        email,
        fathersName,
        mobile1,
        mobile2,
        address,
        reference,
        aadhaarFront,
        aadhaarBack,
        photo,
        resume,
        certificate,
        accountHolder,
        bankName,
        ifsc,
        accountNumber,
        upi,
        linkedin,
        twitter,
        facebook,
        instagram,
        youtube,
        website,
        portfolio,
        blog,
        remarks,
        specializations,
        experienceYears
      } = req.body;

      // Simple check for required field
      if (!fullName) {
        console.log("Check failed: fullName is required");
        return res.status(400).json({ error: "Full name is required" });
      }
      console.log("Check passed: fullName present");

      // Create user document (role: therapist)
      const user = await User.create({
        role: "therapist",
        name: fullName,
        email: email, // add email (User only)
        authProvider: "otp",
        status: "active"
      });
      console.log("User document created:", user);

      // Create TherapistProfile (do NOT store email here)
      const therapistProfile = await TherapistProfile.create({
        userId: user._id,
        fathersName,
        mobile1,
        mobile2,
        address,
        reference,
        aadhaarFront,
        aadhaarBack,
        photo,
        resume,
        certificate,
        accountHolder,
        bankName,
        ifsc,
        accountNumber,
        upi,
        linkedin,
        twitter,
        facebook,
        instagram,
        youtube,
        website,
        portfolio,
        blog,
        remarks,
        specializations,
        experienceYears
        // email is NOT stored in TherapistProfile
      });
      console.log("TherapistProfile document created:", therapistProfile);

      res.status(201).json({ user, therapistProfile });
    } catch (e) {
      console.log("Error in addTherapist:", e);
      res.status(400).json({ error: "Failed to add therapist", details: e.message });
    }
  };

  // Fetch all therapists
  fetchTherapists = async (req, res) => {
    console.log("--");

    try {
      // Populate userId so email appears in .userId.email
      const therapists = await TherapistProfile.find().populate({
        path: "userId"
      });

      console.log(therapists);
      console.log("--");

      res.json({ therapists });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch therapists", details: e.message });
    }
  };

  // Fetch therapist by ID
  fetchTherapistById = async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid therapist ID" });
      }
      // Only email of therapist is in userId (not TherapistProfile)
      const therapist = await TherapistProfile.findById(id)
        .populate({ path: "userId"});
      if (!therapist) return res.status(404).json({ error: "Therapist not found" });
      res.json({ therapist });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch therapist", details: e.message });
    }
  };

  // Edit therapist profile
  editTherapist = async (req, res) => {
    try {
      const { id } = req.params;
      console.log("[editTherapist] Called with id:", id);

      if (!mongoose.Types.ObjectId.isValid(id)) {
        console.log("[editTherapist] Invalid therapist profile ID:", id);
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }

      const { email, ...profileFields } = req.body || {};
      console.log("[editTherapist] Incoming profileFields:", profileFields, "and email:", email);

      Object.keys(profileFields).forEach(
        (key) => profileFields[key] === undefined && delete profileFields[key]
      );

      const updatedTherapist = await TherapistProfile.findByIdAndUpdate(
        id,
        profileFields,
        { new: true }
      );

      if (email) {
        const therapist = await TherapistProfile.findById(id);
        if (therapist && therapist.userId) {
          console.log(`[editTherapist] Updating User email for userId: ${therapist.userId} -> ${email}`);
          await User.findByIdAndUpdate(therapist.userId, { email: email });
        }
      }

      if (!updatedTherapist) {
        console.log("[editTherapist] Therapist not found for id:", id);
        return res.status(404).json({ error: "Therapist not found" });
      }

      console.log("[editTherapist] Updated therapist profile:", updatedTherapist);

      res.json({ therapist: updatedTherapist });
    } catch (e) {
      console.error("[editTherapist] Error editing therapist:", e);
      res.status(400).json({ error: "Error editing therapist", details: e.message });
    }
  };

  // Delete therapist (delete both User and TherapistProfile)
  deleteTherapist = async (req, res) => {
    try {
      const { id } = req.params; // id = TherapistProfile _id
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }
      const therapist = await TherapistProfile.findById(id);
      if (!therapist) return res.status(404).json({ error: "Therapist not found" });

      // Delete TherapistProfile
      await TherapistProfile.findByIdAndDelete(id);

      // Set User status to 'deleted'
      await User.findByIdAndUpdate(therapist.userId, { status: "deleted" });

      res.json({ success: true, message: "Therapist deleted successfully" });
    } catch (e) {
      res.status(400).json({ error: "Failed to delete therapist", details: e.message });
    }
  };
}

export default TherapistAdminController;
