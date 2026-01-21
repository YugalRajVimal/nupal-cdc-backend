import { User, TherapistProfile } from "../../Schema/user.schema.js";
import mongoose from "mongoose";
import Counter from "../../Schema/counter.schema.js";
import { deleteUploadedFiles } from "../../middlewares/fileDelete.middleware.js";

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

// const therapistSeq = await getNextSequence("therapist");
// const therapistId = generateTherapistId(therapistSeq);

class TherapistAdminController {
  // Add therapist


  addTherapist = async (req, res) => {
    // Collect Multer filepaths from fields (see @therapist-admin.routes.js (19-33))
    // req.files is an object like: { aadhaarFront: [...], aadhaarBack: [...], photo: [...], resume: [...], certificate: [...] }
    const uploadedFiles = req.files;

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
        // Do NOT take: aadhaarFront, aadhaarBack, photo, resume, certificate from req.body (should come from multer files)
      } = req.body;

      // Get the filepaths to store into DB (if files uploaded)
      const fileFields = [
        "aadhaarFront",
        "aadhaarBack",
        "photo",
        "resume",
        "certificate"
      ];

      // For each field, if file was uploaded, get correct filepath
      const filePaths = {};
      for (const field of fileFields) {
        if (uploadedFiles && uploadedFiles[field] && uploadedFiles[field][0]) {
          // Only save path relative from ./Uploads, e.g., "Uploads/Therapist/...", or Multer's full path
          filePaths[field] = uploadedFiles[field][0].path;
        } else {
          filePaths[field] = undefined; // allow undefined for optional
        }
      }

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
        // Clean up files before responding
        deleteUploadedFiles(uploadedFiles);
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
        deleteUploadedFiles(uploadedFiles);
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
        deleteUploadedFiles(uploadedFiles);
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
      let user;
      try {
        user = await User.create({
          role: "therapist",
          name: fullName,
          email: email,
          authProvider: "otp",
          status: "active",
          phone: mobile1,  // <<--- Added: Save mobile1 as phone in User schema
incompleteTherapistProfile:false
        });
      } catch (err) {
        // Likely a unique constraint error (duplicate email, etc)
        console.log("[addTherapist] User.create error, cleaning up uploaded files");
        deleteUploadedFiles(uploadedFiles);
        throw err;
      }
      console.log("User document created:", user);

      // Create TherapistProfile (do NOT store email here) + add therapistId
      let therapistProfile;
      try {
        therapistProfile = await TherapistProfile.create({
          userId: user._id,
          therapistId, // <-- new
          fathersName,
          mobile1,
          mobile2, // optional
          address,
          reference,
          aadhaarFront: filePaths.aadhaarFront,  // <-- Use uploaded file path
          aadhaarBack: filePaths.aadhaarBack,
          photo: filePaths.photo,
          resume: filePaths.resume,
          certificate: filePaths.certificate,
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
          experienceYears,
          isPanelAccessible: false, 
          // email is NOT stored in TherapistProfile
        });
      } catch (err) {
        // If therapist profile fails, clean up: remove created user and any files
        console.log("[addTherapist] TherapistProfile.create error, cleaning up user and files");
        await User.findByIdAndDelete(user._id).catch(() => {});
        deleteUploadedFiles(uploadedFiles);
        throw err;
      }
      console.log("TherapistProfile document created:", therapistProfile);

      res.status(201).json({ user, therapistProfile });
    } catch (e) {
      console.log("Error in addTherapist:", e);
      // Clean up any files that were uploaded
      deleteUploadedFiles(req.files);
      res.status(400).json({ error: "Failed to add therapist", details: e.message });
    }
  };

  // Fetch all therapists
  fetchTherapists = async (req, res) => {


    try {
      // Populate userId so email appears in .userId.email
      const therapists = await TherapistProfile.find().populate({
        path: "userId"
      });



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

  /**
   * Pay therapist (append to therapist.earnings array)
   * POST /api/admin/therapists/:id/pay
   * body: { amount, type, fromDate, toDate, remark, paidOn }
   * type: "salary" | "contract"
   */
  payTherapist = async (req, res) => {
    try {
      const { id } = req.params; // TherapistProfile _id
      const { amount, type, fromDate, toDate, remark, paidOn } = req.body;

      // Validate therapist id
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }
      // Validate amount, type, fromDate, toDate
      if (
        typeof amount !== "number" ||
        amount <= 0 ||
        !["salary", "contract"].includes(type) ||
        !fromDate ||
        !toDate
      ) {
        return res.status(400).json({ error: "Missing or invalid payment details" });
      }

      const therapist = await TherapistProfile.findById(id);
      if (!therapist) {
        return res.status(404).json({ error: "Therapist not found" });
      }

      // Construct payment object as per schema
      const payment = {
        amount,
        type,
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
        remark: remark || "",
        paidOn: paidOn ? new Date(paidOn) : new Date(),
      };

      // Append to earnings array
      therapist.earnings.push(payment);
      await therapist.save();

      // ----- Add entry in Finances schema -----
      // Finances fields: date, description, type, amount, creditDebitStatus
      // We'll store:
      // - date: paidOn or now
      // - description: Salary/Contract payment to therapist <name/therapistId> for period <fromDate> - <toDate> [remark]
      // - type: 'expense'
      // - amount
      // - creditDebitStatus: 'debited'
      const Finances = (await import("../../Schema/finances.schema.js")).default;

      let description = `Therapist ${type} payment to ${therapist.name || therapist.therapistId || therapist._id} for ${fromDate} to ${toDate}`;
      if (remark) {
        description += ` [${remark}]`;
      }

      const financesDoc = await Finances.create({
        date: payment.paidOn,
        description,
        type: "expense",
        amount: payment.amount,
        creditDebitStatus: "debited"
      });

      res.json({
        success: true,
        message: "Therapist paid and earning added.",
        earnings: therapist.earnings,
        payment,
        finance: financesDoc
      });
    } catch (e) {
      res.status(400).json({ error: "Failed to pay therapist", details: e.message });
    }
  }

  /**
   * Disable a therapist (set their User 'isDisabled' = true)
   * PATCH /api/admin/therapists/:id/disable
   */
  disableTherapist = async (req, res) => {
    try {
      const { id } = req.params; // TherapistProfile _id
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }
      const therapist = await TherapistProfile.findById(id);
      if (!therapist || !therapist.userId) {
        return res.status(404).json({ error: "Therapist not found" });
      }

      await User.findByIdAndUpdate(therapist.userId, { isDisabled: true });
      res.json({ success: true, message: "Therapist disabled successfully" });
    } catch (e) {
      res.status(400).json({ error: "Failed to disable therapist", details: e.message });
    }
  };

  /**
   * Enable a therapist (set their User 'isDisabled' = false)
   * PATCH /api/admin/therapists/:id/enable
   */
  enableTherapist = async (req, res) => {
    try {
      const { id } = req.params; // TherapistProfile _id
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }
      const therapist = await TherapistProfile.findById(id);
      if (!therapist || !therapist.userId) {
        return res.status(404).json({ error: "Therapist not found" });
      }

      await User.findByIdAndUpdate(therapist.userId, { isDisabled: false });
      res.json({ success: true, message: "Therapist enabled successfully" });
    } catch (e) {
      res.status(400).json({ error: "Failed to enable therapist", details: e.message });
    }
  };

  /**
   * Set therapist panel accessibility (set TherapistProfile.isPanelAccessible)
   * PATCH /api/admin/therapists/:id/panel-access
   * body: { isPanelAccessible: true/false }
   */
  setPanelAccessible = async (req, res) => {
    try {
      const { id } = req.params; // TherapistProfile _id
      const { isPanelAccessible } = req.body;

      console.log("[setPanelAccessible] Params.id:", id);
      console.log("[setPanelAccessible] Body.isPanelAccessible:", isPanelAccessible);

      if (!mongoose.Types.ObjectId.isValid(id)) {
        console.log("[setPanelAccessible] Invalid therapist profile ID");
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }
      if (typeof isPanelAccessible !== "boolean") {
        console.log("[setPanelAccessible] isPanelAccessible is NOT boolean:", typeof isPanelAccessible);
        return res.status(400).json({ error: "isPanelAccessible must be boolean" });
      }

      const therapist = await TherapistProfile.findByIdAndUpdate(
        id,
        { isPanelAccessible },
        { new: true }
      );
      console.log("[setPanelAccessible] Therapist after update:", therapist);

      if (!therapist) {
        console.log("[setPanelAccessible] Therapist not found for id:", id);
        return res.status(404).json({ error: "Therapist not found" });
      }
      res.json({ success: true, therapist });
    } catch (e) {
      console.log("[setPanelAccessible] Error:", e);
      res.status(400).json({ error: "Failed to update panel accessibility", details: e.message });
    }
  };


  /**
   * Set holidays for therapist (full day range or partial slots)
   * POST /api/admin/therapist/:id/holidays
   * Body:
   *   - Full day: { fromDate, toDate }
   *   - Partial day: { date, slots }
   */
  setHolidays = async (req, res) => {
    try {
      const { id } = req.params; // TherapistProfile _id
      const { fromDate, toDate, date, slots } = req.body;

      // Validate therapist profile ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }

      // Fetch therapist
      const therapist = await TherapistProfile.findById(id);
      if (!therapist) {
        return res.status(404).json({ error: "Therapist not found" });
      }

      // Helper: extract 'YYYY-MM-DD' from input
      function extractDateString(str) {
        if (!str) return null;
        const match = /^(\d{4}-\d{2}-\d{2})/.exec(str);
        return match ? match[1] : null;
      }

      // ---- Setup for checking availability ----
      // Import Booking (do NOT move to toplevel, since AdminController uses ESM and .default needed)
      const Booking = (await import("../../Schema/booking.schema.js")).default;

      // Session slot options (for slot label resolution)
      const sessionOptions = [
        { id: '1000-1045', label: '10:00 to 10:45' },
        { id: '1045-1130', label: '10:45 to 11:30' },
        { id: '1130-1215', label: '11:30 to 12:15' },
        { id: '1215-1300', label: '12:15 to 13:00' },
        { id: '1300-1345', label: '13:00 to 13:45' },
        { id: '1415-1500', label: '14:15 to 15:00' },
        { id: '1500-1545', label: '15:00 to 15:45' },
        { id: '1545-1630', label: '15:45 to 16:30' },
        { id: '1630-1715', label: '16:30 to 17:15' },
        { id: '1715-1800', label: '17:15 to 18:00' },
        { id: '0830-0915', label: '08:30 to 09:15' },
        { id: '0915-1000', label: '09:15 to 10:00' },
        { id: '1800-1845', label: '18:00 to 18:45' },
        { id: '1845-1930', label: '18:45 to 19:30' },
        { id: '1930-2015', label: '19:30 to 20:15' }
      ];

      // Utility: session is not cancelled or deleted
      function isActiveSession(sess) {
        return (
          sess &&
          (!sess.status || !["cancelled", "cancelledByTherapist", "deleted"].includes(sess.status))
        );
      }

      // ---- FULL DAY HOLIDAY ----
      if (fromDate && toDate) {
        const fromStr = extractDateString(fromDate);
        const toStr = extractDateString(toDate);

        if (!fromStr || !toStr) {
          return res.status(400).json({ error: "Invalid fromDate/toDate format" });
        }

        const from = new Date(fromStr + "T00:00:00Z");
        const to = new Date(toStr + "T00:00:00Z");

        if (from > to) {
          return res.status(400).json({ error: "fromDate cannot be after toDate" });
        }

        // Gather all date strings in the range, inclusive
        let dateIter = new Date(from.getTime());
        const dateStrings = [];
        while (dateIter <= to) {
          dateStrings.push(dateIter.toISOString().slice(0, 10));
          dateIter.setUTCDate(dateIter.getUTCDate() + 1);
        }

        // Check for existing bookings for THIS therapist on ANY of those dates
        const sessionDatesQuery = {
          therapist: therapist._id,
          "sessions.date": { $in: dateStrings }
        };
        const bookings = await Booking.find(sessionDatesQuery, {sessions: 1}).lean();

        // Find conflicting dates (dates where therapist has an active session)
        const bookedDates = new Set();
        for (const bk of bookings) {
          if (Array.isArray(bk.sessions)) {
            for (const sess of bk.sessions) {
              if (
                sess.date &&
                dateStrings.includes(sess.date) &&
                isActiveSession(sess)
              ) {
                bookedDates.add(sess.date);
              }
            }
          }
        }

        if (bookedDates.size > 0) {
          return res.status(400).json({
            error: `Cannot set holiday: Therapist already has session(s) on ${Array.from(bookedDates).join(", ")}.`
          });
        }

        // No conflict - proceed to set holidays
        let holidaysToAdd = [];
        for (const dateStr of dateStrings) {
          const foundIdx = therapist.holidays.findIndex(h =>
            h.date && h.date === dateStr
          );
          if (foundIdx !== -1) {
            therapist.holidays[foundIdx].isFullDay = true;
            therapist.holidays[foundIdx].slots = [];
            therapist.holidays[foundIdx].date = dateStr;
          } else {
            holidaysToAdd.push({
              date: dateStr,
              reason: "",
              slots: [],
              isFullDay: true
            });
          }
        }
        therapist.holidays.push(...holidaysToAdd);

        await therapist.save();
        return res.json({
          success: true,
          message: "Holiday(s) set for full day date range",
          holidays: therapist.holidays
        });
      }

      // ---- PARTIAL (SLOTS) HOLIDAY ----
      if (date && Array.isArray(slots) && slots.length > 0) {
        const holidayDateStr = extractDateString(date);
        if (!holidayDateStr) {
          return res.status(400).json({ error: "Invalid date format" });
        }

        // Format slots as: [{ slotId, label }]
        const slotsToSave = slots
          .map(slotId => {
            const found = sessionOptions.find(s => s.id === slotId);
            if (!found) return null;
            return { slotId: found.id, label: found.label };
          })
          .filter(Boolean);

        if (slotsToSave.length === 0) {
          return res.status(400).json({ error: "No valid slots selected" });
        }

        // Check if this therapist has any session on this date and slot
        const sessionsQuery = {
          therapist: therapist._id,
          "sessions.date": holidayDateStr,
          "sessions.id": { $in: slots }
        };
        // We must check all sessions for the requested slot(s) on that date
        const bookings = await Booking.find(sessionsQuery, { sessions: 1 }).lean();
        let blockedSlots = new Set();
        for (const bk of bookings) {
          if (Array.isArray(bk.sessions)) {
            for (const sess of bk.sessions) {
              if (
                sess.date === holidayDateStr &&
                slots.includes(sess.id) &&
                isActiveSession(sess)
              ) {
                blockedSlots.add(sess.id);
              }
            }
          }
        }

        if (blockedSlots.size > 0) {
          // Return slot labels
          const blockedLabels = Array.from(blockedSlots).map(blockedId => {
            const found = sessionOptions.find(o => o.id === blockedId);
            return found ? found.label : blockedId;
          });
          return res.status(400).json({
            error: `Cannot set holiday: Therapist already has session(s) for slot(s): ${blockedLabels.join(", ")} on ${holidayDateStr}.`
          });
        }

        // No conflicts - set holiday for ONLY allowed slots
        const existingIdx = therapist.holidays.findIndex(
          h => h.date && h.date === holidayDateStr
        );
        if (existingIdx !== -1) {
          therapist.holidays[existingIdx].isFullDay = false;
          therapist.holidays[existingIdx].slots = slotsToSave;
          therapist.holidays[existingIdx].date = holidayDateStr;
        } else {
          therapist.holidays.push({
            date: holidayDateStr, // Store as string "YYYY-MM-DD"
            reason: "",
            slots: slotsToSave,
            isFullDay: false
          });
        }
        await therapist.save();
        return res.json({
          success: true,
          message: "Partial holiday set for date",
          holidays: therapist.holidays
        });
      }

      return res.status(400).json({ error: "Invalid request. Please provide fromDate/toDate (full), or date and slots (partial)." });
    } catch (e) {
      console.error("[setHolidays] Error:", e);
      res.status(400).json({ error: "Error setting therapist holidays", details: e.message });
    }
  };

  
}

export default TherapistAdminController;
