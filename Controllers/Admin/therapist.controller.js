import { User, TherapistProfile } from "../../Schema/user.schema.js";
import mongoose from "mongoose";
import Counter from "../../Schema/counter.schema.js";

/**
 * Util: get next sequence number for a given counter name
 * Returns the incremented value for the given counter
 * (Always upserts, so 1 is returned if not present already)
 */
const getNextSequence = async (name) => {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

/**
 * Therapist ID format: NPL + <three digits, starting from 001>
 * e.g., NPL001, NPL002, ...
 */
function generateTherapistId(seq) {
  // pad with leading zeros to at least 3 digits (change as needed)
  return "NPL" + seq.toString().padStart(3, "0");
}

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

      // List all required fields (excluding optional ones)
      const requiredFields = [
        { key: "fullName", value: fullName },
        { key: "email", value: email },
        { key: "fathersName", value: fathersName },
        { key: "mobile1", value: mobile1 },
        { key: "address", value: address },
        { key: "reference", value: reference },
        { key: "specializations", value: specializations },
        { key: "experienceYears", value: experienceYears }
      ];

      // Check for any missing required fields
      const missingFields = requiredFields
        .filter(f => !f.value || (typeof f.value === "string" && f.value.trim() === ""))
        .map(f => f.key);

      if (missingFields.length > 0) {
        console.log("Check failed: Missing required fields:", missingFields);
        return res.status(400).json({
          error: `Missing required fields: ${missingFields.join(", ")}`
        });
      }
      console.log("Check passed: All required fields present");

      // --- Uniqueness enforcement logic for therapist email + phone ---
      // We only allow the same combination of email & phone to be used for one therapist.
      // If an email exists with a different phone, or a phone exists with a different email, this is not allowed!

      const emailTrimmed = typeof email === "string" ? email.trim() : email;
      const mobile1Trimmed = typeof mobile1 === "string" ? mobile1.trim() : mobile1;

      // 1. Find existing User with this email and role therapist
      const existingUserByEmail = await User.findOne({ email: emailTrimmed, role: "therapist" });
      // 2. Find existing TherapistProfile with this mobile1
      const existingProfileByMobile = await TherapistProfile.findOne({ mobile1: mobile1Trimmed });

      let emailAssociatedMobile = null;
      let emailAssociatedMobileFull = null;
      let mobileAssociatedEmail = null;
      let mobileAssociatedEmailFull = null;

      if (existingUserByEmail) {
        // find therapist profile for this user
        const profile = await TherapistProfile.findOne({ userId: existingUserByEmail._id });
        if (profile) {
          emailAssociatedMobile = profile.mobile1 ? profile.mobile1.trim() : "";
          emailAssociatedMobileFull = profile.mobile1 || "";
        }
      }
      if (existingProfileByMobile) {
        // find user for this therapist profile
        const userForMobile = await User.findById(existingProfileByMobile.userId);
        if (userForMobile) {
          mobileAssociatedEmail = userForMobile.email ? userForMobile.email.trim() : "";
          mobileAssociatedEmailFull = userForMobile.email || "";
        }
      }

      console.log("[Uniqueness] emailAssociatedMobile (by email):", emailAssociatedMobile);
      console.log("[Uniqueness] mobileAssociatedEmail (by phone):", mobileAssociatedEmail);

      // Both fields are new (email not used, phone not used) => OK
      // If either is in use, enforce rules
      let errorMsg = null;
      if (existingUserByEmail && (!emailAssociatedMobile || emailAssociatedMobile !== mobile1Trimmed)) {
        // email is taken and associated to a different phone number
        errorMsg = `This email is already used for another therapist (Phone: ${emailAssociatedMobileFull || "[none]"})`;
      }
      if (existingProfileByMobile && (!mobileAssociatedEmail || mobileAssociatedEmail !== emailTrimmed)) {
        // phone is taken and associated to a different email
        errorMsg = `This phone number is already used for another therapist (Email: ${mobileAssociatedEmailFull || "[none]"})`;
      }
      // If both email and phone already exist as a pair, block duplicate
      if (
        existingUserByEmail && 
        existingProfileByMobile &&
        emailAssociatedMobile === mobile1Trimmed &&
        mobileAssociatedEmail === emailTrimmed
      ) {
        return res.status(409).json({
          error: "Therapist with this email and phone already exists.",
          details: {
            email: emailTrimmed,
            phone: mobile1Trimmed
          }
        });
      }
      if (errorMsg) {
        // Send full info in error, as per instruction
        return res.status(409).json({
          error: errorMsg,
          fullDetails: {
            associatedEmail: mobileAssociatedEmailFull,
            associatedMobile: emailAssociatedMobileFull
          }
        });
      }

      // ===== Therapist ID auto-generation using counter =====
      const therapistSeq = await getNextSequence("therapist");
      const therapistId = generateTherapistId(therapistSeq);

      // Create user document (role: therapist)
      // --- Save mobile1 to both 'phone' and (optionally) to any original mobile1 fields if ever required ---
      const user = await User.create({
        role: "therapist",
        name: fullName,
        email: email,
        authProvider: "otp",
        status: "active",
        phone: mobile1  // <<--- Added: Save mobile1 as phone in User schema
      });
      console.log("User document created:", user);

      // Create TherapistProfile (do NOT store email here) + add therapistId
      const therapistProfile = await TherapistProfile.create({
        userId: user._id,
        therapistId, // <-- new
        fathersName,
        mobile1,
        mobile2, // optional
        address,
        reference,
        aadhaarFront, // optional
        aadhaarBack, // optional
        photo, // optional
        resume, // optional
        certificate, // optional
        accountHolder, // optional
        bankName, // optional
        ifsc, // optional
        accountNumber, // optional
        upi, // optional
        linkedin, // optional
        twitter, // optional
        facebook, // optional
        instagram, // optional
        youtube, // optional
        website, // optional
        portfolio, // optional
        blog, // optional
        remarks, // optional
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

      const { email, phone, mobile1, ...profileFields } = req.body || {};
      console.log("[editTherapist] Incoming profileFields:", profileFields, "email:", email, "phone:", phone, "mobile1:", mobile1);

      Object.keys(profileFields).forEach(
        (key) => profileFields[key] === undefined && delete profileFields[key]
      );

      const updatedTherapist = await TherapistProfile.findByIdAndUpdate(
        id,
        profileFields,
        { new: true }
      );

      // Update email, and also phone if provided, in User document
      if (email || phone || mobile1) {
        const therapist = await TherapistProfile.findById(id);
        if (therapist && therapist.userId) {
          const userUpdate = {};
          if (email) userUpdate.email = email;
          // If phone or mobile1 is present in request, update User.phone
          if (typeof phone !== "undefined") {
            userUpdate.phone = phone;
          } else if (typeof mobile1 !== "undefined") {
            userUpdate.phone = mobile1;
          }
          if (Object.keys(userUpdate).length > 0) {
            console.log(`[editTherapist] Updating User (userId: ${therapist.userId}) with:`, userUpdate);
            await User.findByIdAndUpdate(therapist.userId, userUpdate);
          }
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

      // Delete User document as well
      if (therapist.userId) {
        await User.findByIdAndDelete(therapist.userId);
      }

      res.json({ success: true, message: "Therapist and associated user deleted successfully" });
    } catch (e) {
      res.status(400).json({ error: "Failed to delete therapist", details: e.message });
    }
  };
}

export default TherapistAdminController;
