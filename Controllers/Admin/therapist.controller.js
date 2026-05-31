import { User, TherapistProfile } from "../../Schema/user.schema.js";
import mongoose from "mongoose";
import Counter from "../../Schema/counter.schema.js";
import { deleteUploadedFiles } from "../../middlewares/fileDelete.middleware.js";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";
import WhatsappController from "../Whatsapp/whatsapp.js";


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
          phone: mobile1,
          incompleteTherapistProfile: false
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
          therapistId,
          fathersName,
          mobile1,
          mobile2, // optional
          address,
          reference,
          aadhaarFront: filePaths.aadhaarFront,
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
          isPanelAccessible: false
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

      // ---- AUDIT LOG: Therapist added ----
      try {
        await AuditLogService.addLog({
          action: "THERAPIST_ONBOARDED",
          user: req.user?.id,
          role: "admin",
          resource: "Therapist",
          resourceId: therapistProfile._id,
          details: {
            therapistId: therapistProfile.therapistId,
            fullName: fullName,
            email: email,
            mobile1: mobile1,
            message: `Therapist profile created for ${fullName} (${email})`
          },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        });
      } catch (logErr) {
        // If logging fails, clean up everything to maintain parity with patient.controller.js
        await TherapistProfile.findByIdAndDelete(therapistProfile._id).catch(() => {});
        await User.findByIdAndDelete(user._id).catch(() => {});
        deleteUploadedFiles(uploadedFiles);
        return res.status(500).json({
          success: false,
          message: "Failed to write audit log. Therapist creation not saved.",
          error: logErr.message
        });
      }

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
      // Destructure query params, only allow search input, remove both filters
      let {
        page = 1,
        pageSize = 20,
        search = "",
        sortField = "therapistId", // Default: sort by therapistId (NPL001 format)
        sortOrder = "desc"
      } = req.query;

      page = parseInt(page, 10) || 1;
      pageSize = parseInt(pageSize, 10) || 20;

      // No filters -- just fetch all
      let query = {};

      // Always sort by therapistId as string, but descending (bigger on top)
      // NPL001, NPL002... so sort lexicographically desc for "bigger on top"
      let sortObj = {};
      if (sortField === "therapistId") {
        sortObj["therapistId"] = sortOrder === "asc" ? 1 : -1; 
      } else if (sortField) {
        sortObj[sortField] = sortOrder === "asc" ? 1 : -1;
      }

      // Fetch all matching therapists, populate userId for searching in populated data
      let therapists = await TherapistProfile.find(query)
        .populate({ path: "userId" })
        .sort(sortObj)
        .lean();

      // Search logic: filter over both TherapistProfile and populated userId.* fields in-memory
      if (search && typeof search === "string" && search.trim().length > 0) {
        const regex = new RegExp(search.trim(), "i");
        therapists = therapists.filter(t => {
          // Search fields direct in TherapistProfile
          const matchesTherapist = 
            (t.fullName && regex.test(t.fullName)) ||
            (t.name && regex.test(t.name)) || // fallback for any legacy use
            (t.mobile1 && regex.test(t.mobile1)) ||
            (t.mobile2 && regex.test(t.mobile2)) ||
            (t.reference && regex.test(t.reference)) ||
            (t.therapistId && regex.test(t.therapistId)) ||
            (t.specializations && regex.test(t.specializations));

          // Search in populated userId fields
          const matchesUser = t.userId && (
            (t.userId.email && regex.test(t.userId.email)) ||
            (t.userId.name && regex.test(t.userId.name)) ||
            (t.userId.phone && regex.test(t.userId.phone)) ||
            (t.userId.role && regex.test(t.userId.role))
          );

          return matchesTherapist || matchesUser;
        });

        // Resort filtered results by therapistId, desc (bigger on top)
        therapists.sort((a, b) => {
          if (a.therapistId && b.therapistId) {
            if (a.therapistId < b.therapistId) return sortOrder === "asc" ? -1 : 1;
            if (a.therapistId > b.therapistId) return sortOrder === "asc" ? 1 : -1;
            return 0;
          }
          // If therapistId missing, those items go below
          if (!a.therapistId) return 1;
          if (!b.therapistId) return -1;
          return 0;
        });
      }

      // No other filters

      const total = therapists.length;

      // Pagination
      const offset = (page - 1) * pageSize;
      const pagedTherapists = therapists.slice(offset, offset + pageSize);

      res.json({
        therapists: pagedTherapists,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
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

  // Edit therapist profile (with mandatory log creation and MongoDB transactions)
  editTherapist = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      console.log("[editTherapist] Called with id:", id);

      if (!mongoose.Types.ObjectId.isValid(id)) {
        console.log("[editTherapist] Invalid therapist profile ID:", id);
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }

      const { email, phone, mobile1, name, ...profileFields } = req.body || {};
      console.log("[editTherapist] Incoming profileFields:", profileFields, "email:", email, "phone:", phone, "mobile1:", mobile1, "name:", name);

      Object.keys(profileFields).forEach(
        (key) => profileFields[key] === undefined && delete profileFields[key]
      );

      // Get current TherapistProfile for diff
      const oldTherapist = await TherapistProfile.findById(id).session(session);
      if (!oldTherapist) {
        console.log("[editTherapist] Therapist not found for id:", id);
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Therapist not found" });
      }
      const oldProfile = oldTherapist.toObject();

      // Update TherapistProfile document
      const updatedTherapist = await TherapistProfile.findByIdAndUpdate(
        id,
        profileFields,
        { new: true, session }
      );

      // Track which file fields were updated/uploaded
      const fileFields = [
        "aadhaarFront",
        "aadhaarBack",
        "photo",
        "resume",
        "certificate"
      ];

      // Only record diff for profile fields excluding forbidden fields (but special logic for fileFields)
      const excludedFields = new Set([
        "holidays",
        "earnings"
      ]);
      const changedFields = {};

      for (const key of Object.keys(profileFields)) {
        if (excludedFields.has(key)) continue;

        const fromVal = oldProfile[key];
        const toVal = updatedTherapist[key];

        if (fileFields.includes(key)) {
          // Determine if a file was actually uploaded for this key
          // Log only if there is any real file upload (value changes to something truthy different from before)
          if (
            // Case 1: uploading a new file (from null/undefined/empty to some value/string)
            (
              (fromVal === null || typeof fromVal === "undefined" || fromVal === "") &&
              (typeof toVal !== "undefined" && toVal !== null && toVal !== "")
            )
            ||
            // Case 2: changing file (from one value to a different nonempty value)
            (
              (typeof fromVal !== "undefined" && fromVal !== null && fromVal !== "") &&
              (typeof toVal !== "undefined" && toVal !== null && toVal !== "") &&
              (String(fromVal) !== String(toVal))
            )
          ) {
            changedFields[key] = { from: fromVal, to: toVal };
          }
          // else: do not record this file field if not actually uploaded/changed
          continue;
        }

        // For non-file fields:
        if (
          (fromVal === null || typeof fromVal === "undefined" || fromVal === "") && 
          (toVal === null || typeof toVal === "undefined" || toVal === "")
        ) {
          continue;
        }
        if (String(fromVal) !== String(toVal)) {
          changedFields[key] = { from: fromVal, to: toVal };
        }
      }

      // Handle User (email/phone/name) updates separately; only include them if changed
      let userChangedFields = {};
      if (email || phone || mobile1 || name) {
        const therapist = await TherapistProfile.findById(id).session(session);
        if (therapist && therapist.userId) {
          const user = await User.findById(therapist.userId).session(session);
          const userUpdate = {};
          if (email && email !== user.email) {
            userUpdate.email = email;
            userChangedFields.email = { from: user.email, to: email };
          }
          if (typeof phone !== "undefined" && phone !== user.phone) {
            userUpdate.phone = phone;
            userChangedFields.phone = { from: user.phone, to: phone };
          } else if (typeof mobile1 !== "undefined" && mobile1 !== user.phone) {
            userUpdate.phone = mobile1;
            userChangedFields.phone = { from: user.phone, to: mobile1 };
          }
          if (typeof name !== "undefined" && name !== user.name) {
            userUpdate.name = name;
            userChangedFields.name = { from: user.name, to: name };
          }
          if (Object.keys(userUpdate).length > 0) {
            console.log(`[editTherapist] Updating User (userId: ${therapist.userId}) with:`, userUpdate);
            await User.findByIdAndUpdate(therapist.userId, userUpdate, { session });
          }
        }
      }

      // Merge edited fields to be logged
      const allEditedFields = { ...changedFields, ...userChangedFields };

      // Remove non-file audit-excluded fields if present (but file fields logic already handled above)
      for (const excluded of [
        "holidays",
        "earnings"
      ]) {
        if (
          Object.prototype.hasOwnProperty.call(allEditedFields, excluded)
        ) {
          delete allEditedFields[excluded];
        }
      }

      console.log("[editTherapist] Updated therapist profile:", updatedTherapist);

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "THERAPIST_PROFILE_EDITED",
            user: req?.user?.id,
            role: req?.user?.role,
            resource: "Therapist",
            resourceId: id,
            details: {
              changedFields: allEditedFields,
              message: `Therapist profile edited for therapistId=${id} by userId=${req?.user?.id || "SYSTEM"}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        console.error("[editTherapist] Error writing audit log (aborting transaction):");
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ error: "Audit log creation failed. Changes not saved." });
      }

      await session.commitTransaction();
      session.endSession();

      res.json({ therapist: updatedTherapist });
    } catch (e) {
      console.error("[editTherapist] Error editing therapist (transaction will be aborted):", e);
      await session.abortTransaction();
      session.endSession();
      res.status(400).json({ error: "Error editing therapist", details: e.message });
    }
  };


  payTherapist = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params; // TherapistProfile _id
      const { amount, type, fromDate, toDate, remark, paidOn } = req.body;

      // Debug: log incoming request parameters for payTherapist
      if (process.env.NODE_ENV !== "production") {
        console.log("[payTherapist] Received params:", {
          id,
          amount,
          type,
          fromDate,
          toDate,
          remark,
          paidOn,
        });
      }

      // Validate therapist id
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await session.abortTransaction();
        session.endSession();
        if (process.env.NODE_ENV !== "production") {
          console.log("[payTherapist] Invalid therapist profile ID:", id);
        }
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
        await session.abortTransaction();
        session.endSession();
        if (process.env.NODE_ENV !== "production") {
          console.log("[payTherapist] Validation error: ", {
            amount,
            type,
            fromDate,
            toDate
          });
        }
        return res.status(400).json({ error: "Missing or invalid payment details" });
      }

      const therapist = await TherapistProfile.findById(id).session(session);
      if (!therapist) {
        await session.abortTransaction();
        session.endSession();
        if (process.env.NODE_ENV !== "production") {
          console.log("[payTherapist] Therapist not found:", id);
        }
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

      // Append to earnings array and save within session
      therapist.earnings.push(payment);

      if (process.env.NODE_ENV !== "production") {
        console.log("[payTherapist] Adding payment to therapist.earnings:", payment);
      }
      await therapist.save({ session });

      // ----- Add entry in Finances schema -----
      const Finances = (await import("../../Schema/finances.schema.js")).default;

      let description = `Therapist ${type} payment to ${therapist.name || therapist.therapistId || therapist._id} for ${fromDate} to ${toDate}`;
      if (remark) {
        description += ` [${remark}]`;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log("[payTherapist] Creating Finances document with description:", description);
      }
      const financesDoc = await Finances.create([{
        date: payment.paidOn,
        description,
        type: "expense",
        amount: payment.amount,
        creditDebitStatus: "debited"
      }], { session });
      const financeDocObj = financesDoc && Array.isArray(financesDoc) ? financesDoc[0] : financesDoc;

      // ====== Audit Log using AuditLogService (must succeed for transaction) ======
      try {
        await AuditLogService.addLog(
          {
            action: "THERAPIST_PAID",
            user: req?.user?.id,
            role: req?.user?.role,
            resource: "Therapist",
            resourceId: id,
            details: {
              amount,
              type,
              fromDate,
              toDate,
              remark: remark || "",
              paidOn: payment.paidOn,
              financeId: financeDocObj?._id?.toString() || undefined,
              message: `Therapist paid (amount=${amount}, type=${type}) by userId=${req?.user?.id || "SYSTEM"} for therapistId=${id}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
        if (process.env.NODE_ENV !== "production") {
          console.log("[payTherapist] Audit log written for therapist payment");
        }
      } catch (elog) {
        console.error("[payTherapist] Error writing audit log (aborting transaction):", elog);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ error: "Audit log creation failed. Changes not saved." });
      }

      await session.commitTransaction();
      session.endSession();

      // ---- WhatsApp notification logic ----
      try {
        // Import WhatsappController only after transaction success to avoid cyclic issues
        // Get destination (therapist's phone number) from TherapistProfile or maybe from related User doc
        // Prefer: therapist.mobile1, then therapist.phone, then therapist.contact
        let destination = null;
        if (therapist.mobile1 && typeof therapist.mobile1 === "string" && therapist.mobile1.trim()) {
          destination = therapist.mobile1.trim();
        } else if (therapist.phone && typeof therapist.phone === "string" && therapist.phone.trim()) {
          destination = therapist.phone.trim();
        } else if (therapist.contact && typeof therapist.contact === "string" && therapist.contact.trim()) {
          destination = therapist.contact.trim();
        }

        // therapistName: use therapist.name or therapist.therapistId or empty string for WhatsApp template
        const therapistName = therapist.name || therapist.therapistId || "";

        // Get userName for WhatsApp: could be therapist.name, or fallback to empty string
        // If TherapistProfile ref to User is available, try to get user.name
        let userName = therapist.userName || therapist.name || "";
        if (!userName && therapist.userId) {
          // Try to fetch User doc
          const foundUser = await User.findById(therapist.userId).lean();
          if (foundUser && foundUser.name) {
            userName = foundUser.name;
          }
        }

        // periodFrom, periodTo, paidOn - format as yyyy-mm-dd strings
        const formatISODate = d => {
          if (!d) return "";
          try {
            // Accepts Date obj or string
            const dateObj = typeof d === "string" ? new Date(d) : d;
            return dateObj.toISOString().slice(0, 10);
          } catch { return ""; }
        };

        if (process.env.NODE_ENV !== "production") {
          console.log("[payTherapist] WhatsApp notification destination:", destination);
        }

        if (destination) {
          await WhatsappController.sendTherapistPaymentInitiated({
            destination,
            userName: userName || "",
            therapistName: therapistName
              ? `${therapistName} (${therapist.therapistId || therapist._id || ""})`
              : `${therapist.therapistId || therapist._id || ""}`,
       
            amountPaid: amount != null ? String(amount) : "",
            paymentType: type || "",
            periodFrom: formatISODate(fromDate),
            periodTo: formatISODate(toDate),
            paidOn: formatISODate(payment.paidOn)
          });

          if (process.env.NODE_ENV !== "production") {
            console.log("[payTherapist] WhatsApp notification sent for therapistId:", therapist._id);
          }
        } else {
          console.warn("[payTherapist] No available WhatsApp destination for therapist ID:", therapist._id);
        }
      } catch (whatsAppErr) {
        // DO NOT block main response, just log
        console.error("[payTherapist] Failed to send WhatsApp notification:", whatsAppErr);
      }

      // --- Final success response ---
      if (process.env.NODE_ENV !== "production") {
        console.log("[payTherapist] Therapist paid successfully. Returning response for therapistId:", id);
      }
      res.json({
        success: true,
        message: "Therapist paid and earning added.",
        earnings: therapist.earnings,
        payment,
        finance: financeDocObj
      });
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      console.error("[payTherapist] Exception caught in catch block:", e);
      res.status(400).json({ error: "Failed to pay therapist", details: e.message });
    }
  }

  /**
   * Disable a therapist (set their User 'isDisabled' = true)
   * PATCH /api/admin/therapists/:id/disable
   */
  disableTherapist = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params; // TherapistProfile _id
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }
      const therapist = await TherapistProfile.findById(id).session(session);
      if (!therapist || !therapist.userId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Therapist not found" });
      }

      await User.findByIdAndUpdate(therapist.userId, { isDisabled: true }, { session });

      // ====== Audit Log (same style as payTherapist, using AuditLogService.addLog) ======
      try {

        await AuditLogService.addLog(
          {
            action: "THERAPIST_DISABLED",
            user: req?.user?.id,
            role: req?.user?.role,
            resource: "Therapist",
            resourceId: id,
            details: {
              userId: therapist.userId?.toString(),
              therapistProfileId: id,
              message: `Therapist userId=${therapist.userId} disabled by userId=${req?.user?.id || "SYSTEM"}. TherapistProfile=${id}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        console.error("[disableTherapist] Error writing audit log (aborting transaction):", elog);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ error: "Audit log creation failed. Changes not saved." });
      }

      await session.commitTransaction();
      session.endSession();
      res.json({ success: true, message: "Therapist disabled successfully" });
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      res.status(400).json({ error: "Failed to disable therapist", details: e.message });
    }
  };

  /**
   * Enable a therapist (set their User 'isDisabled' = false)
   * PATCH /api/admin/therapists/:id/enable
   */
  enableTherapist = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params; // TherapistProfile _id
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }
      const therapist = await TherapistProfile.findById(id).session(session);
      if (!therapist || !therapist.userId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Therapist not found" });
      }

      await User.findByIdAndUpdate(therapist.userId, { isDisabled: false }, { session });

      // ====== Audit Log (same style as payTherapist, using AuditLogService.addLog) ======
      try {

        await AuditLogService.addLog(
          {
            action: "THERAPIST_ENABLED",
            user: req?.user?.id,
            role: req?.user?.role,
            resource: "Therapist",
            resourceId: id,
            details: {
              userId: therapist.userId?.toString(),
              therapistProfileId: id,
              message: `Therapist userId=${therapist.userId} enabled by userId=${req?.user?.id || "SYSTEM"}. TherapistProfile=${id}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        console.error("[enableTherapist] Error writing audit log (aborting transaction):", elog);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ error: "Audit log creation failed. Changes not saved." });
      }

      await session.commitTransaction();
      session.endSession();
      res.json({ success: true, message: "Therapist enabled successfully" });
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      res.status(400).json({ error: "Failed to enable therapist", details: e.message });
    }
  };

  /**
   * Set therapist panel accessibility (set TherapistProfile.isPanelAccessible)
   * PATCH /api/admin/therapists/:id/panel-access
   * body: { isPanelAccessible: true/false }
   */
  setPanelAccessible = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params; // TherapistProfile _id
      const { isPanelAccessible } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }
      if (typeof isPanelAccessible !== "boolean") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "isPanelAccessible must be boolean" });
      }

      const therapist = await TherapistProfile.findByIdAndUpdate(
        id,
        { isPanelAccessible },
        { new: true, session }
      );

      if (!therapist) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Therapist not found" });
      }

      // ====== Audit Log (same style as enableTherapist, using AuditLogService.addLog) ======
      try {
        await AuditLogService.addLog(
          {
            action: "SET_PANEL_ACCESSIBLE",
            user: req?.user?.id,
            role: req?.user?.role,
            resource: "Therapist",
            resourceId: id,
            details: {
              userId: therapist.userId?.toString?.() || undefined,
              therapistProfileId: id,
              isPanelAccessible,
              message: `Panel accessibility set to isPanelAccessible=${isPanelAccessible} for therapistId=${id} by userId=${req?.user?.id || "SYSTEM"}.`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        console.error("[setPanelAccessible] Error writing audit log (aborting transaction):", elog);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ error: "Audit log creation failed. Changes not saved." });
      }

      await session.commitTransaction();
      session.endSession();
      res.json({ success: true, therapist });
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
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
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params; // TherapistProfile _id
      const { fromDate, toDate, date, slots } = req.body;

      // Validate therapist profile ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Invalid therapist profile ID" });
      }

      // Fetch therapist with transaction
      const therapist = await TherapistProfile.findById(id).session(session);
      if (!therapist) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Therapist not found" });
      }

      // Helper: extract 'YYYY-MM-DD' from input
      function extractDateString(str) {
        if (!str) return null;
        const match = /^(\d{4}-\d{2}-\d{2})/.exec(str);
        return match ? match[1] : null;
      }

      // Import Booking (do NOT move to top-level)
      const Booking = (await import("../../Schema/booking.schema.js")).default;

      // Session slot options
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
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: "Invalid fromDate/toDate format" });
        }

        const from = new Date(fromStr + "T00:00:00Z");
        const to = new Date(toStr + "T00:00:00Z");

        if (from > to) {
          await session.abortTransaction();
          session.endSession();
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
          await session.abortTransaction();
          session.endSession();
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

        await therapist.save({ session });

        // ====== Audit Log (use AuditLogService.addLog, with transaction) ======
        try {
          await AuditLogService.addLog(
            {
              action: "SET_HOLIDAYS_FULL",
              user: req?.user?.id,
              role: req?.user?.role,
              resource: "Therapist",
              resourceId: id,
              details: {
                userId: therapist.userId?.toString?.() || undefined,
                therapistProfileId: id,
                fromDate: fromDate,
                toDate: toDate,
                dateStringsSet: dateStrings,
                isFullDay: true,
                message: `Set full-day holidays for dates ${fromDate} to ${toDate}, therapistId=${id} by userId=${req?.user?.id || "SYSTEM"}.`
              },
              ipAddress: req.ip,
              userAgent: req.headers["user-agent"]
            },
            { session }
          );
        } catch (elog) {
          console.error("[setHolidays] Error writing audit log, aborting transaction:", elog);
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({ error: "Audit log creation failed. Changes not saved." });
        }

        await session.commitTransaction();
        session.endSession();
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
          await session.abortTransaction();
          session.endSession();
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
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({ error: "No valid slots selected" });
        }

        // Check if this therapist has any session on this date and slot
        const sessionsQuery = {
          therapist: therapist._id,
          "sessions.date": holidayDateStr,
          "sessions.id": { $in: slots }
        };

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
          await session.abortTransaction();
          session.endSession();
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
        await therapist.save({ session });

        // ====== Audit Log (use AuditLogService.addLog, with transaction) ======
        try {
          await AuditLogService.addLog(
            {
              action: "SET_HOLIDAYS_PARTIAL",
              user: req?.user?.id,
              role: req?.user?.role,
              resource: "Therapist",
              resourceId: id,
              details: {
                userId: therapist.userId?.toString?.() || undefined,
                therapistProfileId: id,
                date: holidayDateStr,
                slots: slotsToSave,
                isFullDay: false,
                message: `Set partial-slot holiday for date ${holidayDateStr}, therapistId=${id} by userId=${req?.user?.id || "SYSTEM"}.`
              },
              ipAddress: req.ip,
              userAgent: req.headers["user-agent"]
            },
            { session }
          );
        } catch (elog) {
          console.error("[setHolidays] Error writing audit log, aborting transaction:", elog);
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({ error: "Audit log creation failed. Changes not saved." });
        }

        await session.commitTransaction();
        session.endSession();
        return res.json({
          success: true,
          message: "Partial holiday set for date",
          holidays: therapist.holidays
        });
      }

      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: "Invalid request. Please provide fromDate/toDate (full), or date and slots (partial)." });
    } catch (e) {
      console.error("[setHolidays] Error:", e);
      await session.abortTransaction();
      session.endSession();
      res.status(400).json({ error: "Error setting therapist holidays", details: e.message });
    }
  };

/**
 * For every therapist, for each entry in earnings[]:
 *   - Compare with all sessions that (a) belong to therapist, (b) session.date within earning.fromDate/toDate, (c) is checked-in/confirmed/completed
 *   - Response: List of per-therapist, per-earning reports, each containing earning info and all eligible sessions with their prices.
 *
 * Route: GET /api/admin/therapist/salary-session-comparison
 */


/**
 * Route: GET /api/admin/therapist/salary-session-comparison
 * Response: [
 *   {
 *     therapist: <TherapistProfile>,
 *     earning: { amount, type, fromDate, toDate, remark, paidOn },
 *     sessions: [ { date, price, checkInStatus, status, child, therapist } ]
 *   },
 *   ...
 * ]
 */

  
}

export default TherapistAdminController;
