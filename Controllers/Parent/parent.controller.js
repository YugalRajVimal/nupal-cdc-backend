import BookingRequests from '../../Schema/booking-request.schema.js';
import Booking from '../../Schema/booking.schema.js';
import counterSchema from '../../Schema/counter.schema.js';
import DiscountModel from '../../Schema/discount.schema.js';
import Package from '../../Schema/packages.schema.js';
import SessionEditRequest from '../../Schema/session-edit-request.schema.js';
import { TherapyType } from '../../Schema/therapy-type.schema.js';
import { PatientProfile, TherapistProfile, User } from '../../Schema/user.schema.js';




class ParentController {


  /**
   * POST /parent/signup
   * Body: { email: string, name: string }
   * Sends OTP to the given email, stores OTP record (now uses User.signUpOTP fields in DB)
   * Parent signup by OTP (role: "parent")
   */
  async parentSignUpSendOTP(req, res) {
    try {
      const { email, name } = req.body;

      if (!email || typeof email !== "string") {
        return res.status(400).json({ success: false, message: "Valid email is required." });
      }

      if (!name || typeof name !== "string") {
        return res.status(400).json({ success: false, message: "Name is required." });
      }

      // Only check if a parent user exists with this email
      const userExists = await User.findOne({ email, role: "patient" });
      if (userExists) {
        // If a parent user with this email already exists, no new OTP is sent.
        return res.status(409).json({ success: false, message: "A parent with this email already exists." });
      }

      // Use default OTP 000000 for demo; replace with real random OTP generator in prod.
      const otp = "000000";
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
        manualSignUp:true
      });
      await newUser.save();

      // Do NOT create PatientProfile or patientId yet (done on completeProfile)

      // Real: Send OTP via nodemailer/sendgrid here. --- For demo, just log.
      console.log(`[ParentSignup] OTP for ${email}:`, otp);

      return res.json({ success: true, message: "OTP sent to email address." });
    } catch (e) {
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

      // 4. Find all bookings where patient is one of these children
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

      // 5. Count total appointments
      const totalAppointments = appointments.length;

      // 6. Count all sessions which are not checked-in and store details
      const uncheckedSessions = [];
      appointments.forEach(booking => {
        if (Array.isArray(booking.sessions)) {
          for (const session of booking.sessions) {
            // A session is "not checked in" if session.checkedIn is falsy (undefined, null, false)
            if (!session.isCheckedIn) {
              uncheckedSessions.push({
                patientId: booking.patient.patientId,
                name: booking.patient.name, // adjust based on actual patient name field
                notCheckedInSession: session
              });
            }
          }
        }
      });

      // Now the uncheckedSessions array holds objects: { patientId, name, notCheckedInSession }

      // 7. Fetch payments for these bookings (populate payment field)
      // Use lean(false) so that payment is populated as Mongoose docs
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

      // 8. Process and collect pending payment details
      const pendingPayments = [];
      // Each booking may have .payment as a single object or array (support both)
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
            // Fetch patientName and patientId as in getInvoiceAndPayment
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

      

      // 9. Compose dashboard data (add pendingPayments as requested)
      const dashboardData = {
        childrenCount: children.length,
        totalAppointments,
        pendingPayments, // <-- list of pending payments
        uncheckedSessions
      };

      res.json({ success: true, data: dashboardData });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message || String(err)
      });
    }
  }


  // Returns a list of all children assigned to the parent
  async getAllChildrens(req, res) {
    try {
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }
      // Replace with real schema/model for child (E.g. Child or Patient)
      const userId = parentId;

      // Fetch the user using the given id (parentId)
      const user = await User.findById(userId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // Fetch all patient profiles who have userId equal to this user
      const children = await PatientProfile.find({ userId: user._id }).lean();

      res.json({ success: true, data: children });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // Returns all appointments for the parent's children
  async getAllAppointments(req, res) {
    try {
      // Use a hardcoded parent ID for demonstration. Replace with req.user?._id in production.
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      // 1. Fetch parent user
      const user = await User.findById(parentId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "Parent user not found." });
      }

      // 2. Fetch all children (PatientProfiles) who belong to parent user
      const children = await PatientProfile.find({ userId: user._id }).lean();
      if (!children || children.length === 0) {
        return res.json({ success: true, data: [] });
      }
      const childIds = children.map(child => child._id);

      // 3. Fetch all bookings where patient is any of the children
      // Populate package, patient, therapist, and therapy everywhere (including in sessions)
      const appointments = await Booking.find({ patient: { $in: childIds } })
        .populate({ path: 'package' })
        .populate({ path: 'patient', model: 'PatientProfile' })
        .populate({ 
          path: 'therapist', 
          model: 'TherapistProfile',
          select:"therapistId",
          populate: { 
            path: 'userId', 
            model: 'User', 
            select: 'name' // Only fetch the name field in the User document 
          }
        })
        .populate({ path: 'therapy', model: 'TherapyType' })
        .populate({ path: 'payment' })
        .lean();




      // Gather all therapist ids and therapy ids used in all sessions
      const therapistIds = [];
      const therapyIds = [];
      appointments.forEach((appointment, i) => {
        if (Array.isArray(appointment.sessions)) {
          appointment.sessions.forEach((session, j) => {
            if (session.therapist) therapistIds.push(session.therapist);
            if (session.therapy) therapyIds.push(session.therapy);
            // Check session structure

          });
        }
      });


      // Unique ids
      const uniqueTherapistIds = [...new Set(therapistIds.map(id => id?.toString()).filter(Boolean))];
      const uniqueTherapyIds = [...new Set(therapyIds.map(id => id?.toString()).filter(Boolean))];



      // Fetch all therapist User docs and TherapyType docs
      const therapists = await TherapistProfile.find({ _id: { $in: uniqueTherapistIds } })
        .populate({ 
          path: 'userId', 
          model: 'User', 
          select: 'name' // Only fetch the name field in the User document 
        })
        .select('userId name therapistId') // Only fetch userId and name in TherapistProfile
        .lean();


      // Build lookup maps
      const therapistMap = {};
      therapists.forEach(t => { therapistMap[String(t._id)] = t; });





      // Attach the populated therapist & therapy for each session
      for (const [i, appointment] of appointments.entries()) {
        if (Array.isArray(appointment.sessions)) {
          appointment.sessions = appointment.sessions.map((session, j) => {
            const sessionCopy = { ...session };
            if (session.therapist && therapistMap[session.therapist?.toString()]) {
              sessionCopy.therapist = therapistMap[session.therapist?.toString()];
            }
          
            return sessionCopy;
          });
        }
      }

      // INSERT_YOUR_CODE

      // Fetch all session edit requests for these appointments and map them by appointmentId and sessionId

      const appointmentIds = appointments.map(a => a._id);
      // Only fetch edit requests for these appointments
      const sessionEditRequests = await SessionEditRequest.find({ appointmentId: { $in: appointmentIds } }).lean();

      // Map edit requests by appointmentId (array), for direct access
      const editRequestsByAppointment = {};
      sessionEditRequests.forEach(er => {
        const apptId = er.appointmentId?.toString?.() || er.appointmentId;
        if (!editRequestsByAppointment[apptId]) editRequestsByAppointment[apptId] = [];
        editRequestsByAppointment[apptId].push(er);
      });

      // Attach all session edit requests for this appointment to appointment object (flat array)
      for (const appointment of appointments) {
        const apptId = appointment._id?.toString?.() || appointment._id;
        appointment.editRequests = editRequestsByAppointment[apptId] || [];
      }

      console.log(appointments);




      res.json({ success: true, data: appointments });
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

      // Fetch patients for dropdown
      // Only fetch patient profiles belonging to this parent
      const patientProfiles = await PatientProfile.find({ userId: parentId }, "name userId patientId mobile1").populate({
        path: "userId",
        select: "name",
      });

      const patients = patientProfiles.map((profile) => ({
        id: profile._id,
        patientId: profile.patientId,
        name: profile.name || "",
        phoneNo: profile.mobile1 || "",
      }));

      // Fetch therapy types and packages
      const therapyTypes = await TherapyType.find();
      const packages = await Package.find();

      // Fetch all active therapists with their holidays
      const activeTherapists = await (await import("../../Schema/user.schema.js")).TherapistProfile.aggregate([
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
        {
          $project: {
            _id: 1,
            therapistId: 1,
            name: "$user.name",
            holidays: 1,
            mobile1: 1
          }
        }
      ]);
      
      // 2. Get bookings count per therapist grouped by date
      const bookingCounts = await Booking.aggregate([
        {
          $unwind: "$sessions"
        },
        {
          $group: {
            _id: { therapist: "$therapist", date: "$sessions.date" },
            count: { $sum: 1 }
          }
        }
      ]);

      const therapistBookingMap = {};
      bookingCounts.forEach((row) => {
        const therapistId = row._id.therapist.toString();
        const date = row._id.date;
        if (!therapistBookingMap[therapistId]) therapistBookingMap[therapistId] = {};
        therapistBookingMap[therapistId][date] = row.count;
      });

      const therapistsWithCounts = activeTherapists.map((t) => {
        const bookingsByDate = therapistBookingMap[t._id.toString()] || {};
        return { ...t, bookingsByDate };
      });

      // Fetch discount coupons (for booking form, show only enabled)
      const coupons = await DiscountModel.find({ discountEnabled: true }).sort({ createdAt: -1 }).lean();

      return res.json({
        success: true,
        patients,
        therapyTypes,
        packages,
        therapists: activeTherapists,
        therapistsWithCounts,
        coupons
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

      // Only fields needed by booking-request.schema.js
      const {
        package: packageId,
        patient: patientId,
        therapy: therapyId,
        sessions
      } = req.body;

      // Log incoming request for audit
      console.log("[CREATE BOOKING REQUEST] Incoming body:", req.body);

      // Validate required fields (per schema: requestId, package, patient, sessions[], therapy)
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

      // (Optional: check Package ID valid)
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
      // Format: REQ-00001
      const requestId = `REQ-${String(counter.seq).padStart(5, '0')}`;
      console.log("[CREATE BOOKING REQUEST] Generated requestId:", requestId);

      // Compose booking request payload with only allowed fields
      const bookingRequestPayload = {
        requestId,
        package: packageId,
        patient: patientId,
        sessions,
        therapy: therapyId
      };

      // Remove undefined/nulls
      Object.keys(bookingRequestPayload).forEach(
        k => bookingRequestPayload[k] === undefined && delete bookingRequestPayload[k]
      );

      // Save booking request in DB
      const bookingRequest = new BookingRequests(bookingRequestPayload);
      await bookingRequest.save({ session });
      console.log("[CREATE BOOKING REQUEST] BookingRequest saved. _id:", bookingRequest._id);

      await session.commitTransaction();
      session.endSession();

      // Populate returned fields (basic for now)
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
  async getAllBookingRequests(req, res) {
    try {
      const parentUserId =  req.user?.id;

      // Support filter: only my requests
      const filter = {};
      if (parentUserId) {
        // Find all PatientProfiles for this parent

        // Fetch the user first, then fetch all Patient Profiles for that user
        const user = await User.findById(parentUserId).lean();
        if (!user) {
          return res.status(404).json({ success: false, message: "User not found" });
        }
        const myPatients = await PatientProfile.find({ userId: user._id }, '_id').lean();
        const myPatientIds = myPatients.map(p => p._id);

        if (myPatientIds.length > 0) {
          filter.patient = { $in: myPatientIds };
        } else {
          // No patients for this parent, no booking requests
          return res.json({ success: true, bookingRequests: [] });
        }
      }

      const requests = await BookingRequests.find(filter)
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User"
          }
        })
        .populate({ path: "therapy", model: "TherapyType" })
        .sort({ createdAt: -1 });
      res.json({
        success: true,
        bookingRequests: requests
      });
    } catch (error) {
      console.error("[GET ALL BOOKING REQUESTS]", error);
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
    session.startTransaction();

    try {
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

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, bookingRequest });
    } catch (error) {
      await session.abortTransaction();
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

      const bookingRequest = await BookingRequests.findByIdAndDelete(id, { session });
      if (!bookingRequest) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Booking request not found" });
      }

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
    try {
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
        return res.status(400).json({
          success: false,
          message:
            "Missing required fields. appointmentId, patientId, and sessions (with sessionId, newDate, newSlotId) are required.",
        });
      }

      // INSERT_YOUR_CODE

      // Check if a pending request for this appointment already exists
      const existingPendingRequest = await SessionEditRequest.findOne({
        appointmentId: appointmentId,
        status: "pending"
      });

      if (existingPendingRequest) {
        return res.status(400).json({
          success: false,
          message: "A pending session edit request for this appointment already exists.",
          request: existingPendingRequest
        });
      }


      // Generate custom session-edit-request Id
      const requestId = await this.generateSessionEditRequestId();

      const request = await SessionEditRequest.create({
        // Do not set _id manually, let Mongo generate
        appointmentId,
        patientId,
        sessions,
        status: "pending",
        requestId, // Optional: can store for external reference
      });

      res.status(201).json({ success: true, request });
    } catch (error) {
      console.error("[CREATE SESSION EDIT REQUEST]", error);
      res.status(500).json({ success: false, message: "Failed to create session edit request", error: error.message });
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

  // Edit/update a session edit request (only updatable: sessions array, status)
  async updateSessionEditRequest(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
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
        return res.status(400).json({ success: false, message: "No valid fields provided for update" });
      }

      const updated = await SessionEditRequest.findByIdAndUpdate(id, updates, { new: true });
      if (!updated) {
        return res.status(404).json({ success: false, message: "Session edit request not found" });
      }

      res.json({ success: true, request: updated });
    } catch (error) {
      console.error("[UPDATE SESSION EDIT REQUEST]", error);
      res.status(500).json({ success: false, message: "Failed to update session edit request", error: error.message });
    }
  }

  // Delete a session edit request
  async deleteSessionEditRequest(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, message: "Request ID required" });
      }

      const deleted = await SessionEditRequest.findByIdAndDelete(id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: "Session edit request not found" });
      }

      res.json({ success: true, message: "Session edit request deleted successfully" });
    } catch (error) {
      console.error("[DELETE SESSION EDIT REQUEST]", error);
      res.status(500).json({ success: false, message: "Failed to delete session edit request", error: error.message });
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
  async getInvoiceAndPayment(req, res) {
    try {
      const userId = req.user.id;

      // 1. Fetch User (assuming you have a User model)
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      // 2. Fetch all Patient Profiles linked to this user
      const patientProfiles = await PatientProfile.find({ userId: userId });
      if (!patientProfiles || patientProfiles.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No patient profiles found for this user.",
        });
      }
      const patientProfileIds = patientProfiles.map((p) => p._id);

      // 3. Fetch all Bookings for these Patient Profiles and populate related fields + payments
      const bookings = await Booking.find({ patient: { $in: patientProfileIds } })
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

      // Structure all populated payments: [{ InvoiceId, date, patientName, amount, status }]
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
          // Try to resolve patient name from populated path
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
          let patientId = booking.patient.patientId;
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
  


}

export default ParentController;
