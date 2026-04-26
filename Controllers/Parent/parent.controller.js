import BookingRequests from '../../Schema/booking-request.schema.js';
import Booking from '../../Schema/booking.schema.js';
import ConsultationBooking from '../../Schema/consultation-booking.schema.js';
import counterSchema from '../../Schema/counter.schema.js';
import DiscountModel from '../../Schema/discount.schema.js';
import Package from '../../Schema/packages.schema.js';
import SessionEditRequest from '../../Schema/session-edit-request.schema.js';
import { TherapyType } from '../../Schema/therapy-type.schema.js';
import TicketModel from '../../Schema/ticket.schema.js';
import { PatientProfile, TherapistProfile, User } from '../../Schema/user.schema.js';
import AuditLogService from "../AuditLogs/audit-logs.controller.js";





class ParentController {



  /**
   * POST /parent/signup
   * Body: { email: string, name: string }
   * Sends OTP to the given email, stores OTP record (now uses User.signUpOTP fields in DB)
   * Parent signup by OTP (role: "parent")
   */
  async parentSignUpSendOTP(req, res) {
    const session = await User.startSession();
    session.startTransaction();
    try {
      const { email, name } = req.body;

      if (!email || typeof email !== "string") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Valid email is required." });
      }

      if (!name || typeof name !== "string") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Name is required." });
      }

      // Only check if a parent user exists with this email
      const userExists = await User.findOne({ email, role: "patient" }).session(session);
      if (userExists) {
        await session.abortTransaction();
        session.endSession();
        // If a parent user with this email already exists, no new OTP is sent.
        return res.status(409).json({ success: false, message: "A parent with this email already exists." });
      }

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresInMs = 1000 * 300; // 5 min

      // Always create a new temp User record for sign up (never update existing)
      const newUser = new User({
        email,
        name,
        role: "patient",
        authProvider: "otp",
        signUpOTP: otp,
        signUpOTPExpiresAt: new Date(Date.now() + expiresInMs),
        signUpOTPSentAt: new Date(),
        signUpOTPAttempts: 0,
        signUpOTPLastUsedAt: null,
        status: "active",
        isDisabled: false, // default is enabled
        manualSignUp: true
      });
      await newUser.save({ session });

      // Do NOT create PatientProfile or patientId yet (done on completeProfile)

      // Send OTP to email (using sendMail instead of a console.log for demo parity)
      let sendEmailError = null;
      let sendEmailPromise = null;
      let whatsappStatus = null;

      // Lazy load sendMail to prevent circular dependency if necessary,
      // otherwise import sendMail at top of file.
      try {
        // Delay require for sendMail so import won't break for existing code
        // If you have sendMail already imported, you can remove the next two lines and just use sendMail directly.
        const sendMail = (await import('../../config/nodeMailer.config.js')).default;
        sendEmailPromise = sendMail(email, "Your OTP Code", `Your OTP is: ${otp}`)
          .catch((err) => { sendEmailError = err; });
      } catch (err) {
        sendEmailError = err;
      }

      // For WhatsApp: Only send if phone exists (future-proof), for now skip
      try {
        whatsappStatus = '[Skipped WhatsApp OTP - only send if phone is available]';
        // If you want WhatsApp OTP for parent sign up, add logic here similar to WhatsAppController.sendOtpVerification
      } catch (waErr) {
        whatsappStatus = waErr?.message || "Failed to send OTP on WhatsApp";
        // Do not block signup on WhatsApp fail; just log
        console.error("ParentSignUp OTP WhatsApp error:", waErr);
      }

      // Await the sendMail promise if created
      if (sendEmailPromise) await sendEmailPromise;

      // If email failed, treat as error
      if (sendEmailError) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          success: false,
          message: "Failed to send OTP to email address.",
          emailError: sendEmailError?.message || sendEmailError
        });
      }

      // ---- AUDIT LOG: Parent signup OTP sent ----
      try {
        await AuditLogService.addLog({
          action: 'PARENT_SIGNUP_OTP_SENT',
          user: newUser._id,
          role: 'parent',
          resource: 'Parent',
          resourceId: newUser._id,
          details: {
            email,
            name,
            message: `Parent signup OTP sent to ${email}`,
            completeProfileOrigin: 'self-service',
            whatsappStatus
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      } catch (logErr) {
        // Still commit the transaction, but log the error
        console.error('Failed to write audit log (PARENT_SIGNUP_OTP_SENT) in parentSignUpSendOTP:', logErr);
      }

      await session.commitTransaction();
      session.endSession();

      return res.json({ success: true, message: "OTP sent to email address." });
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error in parentSignUpSendOTP:", e);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }

  /**
   * POST /parent/verify-otp
   * Body: { email: string, otp: string }
   * Verifies OTP and creates/activates the parent user (using User.signUpOTP fields)
   */
  async parentSignUpVerifyOTP(req, res) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({ success: false, message: "Email and OTP are required." });
      }

      // Find the user-in-signup (either existing with pending signUpOTP, or never started)
      const signupUser = await User.findOne({ email, role: "patient" });

      if (!signupUser || (!signupUser.signUpOTP || !signupUser.signUpOTPExpiresAt)) {
        return res.status(400).json({ success: false, message: "No OTP request found or OTP expired." });
      }

      // Check expiration
      if (Date.now() > new Date(signupUser.signUpOTPExpiresAt).getTime()) {
        // Optionally clear the OTP fields (cleanup)
        signupUser.signUpOTP = null;
        signupUser.signUpOTPExpiresAt = null;
        signupUser.signUpOTPSentAt = null;
        signupUser.signUpOTPAttempts = 0;
        signupUser.signUpOTPLastUsedAt = null;
        await signupUser.save();
        return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
      }

      // Increment attempts
      signupUser.signUpOTPAttempts = (signupUser.signUpOTPAttempts || 0) + 1;
      await signupUser.save();

      if (signupUser.signUpOTP !== otp) {
        return res.status(401).json({ success: false, message: "Invalid OTP." });
      }

      // OTP is valid
      // Mark signUpOTPLastUsedAt and clear OTP fields
      signupUser.signUpOTPLastUsedAt = new Date();
      signupUser.signUpOTP = null;
      signupUser.signUpOTPExpiresAt = null;
      signupUser.signUpOTPSentAt = null;
      signupUser.signUpOTPAttempts = 0;

      // Set identity fields, redundantly
      if (!signupUser.role) signupUser.role = "patient";
      if (!signupUser.authProvider) signupUser.authProvider = "otp";
      signupUser.status = "active";
      signupUser.isDisabled = false;

      await signupUser.save();

      // ---- AUDIT LOG: Parent signup OTP verified ----
      try {
        await AuditLogService.addLog({
          action: 'PARENT_SIGNUP_OTP_VERIFIED',
          user: signupUser._id,
          role: 'parent',
          resource: 'Parent',
          resourceId: signupUser._id,
          details: {
            email,
            otpVerified: true,
            message: `Parent OTP verified and account activated for ${email}`,
            completeProfileOrigin: 'self-service'
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      } catch (logErr) {
        console.error('Failed to write audit log (PARENT_SIGNUP_OTP_VERIFIED) in parentSignUpVerifyOTP:', logErr);
      }

      // No separate ParentProfile collection -- parent is done upon user creation.
      return res.json({ success: true, message: "Parent account created. You may now login." });
    } catch (e) {
      console.error("Error in parentSignUpVerifyOTP:", e);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }

  // Parent complete profile (now also creates patientId ONCE for their child profile)
  // PATCH /api/parent/complete-profile
  // Expects (optionally) phone in body to patch onto User profile, and creates PatientProfile with unique patientId
  async completeParentProfile(req, res) {
    try {
      // Expect parent user is authenticated (from JWT) and userId is req.user.id
      const parentUserId = req.user?.id;
      if (!parentUserId) {
        return res.status(401).json({ error: "Unauthorized: No user ID found." });
      }

      // Find user
      const user = await User.findById(parentUserId);
      if (!user || user.role !== "patient") {
        return res.status(404).json({ error: "No parent user found." });
      }

      // Save mobile1 in phone field of User schema, with uniqueness check
      const { 
        mobile1, 
        childFullName,
        gender,
        childDOB,
        fatherFullName,
        motherFullName,
        parentEmail,
        mobile2,
        address,
        areaName,
        pincode,
        diagnosisInfo,
        childReference,
        parentOccupation,
        remarks,
        otherDocument
      } = req.body;

      console.log(req.body);

      const phone = mobile1;

      if (phone && typeof phone === "string" && phone.trim() !== "") {
        // Check whether another user has this phone
        const existingUser = await User.findOne({
          phone: phone.trim(),
          _id: { $ne: parentUserId }
        });
        if (existingUser) {
          return res.status(409).json({
            error: `This phone number is already used by another user (Email: ${existingUser.email || "[none]"})`
          });
        }
        user.phone = phone.trim();
        user.incompleteParentProfile = false;
      }
      await user.save();

      // Only create PatientProfile (and patientId) if not already present
      let existingProfile = await PatientProfile.findOne({ userId: user._id });
      let createdProfile = null;
      let patientId = null;

      if (!existingProfile) {
        // Require childFullName to create PatientProfile
        if (!childFullName || typeof childFullName !== "string" || !childFullName.trim()) {
          return res.status(400).json({ error: "Child name (childFullName) is required to complete profile for the first time." });
        }

        // Generate next unique patientId
        let seq;
        try {
          const counter = await counterSchema.findOneAndUpdate(
            { name: "patient" },
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
          );
          seq = counter.seq;
        } catch (counterErr) {
          return res.status(500).json({ error: "Could not generate patient ID." });
        }
        patientId = `P${seq.toString().padStart(4, "0")}`;

        // Save all details per code block (file_context_0)
        createdProfile = new PatientProfile({
          userId: user._id,
          name: childFullName ? childFullName.trim() : "",
          patientId,
          gender: gender || "",
          childDOB: childDOB || "",
          fatherFullName: fatherFullName || "",
          motherFullName: motherFullName || "",
          parentEmail: parentEmail || "",
          mobile1: mobile1 || "",
          mobile2: mobile2 || "",
          address: address || "",
          areaName: areaName || "",
          pincode: pincode || "",
          diagnosisInfo: diagnosisInfo || "",
          childReference: childReference || "",
          parentOccupation: parentOccupation || "",
          remarks: remarks || "",
          parentEmail: parentEmail || user.email,
          otherDocument: otherDocument || undefined,
          // Add other profile fields here as needed
        });
        await createdProfile.save();
      }

      // ---- AUDIT LOG: Parent profile completed ----
      try {
        await AuditLogService.addLog({
          action: 'PARENT_PROFILE_COMPLETED',
          user: user._id,
          role:  'parent',
          resource: 'Parent',
          resourceId: createdProfile?._id || existingProfile?._id,
          details: {
            email: user.email,
            userId: user._id,
            fieldsSubmitted: {
              childFullName, gender, childDOB, fatherFullName, motherFullName, parentEmail,
              mobile1, mobile2, address, areaName, pincode, diagnosisInfo, childReference,
              parentOccupation, remarks, otherDocument
            },
            createdProfile: !!createdProfile,
            completeProfileOrigin: 'self-service',
            message: `Parent [${user.email}] completed their profile`
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      } catch (logErr) {
        console.error('Failed to write audit log (PARENT_PROFILE_COMPLETED) in completeParentProfile:', logErr);
      }

      return res.status(200).json({
        success: true,
        user: {
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          _id: user._id
        },
        patientProfile: createdProfile
          ? {
              _id: createdProfile._id,
              name: createdProfile.name,
              patientId: createdProfile.patientId,
              gender: createdProfile.gender,
              childDOB: createdProfile.childDOB,
              fatherFullName: createdProfile.fatherFullName,
              motherFullName: createdProfile.motherFullName,
              parentEmail: createdProfile.parentEmail,
              mobile1: createdProfile.mobile1,
              mobile2: createdProfile.mobile2,
              address: createdProfile.address,
              areaName: createdProfile.areaName,
              pincode: createdProfile.pincode,
              diagnosisInfo: createdProfile.diagnosisInfo,
              childReference: createdProfile.childReference,
              parentOccupation: createdProfile.parentOccupation,
              remarks: createdProfile.remarks,
              otherDocument: createdProfile.otherDocument,
            }
          : undefined
      });
    } catch (e) {
      console.error("Error in completeParentProfile:", e);
      res.status(400).json({ error: "Failed to complete parent profile", details: e.message });
    }
  }
  

  async getDashboardDetails(req, res) {
    try {
      // 1. Extract parentId from token/user
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      // 2. Fetch user
      const user = await User.findById(parentId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "Parent user not found." });
      }

      // 3. Fetch children (PatientProfiles)
      const children = await PatientProfile.find({ userId: user._id }).lean();
      const childIds = children.map(child => child._id);

      // 4. Find all Therapy Bookings (Booking collection, i.e. therapy appointments)
      const appointments = await Booking.find({ patient: { $in: childIds } })
        .populate({
          path: "patient",
          model: "PatientProfile",
          select: "patientId name",
          populate: {
            path: "userId",
            model: "User",
            select: "name",
          }
        })
        .populate({
          path: "sessions.therapist",
          model: "TherapistProfile",
          select: "therapistId",
          populate: {
            path: "userId",
            model: "User",
            select: "name"
          }
        })
        .lean();

      // 5. Find all Consultation Bookings (consultation-booking collection, i.e. nupal-cdc-software-backend/Schema/consultation-booking.schema.js)
      // Consultations are stored by "client" field which refers to PatientProfile
      // (consultation-booking.schema.js: client: { type: ObjectId, ref: 'PatientProfile', required: true })

      const consultationBookings = await ConsultationBooking.find({ client: { $in: childIds } })
        .populate({
          path: "client",
          model: "PatientProfile",
          select: "patientId name",
          populate: {
            path: "userId",
            model: "User",
            select: "name",
          }
        })
        .populate({
          path: "therapy",
          model: "TherapyType",
          select: "name"
        })
        .lean();

      // 6. Count total appointments
      const totalAppointments = appointments.length;

      // 7. Build unchecked sessions (from therapy appointments)
      const uncheckedSessions = [];
      appointments.forEach(booking => {
        if (Array.isArray(booking.sessions)) {
          for (const session of booking.sessions) {
            if (!session.isCheckedIn) {
              uncheckedSessions.push({
                patientId: booking.patient.patientId,
                name: booking.patient.name,
                notCheckedInSession: session
              });
            }
          }
        }
      });

      // 8. Fetch payments for therapy bookings (populate payment field)
      const populatedBookings = await Booking.find({ patient: { $in: childIds } })
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User",
          },
        })
        .populate({
          path: "payment",
          model: "Payment"
        })
        .lean({ virtuals: true });

      // 9. Process and collect pending payment details
      const pendingPayments = [];
      for (const booking of populatedBookings) {
        let payments = [];
        if (Array.isArray(booking.payment)) {
          payments = booking.payment;
        } else if (booking.payment) {
          payments = [booking.payment];
        }
        for (const pay of payments) {
          if (!pay) continue;
          const status = pay.status || "Unknown";
          if (status.toLowerCase() === "pending") {
            let patientName = "";
            if (
              booking.patient &&
              booking.patient.userId &&
              booking.patient.userId.name
            ) {
              patientName = booking.patient.name;
            } else if (booking.patient && booking.patient.name) {
              patientName = booking.patient.name;
            }
            const patientId = booking.patient?.patientId;
            if (!patientName && user && user.name) patientName = user.name;
            pendingPayments.push({
              InvoiceId: pay.paymentId ? pay.paymentId.toString() : "",
              date: pay.createdAt || pay.date || booking.createdAt,
              patientName: patientName,
              patientId,
              amount: pay.amount || booking.totalAmount || 0,
              status: status
            });
          }
        }
      }

      // 10. Compose dashboard data (now including consultationBookings)
      const dashboardData = {
        childrenCount: children.length,
        totalAppointments,
        pendingPayments,
        uncheckedSessions,
        consultationBookings // <-- all their children's consultation bookings
      };

      res.json({ success: true, data: dashboardData });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message || String(err)
      });
    }
  }


  // Returns a paginated & searchable list of all children assigned to the parent
  async getAllChildrens(req, res) {
    try {
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }
      const userId = parentId;

      // Fetch the user using the given id (parentId)
      const user = await User.findById(userId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // --- Pagination & Search Setup ---
      let { page = 1, limit = 10, search = "" } = req.query;
      page = Math.max(parseInt(page) || 1, 1);
      limit = Math.max(parseInt(limit) || 10, 1);
      search = (search || "").trim();

      // Build query
      const dbQuery = { userId: user._id };
      if (search) {
        // Searching by child name, patientId, or father's/mother's name (case-insensitive)
        dbQuery.$or = [
          { name: { $regex: search, $options: "i" } },
          { patientId: { $regex: search, $options: "i" } },
          { fatherFullName: { $regex: search, $options: "i" } },
          { motherFullName: { $regex: search, $options: "i" } }
        ];
      }

      // Get total for pagination
      const total = await PatientProfile.countDocuments(dbQuery);

      // Fetch paginated results
      const children = await PatientProfile.find(dbQuery)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      res.json({
        success: true,
        data: children,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // Returns all appointments for the parent's children with proper search & pagination (search/pagination handled at DB, not table, so table refresh does not affect search state)
  async getAllAppointments(req, res) {
    try {
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      // Fetch parent user
      const user = await User.findById(parentId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "Parent user not found." });
      }

      // Fetch all child PatientProfiles for parent
      const children = await PatientProfile.find({ userId: user._id }).lean();
      if (!children || children.length === 0) {
        return res.json({ success: true, data: [], page: 1, limit: 10, total: 0, totalPages: 1 });
      }
      const childIds = children.map(child => child._id);

      // --- Pagination & Search ---
      let { page = 1, limit = 10, search = "" } = req.query;
      page = Math.max(parseInt(page) || 1, 1);
      limit = Math.max(parseInt(limit) || 10, 1);
      search = (search || "").trim();

      // Build the booking query: all bookings for the parent's children
      const bookingQuery = { patient: { $in: childIds } };

      if (search) {
        // Build search $or clause, searching by:
        //   - Booking requestId/appointmentId
        //   - Patient name/patientId
        //   - Therapy name
        //   - Status/RequestStatus
        //   - Coupon Code
        //   - Session date/slotId
        // To efficiently search, we will fetch booking IDs filtered by search then fetch details
        // Otherwise, we'd need to populate to search across referenced fields.
        // We'll use aggregation for more sophisticated search

        // Step 1: Build $lookup and $match stages
        const orConditions = [
          { requestId: { $regex: search, $options: "i" } },
          { appointmentId: { $regex: search, $options: "i" } },
          { status: { $regex: search, $options: "i" } },
          { requestStatus: { $regex: search, $options: "i" } }
        ];

        // For patient fields (name, patientId)
        orConditions.push(
          { 
            // Must cast to string for aggregation: look up patient name
            // We'll look up on PatientProfile as joined
            "patientProfile.name": { $regex: search, $options: "i" } 
          },
          { 
            "patientProfile.patientId": { $regex: search, $options: "i" } 
          }
        );

        // For therapy name
        orConditions.push(
          {
            "therapyProfile.name": { $regex: search, $options: "i" }
          }
        );

        // For coupon code (discountInfo.coupon.couponCode)
        orConditions.push(
          { "discountInfo.coupon.couponCode": { $regex: search, $options: "i" } }
        );
        // For session date and session slotId
        orConditions.push(

          { "sessions.date": { $regex: search, $options: "i" } },
          { "sessions.slotId": { $regex: search, $options: "i" } }
        );

        // Setup aggregation pipeline for search+pagination
        const pipeline = [
          { $match: bookingQuery },
          // Join for patientProfile on patient
          {
            $lookup: {
              from: 'patientprofiles',
              localField: 'patient',
              foreignField: '_id',
              as: 'patientProfile'
            }
          },
          { $unwind: { path: "$patientProfile", preserveNullAndEmptyArrays: true } },
          // Join for therapy name
          {
            $lookup: {
              from: 'therapytypes',
              localField: 'therapy',
              foreignField: '_id',
              as: 'therapyProfile'
            }
          },
          { $unwind: { path: "$therapyProfile", preserveNullAndEmptyArrays: true } },
          // $match with $or search on all keys above
          { $match: { $or: orConditions } }
        ];

        // For pagination/total count
        const pipelineCount = [...pipeline, { $count: "total" }];
        const pipelineData = [
          ...pipeline,
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit }
        ];

        // Find total count
        const countResult = await Booking.aggregate(pipelineCount);
        const total = countResult?.[0]?.total || 0;

        // Get booking _ids for the paginated result
        const pagedDocs = await Booking.aggregate([
          ...pipelineData,
          { $project: { _id: 1 } }
        ]);
        const pagedBookingIds = pagedDocs.map(doc => doc._id);

        // Now fetch/populate the actual paged bookings (full objects with populations)
        let appointments = [];
        if (pagedBookingIds.length > 0) {
          appointments = await Booking.find({ _id: { $in: pagedBookingIds } })
            .populate({ path: 'package' })
            .populate({ path: 'patient', model: 'PatientProfile' })
            .populate({
              path: 'therapist',
              model: 'TherapistProfile',
              select: "therapistId",
              populate: {
                path: 'userId',
                model: 'User',
                select: 'name'
              }
            })
            .populate({ path: 'therapy', model: 'TherapyType' })
            .populate({ path: 'payment' })
            // preserve order
            .lean();

          // Restore sort order (Mongo may rearrange order on $in)
          const orderMap = {};
          pagedBookingIds.forEach((id, i) => { orderMap[String(id)] = i; });
          appointments.sort((a, b) => (orderMap[String(a._id)] ?? 0) - (orderMap[String(b._id)] ?? 0));
        }

        // --- [continue after population below...]

        // Gather all therapist ids and therapy ids used in all sessions
        const therapistIds = [];
        appointments.forEach((appointment) => {
          if (Array.isArray(appointment.sessions)) {
            appointment.sessions.forEach((session) => {
              if (session.therapist) therapistIds.push(session.therapist);
            });
          }
        });
        const uniqueTherapistIds = [...new Set(therapistIds.map(id => id?.toString()).filter(Boolean))];
        const therapists = await TherapistProfile.find({ _id: { $in: uniqueTherapistIds } })
          .populate({
            path: 'userId',
            model: 'User',
            select: 'name'
          })
          .select('userId name therapistId')
          .lean();
        const therapistMap = {};
        therapists.forEach(t => { therapistMap[String(t._id)] = t; });

        // Attach therapist object on sessions
        for (const appointment of appointments) {
          if (Array.isArray(appointment.sessions)) {
            appointment.sessions = appointment.sessions.map((session) => {
              const sessionCopy = { ...session };
              if (session.therapist && therapistMap[session.therapist?.toString()]) {
                sessionCopy.therapist = therapistMap[session.therapist?.toString()];
              }
              return sessionCopy;
            });
          }
        }

        // Fetch and attach edit requests
        const appointmentIds = appointments.map(a => a._id);
        // Since sessions is an array, we need to populate each session's sessionId in the sessions array
        // The mongoose population syntax will still work as written, as it goes inside the array
        const sessionEditRequests = await SessionEditRequest.find({ appointmentId: { $in: appointmentIds } })
          .populate({
            path: 'sessions.sessionId',
            model: 'Session' // If your sessions array contains session objects with { sessionId }, this works
          })
          .lean();
        // Note: If your sessions array has sessionId fields as references, this is correct.
        // If you need to map or process further, do so after the query.
        const editRequestsByAppointment = {};
        sessionEditRequests.forEach(er => {
          const apptId = er.appointmentId?.toString?.() || er.appointmentId;
          if (!editRequestsByAppointment[apptId]) editRequestsByAppointment[apptId] = [];
          editRequestsByAppointment[apptId].push(er);
        });
        for (const appointment of appointments) {
          const apptId = appointment._id?.toString?.() || appointment._id;
          appointment.editRequests = editRequestsByAppointment[apptId] || [];
        }

        res.json({
          success: true,
          data: appointments,
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1
        });
        return;
      }

      // --- No search filter: paginate ALL for parent's children ---
      // Get total
      const total = await Booking.countDocuments(bookingQuery);

      // Get paginated result
      let appointments = await Booking.find(bookingQuery)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: 'package' })
        .populate({ path: 'patient', model: 'PatientProfile' })
        .populate({
          path: 'therapist',
          model: 'TherapistProfile',
          select: "therapistId",
          populate: {
            path: 'userId',
            model: 'User',
            select: 'name'
          }
        })
        .populate({ path: 'therapy', model: 'TherapyType' })
        .populate({ path: 'payment' })
        .lean();

      // Therapist for sessions
      const therapistIds = [];
      appointments.forEach((appointment) => {
        if (Array.isArray(appointment.sessions)) {
          appointment.sessions.forEach((session) => {
            if (session.therapist) therapistIds.push(session.therapist);
          });
        }
      });
      const uniqueTherapistIds = [...new Set(therapistIds.map(id => id?.toString()).filter(Boolean))];
      const therapists = await TherapistProfile.find({ _id: { $in: uniqueTherapistIds } })
        .populate({
          path: 'userId',
          model: 'User',
          select: 'name'
        })
        .select('userId name therapistId')
        .lean();
      const therapistMap = {};
      therapists.forEach(t => { therapistMap[String(t._id)] = t; });

      // Attach therapist object on sessions
      for (const appointment of appointments) {
        if (Array.isArray(appointment.sessions)) {
          appointment.sessions = appointment.sessions.map((session) => {
            const sessionCopy = { ...session };
            if (session.therapist && therapistMap[session.therapist?.toString()]) {
              sessionCopy.therapist = therapistMap[session.therapist?.toString()];
            }
            return sessionCopy;
          });
        }
      }

      // Fetch and attach edit requests
      const appointmentIds = appointments.map(a => a._id);
      const sessionEditRequests = await SessionEditRequest.find({ appointmentId: { $in: appointmentIds } }).lean();
      const editRequestsByAppointment = {};
      sessionEditRequests.forEach(er => {
        const apptId = er.appointmentId?.toString?.() || er.appointmentId;
        if (!editRequestsByAppointment[apptId]) editRequestsByAppointment[apptId] = [];
        editRequestsByAppointment[apptId].push(er);
      });
      for (const appointment of appointments) {
        const apptId = appointment._id?.toString?.() || appointment._id;
        appointment.editRequests = editRequestsByAppointment[apptId] || [];
      }

      res.json({
        success: true,
        data: appointments,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      });

    } catch (err) {
      console.error("[getAllAppointments] error:", err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // Returns profile details for the parent user, and also returns all children assigned to the parent
  async getProfileDetails(req, res) {
    try {
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      // Get the parent user profile
      const parent = await User.findById(parentId).lean();
      if (!parent) {
        return res.status(404).json({ success: false, message: "Parent profile not found." });
      }

      // Get all children/patient profiles for this parent
      const childrens = await PatientProfile.find({ userId: parentId }).lean();

      res.json({ success: true, data: { parent, childrens } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  async getRequestAppointmentHomePage(req, res) {
    try {
      const parentId = req.user.id;

      // Pagination & Search setup for patients dropdown
      let {
        patientPage = 1,
        patientLimit = 25,
        patientSearch = ""
      } = req.query;
      patientPage = Math.max(parseInt(patientPage) || 1, 1);
      patientLimit = Math.max(parseInt(patientLimit) || 25, 1);
      patientSearch = (patientSearch || "").trim();

      const patientQuery = { userId: parentId };
      if (patientSearch) {
        patientQuery.$or = [
          { name: { $regex: patientSearch, $options: "i" } },
          { patientId: { $regex: patientSearch, $options: "i" } },
          { mobile1: { $regex: patientSearch, $options: "i" } }
        ];
      }

      // Find total patients for pagination
      const totalPatients = await PatientProfile.countDocuments(patientQuery);

      // Search & paginated fetch of patient profiles
      const patientProfiles = await PatientProfile.find(
        patientQuery,
        "name userId patientId mobile1"
      )
        .populate({ path: "userId", select: "name" })
        .skip((patientPage - 1) * patientLimit)
        .limit(patientLimit)
        .lean();

      const patients = (patientProfiles || []).map((profile) => ({
        id: profile._id,
        patientId: profile.patientId,
        name: profile.name || "",
        phoneNo: profile.mobile1 || "",
      }));

      // Therapy Types: pagination/search support
      let {
        therapyPage = 1,
        therapyLimit = 100,
        therapySearch = ""
      } = req.query;
      therapyPage = Math.max(parseInt(therapyPage) || 1, 1);
      therapyLimit = Math.max(parseInt(therapyLimit) || 100, 1);
      therapySearch = (therapySearch || "").trim();

      const therapyQuery = therapySearch
        ? { name: { $regex: therapySearch, $options: "i" } }
        : {};

      const totalTherapy = await TherapyType.countDocuments(therapyQuery);
      const therapyTypes = await TherapyType.find(therapyQuery)
        .skip((therapyPage - 1) * therapyLimit)
        .limit(therapyLimit)
        .lean();

      // Packages: pagination/search support
      let {
        packagePage = 1,
        packageLimit = 100,
        packageSearch = ""
      } = req.query;
      packagePage = Math.max(parseInt(packagePage) || 1, 1);
      packageLimit = Math.max(parseInt(packageLimit) || 100, 1);
      packageSearch = (packageSearch || "").trim();

      const packageQuery = packageSearch
        ? {
            $or: [
              { name: { $regex: packageSearch, $options: "i" } },
              { packageId: { $regex: packageSearch, $options: "i" } }
            ]
          }
        : {};

      const totalPackages = await Package.countDocuments(packageQuery);
      const packages = await Package.find(packageQuery)
        .skip((packagePage - 1) * packageLimit)
        .limit(packageLimit)
        .lean();

      // Therapists: pagination/search support
      let {
        therapistPage = 1,
        therapistLimit = 50,
        therapistSearch = ""
      } = req.query;
      therapistPage = Math.max(parseInt(therapistPage) || 1, 1);
      therapistLimit = Math.max(parseInt(therapistLimit) || 50, 1);
      therapistSearch = (therapistSearch || "").trim();

      // Therapist text search applies on user's name and therapistId
      const therapistLookupPipeline = [
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user"
          }
        },
        { $unwind: "$user" },
        { $match: { "user.status": "active" } },
      ];
      if (therapistSearch) {
        therapistLookupPipeline.push({
          $match: {
            $or: [
              { "user.name": { $regex: therapistSearch, $options: "i" } },
              { therapistId: { $regex: therapistSearch, $options: "i" } }
            ]
          }
        });
      }
      therapistLookupPipeline.push({
        $project: {
          _id: 1,
          therapistId: 1,
          name: "$user.name",
          holidays: 1,
          mobile1: 1
        }
      });

      // Count for therapists
      const totalTherapistsAgg = [
        ...therapistLookupPipeline,
        { $count: "total" }
      ];
      // Paginated therapists fetch (pipeline)
      const therapistAggPaginated = [
        ...therapistLookupPipeline,
        { $skip: (therapistPage - 1) * therapistLimit },
        { $limit: therapistLimit }
      ];

      const TherapistProfileModel = (await import("../../Schema/user.schema.js")).TherapistProfile;
      const [totalTherapistsResult, activeTherapists] = await Promise.all([
        TherapistProfileModel.aggregate(totalTherapistsAgg),
        TherapistProfileModel.aggregate(therapistAggPaginated)
      ]);
      const totalTherapists = totalTherapistsResult && totalTherapistsResult[0]?.total ? totalTherapistsResult[0].total : 0;

      // Get bookings count per therapist grouped by date
      // (not paginated; assumes all for calendar display)
      const bookingCounts = await Booking.aggregate([
        { $unwind: "$sessions" },
        {
          $group: {
            _id: { therapist: "$therapist", date: "$sessions.date" },
            count: { $sum: 1 }
          }
        }
      ]);

      const therapistBookingMap = {};
      bookingCounts.forEach((row) => {
        const therapistId = row._id.therapist?.toString?.() || "";
        const date = row._id.date;
        if (!therapistBookingMap[therapistId]) therapistBookingMap[therapistId] = {};
        therapistBookingMap[therapistId][date] = row.count;
      });

      const therapistsWithCounts = (activeTherapists || []).map((t) => {
        const bookingsByDate = therapistBookingMap[t._id.toString()] || {};
        return { ...t, bookingsByDate };
      });

      // Coupons: search & paginated
      let {
        couponPage = 1,
        couponLimit = 50,
        couponSearch = ""
      } = req.query;
      couponPage = Math.max(parseInt(couponPage) || 1, 1);
      couponLimit = Math.max(parseInt(couponLimit) || 50, 1);
      couponSearch = (couponSearch || "").trim();

      const couponQuery = {
        discountEnabled: true,
        ...(couponSearch && {
          $or: [
            { couponCode: { $regex: couponSearch, $options: "i" } },
            { description: { $regex: couponSearch, $options: "i" } }
          ]
        })
      };

      const totalCoupons = await DiscountModel.countDocuments(couponQuery);
      const coupons = await DiscountModel.find(couponQuery)
        .sort({ createdAt: -1 })
        .skip((couponPage - 1) * couponLimit)
        .limit(couponLimit)
        .lean();

      // Compose final response, with pagination info for each section
      return res.json({
        success: true,
        patients,
        patientPage,
        patientLimit,
        totalPatients,
        patientTotalPages: Math.ceil(totalPatients / patientLimit),
        hasMorePatients: patientPage * patientLimit < totalPatients,

        therapyTypes,
        therapyPage,
        therapyLimit,
        totalTherapy,
        therapyTotalPages: Math.ceil(totalTherapy / therapyLimit),
        hasMoreTherapy: therapyPage * therapyLimit < totalTherapy,

        packages,
        packagePage,
        packageLimit,
        totalPackages,
        packageTotalPages: Math.ceil(totalPackages / packageLimit),
        hasMorePackages: packagePage * packageLimit < totalPackages,

        therapists: activeTherapists,
        therapistsWithCounts,
        therapistPage,
        therapistLimit,
        totalTherapists,
        therapistTotalPages: Math.ceil(totalTherapists / therapistLimit),
        hasMoreTherapists: therapistPage * therapistLimit < totalTherapists,

        coupons,
        couponPage,
        couponLimit,
        totalCoupons,
        couponTotalPages: Math.ceil(totalCoupons / couponLimit),
        hasMoreCoupons: couponPage * couponLimit < totalCoupons
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch booking page details.",
        error: error.message,
      });
    }
  }

  // Create a booking request (not a confirmed booking)
  async createBookingRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const {
        package: packageId,
        patient: patientId,
        therapy: therapyId,
        sessions
      } = req.body;

      // Log incoming request for audit
      console.log("[CREATE BOOKING REQUEST] Incoming body:", req.body);

      // Validate required fields
      if (
        !packageId ||
        !patientId ||
        !therapyId ||
        !Array.isArray(sessions) ||
        !sessions.length
      ) {
        console.log("[CREATE BOOKING REQUEST] Missing required fields", {
          packageId, patientId, therapyId, sessions
        });
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }

      const pkg = await Package.findById(packageId).lean();
      if (!pkg) {
        return res.status(400).json({
          success: false,
          message: "Invalid package"
        });
      }

      // Generate a unique requestId (using 'request' sequence)
      const counter = await counterSchema.findOneAndUpdate(
        { name: "request" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
      );
      const requestId = `REQ-${String(counter.seq).padStart(5, '0')}`;
      console.log("[CREATE BOOKING REQUEST] Generated requestId:", requestId);

      const bookingRequestPayload = {
        requestId,
        package: packageId,
        patient: patientId,
        sessions,
        therapy: therapyId
      };
      Object.keys(bookingRequestPayload).forEach(
        k => bookingRequestPayload[k] === undefined && delete bookingRequestPayload[k]
      );

      // Save booking request in DB (but commit transaction only after log)
      const bookingRequest = new BookingRequests(bookingRequestPayload);
      await bookingRequest.save({ session });
      console.log("[CREATE BOOKING REQUEST] BookingRequest saved. _id:", bookingRequest._id);

      // --- Audit Log (must succeed for booking to exist) ---
      
      try {
        await AuditLogService.addLog(
          {
            action: "CREATE_BOOKING_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "BookingRequest",
            resourceId: bookingRequest._id,
            details: {
              bookingRequest: {
                requestId,
                packageId,
                patientId,
                therapyId,
                sessionCount: Array.isArray(sessions) ? sessions.length : 0
              },
              message: `Booking request created by userId=${req.user?.id || "?"}, patientId=${patientId}, packageId=${packageId}, therapyId=${therapyId}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        // If log fails, revert booking request (abort transaction)
        await session.abortTransaction();
        session.endSession();
        console.error("[CREATE BOOKING REQUEST] Audit log failed, reverted booking request:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to create booking request. Audit log not created, request reverted.",
          error: auditErr.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      // Populate returned fields
      const populatedRequest = await BookingRequests.findById(bookingRequest._id)
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User"
          }
        })
        .populate({ path: "therapy", model: "TherapyType" });

      res.status(201).json({
        success: true,
        bookingRequest: populatedRequest
      });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // Ignore abort errors (may occur if already committed)
      }
      session.endSession();
      console.error("[CREATE BOOKING REQUEST] Error encountered:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create booking request.",
        error: error.message,
      });
    }
  }

  // INSERT_YOUR_CODE

  // Fetch all booking requests for the logged-in parent (optionally can filter as needed)
  /**
   * Fetch all booking requests for the logged-in parent, with server-side search and pagination.
   * Query Params:
   *   - search: string (optional, search by patient name/id, therapist name/id, therapy/package, requestId)
   *   - page: number (1-based)
   *   - limit: number (default 10)
   */
  async getAllBookingRequests(req, res) {
    try {
      const parentUserId = req.user?.id;

      // --- Server-side Pagination ---
      let page = Number(req.query.page) || 1;
      let limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 100)); // Max 100 per page
      const skip = (page - 1) * limit;

      // --- Server-side Search ---
      const search = (req.query.search || "").trim();
      let filter = {};

      if (parentUserId) {
        // Step 1: Find user and all their PatientProfiles (children)
        const user = await User.findById(parentUserId).lean();
        if (!user) {
          return res.status(404).json({ success: false, message: "User not found" });
        }
        const myPatients = await PatientProfile.find({ userId: user._id }, '_id').lean();
        const myPatientIds = myPatients.map(p => p._id);

        if (myPatientIds.length > 0) {
          filter.patient = { $in: myPatientIds };
        } else {
          // Parent has no children, nothing to return
          return res.json({ success: true, bookingRequests: [], total: 0, page, totalPages: 1 });
        }
      }

      // Prepare aggregate pipeline for search on patient/therapist/therapy fields
      const aggregatePipeline = [
        // Filter: matching this parent
        { $match: filter },
        // Lookup: PatientProfile
        {
          $lookup: {
            from: "patientprofiles",
            localField: "patient",
            foreignField: "_id",
            as: "patient",
          }
        },
        { $unwind: "$patient" },
        // Lookup: userId in patient
        {
          $lookup: {
            from: "users",
            localField: "patient.userId",
            foreignField: "_id",
            as: "patient.userObj",
          }
        },
        {
          $addFields: {
            "patient.user": { $arrayElemAt: ["$patient.userObj", 0] }
          }
        },
        // Lookup: therapy
        {
          $lookup: {
            from: "therapytypes",
            localField: "therapy",
            foreignField: "_id",
            as: "therapy",
          }
        },
        { $unwind: { path: "$therapy", preserveNullAndEmptyArrays: true } },
        // Lookup: package
        {
          $lookup: {
            from: "packages",
            localField: "package",
            foreignField: "_id",
            as: "package",
          }
        },
        { $unwind: { path: "$package", preserveNullAndEmptyArrays: true } },
      ];

      // If search present, add $match with OR on relevant fields
      if (search) {
        const regex = new RegExp(search, "i");
        aggregatePipeline.push({
          $match: {
            $or: [
              { "patient.name": regex },
              { "patient.patientId": regex },
              { "patient.user.name": regex },
              { "therapy.name": regex },
              { "package.name": regex },
              { "requestId": regex },
              { "appointmentId": regex }
              // Add more fields as needed
            ]
          }
        });
      }

      // --- For total count (before paginating) ---
      const countPipeline = [...aggregatePipeline, { $count: "total" }];
      const countResult = await BookingRequests.aggregate(countPipeline).allowDiskUse(true);
      const total = countResult[0]?.total || 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      if (page > totalPages) page = totalPages;
      const newSkip = (page - 1) * limit;

      // --- Pagination + sorting (after search/filter) ---
      aggregatePipeline.push({ $sort: { createdAt: -1 } });
      aggregatePipeline.push({ $skip: newSkip });
      aggregatePipeline.push({ $limit: limit });

      // Clean up embedded "userObj" after joins
      aggregatePipeline.push({
        $project: {
          "patient.userObj": 0,
        }
      });

      // Run aggregate
      const requests = await BookingRequests.aggregate(aggregatePipeline).allowDiskUse(true);

      res.json({
        success: true,
        bookingRequests: requests,
        total,
        page,
        totalPages,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      });

    } catch (error) {
      console.error("[GET ALL BOOKING REQUESTS] (search/pagination)", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch booking requests.",
        error: error.message
      });
    }
  }

  // Fetch a single booking request by ID (for view/edit)
  async getBookingRequestById(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, message: "Booking request ID required" });
      }
      const bookingRequest = await BookingRequests.findById(id)
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User"
          }
        })
        .populate({ path: "therapy", model: "Therapy" });

      if (!bookingRequest) {
        return res.status(404).json({ success: false, message: "Booking request not found" });
      }

      res.json({ success: true, bookingRequest });
    } catch (error) {
      console.error("[GET BOOKING REQUEST BY ID]", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch booking request.",
        error: error.message,
      });
    }
  }

  // Edit/Update a booking request by ID
  async updateBookingRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const { id } = req.params;
      if (!id) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Booking request ID required" });
      }

      // Only update allowed fields
      const updateFields = {};
      if (req.body.package) updateFields.package = req.body.package;
      if (req.body.patient) updateFields.patient = req.body.patient;
      if (req.body.sessions) updateFields.sessions = req.body.sessions;
      if (req.body.therapy) updateFields.therapy = req.body.therapy;

      if (Object.keys(updateFields).length === 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "No fields provided for update" });
      }

      const bookingRequestBefore = await BookingRequests.findById(id).lean();

           // INSERT_YOUR_CODE
      // Check if booking request is already approved; if so, do not allow edits
      if (bookingRequestBefore && bookingRequestBefore.status === 'approved') {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Cannot update booking request: already approved."
        });
      }

      const bookingRequest = await BookingRequests.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, session }
      )
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User"
          }
        })
        .populate({ path: "therapy", model: "TherapyType" });



      if (!bookingRequest) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Booking request not found" });
      }

 
      // --- Audit Log (must succeed for booking to be updated) ---
      try {
        await AuditLogService.addLog(
          {
            action: "UPDATE_BOOKING_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "BookingRequest",
            resourceId: bookingRequest._id,
            details: {
              before: bookingRequestBefore,
              after: bookingRequest,
              updateFields,
              message: `Booking request updated by userId=${req.user?.id || "?"}, patientId=${updateFields.patient || (bookingRequestBefore ? bookingRequestBefore.patient : undefined)}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        // If log fails, revert the update (abort transaction)
        await session.abortTransaction();
        session.endSession();
        console.error("[UPDATE BOOKING REQUEST] Audit log failed, reverted update:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to update booking request. Audit log not created, update reverted.",
          error: auditErr.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, bookingRequest });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // Ignore abort errors
      }
      session.endSession();
      console.error("[UPDATE BOOKING REQUEST]", error);
      res.status(500).json({
        success: false,
        message: "Failed to update booking request.",
        error: error.message
      });
    }
  }

  // Delete a booking request by ID
  async deleteBookingRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { id } = req.params;
      if (!id) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Booking request ID required" });
      }

      // Find the booking request first
      const bookingRequest = await BookingRequests.findById(id).session(session);
      if (!bookingRequest) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Booking request not found" });
      }

      // If booking is already approved, don't allow deletion
      if (bookingRequest.status === "approved") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Cannot delete an approved booking request."
        });
      }

      // --- Audit log before deletion ---
      try {
        await AuditLogService.addLog(
          {
            action: "DELETE_BOOKING_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "BookingRequest",
            resourceId: bookingRequest._id,
            details: {
              deletedBookingRequest: bookingRequest.toObject ? bookingRequest.toObject() : bookingRequest,
              message: `Booking request deleted by userId=${req.user?.id || "?"}, patientId=${bookingRequest.patient}, packageId=${bookingRequest.package}, therapyId=${bookingRequest.therapy}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        // If log fails, revert deletion (abort transaction)
        await session.abortTransaction();
        session.endSession();
        console.error("[DELETE BOOKING REQUEST] Audit log failed, reverted delete:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to delete booking request. Audit log not created, deletion reverted.",
          error: auditErr.message
        });
      }

      // Otherwise, delete it
      await BookingRequests.findByIdAndDelete(id, { session });

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, message: "Booking request deleted successfully" });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("[DELETE BOOKING REQUEST]", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete booking request.",
        error: error.message
      });
    }
  }


  // --- Session Edit Request CRUD ---

  // Import Counter at top (assuming it is available/registered elsewhere in your module)

  // Helper function to generate session-edit-requestId
  async generateSessionEditRequestId() {
    // The counter for "session-edit-request" will just use a sequential format like "SER00001"
    const counterDoc = await counterSchema.findOneAndUpdate(
      { name: "session-edit-request" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const seqNum = counterDoc.seq;
    // Format for example: "SER00001"
    return `SER${seqNum.toString().padStart(5, "0")}`;
  }

  // Create a new session edit request (supports bulk sessions for one appointmentId)
  async createSessionEditRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const { appointmentId, patientId, sessions } = req.body;

      if (
        !appointmentId ||
        !patientId ||
        !Array.isArray(sessions) ||
        sessions.length === 0 ||
        !sessions.every(
          s =>
            s.sessionId &&
            s.newDate &&
            s.newSlotId
        )
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message:
            "Missing required fields. appointmentId, patientId, and sessions (with sessionId, newDate, newSlotId) are required.",
        });
      }

      // Check if a pending request for this appointment already exists
      const existingPendingRequest = await SessionEditRequest.findOne({
        appointmentId: appointmentId,
        status: "pending"
      }).session(session);

      if (existingPendingRequest) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "A pending session edit request for this appointment already exists.",
          request: existingPendingRequest
        });
      }

      // Generate custom session-edit-request Id
      const requestId = await this.generateSessionEditRequestId();

      const requestPayload = {
        appointmentId,
        patientId,
        sessions,
        status: "pending",
        requestId
      };

      const request = await SessionEditRequest.create([requestPayload], { session });

      // INSERT_YOUR_CODE
      console.log("[CREATE SESSION EDIT REQUEST] request fields:", {
        appointmentId,
        patientId,
        sessions,
        status: "pending",
        requestId,
        requestObject: request[0],
        user: req.user,
        userId: req.user?.id,
        role: req.user?.role === "patient" ? "parent" : req.user?.role,
        action: "CREATE_SESSION_EDIT_REQUEST",
        resource: "SessionEditRequest",
        resourceId: request[0]?._id,
        details: {
          requestId,
          appointmentId,
          patientId,
          sessionCount: Array.isArray(sessions) ? sessions.length : 0,
          message: `Session edit request created by userId=${req.user?.id || "?"}, patientId=${patientId}, appointmentId=${appointmentId}.`
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      });
      
      // AUDIT LOG (must succeed or abort)
      try {
        await AuditLogService.addLog(
          {
            action: "CREATE_SESSION_EDIT_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "SessionEditRequest",
            resourceId: request[0]._id,
            details: {
              requestId,
              appointmentId,
              patientId,
              sessionCount: Array.isArray(sessions) ? sessions.length : 0,
              message: `Session edit request created by userId=${req.user?.id || "?"}, patientId=${patientId}, appointmentId=${appointmentId}.`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("[CREATE SESSION EDIT REQUEST] Audit log failed, reverted creation:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to create session edit request. Audit log not created, request reverted.",
          error: auditErr.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      res.status(201).json({ success: true, request: request[0] });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // Ignore abort error
      }
      session.endSession();
      console.error("[CREATE SESSION EDIT REQUEST]", error);
      res.status(500).json({ success: false, message: "Failed to create session edit request", error: error.message });
    }
  }

  // Edit/update a session edit request (only updatable: sessions array, status)
  async updateSessionEditRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const { id } = req.params;
      if (!id) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Request ID required" });
      }

      // Only allow updating sessions and/or status
      const updates = {};
      if (req.body.sessions && Array.isArray(req.body.sessions)) {
        updates.sessions = req.body.sessions;
      }
      if (req.body.status !== undefined) {
        updates.status = req.body.status;
      }

      if (Object.keys(updates).length === 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "No valid fields provided for update" });
      }

      const beforeUpdate = await SessionEditRequest.findById(id).lean().session(session);

      if (!beforeUpdate) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Session edit request not found" });
      }

      const updated = await SessionEditRequest.findByIdAndUpdate(id, updates, { new: true, session });
      if (!updated) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Session edit request not found" });
      }

      // AUDIT LOG (must succeed or abort)
      try {
        await AuditLogService.addLog(
          {
            action: "UPDATE_SESSION_EDIT_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "SessionEditRequest",
            resourceId: updated._id,
            details: {
              before: beforeUpdate,
              after: updated,
              updateFields: updates,
              message: `Session edit request updated by userId=${req.user?.id || "?"}, appointmentId=${beforeUpdate.appointmentId}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("[UPDATE SESSION EDIT REQUEST] Audit log failed, reverted update:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to update session edit request. Audit log not created, update reverted.",
          error: auditErr.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, request: updated });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // ignore
      }
      session.endSession();
      console.error("[UPDATE SESSION EDIT REQUEST]", error);
      res.status(500).json({ success: false, message: "Failed to update session edit request", error: error.message });
    }
  }

  // Delete a session edit request
  async deleteSessionEditRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const { id } = req.params;
      if (!id) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Request ID required" });
      }

      const toDelete = await SessionEditRequest.findById(id).session(session);
      if (!toDelete) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Session edit request not found" });
      }

      // AUDIT LOG (must succeed or abort)
      try {
        await AuditLogService.addLog(
          {
            action: "DELETE_SESSION_EDIT_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "SessionEditRequest",
            resourceId: toDelete._id,
            details: {
              deleted: toDelete,
              message: `Session edit request deleted by userId=${req.user?.id || "?"}, appointmentId=${toDelete.appointmentId}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("[DELETE SESSION EDIT REQUEST] Audit log failed, reverted delete:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to delete session edit request. Audit log not created, deletion reverted.",
          error: auditErr.message
        });
      }

      await SessionEditRequest.findByIdAndDelete(id, { session });

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, message: "Session edit request deleted successfully" });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {}
      session.endSession();
      console.error("[DELETE SESSION EDIT REQUEST]", error);
      res.status(500).json({ success: false, message: "Failed to delete session edit request", error: error.message });
    }
  }

  // Fetch all session edit requests (queryable by appointmentId, status)
  async getSessionEditRequests(req, res) {
    try {
      const { appointmentId, status } = req.query;
      const query = {};
      if (appointmentId) query.appointmentId = appointmentId;
      if (status) query.status = status;

      const requests = await SessionEditRequest.find(query)
        .populate("appointmentId");

      res.json({ success: true, requests });
    } catch (error) {
      console.error("[FETCH SESSION EDIT REQUESTS]", error);
      res.status(500).json({ success: false, message: "Failed to fetch session edit requests", error: error.message });
    }
  }




  async allBookings(req, res) {
    try {
      const bookings = await Booking.find()
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User"
          }
        })
        .populate({
          path: "therapy",
          model: "TherapyType"
        })
        .populate({
          path: "therapist",
          model: "TherapistProfile",
          populate: {
            path: "userId",
            model: "User"
          }
        })
        .populate({
          path: "discountInfo.coupon",
          model: "Discount"
        });
      res.json({
        success: true,
        bookings,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch bookings.",
        error: error.message,
      });
    }
  }

  /**
   * Get invoice and payment details for a given booking or appointment
   * Expects bookingId or appointmentId in req.params or req.query
   */
  /**
   * Fetch User, then Patient Profiles, then all their Bookings, and populate payments for each Booking.
   */
  /**
   * Get invoice and payment details for this parent's children
   * Supports: search (by patient name/ID, paymentId), pagination (?page, ?limit)
   */
  async getInvoiceAndPayment(req, res) {
    try {
      const userId = req.user.id;

      // Parse query parameters for search & pagination
      const search = (req.query.search || "").trim();
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 10, 100));

      // 1. Fetch User
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      // 2. Fetch all Patient Profiles linked to this user
      const patientProfiles = await PatientProfile.find({ userId });
      if (!patientProfiles || patientProfiles.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No patient profiles found for this user.",
        });
      }
      const patientProfileIds = patientProfiles.map((p) => p._id);

      // 3. Build Booking query (with search if provided)
      let bookingQuery = { patient: { $in: patientProfileIds } };
      if (search.length > 0) {
        // build a regex for "patient name", "patientId", or paymentId on payment subdocs
        const patientProfileIdObj = {}; // for $elemMatch on populate
        bookingQuery = {
          ...bookingQuery,
          $or: [
            // try patient name or patientId
            { 'patientNameForSearch': { $regex: search, $options: "i" } }, // fallback if you set this field
            // fallback: support searching via $lookup on patient model (patient.name matching)
            // But since we do not have $lookup directly, we filter after population below
          ]
        };
      }

      // 4. Count matching bookings (for pagination)
      // We'll fetch all, but filter by populated patient/payment for search after pop if needed
      const totalCount = await Booking.countDocuments({ patient: { $in: patientProfileIds } });

      // 5. Pagination: skip/limit
      const skip = (page - 1) * limit;

      // 6. Fetch and populate bookings for this parent, sorted by most recent
      let bookings = await Booking.find({ patient: { $in: patientProfileIds } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User",
          },
        })
        .populate({
          path: "therapy",
          model: "TherapyType"
        })
        .populate({
          path: "therapist",
          model: "TherapistProfile",
          populate: {
            path: "userId",
            model: "User"
          }
        })
        .populate({
          path: "discountInfo.coupon",
          model: "Discount"
        })
        .populate({
          path: "payment",
          model: "Payment"
        });

      // 7. Search filtering for patient name/ID & paymentId (since not in root doc, filter after populate)
      if (search.length > 0) {
        const searchLower = search.toLowerCase();
        bookings = bookings.filter(b => {
          // Check patient name
          let found = false;
          if (b.patient?.name && b.patient.name.toLowerCase().includes(searchLower)) {
            found = true;
          }
          // Check patientId
          if (!found && b.patient?.patientId && (b.patient.patientId + "").toLowerCase().includes(searchLower)) {
            found = true;
          }
          // Check paymentId inside payment(s)
          if (!found && b.payment) {
            // Either is array or single
            let payments = Array.isArray(b.payment) ? b.payment : [b.payment];
            for (let pay of payments) {
              if (!pay) continue;
              if (pay.paymentId && (pay.paymentId + "").toLowerCase().includes(searchLower)) {
                found = true;
                break;
              }
            }
          }
          // Optionally could also add search for InvoiceId, status, or other fields
          return found;
        });
      }

      // 8. Structure all payments for these filtered bookings
      const paymentDetails = [];
      for (const booking of bookings) {
        // May be a single payment, or potentially an array (if ref type is array), handle both
        let payments = [];
        if (Array.isArray(booking.payment)) {
          payments = booking.payment;
        } else if (booking.payment) {
          payments = [booking.payment];
        }
        for (const pay of payments) {
          if (!pay) continue;
          let invoiceId = pay.paymentId ? pay.paymentId.toString() : "";
          let date = pay.createdAt || pay.date || booking.createdAt;
          let patientName = "";
          // Patient name from populated booking
          if (
            booking.patient &&
            booking.patient.userId &&
            booking.patient.userId.name
          ) {
            patientName = booking.patient.name;
          } else if (booking.patient && booking.patient.name) {
            patientName = booking.patient.name;
          }
          let patientId = booking.patient ? booking.patient.patientId : undefined;
          // Fallback: user field
          if (!patientName && user && user.name) patientName = user.name;

          paymentDetails.push({
            InvoiceId: invoiceId,
            date: date,
            patientName: patientName,
            patientId,
            amount:
              pay.amount ||
              // fallback to amount in booking if not in payment
              booking.totalAmount || 0,
            status: pay.status || "Unknown",
          });
        }
      }

      res.json({
        success: true,
        payments: paymentDetails,
        total: search.length > 0 ? paymentDetails.length : totalCount,
        page,
        limit,
      });

    } catch (error) {
      console.error("[GET INVOICE AND PAYMENT]", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch invoice and payment details.",
        error: error.message,
      });
    }
  }
  

  /**
   * POST /parent/tickets/raise
   * Allows a parent to raise a support ticket
   * Body: { subject, description, priority, tags }
   * Raises a ticket as the logged-in parent user.
   */
  /**
   * POST /parent/tickets/raise
   * Allows a parent to raise a support ticket
   * Body: { subject, description, priority, tags }
   * Raises a ticket as the logged-in parent user.
   */
  async raiseTicket(req, res) {
    try {
      // Ensure the user is authenticated and has the correct role
      const id = req.user.id;

      // INSERT_YOUR_CODE
      // Fetch the parent (patient) user from DB to ensure it's up-to-date
      const user = await User.findById(id);

      // Accept both 'patient' and 'parent', since frontend refers as parent, backend as patient
      if (!user || user.role !== "patient") {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Only parents can raise tickets.",
        });
      }

      const { subject, description, priority, tags } = req.body;

      // Validate required fields
      if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Subject is required.",
        });
      }
      if (!description || typeof description !== "string" || description.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Description is required.",
        });
      }

      // Attempt to use both _id (default for Mongo) and patientId (if available from JWT)
      // Use _id always, but fallback/alias if needed
      const raisedById = user._id || user.patientId;
      if (!raisedById) {
        // This can happen if JWT is misconfigured for parent objects
        return res.status(400).json({
          success: false,
          message: "Parent user ID not found in authentication. Please log in again.",
        });
      }

      // Build ticket data to match ticket.schema.js: raisedByRole: "parent", raisedById
      const ticketData = {
        raisedByRole: "parent",
        raisedById,
        subject: subject.trim(),
        description: description.trim(),
        priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
        tags: Array.isArray(tags)
          ? tags.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
          : [],
      };

      // Status and other default fields (like createdAt) handled by schema

      const ticket = new TicketModel(ticketData);
      await ticket.save();

      res.json({
        success: true,
        ticket,
        message: "Ticket raised successfully.",
      });
    } catch (error) {
      // Mongoose validation errors reported nicely
      if (error.name === "ValidationError") {
        return res.status(400).json({
          success: false,
          message: "Validation failed when creating ticket.",
          error: error.message,
        });
      }
      console.error("[RAISE TICKET]", error);
      res.status(500).json({
        success: false,
        message: "Failed to raise ticket.",
        error: error.message,
      });
    }
  }

// INSERT_YOUR_CODE
  /**
   * GET /parent/tickets
   * Retrieves all tickets raised by the authenticated parent.
   * Can support pagination with query params ?page=1&limit=20
   */
  async getAllPatientTickets(req, res) {
    try {
      const id = req.user.id;

      // INSERT_YOUR_CODE
      // Fetch the user (parent) from the database to ensure user exists and get full doc
      const user = await User.findById(id);

      if (!user || user.role !== "patient") {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Parent authentication required.",
        });
      }

      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 20;
      const skip = (page - 1) * limit;

      const query = {
        raisedByRole: "parent",
        raisedById: user._id,
      };

      const [tickets, total] = await Promise.all([
        TicketModel.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        TicketModel.countDocuments(query),
      ]);

      res.json({
        success: true,
        tickets,
        page,
        limit,
        total,
      });

    } catch (error) {
      console.error("[GET ALL PARENT TICKETS]", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch parent tickets.",
        error: error.message,
      });
    }
  }
// INSERT_YOUR_CODE

  /**
   * POST /parent/consultation-booking
   * Allows a parent to create a new consultation booking (the authenticated parent is the client).
   * Required body: {
   *   consultant: ObjectId (therapist id),
   *   therapy: ObjectId (therapyType id),
   *   scheduledAt: Date,
   *   durationMinutes: Number (optional, defaults to 60),
   *   sessionType: 'online'|'in-person',
   *   remark: String (optional)
   * }
   * Protected: requires authentication (parent)
   */
  async createConsultationBooking(req, res) {
    try {
      const clientId = req.user.id;
      const {
        patient,
        therapyType,
        scheduledAt,
        time, // extract time as part of booking
        sessionType,
        reason
      } = req.body;

      console.log(req.body)

      const durationMinutes = 15;

      // Validate required fields
      if (!therapyType || !scheduledAt || !sessionType) {
        return res.status(400).json({
          success: false,
          message: "therapyType, scheduledAt, and sessionType are required."
        });
      }

      // Use Counter model to generate a unique consultationAppointmentId
      // Import Counter at the top if not already: import Counter from '../../Schema/counter.schema.js';
      let seqDoc = await counterSchema.findOneAndUpdate(
        { name: "consultationAppointmentId" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      // Format: CONSULT-yyyy-00001
      const year = new Date().getFullYear();
      const seqStr = String(seqDoc.seq).padStart(5, '0');
      const consultationAppointmentId = `C-${year}-${seqStr}`;

      const booking = await ConsultationBooking.create({
        consultationAppointmentId,
        client: patient,
        therapy:therapyType,
        scheduledAt,
        time: time || undefined, // set if present; could validate "HH:mm"
        durationMinutes: durationMinutes ? +durationMinutes : 15, // default to 15 minutes
        sessionType,
        status: "pending",
        remark:reason
      });

      return res.status(201).json({
        success: true,
        booking
      });
    } catch (error) {
      console.error("[CREATE CONSULTATION BOOKING]", error);
      res.status(500).json({
        success: false,
        message: "Failed to create consultation booking.",
        error: error.message
      });
    }
  }

  /**
   * GET /parent/consultation-bookings
   * Fetch consultation bookings for the authenticated parent (optionally by client, but here client is always the authenticated parent).
   * Query params: ?page=<number>&limit=<number>
   * Protected: requires authentication (parent)
   */
  async getConsultationBookings(req, res) {
    try {
      // Fetch the authenticated parent's children (PatientProfiles)
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      // Find children profiles for this parent
      const children = await PatientProfile.find({ userId: parentId }).lean();
      const childIds = children.map(child => child._id);

      // Pagination
      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 20;
      const skip = (page - 1) * limit;

      // Query for consultation bookings where "client" is any of the parent's children
      const query = { client: { $in: childIds } };

      // Populate: 
      // - client: (PatientProfile) patientId, name, AND their 'userId' (User) name
      // - consultant: (TherapistProfile) therapistId, AND their 'userId' (User) name
      // - therapy: (TherapyType) name
      const [bookings, total] = await Promise.all([
        ConsultationBooking.find(query)
          .sort({ scheduledAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate({
            path: "client",
            model: "PatientProfile",
            select: "patientId name",
            populate: {
              path: "userId",
              model: "User",
              select: "name"
            }
          })
          .populate({
            path: "consultant",
            model: "TherapistProfile",
            select: "therapistId",
            populate: {
              path: "userId",
              model: "User",
              select: "name"
            }
          })
          .populate({
            path: "therapy",
            model: "TherapyType",
            select: "name"
          })
          .lean(),
        ConsultationBooking.countDocuments(query)
      ]);

      res.json({
        success: true,
        bookings,
        total,
        page,
        limit
      });
    } catch (error) {
      console.error("[GET CONSULTATION BOOKINGS]", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve consultation bookings.",
        error: error.message
      });
    }
  }

  /**
   * PUT /parent/consultation-bookings/:id
   * Allows parent to update a consultation booking (cancel or reschedule).
   * Body: { status: 'cancelled' | ..., scheduledAt?: Date, time?: string, remark?: string }
   * Protected: requires authentication (parent)
   */
  async updateConsultationBooking(req, res) {
    try {
      const parentId = req.user.id; // Use parentId to match terminology and usage in rest of controller
      const bookingId = req.params.id;
      const { status, scheduledAt, time, reason, therapyType, sessionType } = req.body;

      // Validate bookingId
      if (!bookingId) {
        return res.status(400).json({ success: false, message: "Booking ID is required." });
      }

      // Ensure only allowed status values can be set
      if (status && !['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status value." });
      }

      // Find the parent's patients
      const parentUser = await User.findById(parentId).lean();
      if (!parentUser) {
        return res.status(401).json({ success: false, message: "Unauthorized: parent not found." });
      }
      const children = await PatientProfile.find({ userId: parentUser._id }).lean();
      const childIds = children.map(child => child._id);

      // Find consultation booking ONLY if it is for parent's child
      const booking = await ConsultationBooking.findOne({ _id: bookingId, client: { $in: childIds } });
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Consultation booking not found or access denied."
        });
      }

      // Patch only allowed fields
      if (typeof status !== "undefined") {
        booking.status = status;
      }
      if (typeof scheduledAt !== "undefined" && scheduledAt) {
        booking.scheduledAt = scheduledAt;
      }
      if (typeof time !== "undefined") {
        booking.time = time;
      }
      if (typeof reason !== "undefined") {
        booking.remark = reason;
      }
      if (typeof therapyType !== "undefined" && therapyType) {
        booking.therapy = therapyType;
      }
      if (typeof sessionType !== "undefined" && sessionType) {
        booking.sessionType = sessionType;
      }

      await booking.save();

      res.json({
        success: true,
        booking
      });
    } catch (error) {
      console.error("[UPDATE CONSULTATION BOOKING]", error);
      res.status(500).json({
        success: false,
        message: "Failed to update consultation booking.",
        error: error?.message || error
      });
    }
  }


  


}

export default ParentController;
