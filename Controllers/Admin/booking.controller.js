
import { User, PatientProfile, TherapistProfile } from "../../Schema/user.schema.js";
import Package from "../../Schema/packages.schema.js";
import { TherapyType } from "../../Schema/therapy-type.schema.js";
import Booking from "../../Schema/booking.schema.js";
import Counter from "../../Schema/counter.schema.js";
import DailyAvailability from "../../Schema/AvailabilitySlots/daily-availability.schema.js";
import DiscountAdminController from "../SuperAdmin/discount.controller.js";
import DiscountModel from "../../Schema/discount.schema.js";
import Payment from "../../Schema/payment.schema.js";
import BookingRequests from "../../Schema/booking-request.schema.js";
import AavailabilitySlotsAdminController from "./availability-slots.controller.js";
import SessionEditRequest from "../../Schema/session-edit-request.schema.js";
import Finances from "../../Schema/finances.schema.js";
import Lead from "../../Schema/leads.schema.js";
import WhatsappController from "../Whatsapp/whatsapp.js"; 

import AuditLogService from "../AuditLogs/audit-logs.controller.js";
import mongoose from "mongoose";

// Utility to get next sequence for an allowed counter
const getNextSequence = async (name) => {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

// Given appointment sequence number, format appointmentId as B000001 etc.
function generateAppointmentId(seq) {
  return 'B' + seq.toString().padStart(5, '0');
}

const aavailabilitySlotsAdminController = new AavailabilitySlotsAdminController();

class BookingAdminController {

  

  async getOverview(req, res) {
    try {
      // 1. Fetch all required data in parallel
      const [
        activeChildrens,
        activeParents, // NEW: will be filled below
        activeTherapists,
        allBookings,
        todayBookings,
        allPendingPaymentsBookings,
        pendingTasks,
        pendingBookingRequests,
        pendingSessionEditRequests,
        perDayStats,
        // TherapistManualSignUp count for pending enable/panel access
        pendingTherapistManualSignUpCount
      ] = await Promise.all([
        // Active Children
        (async () => {
          const activePatientUsers = await User.find({ role: "patient", status: "active" }, { _id: 1 });
          const activePatientUserIds = activePatientUsers.map(u => u._id);
          return PatientProfile.countDocuments({ userId: { $in: activePatientUserIds } });
        })(),
        // Active Parents (NEW)
        (async () => {
          // Find active parents by role in User collection
          return User.countDocuments({ role: "patient", status: "active" });
        })(),
        // Active Therapists
        User.countDocuments({ role: "therapist", status: "active", isDisabled: { $ne: true } }),
        // All bookings (for all-time stats, pending appointments, payments, etc)
        Booking.find({})
          .populate({ path: "patient", model: "PatientProfile", select: "name patientId mobile gender" })
          .populate({ path: "therapist", model: "TherapistProfile", select: "name" })
          .populate({ path: "package", model: "Package" })
          .populate({ path: "therapy", model: "TherapyType" })
          .populate({ path: "sessions.therapist", model: "TherapistProfile", select: "userId therapistId", populate: { path: "userId", model: "User", select: "name" } })
          .populate({ path: "payment", model: "Payment" })
          .lean(),
        // Bookings with at least one session for today
        (async () => {
          const today = new Date();
          const yyyy = today.getFullYear();
          const mm = String(today.getMonth() + 1).padStart(2, '0');
          const dd = String(today.getDate()).padStart(2, '0');
          const todayISO = `${yyyy}-${mm}-${dd}`;
          const bookings = await Booking.find({
            "sessions.date": todayISO
          })
            .populate({ path: "patient", model: "PatientProfile", select: "name patientId mobile gender" })
            .populate({ path: "therapist", model: "TherapistProfile", select: "name" })
            .populate({ path: "package", model: "Package" })
            .populate({ path: "therapy", model: "TherapyType" })
            .populate({ path: "sessions.therapist", model: "TherapistProfile", select: "userId therapistId", populate: { path: "userId", model: "User", select: "name" } })
            .populate({ path: "payment", model: "Payment" })
            .lean();
          return bookings;
        })(),
        // All bookings with pending payments
        (async () => {
          const bookings = await Booking.find({})
            .populate({ path: "payment", model: "Payment" })
            .lean();
          return bookings.filter(b => {
            if (!b.payment) return true;
            if (b.payment && b.payment.status && b.payment.status !== "paid") return true;
            if (b.payment && !b.payment.status) return true;
            return false;
          });
        })(),
        // Pending Tasks
        (typeof Lead !== "undefined"
          ? Lead.countDocuments({ status: "pending", $or: [{ visitFinalized: { $ne: "yes" } }, { status: { $ne: "converted" } }] })
          : Promise.resolve(0)
        ),
        // Pending Booking Requests
        (typeof BookingRequests !== "undefined"
          ? BookingRequests.countDocuments({ status: "pending" })
          : Promise.resolve(0)
        ),
        // Pending Session Edit Requests
        (typeof SessionEditRequest !== "undefined"
          ? SessionEditRequest.countDocuments({ status: "pending" })
          : Promise.resolve(0)
        ),
        // ===== PER DAY SESSIONS AND BOOKINGS =====
        (async () => {
          // Sessions completed each day (sessions.isCheckedIn = true, group by sessions.date)
          const completedSessions = await Booking.aggregate([
            { $unwind: "$sessions" },
            { $match: { "sessions.isCheckedIn": true } },
            {
              $group: {
                _id: "$sessions.date",
                sessionsCompleted: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ]);
          // Sessions scheduled each day (all sessions, group by sessions.date)
          const scheduledSessions = await Booking.aggregate([
            { $unwind: "$sessions" },
            {
              $group: {
                _id: "$sessions.date",
                sessionsScheduled: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ]);
          // Bookings created each day (group by createdAt (date only))
          const bookingsCreated = await Booking.aggregate([
            {
              $group: {
                _id: {
                  $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                },
                bookingsCreated: { $sum: 1 }
              }
            },
            { $sort: { _id: 1 } }
          ]);
          // Build sessionScheduledPerDay array
          const sessionScheduledMap = {};
          scheduledSessions.forEach(ss => {
            sessionScheduledMap[ss._id] = ss.sessionsScheduled;
          });
          // For max date coverage, use union of dates from completedSessions and scheduledSessions
          const allSessionDatesSet = new Set([
            ...completedSessions.map(s => s._id),
            ...scheduledSessions.map(s => s._id),
          ]);
          const sessionScheduledPerDay = Array.from(allSessionDatesSet).sort().map(date => ({
            date,
            sessionsScheduled: sessionScheduledMap[date] || 0
          }));

          // Return structure
          return {
            sessionsCompletedPerDay: completedSessions.map(cs => ({
              date: cs._id,
              sessionsCompleted: cs.sessionsCompleted
            })),
            sessionScheduledPerDay,
            bookingsCreatedPerDay: bookingsCreated.map(bc => ({
              date: bc._id,
              bookingsCreated: bc.bookingsCreated
            }))
          }
        })(),
        // TherapistManualSignUp: count of therapists who are not enabled and do not have pannel access
        (async () => {
          // Adjust the model/fields as per your actual therapist schema.
          // We'll assume "isManualSignUp" (or similar flag), "status" not enabled, and "isDisabled/pannelAccess" fields.
          return User.countDocuments({
            role: "therapist",
            manualSignUp: true,
            $or: [
              { status: { $ne: "active" } },
              { isDisabled: true },
              { panelAccess: { $ne: true } }
            ]
          });
        })()
      ]);

      // Set up date helpers
      const now = new Date();
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const todayISO = `${yyyy}-${mm}-${dd}`;
      const monthStartISO = `${yyyy}-${mm}-01`;

      // Helper: session is pending and not started
      function sessionIsPending(sess) {
        return (sess.status === "pending" || !sess.status)
          && sess.date &&
          (new Date(sess.date) >= now);
      }

      // ----- Today's Pending Bookings & Completed Bookings -----
      let todaysPendingBooking = 0;
      let todaysCompletedBookings = 0;

      // For bookings with any session on today, count the pending or completed state
      todayBookings.forEach(bk => {
        let hasPending = false;
        let hasCompleted = false;
        if (Array.isArray(bk.sessions)) {
          bk.sessions.forEach(sess => {
            if (sess.date === todayISO) {
              if (sess.isCheckedIn === true || sess.status === "done" || sess.status === "completed") {
                hasCompleted = true;
              } else if (sess.status === "pending" || sess.status === "approved" || !sess.status) {
                hasPending = true;
              }
            }
          });
        }
        if (hasPending) todaysPendingBooking++;
        if (hasCompleted) todaysCompletedBookings++;
      });

      // ---- All-Time Pending Payments ----
      const allTimePendingPayments = allPendingPaymentsBookings.length;

      // ---- This Month's Pending Payments ----
      let thisMonthsPendingPayments = 0;
      allPendingPaymentsBookings.forEach(bk => {
        // If the booking has any session in the current month, and payment pending, count it
        if (Array.isArray(bk.sessions)) {
          if (bk.sessions.some(sess => typeof sess.date === "string" && sess.date >= monthStartISO && sess.date <= todayISO)) {
            thisMonthsPendingPayments++;
          }
        }
      });

      // --------- (other unchanged stats for dashboard) ----------
      // Count all sessions on all bookings for aggregate stats
      let totalBookedAppointments = 0;
      let totalAppointments = allBookings.length;
      let totalPendingAppointments = 0;
      allBookings.forEach(bk => {
        if (Array.isArray(bk.sessions)) {
          totalBookedAppointments += bk.sessions.length;
          if (bk.sessions.some(sessionIsPending)) {
            totalPendingAppointments++;
          }
        }
      });

      // For previous "today's" counts in use
      let todaysTotalAppointments = 0;
      let todaysPendingAppointments = 0;
      let todaysDoneAppointments = 0;
      todayBookings.forEach(bk => {
        if (!Array.isArray(bk.sessions)) return;
        bk.sessions.forEach(sess => {
          if (sess.date === todayISO) {
            todaysTotalAppointments++;
            if (sess.isCheckedIn === true || sess.status === "done" || sess.status === "completed") {
              todaysDoneAppointments++;
            } else {
              todaysPendingAppointments++;
            }
          }
        });
      });

      res.json({
        success: true,
        data: {
          activeChildren: activeChildrens,
          activeParents: activeParents, // NEW FIELD ADDED
          activeTherapists: activeTherapists,
          totalSessions: totalBookedAppointments,
          todaysTotalSessions: todaysTotalAppointments,
          todaysPendingSessions: todaysPendingBooking,
          todaysCompletedSessions: todaysCompletedBookings,
          allTimePendingPayments,
          thisMonthsPendingPayments,
          pendingTasks,
          pendingBookingRequests,
          pendingSessionEditRequests,
          pendingTherapistManualSignUp: pendingTherapistManualSignUpCount,
          // NEW SECTION for per-day stats
          sessionsCompletedPerDay: perDayStats.sessionsCompletedPerDay,
          sessionScheduledPerDay: perDayStats.sessionScheduledPerDay,
          bookingsCreatedPerDay: perDayStats.bookingsCreatedPerDay
        }
      });
    } catch (error) {
      console.error("[getOverview] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get overview",
        error: error.message
      });
    }
  }
  
  // Provides booking page dropdown/reference details
  async getBookingHomePageDetails(req, res) {
    try {
      // Fetch patients for dropdown
      const patientProfiles = await PatientProfile.find({}, "userId name patientId mobile1").populate({
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

      // Fetch all active therapists with their holidays, skip if therapist is disabled
      const allTherapists = await (await import("../../Schema/user.schema.js")).TherapistProfile.aggregate([
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user"
          }
        },
        { $unwind: "$user" },
        { 
          $match: { 
            "user.status": "active",
            "user.isDisabled": { $ne: true } // Exclude disabled therapists
          } 
        },
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
      const activeTherapists = allTherapists; // preserve variable name for downstream use

      // Get bookings count per therapist grouped by date
      const bookingCounts = await Booking.aggregate([
        {
          $unwind: "$sessions"
        },
        {
          $group: {
            _id: { therapist: "$sessions.therapist", date: "$sessions.date" },
            count: { $sum: 1 },
            slots: { $addToSet: "$sessions.slotId" }
          }
        }
      ]);

      console.log(bookingCounts);

      // Build therapistBookedSlotMap and therapistBookedCountMap
      const therapistBookedSlotMap = {};
      const therapistBookedCountMap = {};
      bookingCounts.forEach((row) => {
        const therapistId = row._id.therapist.toString();
        const date = row._id.date;

        // For booked slots per therapistId and date
        if (!therapistBookedSlotMap[therapistId]) therapistBookedSlotMap[therapistId] = {};
        if (!therapistBookedSlotMap[therapistId][date]) therapistBookedSlotMap[therapistId][date] = [];
        therapistBookedSlotMap[therapistId][date] = Array.from(new Set([
          ...therapistBookedSlotMap[therapistId][date],
          ...(row.slots || [])
        ]));

        // For booked slot count per therapistId and date
        if (!therapistBookedCountMap[therapistId]) therapistBookedCountMap[therapistId] = {};
        therapistBookedCountMap[therapistId][date] = (row.slots || []).length;
      });

      // For each therapist: include bookedSlots and bookedSlotCount (per date)
      const therapists = activeTherapists.map((t) => {
        const therapistIdString = t._id.toString();
        const bookedSlots = therapistBookedSlotMap[therapistIdString] || {};
        const bookedSlotCount = therapistBookedCountMap[therapistIdString] || {};
        return { ...t, bookedSlots, bookedSlotCount };
      });

      // Fetch discount coupons (for booking form, show only enabled)
      const coupons = await DiscountModel.find({ discountEnabled: true }).sort({ createdAt: -1 }).lean();

      return res.json({
        success: true,
        patients,
        therapyTypes,
        packages,
        therapists, // therapists now have bookedSlots and bookedSlotCount objects per date
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

  // Create a new booking with updated booking schema (1-47)
  async createBooking(req, res) {
    const session = await mongoose.startSession();
    try {
      // Start transaction (mandatory - ALL steps MUST be in session, revert on any error including logs)
      await session.startTransaction();

      const {
        coupon,
        package: packageId,
        patient: patientId,
        therapist: therapistId,
        sessions,
        therapy: therapyId,
        status,
        notes,
        channel,
        attendedBy,
        referral,
        extra,
        attendedByType,
        paymentDueDate,
        invoiceNumber,
        followupRequired,
        followupDate,
        isBookingRequest,
        bookingRequestId,
        remark
      } = req.body;

      // Required fields check
      if (
        !packageId ||
        !patientId ||
        !therapyId ||
        !therapistId ||
        !Array.isArray(sessions) ||
        !sessions.length
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }

      // Step 1: Therapist and slot availability validation (in tx session)
      const therapistIdsForSessions = Array.from(new Set((sessions || []).map(sess => sess.therapistId || therapistId)));
      const therapistProfiles = await TherapistProfile.find({ _id: { $in: therapistIdsForSessions } }).lean();
      const therapistIdToRefIdMap = {};
      therapistProfiles.forEach(tp => {
        therapistIdToRefIdMap[tp._id.toString()] = tp.therapistId;
      });
      if (Object.keys(therapistIdToRefIdMap).length !== therapistIdsForSessions.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "One or more therapist(s) referenced in sessions do not exist."
        });
      }
      // Prepare requestedSlots for availability
      const requestedSlots = (sessions || []).map(sess => ({
        date: sess.date,
        slotId: sess.slotId || sess.id,
        therapistId: sess.therapistId || therapistId
      }));
      if (requestedSlots.some(s => !s.date || !s.slotId || !s.therapistId)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid session data: All sessions must have date, slotId/id, and therapistId."
        });
      }

      let sessionDates = requestedSlots.map(s => s.date).sort();
      const fromDate = sessionDates[0];
      const toDate = sessionDates[sessionDates.length - 1];

      let allSlotAvailabilityData = {};
      for (const uniqueTherapistId of therapistIdsForSessions) {
        try {
          let fakeReq = {
            query: {
              therapistId: String(uniqueTherapistId),
              from: fromDate,
              to: toDate,
            }
          };
          let availabilitySummaryResult = await new Promise((resolve, reject) => {
            aavailabilitySlotsAdminController.getAvailabilitySummary(
              fakeReq,
              {
                json: (body) => resolve(body),
                status: (code) => ({
                  json: (body) => {
                    body.__status = code;
                    resolve(body);
                  }
                })
              }
            );
          });
          if (
            !availabilitySummaryResult ||
            !availabilitySummaryResult.success ||
            !availabilitySummaryResult.data
          ) {
            throw new Error("Invalid response from getAvailabilitySummary");
          }
          const therapistRefId = therapistIdToRefIdMap[uniqueTherapistId];
          allSlotAvailabilityData[therapistRefId] = availabilitySummaryResult.data;
        } catch (err) {
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({
            success: false,
            message: `Failed to check slot availability for one or more therapists.`,
            error: err.message,
          });
        }
      }

      // Conflict check
      let conflicts = [];
      requestedSlots.forEach(sess => {
        const refId = therapistIdToRefIdMap[sess.therapistId];
        const slotAvailabilityData = allSlotAvailabilityData[refId];
        if (!slotAvailabilityData) return;

        for (const availKey in slotAvailabilityData) {
          const [d, m, y] = availKey.split('-');
          const keyAsIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          if (
            sess.date === keyAsIso &&
            slotAvailabilityData[availKey]?.BookedSlots &&
            slotAvailabilityData[availKey].BookedSlots[refId] &&
            Array.isArray(slotAvailabilityData[availKey].BookedSlots[refId]) &&
            slotAvailabilityData[availKey].BookedSlots[refId].includes(sess.slotId)
          ) {
            conflicts.push({
              date: sess.date,
              slotId: sess.slotId,
              therapistId: sess.therapistId
            });
          }
        }
      });
      if (conflicts.length > 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          success: false,
          message: "Selected therapist/time slot already booked for one or more session dates.",
          conflicts,
          allSlotAvailabilityData
        });
      }

      // Step 2: Coupon logic (in tx)
      let discountInfo = undefined;
      if (coupon && coupon.id) {
        discountInfo = { coupon: coupon.id, time: new Date() };
      } else if (typeof coupon === "string" && coupon) {
        discountInfo = { coupon: coupon, time: new Date() };
      }

      // Step 3: Generate new appointmentId & paymentId in tx
      const counter = await Counter.findOneAndUpdate(
        { name: "appointment" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
      );
      const appointmentId = generateAppointmentId(counter.seq);

      // Step 4: Create payment document in tx
      const pkg = await Package.findById(packageId).lean();
      if (!pkg) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid package"
        });
      }
      const year = new Date().getFullYear();
      const paymentCounter = await Counter.findOneAndUpdate(
        { name: "payment" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
      );
      const paymentId = `INV-${year}-${String(paymentCounter.seq).padStart(5, "0")}`;
      const paymentDoc = new Payment({
        paymentId: paymentId,
        totalAmount: pkg.totalCost,
        amount: pkg.totalCost,
        status: 'pending',
        paymentMethod: 'cash'
      });
      await paymentDoc.save({ session });

      // Step 5: Normalize sessions, WITH sessionId per session (S00001...) -- updated: sessionId sorted by date
      const sessionCount = Array.isArray(sessions) ? sessions.length : 0;
      let sessionCounterStart = 1;
      if (sessionCount > 0) {
        const sessionCounterDoc = await Counter.findOneAndUpdate(
          { name: "session" },
          { $inc: { seq: sessionCount } },
          { new: true, upsert: true, session }
        );
        sessionCounterStart = sessionCounterDoc.seq - sessionCount + 1;
      }

      // Sort the sessions by date (earlier sessions first)
      // If two sessions have same date, maintain their original order (stable sort)
      let sortedSessions = [];
      if (Array.isArray(sessions)) {
        sortedSessions = sessions
          .map((s, origIdx) => ({ ...s, __origIdx: origIdx }))
          .sort((a, b) => {
            // Compare dates as ISO strings (YYYY-MM-DD)
            if (a.date < b.date) return -1;
            if (a.date > b.date) return 1;
            return a.__origIdx - b.__origIdx;
          });
      }

      // Assign sessionIds according to the sorted order
      const normalizedSessions = (sortedSessions || []).map((sess, idx) => ({
        sessionId: `S${String(sessionCounterStart + idx).padStart(6, "0")}`,
        date: sess.date,
        time: sess.time || "",
        slotId: sess.slotId || sess.id,
        therapist: sess.therapistId || therapistId,
        therapyTypeId: sess.therapyTypeId || sess.therapyType || null,
        isCheckedIn: typeof sess.isCheckedIn !== "undefined" ? sess.isCheckedIn : false
      }));

      // Compose booking payload (do NOT write outside tx)
      const bookingPayload = {
        appointmentId,
        status,
        notes,
        remark,
        discountInfo,
        package: packageId,
        patient: patientId,
        therapist: therapistId,
        sessions: normalizedSessions,
        therapy: therapyId,
        payment: paymentDoc._id,
        channel,
        attendedBy,
        referral,
        extra,
        attendedByType,
        paymentDueDate,
        invoiceNumber,
        followupRequired,
        followupDate
      };

      Object.keys(bookingPayload).forEach(
        k => bookingPayload[k] === undefined && delete bookingPayload[k]
      );
      const booking = new Booking(bookingPayload);

      // Step 6: Save booking in tx
      await booking.save({ session });

      // Step 7: If booking request, update request status in tx
      if (isBookingRequest && bookingRequestId) {
        const bookingRequestDoc = await BookingRequests.findById(bookingRequestId).session(session);
        if (bookingRequestDoc) {
          const previousBookingRequest = bookingRequestDoc.toObject();
          bookingRequestDoc.status = "approved";
          bookingRequestDoc.appointmentId = booking._id;
          await bookingRequestDoc.save({ session });

          // Log approval of booking request, and association with booking
          try {
            await AuditLogService.addLog(
              {
                action: "BOOKING_REQUEST_APPROVED",
                user: req.user?.id,
                role: "admin",
                resource: "BookingRequest",
                resourceId: bookingRequestDoc._id,
                details: {
                  previous: previousBookingRequest,
                  updated: bookingRequestDoc,
                  approvedBy: req.user?.id,
                  appointmentId: booking._id,
                  message: `Booking request approved and linked to booking ${booking._id} by admin ${req.user?.id}`,
                },
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
              },
              session
            );
          } catch (logError) {
            await session.abortTransaction();
            session.endSession();
            return res.status(500).json({
              success: false,
              message: "Failed to approve booking request (audit log failure).",
              error: logError?.message || "Audit logging failed.",
            });
          }
        }
      }

      // Step 8: Audit log in tx (MANDATORY: if fails, ROLLBACK everything)
      try {
        await AuditLogService.addLog({
          action: "BOOKING_CREATED",
          user: req.user?.id,
          role: "admin",
          resource: "Booking",
          resourceId: booking._id,
          details: {
            patientId,
            therapistId,
            appointmentId: booking.appointmentId,
            packageId,
            therapyId,
            channel,
            sessions: normalizedSessions.length,
            invoiceNumber,
            remark,
            status,
            message: `Booking created for children ${patientId} with therapist ${therapistId}, package ${packageId}, therapy ${therapyId}`
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }, session); // pass session if AuditLog supports it!
      } catch (logError) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          success: false,
          message: "Failed to create booking (audit log failure).",
          error: logError?.message || "Audit logging failed.",
        });
      }

      // Commit transaction ONLY IF ALL steps succeed including log
      await session.commitTransaction();
      session.endSession();

      // Step 9: Populate and return booking (not in tx, not rollbackable but data is safe now)
      const populatedBooking = await Booking.findById(booking._id)
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({ path: "therapy", model: "TherapyType" })
        .populate({ path: "therapist", model: "TherapistProfile" })
        .populate({ path: "payment", model: "Payment" });

      // ---- WhatsApp Integration ----
      try {
        // Children details: phone, name
        let phoneNo;
        let patientName;
        if (populatedBooking?.patient) {
          if (populatedBooking.patient?.mobile1) {
            phoneNo = populatedBooking.patient.mobile1;
          } else if (populatedBooking.patient?.userId && populatedBooking.patient.userId?.phone) {
            phoneNo = populatedBooking.patient.userId.phone;
          }
          patientName = populatedBooking.patient?.name || populatedBooking.patient?.userId?.fullName;
        }
        // therapist name
        let therapistName;
        if (populatedBooking?.therapist) {
          therapistName = populatedBooking.therapist.name || populatedBooking.therapist.therapistId;
        }
        // package
        let packageName = populatedBooking?.package?.name;
        // therapy type
        let therapyTypeName = populatedBooking?.therapy?.name;

        // session dates and times - send all in WhatsApp message
        let sessionsData = [];
        if (Array.isArray(populatedBooking.sessions)) {
          sessionsData = populatedBooking.sessions.map(ses => {
            let sessionDate = ses.date;
            let sessionTime = ses.time;
            return { date: sessionDate, time: sessionTime };
          });
        }

        // Only send if phoneNo present and not empty
        if (phoneNo) {
          // Convert sessionsData (array of {date, time}) to a readable multiline text string, showing every session on separate line as "Date: YYYY-MM-DD, Time: HH:mm"
          const sessionsText = Array.isArray(sessionsData) && sessionsData.length
            ? sessionsData.map(
                (s, i) =>
                  `Session ${i + 1}: Date: ${s.date || '-'}, Time: ${s.time ? s.time : '-'}`
              ).join(",")
            : "";

          // Send the ACTUAL paymentId (not placeholder), as per @payment.schema.js (1-74)
          // paymentId must be taken from populatedBooking.payment.paymentId
          let waPaymentId = undefined;
          if (populatedBooking?.payment && populatedBooking.payment.paymentId) {
            waPaymentId = populatedBooking.payment.paymentId;
          }

          await WhatsappController.sendBookingCreationCompleted({
            destination: phoneNo,
            userName: patientName,
            appointmentId: populatedBooking.appointmentId,
            patientName: patientName,
            therapist: therapistName,
            totalSessions: sessionsText, // now sending multiline all sessions with date & time
            paymentId: waPaymentId
          });

        }
      } catch (waErr) {
        // log error only, do not fail booking creation if WhatsApp fails
        console.error("Failed to send WhatsApp message:", waErr?.message || waErr);
      }
      // ---- End WhatsApp Integration ----

      res.status(201).json({
        success: true,
        booking: populatedBooking,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      res.status(500).json({
        success: false,
        message: "Failed to create booking.",
        error: error.message,
      });
    }
  }

  // Get all bookings (populated)
  /**
   * Get all bookings (with search, filters, and pagination)
   * - Search by any text field (case insensitive).
   * - Filters: All direct Booking fields (id, patient, therapist, package, etc), as well as populated reference fields.
   * - Pagination: page, pageSize
   * - Sort (optionally): sortField, sortOrder
   * URL example:
   * /api/admin/bookings?search=foo&page=1&pageSize=10&status=active&therapist=64xyz...
   */
  /**
   * Enhanced getAllBookings supporting:
   * - Deep, flexible filtering for all Booking fields (and sub-document fields in Patient, Therapist, Payment, Package, TherapyType, including their referenced User where applicable)
   * - Search on: direct Booking fields, PatientProfile fields, TherapistProfile fields, Payment fields, User fields (for patient/therapist), TherapyType fields, and sessions/slot subfields
   * - Filter on: Any Booking, Payment (status, amount, method), PatientProfile (patientId, name, mobile1), TherapistProfile (therapistId, name, mobile1), etc.
   * - Handles all types of filters and search
   */
  /**
   * Enhanced getAllBookings
   * - Handles search, filters for Booking, Payment, Patient, Therapist, Package, Therapy
   * - Pagination (page, pageSize), sort (sortField, sortOrder)
   * - Accepts Booking IDs as CSV strings in patient, therapist, etc
   * - Accepts filters in req.query, e.g. therapist, patient, paymentStatus, etc.
   * - Example: /api/admin/bookings?search=foo&page=1&pageSize=5&paymentStatus=paid&therapist=NPL0002&patient=P0005
   */
  async getAllBookings(req, res) {
    try {
      const {
        page = 1,
        pageSize = 15,
        sortField = "createdAt",
        sortOrder = "desc"
      } = req.query;

      // No filters or search; fetch all bookings, paginate, and sort only.
      let sortObj = {};
      if (sortField) sortObj[sortField] = sortOrder === "desc" ? -1 : 1;
      const _page = parseInt(page, 10) || 1;
      const _pageSize = parseInt(pageSize, 10) || 15;
      const skip = (_page - 1) * _pageSize;

      // Get total count
      const total = await Booking.countDocuments();

      // Query bookings with pagination and population
      const bookings = await Booking.find({})
        .sort(sortObj)
        .skip(skip)
        .limit(_pageSize)
        .populate({ path: "package" })
        .populate({ path: "therapy", model: "TherapyType" })
        .populate({
          path: "therapist",
          model: "TherapistProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({ path: "payment", model: "Payment" })
        .populate({ path: "discountInfo.coupon", model: "Discount" })
        .populate({
          path: "sessions.therapist",
          model: "TherapistProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({
          path: "sessions.therapyTypeId",
          model: "TherapyType"
        });

      res.json({
        success: true,
        bookings,
        total,
        page: _page,
        pageSize: _pageSize,
        totalPages: Math.ceil(total / _pageSize)
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

  // Get single booking by id (populated)
  // async getBookingById(req, res) {
  //   try {
  //     const { id } = req.params;
  //     const booking = await Booking.findById(id)
  //       .populate("package")
  //       .populate({
  //         path: "patient",
  //         model: "PatientProfile",
  //         populate: {
  //           path: "userId",
  //           model: "User"
  //         }
  //       })
  //       .populate({
  //         path: "therapy",
  //         model: "TherapyType"
  //       })
  //       .populate({
  //         path: "therapist",
  //         model: "TherapistProfile"
  //       });

  //     if (!booking) {
  //       return res.status(404).json({
  //         success: false,
  //         message: "Booking not found.",
  //       });
  //     }

  //     res.json({
  //       success: true,
  //       booking,
  //     });
  //   } catch (error) {
  //     console.error(error);
  //     res.status(500).json({
  //       success: false,
  //       message: "Failed to fetch booking.",
  //       error: error.message,
  //     });
  //   }
  // }

  // Utility: adjust booked slot count for a list of sessions
  async adjustAvailabilityCounts(sessions, delta) {
    if (!Array.isArray(sessions) || sessions.length === 0) return;

    const filteredSessions = sessions.filter(
      s => s && typeof s.slotId === "string" && s.slotId.trim().length > 0 && typeof s.date === "string"
    );
    if (filteredSessions.length === 0) {
      if (delta < 0) {
        console.warn("[adjustAvailabilityCounts] No valid sessions with slotId provided for decrement!", sessions);
      }
      return;
    }

    const ops = filteredSessions.map(({ date, slotId }) => ({
      updateOne: {
        filter: {
          date,
          "sessions.id": slotId
        },
        update: {
          $inc: { "sessions.$[slot].booked": delta }
        },
        arrayFilters: [{ "slot.id": slotId }]
      }
    }));

    await DailyAvailability.bulkWrite(ops);
  }

  // Update booking with updated booking schema (1-47), and send WhatsApp message on update
  // async updateBooking(req, res) {
  //   const mongoose = (await import("mongoose")).default;
  //   const session = await mongoose.startSession();
  //   session.startTransaction();

  //   try {
  //     const { id } = req.params;
  //     const {
  //       coupon,
  //       package: packageId,
  //       patient: patientId,
  //       sessions,
  //       therapy: therapyId,
  //       payment,
  //       status,
  //       notes,
  //       channel,
  //       attendedBy,
  //       referral,
  //       extra,
  //       attendedByType,
  //       paymentDueDate,
  //       invoiceNumber,
  //       followupRequired,
  //       followupDate,
  //       therapist: bodyTherapist,
  //       remark,
  //     } = req.body;

  //     // Validate required fields
  //     if (
  //       !packageId ||
  //       !patientId ||
  //       !therapyId ||
  //       !Array.isArray(sessions) ||
  //       !sessions.length
  //     ) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       return res.status(400).json({
  //         success: false,
  //         message: "Missing required fields"
  //       });
  //     }

  //     // Ensure booking exists
  //     const prevBooking = await Booking.findById(id).lean();
  //     if (!prevBooking) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       return res.status(404).json({
  //         success: false,
  //         message: "Booking not found.",
  //       });
  //     }

  //     // Prepare requested slots (include therapist mapping for each slot!)
  //     const requestedSlots = (sessions || []).map(sess => {
  //       let therapistValue =
  //         sess.therapist ||
  //         sess.therapistId ||
  //         bodyTherapist ||
  //         prevBooking.therapist;
  //       if (therapistValue && typeof therapistValue === "object" && therapistValue._id) {
  //         therapistValue = therapistValue._id;
  //       }
  //       return {
  //         date: sess.date,
  //         slotId: sess.slotId || sess.id,
  //         therapist: therapistValue
  //       };
  //     });

  //     if (requestedSlots.some(s => !s.date || !s.slotId || !s.therapist)) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       return res.status(400).json({
  //         success: false,
  //         message: "Invalid session data: Each session must have date, slotId, and therapist."
  //       });
  //     }

  //     // For each involved therapist, check their slots in relevant date range, just like in createBooking.
  //     const therapistToDates = {};
  //     requestedSlots.forEach(({ date, therapist }) => {
  //       const key = String(therapist);
  //       if (!therapistToDates[key]) therapistToDates[key] = new Set();
  //       therapistToDates[key].add(date);
  //     });

  //     // Collect all needed therapist docs so we can get readable .therapistId and .fullName/.name
  //     const uniqueTherapistIds = Array.from(
  //       new Set(requestedSlots.map(r => String(r.therapist)))
  //     );
  //     const therapistDocs = await TherapistProfile.find({
  //       _id: { $in: uniqueTherapistIds }
  //     }).lean();

  //     const therapistIdMap = {};
  //     const therapistNameMap = {};
  //     therapistDocs.forEach(tDoc => {
  //       therapistIdMap[String(tDoc._id)] = tDoc.therapistId;
  //       therapistNameMap[String(tDoc._id)] = tDoc.fullName || tDoc.name || "";
  //     });

  //     // --- Check slot availability for all sessions ---
  //     let slotAvailabilityDataCacheByTherapist = {};
  //     let conflicts = [];

  //     for (const therapistObjId of uniqueTherapistIds) {
  //       const dates = Array.from(therapistToDates[therapistObjId] || []);
  //       if (!dates.length) continue;
  //       const sortedDates = dates.slice().sort();
  //       const fromDate = sortedDates[0];
  //       const toDate = sortedDates[sortedDates.length - 1];

  //       let slotAvailabilityResult;
  //       let therapistRefId = therapistIdMap[therapistObjId];
  //       try {
  //         let fakeReq = {
  //           query: {
  //             therapistId: String(therapistObjId),
  //             from: fromDate,
  //             to: toDate
  //           }
  //         };
  //         slotAvailabilityResult = await new Promise((resolve, reject) => {
  //           aavailabilitySlotsAdminController.getAvailabilitySummary(
  //             fakeReq,
  //             {
  //               json: body => resolve(body),
  //               status: code => ({
  //                 json: body => {
  //                   body.__status = code;
  //                   resolve(body);
  //                 }
  //               })
  //             }
  //           );
  //         });
  //       } catch (err) {
  //         await session.abortTransaction();
  //         session.endSession();
  //         return res.status(500).json({
  //           success: false,
  //           message: "Failed to check slot availability.",
  //           error: err.message,
  //         });
  //       }
  //       if (!slotAvailabilityResult || !slotAvailabilityResult.success || !slotAvailabilityResult.data) {
  //         await session.abortTransaction();
  //         session.endSession();
  //         return res.status(409).json({
  //           success: false,
  //           message: "Could not fetch therapist's slot availability for update request."
  //         });
  //       }
  //       slotAvailabilityDataCacheByTherapist[therapistObjId] = slotAvailabilityResult.data;

  //       // Now check for each session for this therapist
  //       const refId = therapistRefId;
  //       const slotAvailabilityData = slotAvailabilityResult.data;

  //       requestedSlots
  //         .filter(s => String(s.therapist) === String(therapistObjId))
  //         .forEach(sess => {
  //           const alreadyHad =
  //             Array.isArray(prevBooking.sessions) &&
  //             prevBooking.sessions.some(
  //               ps =>
  //                 String(ps.date) === String(sess.date) &&
  //                 String(ps.slotId || ps.id) === String(sess.slotId) &&
  //                 String(ps.therapist || ps.therapistId) === String(sess.therapist)
  //             );
  //           if (alreadyHad) return;
  //           for (const availKey in slotAvailabilityData) {
  //             const [d, m, y] = availKey.split('-');
  //             const keyAsIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  //             if (
  //               sess.date === keyAsIso &&
  //               slotAvailabilityData[availKey]?.BookedSlots &&
  //               slotAvailabilityData[availKey].BookedSlots[refId] &&
  //               Array.isArray(slotAvailabilityData[availKey].BookedSlots[refId]) &&
  //               slotAvailabilityData[availKey].BookedSlots[refId].includes(sess.slotId)
  //             ) {
  //               conflicts.push({
  //                 date: sess.date,
  //                 slotId: sess.slotId,
  //                 therapist: sess.therapist
  //               });
  //             }
  //           }
  //         });
  //     }

  //     if (conflicts.length > 0) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       return res.status(409).json({
  //         success: false,
  //         message: "Selected therapist/time slot already booked for one or more session dates.",
  //         conflicts,
  //       });
  //     }

  //     // For sessionId format: pad with leading zeros as S00001 etc.
  //     function generateSessionId(index) {
  //       return `S${String(index + 1).padStart(5, "0")}`;
  //     }

  //     // Build a map of previous session keys to sessionId if present (to preserve sessionId during update)
  //     const sessionKey = (s) =>
  //       `${s.date}|${s.slotId}|${String(
  //         typeof s.therapist === "object" && s.therapist?._id
  //           ? s.therapist._id
  //           : s.therapist || ""
  //       )}`;
  //     const prevSessions = Array.isArray(prevBooking.sessions)
  //       ? prevBooking.sessions.filter(
  //           s =>
  //             s &&
  //             typeof s.slotId === "string" &&
  //             s.slotId.trim().length > 0 &&
  //             typeof s.date === "string"
  //         )
  //       : [];
  //     const prevSessionIdMap = {};
  //     prevSessions.forEach((sess) => {
  //       if (sess.sessionId) {
  //         prevSessionIdMap[sessionKey(sess)] = sess.sessionId;
  //       }
  //     });

  //     // If all slots clear, proceed with update.
  //     // Properly build updatedSessions with therapist and therapyType (like createBooking body)
  //     let updatedSessions = Array.isArray(sessions)
  //       ? sessions.map((s, idx) => {
  //           let therapistValue =
  //             s.therapist ||
  //             s.therapistId ||
  //             bodyTherapist ||
  //             prevBooking.therapist;
  //           if (therapistValue && typeof therapistValue === "object" && therapistValue._id) {
  //             therapistValue = therapistValue._id;
  //           }
  //           let therapistIdField = therapistIdMap[String(therapistValue)] || "";
  //           let therapyTypeIdValue = s.therapyTypeId || s.therapyType || therapyId;
  //           const keyForSession = sessionKey({
  //             date: s.date,
  //             slotId: s.slotId || s.id,
  //             therapist: therapistValue
  //           });

  //           // Preserve existing sessionId or generate new if not present
  //           let sessionIdValue =
  //             prevSessionIdMap[keyForSession] ||
  //             s.sessionId ||
  //             generateSessionId(idx);

  //           return {
  //             date: s.date,
  //             slotId: s.slotId || s.id,
  //             therapist: therapistValue,
  //             therapistId: therapistIdField,
  //             therapyTypeId: therapyTypeIdValue,
  //             sessionId: sessionIdValue,
  //             ...(s.time && { time: s.time }),
  //             ...(s.isCheckedIn !== undefined && { isCheckedIn: s.isCheckedIn }),
  //           };
  //         })
  //       : [];

  //     const nextSessions = updatedSessions.filter(
  //       s =>
  //         s &&
  //         typeof s.slotId === "string" &&
  //         s.slotId.trim().length > 0 &&
  //         typeof s.date === "string"
  //     );

  //     const prevKeys = new Set(prevSessions.map(sessionKey));
  //     const nextKeys = new Set(nextSessions.map(sessionKey));
  //     const sessionsToDecrement = prevSessions.filter(
  //       s => !nextKeys.has(sessionKey(s))
  //     );
  //     const sessionsToIncrement = nextSessions.filter(
  //       s => !prevKeys.has(sessionKey(s))
  //     );
  //     // Optionally update availability
  //     // if (sessionsToDecrement.length > 0) await this.adjustAvailabilityCounts(sessionsToDecrement, -1);
  //     // if (sessionsToIncrement.length > 0) await this.adjustAvailabilityCounts(sessionsToIncrement, 1);

  //     let discountInfo = undefined;
  //     if (coupon) {
  //       discountInfo = {
  //         coupon: coupon.id || coupon._id || coupon,
  //         time: new Date()
  //       };
  //     }

  //     const updatePayload = {
  //       discountInfo,
  //       package: packageId,
  //       patient: patientId,
  //       sessions: updatedSessions,
  //       therapy: therapyId,
  //       payment,
  //       status,
  //       notes,
  //       channel,
  //       attendedBy,
  //       referral,
  //       extra,
  //       attendedByType,
  //       paymentDueDate,
  //       invoiceNumber,
  //       followupRequired,
  //       followupDate,
  //       remark
  //     };
  //     Object.keys(updatePayload).forEach(
  //       k => updatePayload[k] === undefined && delete updatePayload[k]
  //     );

  //     // Do not commit the booking until audit log creation is successful
  //     let booking = null;
  //     let bookingUpdated = false;
  //     let auditLogCreated = false;
  //     let bookingUpdateError = null;

  //     try {
  //       booking = await Booking.findByIdAndUpdate(id, updatePayload, { new: true })
  //         .populate("package")
  //         .populate({
  //           path: "patient",
  //           model: "PatientProfile",
  //           populate: {
  //             path: "userId",
  //             model: "User"
  //           }
  //         })
  //         .populate({
  //           path: "therapy",
  //           model: "TherapyType"
  //         })
  //         .populate({
  //           path: "therapist",
  //           model: "TherapistProfile"
  //         })
  //         .populate({
  //           path: "payment",
  //           model: "Payment"
  //         });

  //       if (!booking) {
  //         bookingUpdateError = {
  //           status: 404,
  //           msg: "Booking not found.",
  //           response: {
  //             success: false,
  //             message: "Booking not found.",
  //           }
  //         };
  //       } else {
  //         bookingUpdated = true;
  //       }
  //     } catch (err) {
  //       bookingUpdateError = {
  //         status: 500,
  //         msg: "Failed to update booking.",
  //         response: {
  //           success: false,
  //           message: "Failed to update booking.",
  //           error: err.message,
  //         }
  //       };
  //     }

  //     if (!bookingUpdated || !booking) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       return res.status(bookingUpdateError?.status || 500).json(bookingUpdateError?.response || {
  //         success: false,
  //         message: "Failed to update booking."
  //       });
  //     }

  //     // Audit log for booking update is mandatory: if log is not created, revert everything!
  //     try {
  //       // New: Prepare therapist names as comma separated string for the audit log
  //       // We'll collect therapistIds (therapistId field, not _id!) from updated sessions
  //       let auditTherapistNamesArr = [];
  //       let auditTherapistIds = [];
  //       // use updatedSessions from above and therapistIdMap
  //       auditTherapistIds = [
  //         ...new Set(
  //           updatedSessions
  //             .map(sess => {
  //               // convert to therapistId, not objectId
  //               let id = therapistIdMap[String(sess.therapist)] || "";
  //               return id;
  //             })
  //             .filter(x => x)
  //         ),
  //       ];
  //       auditTherapistNamesArr = auditTherapistIds.map(tid => {
  //         // Map therapistId back to readable name
  //         // First, find the objectId in therapistIdMap that matches the therapistId
  //         let objectId = Object.keys(therapistIdMap).find(k => therapistIdMap[k] === tid);
  //         return therapistNameMap[objectId] || tid;
  //       });
  //       const auditTherapistText = auditTherapistNamesArr.length > 0
  //         ? auditTherapistNamesArr.join(", ")
  //         : (booking.therapist && (
  //             booking.therapist.fullName ||
  //             booking.therapist.name ||
  //             (typeof booking.therapist === "string" ? booking.therapist : "")
  //           )) || "--";

  //       await AuditLogService.addLog({
  //         action: "BOOKING_UPDATED",
  //         user: req.user?.id,
  //         role: "admin",
  //         resource: "Booking",
  //         resourceId: booking._id,
  //         details: {
  //           patientId,
  //           // TherapistId: join by comma and pass names not objectId, not array but text as per instruction
  //           therapistId: auditTherapistText,
  //           appointmentId: booking.appointmentId,
  //           packageId,
  //           therapyId,
  //           channel,
  //           sessions: updatedSessions.length,
  //           invoiceNumber,
  //           remark,
  //           status,
  //           message: `Booking updated for Children ${patientId} with therapist ${auditTherapistText}, package ${packageId}, therapy ${therapyId}`
  //         },
  //         ipAddress: req.ip,
  //         userAgent: req.headers['user-agent']
  //       });
  //       auditLogCreated = true;
  //     } catch (err) {
  //       console.error("[AUDIT LOG] Failed to record booking_updated log:", err);
  //       // If audit log creation fails, revert booking update and respond as failure
  //       await session.abortTransaction();
  //       session.endSession();
  //       return res.status(500).json({
  //         success: false,
  //         message: "Failed to update booking. Audit log is mandatory; changes reverted.",
  //         error: err?.message || "Audit logging failed.",
  //       });
  //     }

  //     // --- WhatsApp message logic after update, before commit ---
  //     // Only send message if booking and Children populated, and sendWhatsAppMessage available
  //     if (
  //       booking &&
  //       booking.Children &&
  //       booking.patient.userId
  //     ) {
  //       try {
  //         // Children phone, fallback to empty string if not found
  //         let destination = "";
  //         let userName = "";
  //         let patientName = "";
  //         let therapistNames = [];
  //         let totalSessions = 0;
  //         let appointmentId = booking.appointmentId || booking._id?.toString();
  //         let statusToSend = "Updated"; // Set status explicitly to "Updated"

  //         if (booking.patient.userId && booking.patient.userId.phone) {
  //           destination = booking.patient.userId.phone;
  //         }
  //         if (booking.Children && booking.patient.fullName) {
  //           userName = booking.patient.fullName;
  //           patientName = booking.patient.fullName;
  //         } else if (booking.Children && booking.patient.name) {
  //           userName = booking.patient.name;
  //           patientName = booking.patient.name;
  //         }

  //         // Collect all unique therapist IDs from sessions (by therapistId, not objectId)
  //         let therapistIdsInSessions = [];
  //         if (booking.sessions && Array.isArray(booking.sessions)) {
  //           therapistIdsInSessions = [
  //             ...new Set(
  //               booking.sessions
  //                 .map(s => {
  //                   // s.therapist here may be objectId or object
  //                   // convert to therapistId string
  //                   let key = (s.therapist && typeof s.therapist === "object" && s.therapist._id)
  //                     ? s.therapist._id.toString()
  //                     : (typeof s.therapist === "string" ? s.therapist : s.therapist?.toString());
  //                   return therapistIdMap[key] || "";
  //                 })
  //                 .filter(Boolean)
  //             ),
  //           ];
  //         }

  //         // Now convert those therapistIds to names, fallback handling
  //         therapistNames = therapistIdsInSessions.map(tid => {
  //           let objectId = Object.keys(therapistIdMap).find(k => therapistIdMap[k] === tid);
  //           return therapistNameMap[objectId] || tid;
  //         }).filter(Boolean);

  //         // Remove duplicates, just in case
  //         therapistNames = [...new Set(therapistNames)];

  //         // Compose as comma separated text and send as string (not as array) as per requirements
  //         let therapistNameText = therapistNames.length > 0
  //           ? therapistNames.join(", ")
  //           : (booking.therapist && (
  //             booking.therapist.fullName ||
  //             booking.therapist.name ||
  //             (typeof booking.therapist === "string" ? booking.therapist : "")
  //           )) || "--";

  //         // Total number of sessions
  //         totalSessions = Array.isArray(booking.sessions) ? booking.sessions.length : 0;

  //         // Compose WhatsApp message fields object:
  //         await WhatsappController.sendBookingEditSuccess({
  //           destination,
  //           userName,
  //           appointmentId,
  //           patientName,
  //           therapistName: therapistNameText, // as text, not array, as instructed
  //           totalSessions,
  //           status: statusToSend, // explicitly send as "Updated"
  //         });
  //       } catch (waerr) {
  //         // log only, do not fail main flow
  //         console.error("WhatsApp sending failed on booking update:", waerr);
  //       }
  //     }

  //     // All succeeded: commit final transaction
  //     await session.commitTransaction();
  //     session.endSession();

  //     res.json({
  //       success: true,
  //       booking,
  //     });

  //   } catch (error) {
  //     await session.abortTransaction();
  //     session.endSession();
  //     console.error("[updateBooking] Error:", error);
  //     res.status(500).json({
  //       success: false,
  //       message: "Failed to update booking.",
  //       error: error.message,
  //     });
  //   }
  // }

  // ── PASTE THIS INTO YOUR BOOKING CONTROLLER ──────────────────────────────────
// Only the updateBooking method is shown.  Everything outside this method
// is unchanged.

// async updateBooking(req, res) {
//   const mongoose = (await import("mongoose")).default;
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { id } = req.params;   // ← this is the bookingId being edited
//     const {
//       coupon,
//       package: packageId,
//       patient: patientId,
//       sessions,
//       therapy: therapyId,
//       payment,
//       status,
//       notes,
//       channel,
//       attendedBy,
//       referral,
//       extra,
//       attendedByType,
//       paymentDueDate,
//       invoiceNumber,
//       followupRequired,
//       followupDate,
//       therapist: bodyTherapist,
//       remark,
//     } = req.body;

//     // Validate required fields
//     if (
//       !packageId ||
//       !patientId ||
//       !therapyId ||
//       !Array.isArray(sessions) ||
//       !sessions.length
//     ) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "Missing required fields"
//       });
//     }

//     // Ensure booking exists
//     const prevBooking = await Booking.findById(id).lean();
//     if (!prevBooking) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: "Booking not found.",
//       });
//     }

//     // Prepare requested slots (include therapist mapping for each slot!)
//     const requestedSlots = (sessions || []).map(sess => {
//       let therapistValue =
//         sess.therapist ||
//         sess.therapistId ||
//         bodyTherapist ||
//         prevBooking.therapist;
//       if (therapistValue && typeof therapistValue === "object" && therapistValue._id) {
//         therapistValue = therapistValue._id;
//       }
//       return {
//         date: sess.date,
//         slotId: sess.slotId || sess.id,
//         therapist: therapistValue
//       };
//     });

//     if (requestedSlots.some(s => !s.date || !s.slotId || !s.therapist)) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "Invalid session data: Each session must have date, slotId, and therapist."
//       });
//     }

//     // For each involved therapist, check their slots in relevant date range
//     const therapistToDates = {};
//     requestedSlots.forEach(({ date, therapist }) => {
//       const key = String(therapist);
//       if (!therapistToDates[key]) therapistToDates[key] = new Set();
//       therapistToDates[key].add(date);
//     });

//     // Collect all needed therapist docs
//     const uniqueTherapistIds = Array.from(
//       new Set(requestedSlots.map(r => String(r.therapist)))
//     );
//     const therapistDocs = await TherapistProfile.find({
//       _id: { $in: uniqueTherapistIds }
//     }).lean();

//     const therapistIdMap = {};
//     const therapistNameMap = {};
//     therapistDocs.forEach(tDoc => {
//       therapistIdMap[String(tDoc._id)] = tDoc.therapistId;
//       therapistNameMap[String(tDoc._id)] = tDoc.fullName || tDoc.name || "";
//     });

//     // --- Check slot availability, EXCLUDING the booking being edited ---
//     let conflicts = [];

//     for (const therapistObjId of uniqueTherapistIds) {
//       const dates = Array.from(therapistToDates[therapistObjId] || []);
//       if (!dates.length) continue;
//       const sortedDates = dates.slice().sort();
//       const fromDate = sortedDates[0];
//       const toDate = sortedDates[sortedDates.length - 1];

//       let slotAvailabilityResult;
//       try {
//         // ── KEY FIX ───────────────────────────────────────────────────────
//         // Pass excludeBookingId so getAvailabilitySummary will NOT count
//         // the sessions that belong to the booking currently being edited.
//         // This prevents the editing booking's own slots from appearing as
//         // "already booked" during the conflict check.
//         // ─────────────────────────────────────────────────────────────────
//         let fakeReq = {
//           query: {
//             therapistId: String(therapistObjId),
//             from: fromDate,
//             to: toDate,
//             excludeBookingId: String(id),   // ← NEW: tell availability to ignore this booking
//           }
//         };
//         slotAvailabilityResult = await new Promise((resolve, reject) => {
//           aavailabilitySlotsAdminController.getAvailabilitySummary(
//             fakeReq,
//             {
//               json: body => resolve(body),
//               status: code => ({
//                 json: body => {
//                   body.__status = code;
//                   resolve(body);
//                 }
//               })
//             }
//           );
//         });
//       } catch (err) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(500).json({
//           success: false,
//           message: "Failed to check slot availability.",
//           error: err.message,
//         });
//       }

//       if (!slotAvailabilityResult || !slotAvailabilityResult.success || !slotAvailabilityResult.data) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(409).json({
//           success: false,
//           message: "Could not fetch therapist's slot availability for update request."
//         });
//       }

//       const refId = therapistIdMap[therapistObjId];
//       const slotAvailabilityData = slotAvailabilityResult.data;

//       // ── REMOVED the flawed `alreadyHad` early-return check ────────────
//       // The old code tried to skip sessions that existed in prevBooking,
//       // but ObjectId-to-string comparison was unreliable.  Now that
//       // getAvailabilitySummary excludes this booking's slots entirely,
//       // every requested slot is safe to check directly — if the
//       // availability API says it's booked, it's genuinely booked by
//       // a DIFFERENT booking.
//       requestedSlots
//         .filter(s => String(s.therapist) === String(therapistObjId))
//         .forEach(sess => {
//           for (const availKey in slotAvailabilityData) {
//             const [d, m, y] = availKey.split('-');
//             const keyAsIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
//             if (
//               sess.date === keyAsIso &&
//               slotAvailabilityData[availKey]?.BookedSlots &&
//               slotAvailabilityData[availKey].BookedSlots[refId] &&
//               Array.isArray(slotAvailabilityData[availKey].BookedSlots[refId]) &&
//               slotAvailabilityData[availKey].BookedSlots[refId].includes(sess.slotId)
//             ) {
//               conflicts.push({
//                 date: sess.date,
//                 slotId: sess.slotId,
//                 therapist: sess.therapist
//               });
//             }
//           }
//         });
//     }

//     if (conflicts.length > 0) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(409).json({
//         success: false,
//         message: "Selected therapist/time slot already booked for one or more session dates.",
//         conflicts,
//       });
//     }

//     // For sessionId format: pad with leading zeros as S00001 etc.
//     function generateSessionId(index) {
//       return `S${String(index + 1).padStart(6, "0")}`;
//     }

//     // Build a map of previous session keys to sessionId if present
//     const sessionKey = (s) =>
//       `${s.date}|${s.slotId}|${String(
//         typeof s.therapist === "object" && s.therapist?._id
//           ? s.therapist._id
//           : s.therapist || ""
//       )}`;
//     const prevSessions = Array.isArray(prevBooking.sessions)
//       ? prevBooking.sessions.filter(
//           s =>
//             s &&
//             typeof s.slotId === "string" &&
//             s.slotId.trim().length > 0 &&
//             typeof s.date === "string"
//         )
//       : [];
//     const prevSessionIdMap = {};
//     prevSessions.forEach((sess) => {
//       if (sess.sessionId) {
//         prevSessionIdMap[sessionKey(sess)] = sess.sessionId;
//       }
//     });

//     // Build updatedSessions
//     let updatedSessions = Array.isArray(sessions)
//       ? sessions.map((s, idx) => {
//           let therapistValue =
//             s.therapist ||
//             s.therapistId ||
//             bodyTherapist ||
//             prevBooking.therapist;
//           if (therapistValue && typeof therapistValue === "object" && therapistValue._id) {
//             therapistValue = therapistValue._id;
//           }
//           let therapistIdField = therapistIdMap[String(therapistValue)] || "";
//           let therapyTypeIdValue = s.therapyTypeId || s.therapyType || therapyId;
//           const keyForSession = sessionKey({
//             date: s.date,
//             slotId: s.slotId || s.id,
//             therapist: therapistValue
//           });

//           let sessionIdValue =
//             prevSessionIdMap[keyForSession] ||
//             s.sessionId ||
//             generateSessionId(idx);

//           return {
//             date: s.date,
//             slotId: s.slotId || s.id,
//             therapist: therapistValue,
//             therapistId: therapistIdField,
//             therapyTypeId: therapyTypeIdValue,
//             sessionId: sessionIdValue,
//             ...(s.time && { time: s.time }),
//             ...(s.isCheckedIn !== undefined && { isCheckedIn: s.isCheckedIn }),
//           };
//         })
//       : [];

//     const nextSessions = updatedSessions.filter(
//       s =>
//         s &&
//         typeof s.slotId === "string" &&
//         s.slotId.trim().length > 0 &&
//         typeof s.date === "string"
//     );

//     const prevKeys = new Set(prevSessions.map(sessionKey));
//     const nextKeys = new Set(nextSessions.map(sessionKey));
//     const sessionsToDecrement = prevSessions.filter(s => !nextKeys.has(sessionKey(s)));
//     const sessionsToIncrement = nextSessions.filter(s => !prevKeys.has(sessionKey(s)));

//     let discountInfo = undefined;
//     if (coupon) {
//       discountInfo = {
//         coupon: coupon.id || coupon._id || coupon,
//         time: new Date()
//       };
//     }

//     const updatePayload = {
//       discountInfo,
//       package: packageId,
//       patient: patientId,
//       sessions: updatedSessions,
//       therapy: therapyId,
//       payment,
//       status,
//       notes,
//       channel,
//       attendedBy,
//       referral,
//       extra,
//       attendedByType,
//       paymentDueDate,
//       invoiceNumber,
//       followupRequired,
//       followupDate,
//       remark
//     };
//     Object.keys(updatePayload).forEach(
//       k => updatePayload[k] === undefined && delete updatePayload[k]
//     );

//     let booking = null;
//     let bookingUpdated = false;
//     let bookingUpdateError = null;

//     try {
//       booking = await Booking.findByIdAndUpdate(id, updatePayload, { new: true })
//         .populate("package")
//         .populate({
//           path: "patient",
//           model: "PatientProfile",
//           populate: { path: "userId", model: "User" }
//         })
//         .populate({ path: "therapy", model: "TherapyType" })
//         .populate({ path: "therapist", model: "TherapistProfile" })
//         .populate({ path: "payment", model: "Payment" });

//       if (!booking) {
//         bookingUpdateError = {
//           status: 404,
//           response: { success: false, message: "Booking not found." }
//         };
//       } else {
//         bookingUpdated = true;
//       }
//     } catch (err) {
//       bookingUpdateError = {
//         status: 500,
//         response: { success: false, message: "Failed to update booking.", error: err.message }
//       };
//     }

//     if (!bookingUpdated || !booking) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(bookingUpdateError?.status || 500).json(
//         bookingUpdateError?.response || { success: false, message: "Failed to update booking." }
//       );
//     }

//     // Audit log
//     try {
//       let auditTherapistIds = [
//         ...new Set(
//           updatedSessions
//             .map(sess => therapistIdMap[String(sess.therapist)] || "")
//             .filter(x => x)
//         ),
//       ];
//       let auditTherapistNamesArr = auditTherapistIds.map(tid => {
//         let objectId = Object.keys(therapistIdMap).find(k => therapistIdMap[k] === tid);
//         return therapistNameMap[objectId] || tid;
//       });
//       const auditTherapistText = auditTherapistNamesArr.length > 0
//         ? auditTherapistNamesArr.join(", ")
//         : (booking.therapist && (
//             booking.therapist.fullName ||
//             booking.therapist.name ||
//             (typeof booking.therapist === "string" ? booking.therapist : "")
//           )) || "--";

//       await AuditLogService.addLog({
//         action: "BOOKING_UPDATED",
//         user: req.user?.id,
//         role: "admin",
//         resource: "Booking",
//         resourceId: booking._id,
//         details: {
//           patientId,
//           therapistId: auditTherapistText,
//           appointmentId: booking.appointmentId,
//           packageId,
//           therapyId,
//           channel,
//           sessions: updatedSessions.length,
//           invoiceNumber,
//           remark,
//           status,
//           message: `Booking updated for Children ${patientId} with therapist ${auditTherapistText}, package ${packageId}, therapy ${therapyId}`
//         },
//         ipAddress: req.ip,
//         userAgent: req.headers['user-agent']
//       });
//     } catch (err) {
//       console.error("[AUDIT LOG] Failed to record booking_updated log:", err);
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(500).json({
//         success: false,
//         message: "Failed to update booking. Audit log is mandatory; changes reverted.",
//         error: err?.message || "Audit logging failed.",
//       });
//     }

//     // WhatsApp notification
//     if (booking && booking.patient && booking.patient.userId) {
//       try {
//         let destination = booking.patient.userId.phone || "";
//         let userName = booking.patient.fullName || booking.patient.name || "";
//         let patientName = userName;
//         let therapistIdsInSessions = [
//           ...new Set(
//             booking.sessions
//               .map(s => {
//                 let key = (s.therapist && typeof s.therapist === "object" && s.therapist._id)
//                   ? s.therapist._id.toString()
//                   : (typeof s.therapist === "string" ? s.therapist : s.therapist?.toString());
//                 return therapistIdMap[key] || "";
//               })
//               .filter(Boolean)
//           ),
//         ];
//         let therapistNames = therapistIdsInSessions.map(tid => {
//           let objectId = Object.keys(therapistIdMap).find(k => therapistIdMap[k] === tid);
//           return therapistNameMap[objectId] || tid;
//         }).filter(Boolean);
//         therapistNames = [...new Set(therapistNames)];
//         let therapistNameText = therapistNames.length > 0
//           ? therapistNames.join(", ")
//           : (booking.therapist && (
//               booking.therapist.fullName ||
//               booking.therapist.name ||
//               (typeof booking.therapist === "string" ? booking.therapist : "")
//             )) || "--";

//         await WhatsappController.sendBookingEditSuccess({
//           destination,
//           userName,
//           appointmentId: booking.appointmentId || booking._id?.toString(),
//           patientName,
//           therapistName: therapistNameText,
//           totalSessions: Array.isArray(booking.sessions) ? booking.sessions.length : 0,
//           status: "Updated",
//         });
//       } catch (waerr) {
//         console.error("WhatsApp sending failed on booking update:", waerr);
//       }
//     }

//     await session.commitTransaction();
//     session.endSession();

//     res.json({ success: true, booking });

//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();
//     console.error("[updateBooking] Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to update booking.",
//       error: error.message,
//     });
//   }
// }

// ── updateBooking ─────────────────────────────────────────────────────────────
// Full controller method with globally-unique sessionId handling on edit.
//
// Key rules:
//   • Sessions that existed before  →  keep their original sessionId
//   • Sessions that are genuinely new → get Counter-issued IDs (globally unique)
//   • Incoming sessions are sorted by date (same as createBooking) so counter
//     values are allocated in chronological order
//   • One atomic Counter.findOneAndUpdate call claims a contiguous block of N
//     IDs for all new sessions, preventing race conditions
// ─────────────────────────────────────────────────────────────────────────────

async updateBooking(req, res) {
  const mongoose = (await import("mongoose")).default;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params; // bookingId being edited

    const {
      coupon,
      package: packageId,
      patient: patientId,
      sessions,
      therapy: therapyId,
      payment,
      status,
      notes,
      channel,
      attendedBy,
      referral,
      extra,
      attendedByType,
      paymentDueDate,
      invoiceNumber,
      followupRequired,
      followupDate,
      therapist: bodyTherapist,
      remark,
    } = req.body;

    // ── 1. Validate required fields ───────────────────────────────────────────
    if (
      !packageId ||
      !patientId ||
      !therapyId ||
      !Array.isArray(sessions) ||
      !sessions.length
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // ── 2. Ensure booking exists ──────────────────────────────────────────────
    const prevBooking = await Booking.findById(id).lean();
    if (!prevBooking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    // ── 3. Prepare requested slots ────────────────────────────────────────────
    const requestedSlots = (sessions || []).map((sess) => {
      let therapistValue =
        sess.therapist ||
        sess.therapistId ||
        bodyTherapist ||
        prevBooking.therapist;
      if (
        therapistValue &&
        typeof therapistValue === "object" &&
        therapistValue._id
      ) {
        therapistValue = therapistValue._id;
      }
      return {
        date: sess.date,
        slotId: sess.slotId || sess.id,
        therapist: therapistValue,
      };
    });

    if (requestedSlots.some((s) => !s.date || !s.slotId || !s.therapist)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "Invalid session data: Each session must have date, slotId, and therapist.",
      });
    }

    // ── 4. Build therapist → dates map ────────────────────────────────────────
    const therapistToDates = {};
    requestedSlots.forEach(({ date, therapist }) => {
      const key = String(therapist);
      if (!therapistToDates[key]) therapistToDates[key] = new Set();
      therapistToDates[key].add(date);
    });

    // ── 5. Fetch therapist docs for id ↔ refId ↔ name mapping ─────────────────
    const uniqueTherapistIds = Array.from(
      new Set(requestedSlots.map((r) => String(r.therapist)))
    );
    const therapistDocs = await TherapistProfile.find({
      _id: { $in: uniqueTherapistIds },
    }).lean();

    const therapistIdMap = {};   // objectId string → therapistId (refId)
    const therapistNameMap = {}; // objectId string → fullName
    therapistDocs.forEach((tDoc) => {
      therapistIdMap[String(tDoc._id)] = tDoc.therapistId;
      therapistNameMap[String(tDoc._id)] = tDoc.fullName || tDoc.name || "";
    });

    // ── 6. Slot conflict check (excluding the booking being edited) ───────────
    let conflicts = [];

    for (const therapistObjId of uniqueTherapistIds) {
      const dates = Array.from(therapistToDates[therapistObjId] || []);
      if (!dates.length) continue;

      const sortedDates = dates.slice().sort();
      const fromDate = sortedDates[0];
      const toDate = sortedDates[sortedDates.length - 1];

      let slotAvailabilityResult;
      try {
        // Pass excludeBookingId so availability does NOT count this booking's
        // own sessions — preventing its slots from appearing as "already booked".
        const fakeReq = {
          query: {
            therapistId: String(therapistObjId),
            from: fromDate,
            to: toDate,
            excludeBookingId: String(id), // ← key fix
          },
        };
        slotAvailabilityResult = await new Promise((resolve, reject) => {
          aavailabilitySlotsAdminController.getAvailabilitySummary(fakeReq, {
            json: (body) => resolve(body),
            status: (code) => ({
              json: (body) => {
                body.__status = code;
                resolve(body);
              },
            }),
          });
        });
      } catch (err) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          success: false,
          message: "Failed to check slot availability.",
          error: err.message,
        });
      }

      if (
        !slotAvailabilityResult ||
        !slotAvailabilityResult.success ||
        !slotAvailabilityResult.data
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          success: false,
          message:
            "Could not fetch therapist's slot availability for update request.",
        });
      }

      const refId = therapistIdMap[therapistObjId];
      const slotAvailabilityData = slotAvailabilityResult.data;

      requestedSlots
        .filter((s) => String(s.therapist) === String(therapistObjId))
        .forEach((sess) => {
          for (const availKey in slotAvailabilityData) {
            const [d, m, y] = availKey.split("-");
            const keyAsIso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
            if (
              sess.date === keyAsIso &&
              slotAvailabilityData[availKey]?.BookedSlots &&
              slotAvailabilityData[availKey].BookedSlots[refId] &&
              Array.isArray(slotAvailabilityData[availKey].BookedSlots[refId]) &&
              slotAvailabilityData[availKey].BookedSlots[refId].includes(
                sess.slotId
              )
            ) {
              conflicts.push({
                date: sess.date,
                slotId: sess.slotId,
                therapist: sess.therapist,
              });
            }
          }
        });
    }

    if (conflicts.length > 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message:
          "Selected therapist/time slot already booked for one or more session dates.",
        conflicts,
      });
    }

    // ── 7. Build prev-session lookup maps ─────────────────────────────────────
    //
    // sessionKey produces a deterministic string for a session so we can
    // match incoming sessions against previous ones by (date, slotId, therapist).
    const sessionKey = (s) =>
      `${s.date}|${String(s.slotId || "")}|${String(
        typeof s.therapist === "object" && s.therapist?._id
          ? s.therapist._id
          : s.therapist || ""
      )}`;

    const prevSessions = Array.isArray(prevBooking.sessions)
      ? prevBooking.sessions.filter(
          (s) =>
            s &&
            typeof s.slotId === "string" &&
            s.slotId.trim().length > 0 &&
            typeof s.date === "string"
        )
      : [];

    // Map: sessionKey → existing sessionId (only entries that already have one)
    const prevSessionIdMap = {};
    prevSessions.forEach((sess) => {
      if (sess.sessionId) {
        prevSessionIdMap[sessionKey(sess)] = sess.sessionId;
      }
    });

    // ── 8. Sort incoming sessions by date (mirrors createBooking ordering) ────
    const sortedIncomingSessions = sessions
      .map((s, origIdx) => ({ ...s, __origIdx: origIdx }))
      .sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return a.__origIdx - b.__origIdx;
      });

    // ── 9. Identify sessions that need a brand-new globally-unique ID ─────────
    //
    // A session needs a new ID when:
    //   • It has no match in prevSessionIdMap  (it's a genuinely new session)
    //   • AND the incoming object itself carries no sessionId
    const indicesNeedingNewId = [];
    sortedIncomingSessions.forEach((s, sortedIdx) => {
      let therapistValue =
        s.therapist || s.therapistId || bodyTherapist || prevBooking.therapist;
      if (
        therapistValue &&
        typeof therapistValue === "object" &&
        therapistValue._id
      ) {
        therapistValue = therapistValue._id;
      }
      const key = sessionKey({
        date: s.date,
        slotId: s.slotId || s.id,
        therapist: therapistValue,
      });
      if (!prevSessionIdMap[key] && !s.sessionId) {
        indicesNeedingNewId.push(sortedIdx);
      }
    });

    // ── 10. Claim a contiguous Counter block for all new sessions (atomic) ────
    let counterStart = null;
    if (indicesNeedingNewId.length > 0) {
      const sessionCounterDoc = await Counter.findOneAndUpdate(
        { name: "session" },
        { $inc: { seq: indicesNeedingNewId.length } },
        { new: true, upsert: true }
        // Note: no `session` option here intentionally — the counter increment
        // should be permanent even if the booking transaction rolls back, to
        // avoid ever reusing an ID that was briefly visible to another process.
      );
      counterStart = sessionCounterDoc.seq - indicesNeedingNewId.length + 1;
    }

    // Map: sortedIndex → allocated counter value
    const newIdBySortedIndex = {};
    indicesNeedingNewId.forEach((sortedIdx, i) => {
      newIdBySortedIndex[sortedIdx] = counterStart + i;
    });

    // ── 11. Build updatedSessions with correct sessionIds ─────────────────────
    const updatedSessions = sortedIncomingSessions.map((s, sortedIdx) => {
      let therapistValue =
        s.therapist || s.therapistId || bodyTherapist || prevBooking.therapist;
      if (
        therapistValue &&
        typeof therapistValue === "object" &&
        therapistValue._id
      ) {
        therapistValue = therapistValue._id;
      }

      const therapistIdField = therapistIdMap[String(therapistValue)] || "";
      const therapyTypeIdValue = s.therapyTypeId || s.therapyType || therapyId;

      const key = sessionKey({
        date: s.date,
        slotId: s.slotId || s.id,
        therapist: therapistValue,
      });

      let sessionIdValue;
      if (prevSessionIdMap[key]) {
        // ✅ Existing session — preserve the same sessionId
        sessionIdValue = prevSessionIdMap[key];
      } else if (s.sessionId) {
        // Safety net: incoming object already carries one
        sessionIdValue = s.sessionId;
      } else {
        // 🆕 New session — use the globally unique Counter value
        sessionIdValue = `S${String(newIdBySortedIndex[sortedIdx]).padStart(6, "0")}`;
      }

      return {
        date: s.date,
        slotId: s.slotId || s.id,
        therapist: therapistValue,
        therapistId: therapistIdField,
        therapyTypeId: therapyTypeIdValue,
        sessionId: sessionIdValue,
        ...(s.time !== undefined && { time: s.time }),
        ...(s.isCheckedIn !== undefined && { isCheckedIn: s.isCheckedIn }),
      };
    });

    // ── 12. Compute availability delta (for optional booked-count adjustment) ──
    const nextSessions = updatedSessions.filter(
      (s) =>
        s &&
        typeof s.slotId === "string" &&
        s.slotId.trim().length > 0 &&
        typeof s.date === "string"
    );

    const prevKeys = new Set(prevSessions.map(sessionKey));
    const nextKeys = new Set(nextSessions.map(sessionKey));
    const sessionsToDecrement = prevSessions.filter((s) => !nextKeys.has(sessionKey(s)));
    const sessionsToIncrement = nextSessions.filter((s) => !prevKeys.has(sessionKey(s)));

    // Uncomment if you want to maintain booked counts in DailyAvailability:
    // if (sessionsToDecrement.length > 0) await this.adjustAvailabilityCounts(sessionsToDecrement, -1);
    // if (sessionsToIncrement.length > 0) await this.adjustAvailabilityCounts(sessionsToIncrement,  1);

    // ── 13. Build update payload ──────────────────────────────────────────────
    let discountInfo = undefined;
    if (coupon) {
      discountInfo = {
        coupon: coupon.id || coupon._id || coupon,
        time: new Date(),
      };
    }

    const updatePayload = {
      discountInfo,
      package: packageId,
      patient: patientId,
      sessions: updatedSessions,
      therapy: therapyId,
      payment,
      status,
      notes,
      channel,
      attendedBy,
      referral,
      extra,
      attendedByType,
      paymentDueDate,
      invoiceNumber,
      followupRequired,
      followupDate,
      remark,
    };
    // Strip undefined keys so Mongoose doesn't unset existing fields
    Object.keys(updatePayload).forEach(
      (k) => updatePayload[k] === undefined && delete updatePayload[k]
    );

    // ── 14. Persist the booking update ───────────────────────────────────────
    let booking = null;
    let bookingUpdated = false;
    let bookingUpdateError = null;

    try {
      booking = await Booking.findByIdAndUpdate(id, updatePayload, { new: true })
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: { path: "userId", model: "User" },
        })
        .populate({ path: "therapy", model: "TherapyType" })
        .populate({ path: "therapist", model: "TherapistProfile" })
        .populate({ path: "payment", model: "Payment" });

      if (!booking) {
        bookingUpdateError = {
          status: 404,
          response: { success: false, message: "Booking not found." },
        };
      } else {
        bookingUpdated = true;
      }
    } catch (err) {
      bookingUpdateError = {
        status: 500,
        response: {
          success: false,
          message: "Failed to update booking.",
          error: err.message,
        },
      };
    }

    if (!bookingUpdated || !booking) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(bookingUpdateError?.status || 500)
        .json(
          bookingUpdateError?.response || {
            success: false,
            message: "Failed to update booking.",
          }
        );
    }

    // ── 15. Audit log (mandatory — roll back if it fails) ────────────────────
    try {
      const auditTherapistIds = [
        ...new Set(
          updatedSessions
            .map((sess) => therapistIdMap[String(sess.therapist)] || "")
            .filter((x) => x)
        ),
      ];
      const auditTherapistNamesArr = auditTherapistIds.map((tid) => {
        const objectId = Object.keys(therapistIdMap).find(
          (k) => therapistIdMap[k] === tid
        );
        return therapistNameMap[objectId] || tid;
      });
      const auditTherapistText =
        auditTherapistNamesArr.length > 0
          ? auditTherapistNamesArr.join(", ")
          : (booking.therapist &&
              (booking.therapist.fullName ||
                booking.therapist.name ||
                (typeof booking.therapist === "string"
                  ? booking.therapist
                  : ""))) ||
            "--";

      await AuditLogService.addLog({
        action: "BOOKING_UPDATED",
        user: req.user?.id,
        role: "admin",
        resource: "Booking",
        resourceId: booking._id,
        details: {
          patientId,
          therapistId: auditTherapistText,
          appointmentId: booking.appointmentId,
          packageId,
          therapyId,
          channel,
          sessions: updatedSessions.length,
          invoiceNumber,
          remark,
          status,
          message: `Booking updated for patient ${patientId} with therapist ${auditTherapistText}, package ${packageId}, therapy ${therapyId}`,
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
    } catch (err) {
      console.error("[AUDIT LOG] Failed to record booking_updated log:", err);
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({
        success: false,
        message:
          "Failed to update booking. Audit log is mandatory; changes reverted.",
        error: err?.message || "Audit logging failed.",
      });
    }

    // ── 16. WhatsApp notification (non-blocking — never fails the request) ────
    if (booking && booking.patient && booking.patient.userId) {
      try {
        const destination = booking.patient.userId.phone || "";
        const userName =
          booking.patient.fullName || booking.patient.name || "";
        const patientName = userName;

        const therapistIdsInSessions = [
          ...new Set(
            booking.sessions
              .map((s) => {
                const key =
                  s.therapist &&
                  typeof s.therapist === "object" &&
                  s.therapist._id
                    ? s.therapist._id.toString()
                    : typeof s.therapist === "string"
                    ? s.therapist
                    : s.therapist?.toString();
                return therapistIdMap[key] || "";
              })
              .filter(Boolean)
          ),
        ];

        let therapistNames = therapistIdsInSessions
          .map((tid) => {
            const objectId = Object.keys(therapistIdMap).find(
              (k) => therapistIdMap[k] === tid
            );
            return therapistNameMap[objectId] || tid;
          })
          .filter(Boolean);
        therapistNames = [...new Set(therapistNames)];

        const therapistNameText =
          therapistNames.length > 0
            ? therapistNames.join(", ")
            : (booking.therapist &&
                (booking.therapist.fullName ||
                  booking.therapist.name ||
                  (typeof booking.therapist === "string"
                    ? booking.therapist
                    : ""))) ||
              "--";

        await WhatsappController.sendBookingEditSuccess({
          destination,
          userName,
          appointmentId: booking.appointmentId || booking._id?.toString(),
          patientName,
          therapistName: therapistNameText,
          totalSessions: Array.isArray(booking.sessions)
            ? booking.sessions.length
            : 0,
          status: "Updated",
        });
      } catch (waErr) {
        console.error("WhatsApp sending failed on booking update:", waErr);
      }
    }

    // ── 17. Commit ────────────────────────────────────────────────────────────
    await session.commitTransaction();
    session.endSession();

    return res.json({ success: true, booking });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[updateBooking] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update booking.",
      error: error.message,
    });
  }
}

  // Delete booking and return result
  // async deleteBooking(req, res) {
  //   try {
  //     const { id } = req.params;
  //     const booking = await Booking.findById(id);
  //     if (!booking) {
  //       return res.status(404).json({
  //         success: false,
  //         message: "Booking not found.",
  //       });
  //     }

  //     if (Array.isArray(booking.sessions)) {
  //       const validSessions = booking.sessions.filter(
  //         s => s && typeof s.slotId === "string" && s.slotId.trim().length > 0 && typeof s.date === "string"
  //       );
  //       if (validSessions.length > 0) {
  //         await this.adjustAvailabilityCounts(validSessions, -1);
  //       } else {
  //         console.warn("[deleteBooking] No valid sessions with slotId found for decrement!", booking.sessions);
  //       }
  //     }

  //     await Booking.findByIdAndDelete(id);

  //     res.json({
  //       success: true,
  //       message: "Booking deleted successfully.",
  //     });
  //   } catch (error) {
  //     console.error(error);
  //     res.status(500).json({
  //       success: false,
  //       message: "Failed to delete booking.",
  //       error: error.message,
  //     });
  //   }
  // }

  // Get all booking requests (admin) from BookingRequests schema/model, now including appointmentId population
  /**
   * Enhanced getAllBookingRequests
   * - Supports full-text search, flexible filtering on any field of BookingRequests and populated fields,
   *   and pagination & sorting via query params:
   *   ?search=foo&status=pending&patient=xyz&therapy=abc&page=1&pageSize=20&sortField=createdAt&sortOrder=desc
   */
  async getAllBookingRequests(req, res) {
    try {
      const {
        search = "",
        status = "",
        page = 1,
        pageSize = 15,
        sortField = "createdAt",
        sortOrder = "desc"
      } = req.query;

      let query = {};

      // Build direct search by requestId if present
      if (search && typeof search === "string" && search.trim().length > 0) {
        const s = search.trim();
        query = {
          ...query,
          $or: [
            { requestId: { $regex: s, $options: "i" } }
          ]
        };
      }

      // Status filter
      if (status && typeof status === "string" && status.trim().length > 0) {
        query = {
          ...query,
          status: status.trim()
        };
      }

      let sortObj = {};
      if (sortField) sortObj[sortField] = sortOrder === "desc" ? -1 : 1;
      const _page = parseInt(page, 10) || 1;
      const _pageSize = parseInt(pageSize, 10) || 15;

      // Count ONLY for the filtered DB query (correct for pagination controls)
      const total = await BookingRequests.countDocuments(query);

      // Always fetch filtered by query (may fetch more than needed on in-memory search though)
      let bookingRequests = await BookingRequests.find(query)
        .sort(sortObj)
        .populate([
          {
            path: "patient",
            select: "name patientId phoneNo userId mobile1 email",
            model: "PatientProfile",
            populate: { path: "userId", model: "User", select: "name email" },
          },
          { path: "therapy", select: "name", model: "TherapyType" },
          { path: "package", select: "name totalSessions sessionCount costPerSession totalCost", model: "Package" },
          {
            path: "appointmentId",
            select: "appointmentId Children therapy package sessions",
            model: "Booking"
          }
        ]);

      // If search is set, need to do in-memory filtering for populated fields
      if (search && typeof search === "string" && search.trim().length > 0) {
        const s = search.toLowerCase();

        bookingRequests = bookingRequests.filter((br) => {
          // requestId
          if (br.requestId && String(br.requestId).toLowerCase().includes(s)) return true;
          // Patient: name, patientId, phoneNo, mobile1, email
          if (
            br.Children &&
            (
              (br.patient.name && br.patient.name.toLowerCase().includes(s)) ||
              (br.patient.patientId && br.patient.patientId.toLowerCase().includes(s)) ||
              (br.patient.phoneNo && br.patient.phoneNo.toLowerCase().includes(s)) ||
              (br.patient.mobile1 && br.patient.mobile1.toLowerCase().includes(s)) ||
              (br.patient.email && br.patient.email.toLowerCase().includes(s))
            )
          ) return true;
          // Therapy: name
          if (br.therapy && br.therapy.name && br.therapy.name.toLowerCase().includes(s)) return true;
          // Package: name
          if (br.package && br.package.name && br.package.name.toLowerCase().includes(s)) return true;
          // appointmentId: id/appointmentId
          if (
            br.appointmentId &&
            (
              (br.appointmentId._id && br.appointmentId._id.toString().toLowerCase().includes(s)) ||
              (br.appointmentId.appointmentId && br.appointmentId.appointmentId.toLowerCase().includes(s))
            )
          ) return true;
          return false;
        });

        // In-memory pagination
        const offset = (_page - 1) * _pageSize;
        bookingRequests = bookingRequests.slice(offset, offset + _pageSize);
      } else {
        // Paginate from DB result if not searching (already filtered by status above)
        bookingRequests = bookingRequests.slice(0, _pageSize);
      }

      res.json({
        success: true,
        bookingRequests,
        total, // Only accurate for no in-memory search
        page: _page,
        pageSize: _pageSize,
        totalPages: Math.ceil(total / _pageSize),
      });
    } catch (error) {
      console.error("[getAllBookingRequests] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch booking requests.",
        error: error.message,
      });
    }
  }

  // Reject a booking request (admin action) + trigger WhatsApp notification
  async rejectBookingRequest(req, res) {
    let session;
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, message: "Booking request ID required." });
      }

      // Start a session for transaction safety (similar to approval logic)
      session = await BookingRequests.startSession();
      await session.startTransaction();

      // Find booking request with relevant populations for WhatsApp info
      // We'll want Children info, and maybe also appointmentId
      const bookingRequest = await BookingRequests.findById(id)
        .populate({
          path: "patient",
          model: "PatientProfile",
          select: "name email phoneNo mobile1 mobile2"
        })
        .populate({
          path: "appointmentId",
          model: "Booking", // or the correct appointment model
          select: "appointmentId scheduledAt time"
        })
        .session(session);
      if (!bookingRequest) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Booking request not found." });
      }

      if (bookingRequest.status === "rejected") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Booking request has already been processed as not approved." });
   
      }
      if (bookingRequest.status === "approved") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Booking request already approved. Cannot mark as not approved." });
   
      }

      const previousBookingRequest = bookingRequest.toObject();

      bookingRequest.status = "rejected";
      await bookingRequest.save({ session });

      // --- AUDIT LOG ---
      try {
        await AuditLogService.addLog(
          {
            action: "BOOKING_REQUEST_REJECTED",
            user: req.user?.id,
            role: "admin",
            resource: "BookingRequest",
            resourceId: bookingRequest._id,
            details: {
              previous: previousBookingRequest,
              updated: bookingRequest,
              rejectedBy: req.user?.id,
              appointmentId: bookingRequest.appointmentId || null,
              message: `Booking request not approved by admin ${req.user?.id}`
         
            },
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
          },
          session
        );
      } catch (logError) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          success: false,
          message: "Failed to mark booking request as not approved (audit log failure).",
     
          error: logError?.message || "Audit logging failed.",
        });
      }

      await session.commitTransaction();
      session.endSession();

      // --- Send WhatsApp notification ---
      try {
        // Use the WhatsApp controller
        // We want: destination, userName, bookingId, date, time
        // Fallback logic for destination/mobile

        // Try to get the patient's (user's) main WhatsAppable phone number
        let phone = (
          bookingRequest.patient?.mobile1 ||
          bookingRequest.patient?.phoneNo ||
          bookingRequest.patient?.mobile2 ||
          ""
        );
        // Sanitize phone (basic): remove non-numeric, make sure starts with country code if possible
        if (phone) phone = phone.replace(/[^0-9]/g, "");
        if (phone && !phone.startsWith('91') && phone.length === 10) phone = `91${phone}`;

        let bookingIdForMsg = bookingRequest.appointmentId?.appointmentId || bookingRequest.appointmentId?._id?.toString() || bookingRequest._id.toString();

        // Scheduled date+time: try to format in "YYYY-MM-DD" and "HH:mm"
        let scheduledAt = bookingRequest.appointmentId?.scheduledAt || bookingRequest.scheduledAt || bookingRequest.createdAt;
        let dateStr = "";
        let timeStr = "";
        if (scheduledAt) {
          const dt = new Date(scheduledAt);
          dateStr = dt.toISOString().slice(0, 10); // "YYYY-MM-DD"
        }
        timeStr = bookingRequest.appointmentId?.time
          || bookingRequest.time
          || ((scheduledAt && (new Date(scheduledAt)).toISOString().slice(11,16)) || "");

        await WhatsappController.sendBookingRequestRejected({
          destination: phone,
          userName: bookingRequest.patient?.name || "",
          bookingId: bookingRequest.requestId,
          date: dateStr,
          time: timeStr
        });
      } catch (waErr) {
        // Log but do not fail the main flow on WhatsApp error!
        console.error("[rejectBookingRequest] Failed to send WhatsApp notification:", waErr);
      }

      res.json({ success: true, message: "Booking request declined successfully." });
 
    } catch (error) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      console.error("[rejectBookingRequest] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to process booking request decline.",
   
        error: error.message,
      });
    }
  }

/**
 * [Admin] Get all session edit requests
 * - Lists all session edit requests (for parent edit requests of sessions)
 */
async getAllSessionEditRequests(req, res) {
  try {
    // Get query params for pagination, search, sorting, and status filter
    const {
      search = "",
      status = "",
      page = 1,
      pageSize = 15,
      sortField = "createdAt",
      sortOrder = "desc"
    } = req.query;

    let sortObj = {};
    if (sortField) sortObj[sortField] = sortOrder === "desc" ? -1 : 1;
    const _page = parseInt(page, 10) || 1;
    const _pageSize = parseInt(pageSize, 10) || 15;

    // Build query object to support status filtering
    let query = {};
    if (status && typeof status === "string" && status.trim().length > 0) {
      query.status = status.trim();
    }

    // Always fetch with populate for admin display
    let sessionEditRequests = await SessionEditRequest.find(query)
      .sort(sortObj)
      .populate({
        path: 'appointmentId',
        model: 'Booking',
        populate: [
          {
            path: 'patient',
            model: 'PatientProfile',
            select: 'patientId name email mobile1 mobile2'
          },
          {
            path: 'therapy',
            model: 'TherapyType',
            select: 'name'
          },
        ],
        select: 'Children therapy appointmentId sessions'
      })
      .lean();

    // Filter in-memory for search support across all relevant/populated fields
    let total = sessionEditRequests.length;
    if (search && typeof search === "string" && search.trim().length > 0) {
      const s = search.trim().toLowerCase();

      sessionEditRequests = sessionEditRequests.filter((er) => {
        // Direct fields
        if (
          (er._id && String(er._id).toLowerCase().includes(s)) ||
          (er.reason && String(er.reason).toLowerCase().includes(s)) ||
          (er.status && String(er.status).toLowerCase().includes(s))
        ) {
          return true;
        }
        // Populated appointmentId fields
        const appt = er.appointmentId;
        if (appt) {
          // appointmentId direct id
          if ((appt._id && String(appt._id).toLowerCase().includes(s)) ||
              (appt.appointmentId && String(appt.appointmentId).toLowerCase().includes(s))
          ) {
            return true;
          }
          // Children populated fields
          if (appt.patient) {
            if ((appt.patient.name && appt.patient.name.toLowerCase().includes(s)) ||
                (appt.patient.patientId && String(appt.patient.patientId).toLowerCase().includes(s)) ||
                (appt.patient.email && String(appt.patient.email).toLowerCase().includes(s)) ||
                (appt.patient.mobile1 && String(appt.patient.mobile1).toLowerCase().includes(s)) ||
                (appt.patient.mobile2 && String(appt.patient.mobile2).toLowerCase().includes(s))
            ) {
              return true;
            }
          }
          // therapy name
          if (appt.therapy && appt.therapy.name && appt.therapy.name.toLowerCase().includes(s)) {
            return true;
          }
        }
        // Extendable for other related fields if needed
        return false;
      });

      total = sessionEditRequests.length;

      // In-memory pagination if searching
      const offset = (_page - 1) * _pageSize;
      sessionEditRequests = sessionEditRequests.slice(offset, offset + _pageSize);
    } else {
      // Standard pagination if not searching
      total = sessionEditRequests.length;
      const offset = (_page - 1) * _pageSize;
      sessionEditRequests = sessionEditRequests.slice(offset, offset + _pageSize);
    }

    res.json({
      success: true,
      editRequests: sessionEditRequests,
      total,
      page: _page,
      pageSize: _pageSize,
      totalPages: Math.ceil(total / _pageSize),
    });
  } catch (error) {
    console.error("[getAllSessionEditRequests] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch session edit requests.",
      error: error.message,
    });
  }
}

// Approve a session edit request (Admin)
async approveSessionEditRequest(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Session edit request ID required." });
    }

    // Populate appointment and Children for WhatsApp
    const editReq = await SessionEditRequest.findById(id)
      .populate({
        path: "appointmentId",
        model: "Booking",
        populate: {
          path: "patient",
          model: "PatientProfile",
          select: "name mobile1 email"
        }
      });
    if (!editReq) {
      return res.status(404).json({ success: false, message: "Session edit request not found." });
    }
    if (editReq.status === "approved") {
      return res.status(400).json({ success: false, message: "Session edit request already approved." });
    }

    // Apply the session edits to the Booking
    const booking = await Booking.findById(editReq.appointmentId._id || editReq.appointmentId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found for session edit request." });
    }

    // For each session edit, update the session in the booking
    let appliedCount = 0;
    for (const sessionEdit of editReq.sessions) {
      // The booking has sessions as an array, each containing _id or id
      const sessionToUpdate = booking.sessions.id(sessionEdit.sessionId) || 
        booking.sessions.find(s => String(s._id || s.id) === String(sessionEdit.sessionId));
      if (sessionToUpdate) {
        // Update session date and slotId
        sessionToUpdate.date = sessionEdit.newDate;
        sessionToUpdate.slotId = sessionEdit.newSlotId;
        appliedCount++;
      }
    }

    await booking.save();

    // Set the status to approved
    editReq.status = "approved";
    await editReq.save();

    // --- WhatsApp Notification ---
    try {
      // Get Children info for WhatsApp
      let patientProfile = editReq.appointmentId.patient;
      let patientName = patientProfile && patientProfile.name ? patientProfile.name : "User";
      let patientMobile = patientProfile && patientProfile.mobile1 
        ? String(patientProfile.mobile1)
        : (patientProfile && patientProfile.phoneNo ? String(patientProfile.phoneNo) : "");

      // fallback for mobile, can be customized
      if (patientMobile && !patientMobile.startsWith("+")) {
        patientMobile = "+91" + patientMobile.replace(/[^0-9]/g, "");
      }
      // Build WhatsApp payload
      await WhatsappController.sendSessionEditRequestStatusUpdate({
        destination: patientMobile,
        userName: patientName,
        status: "approved",
        appointmentId: editReq.appointmentId.appointmentId || editReq.appointmentId._id?.toString() || "",
        extraMessage: `Your request to change session schedule has been approved. Updated sessions: ${appliedCount}.`
      });
    } catch (waErr) {
      console.error("[WhatsApp][approveSessionEditRequest] error sending notification:", waErr);
      // Continue, but log
    }

    return res.json({
      success: true,
      message: `Session edit request approved and ${appliedCount} sessions updated.`,
      editRequest: editReq
    });
  } catch (error) {
    console.error("[approveSessionEditRequest] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to approve session edit request.", error: error.message });
  }
}

// Reject a session edit request (Admin)
async rejectSessionEditRequest(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Session edit request ID required." });
    }
    // Populate appointment and Children for WhatsApp
    const editReq = await SessionEditRequest.findById(id)
      .populate({
        path: "appointmentId",
        model: "Booking",
        populate: {
          path: "patient",
          model: "PatientProfile",
          select: "name mobile1 email"
        }
      });
    if (!editReq) {
      return res.status(404).json({ success: false, message: "Session edit request not found." });
    }
    if (editReq.status === "rejected") {
      return res.status(400).json({ success: false, message: "Session edit request already rejected." });
    }

    editReq.status = "rejected";
    await editReq.save();

    // --- WhatsApp Notification ---
    try {
      // Get Children info for WhatsApp
      let patientProfile = editReq.appointmentId.patient;
      let patientName = patientProfile && patientProfile.name ? patientProfile.name : "User";
      let patientMobile = patientProfile && patientProfile.mobile1 
        ? String(patientProfile.mobile1)
        : (patientProfile && patientProfile.phoneNo ? String(patientProfile.phoneNo) : "");

      // fallback for mobile, can be customized
      if (patientMobile && !patientMobile.startsWith("+")) {
        patientMobile = "+91" + patientMobile.replace(/[^0-9]/g, "");
      }
      // Build WhatsApp payload
      await WhatsappController.sendSessionEditRequestStatusUpdate({
        destination: patientMobile,
        userName: patientName,
        status: "rejected",
        appointmentId: editReq.appointmentId.appointmentId || editReq.appointmentId._id?.toString() || "",
        extraMessage: `Your request to change the session schedule has been rejected. Please contact us for details.`
      });
    } catch (waErr) {
      console.error("[WhatsApp][rejectSessionEditRequest] error sending notification:", waErr);
      // Continue, but log
    }

    return res.json({
      success: true,
      message: `Session edit request rejected.`,
      editRequest: editReq
    });
  } catch (error) {
    console.error("[rejectSessionEditRequest] Error:", error);
    return res.status(500).json({ success: false, message: "Failed to reject session edit request.", error: error.message });
  }
}


/**
 * Mark payment collection details for a booking.
 * Expects: { payment } in req.body
 * Params: booking id in req.params.id
 * Sends WhatsApp message (see @whatsapp.js sendPaymentCollectedSuccessfully) 
 */
async collectPayment(req, res) {
  const session = await Booking.startSession();
  session.startTransaction();
  let auditLogFailed = false;
  let auditLogError = null;
  try {
    const { id } = req.params;
    const {
      paymentType = "full",
      partialAmount,
      discountApplied = false // Discount applied flag from frontend
    } = req.body;

    if (!id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Booking ID required."
      });
    }

    // Populate patient, discountInfo for WhatsApp and discount calculation
    const booking = await Booking.findById(id)
      .populate([
        {
          path: "patient",
          model: "PatientProfile",
          select: "name mobile1 patientId userId",
          populate: {
            path: "userId",
            model: "User",
            select: "phone name"
          }
        },
        {
          path: "discountInfo.coupon",
          model: "Discount"
        }
      ])
      .session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Booking not found."
      });
    }

    const paymentId = booking.payment;
    if (!paymentId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "This booking has no associated payment record."
      });
    }

    const payment = await Payment.findOne({ _id: paymentId }).session(session);

    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Associated payment not found."
      });
    }

    // --- Discount Logic ---
    let originalAmount = payment.amount;
    let amountToCollect = originalAmount;
    let discountAmount = 0;
    let appliedDiscountPercent = 0;

    // If discount applied, get actual discount percent from booking's coupon if available
    if (discountApplied && booking.discountInfo && booking.discountInfo.coupon && typeof booking.discountInfo.coupon.discount === "number") {
      appliedDiscountPercent = booking.discountInfo.coupon.discount;
      if (appliedDiscountPercent > 0) {
        discountAmount = Math.round((originalAmount * appliedDiscountPercent) / 100);
        amountToCollect = originalAmount - discountAmount;
      }
    }

    let financeRecord = null;
    let auditLogMessage = "";
    let paymentStatusChanged = false;
    let paymentStatusForWhatsapp = ""; // to determine sent status

    // -------- PARTIAL PAYMENT --------
    if (paymentType === "partial") {
      const { amountPaid = 0 } = payment;
      // Remaining is always based on original amount (before discount)
      let actualAmountToCompare = amountToCollect;
      let remaining = actualAmountToCompare - amountPaid;

      // Validate partial amount (must not exceed remaining)
      if (
        typeof partialAmount !== "number" ||
        partialAmount <= 0 ||
        partialAmount > remaining
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Partial amount to pay must be a number > 0 and <= remaining amount (${remaining}).`
        });
      }

      payment.amountPaid = (payment.amountPaid || 0) + partialAmount;

      // Handle payment status vs discounted collection
      if (payment.amountPaid < amountToCollect) {
        payment.status = "partiallypaid";
        payment.paymentTime = new Date();
        booking.paymentStatus = "partiallypaid";
        auditLogMessage = `[collectPayment] Marking as partiallypaid. Partial payment of Rs.${partialAmount} received for Booking #${booking.appointmentId}. Remaining: Rs.${amountToCollect - payment.amountPaid}. DiscountApplied: ${discountApplied}${discountApplied ? ` (${appliedDiscountPercent}%)` : ""}`;
        paymentStatusForWhatsapp = "Partial";
        paymentStatusChanged = true;
      } else {
        payment.status = "paid";
        payment.paymentTime = new Date();
        // Make sure we don't overpay (limit to discounted total)
        payment.amountPaid = amountToCollect;
        booking.paymentStatus = "paid";
        auditLogMessage = `[collectPayment] Marking as fully paid after partial payment. Final partial payment of Rs.${partialAmount} received. Booking #${booking.appointmentId} fully paid. DiscountApplied: ${discountApplied}${discountApplied ? ` (${appliedDiscountPercent}%)` : ""}`;
        paymentStatusForWhatsapp = "Full";
        paymentStatusChanged = true;
      }

      // Persist payment and booking
      await payment.save({ session });
      await booking.save({ session });

      financeRecord = await Finances.create([
        {
          date: payment.paymentTime || new Date(),
          description: `Partial Payment for Booking #${booking.appointmentId}${discountApplied ? " (DISCOUNT APPLIED)" : ""}`,
          type: "income",
          amount: partialAmount,
          creditDebitStatus: "credited",
        }
      ], { session });

    } else {
      // -------- FULL PAYMENT --------
      payment.status = "paid";
      payment.paymentTime = new Date();
      payment.amountPaid = amountToCollect; // Use discounted amount if discount applied
      await payment.save({ session });

      booking.paymentStatus = "paid";
      await booking.save({ session });

      auditLogMessage = `[collectPayment] Full payment of Rs.${amountToCollect} received for Booking #${booking.appointmentId}.${discountApplied ? ` Discount of Rs.${discountAmount} (${appliedDiscountPercent}%) applied.` : ""}`;
      paymentStatusForWhatsapp = "Full";
      paymentStatusChanged = true;

      const financeExists = await Finances.findOne({
        description: { $regex: `Payment for Booking #${booking.appointmentId}`, $options: "i" }
      }).session(session);

      if (!financeExists) {
        financeRecord = await Finances.create([{
          date: payment.paymentTime || new Date(),
          description: `Payment for Booking #${booking.appointmentId}${discountApplied ? " (DISCOUNT APPLIED)" : ""}`,
          type: "income",
          amount: amountToCollect,
          creditDebitStatus: "credited",
        }], { session });
      } else {
        financeRecord = financeExists;
      }
    }

    // Add audit log for payment collection if payment status changed
    if (paymentStatusChanged) {
      const auditLogPayload = {
        action: "BOOKING_PAYMENT_UPDATE",
        user: req.user?.id,
        role: "admin",
        resource: "Booking",
        resourceId: booking._id,
        details: {
          patientId: booking.patient?._id || booking.patient,
          therapistId: booking.therapist?._id || booking.therapist,
          appointmentId: booking.appointmentId,
          packageId: booking.package?._id || booking.package,
          therapyId: booking.therapy?._id || booking.therapy,
          channel: booking.channel,
          sessions: Array.isArray(booking.sessions) ? booking.sessions.length : 0,
          invoiceNumber: booking.invoiceNumber,
          remark: booking.remark,
          status: booking.paymentStatus,
          message: auditLogMessage,
          discountApplied,
          discountPercent: appliedDiscountPercent,
          totalAmount: originalAmount,
          discountAmount,
          netAmount: amountToCollect
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      };
      try {
        await AuditLogService.addLog(auditLogPayload);
      } catch (err) {
        auditLogFailed = true;
        auditLogError = err;
        console.error("[collectPayment] Error creating audit log:", err);
      }
    }

    // If audit log creation failed with an error
    if (paymentStatusChanged && auditLogFailed) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({
        success: false,
        message: "Failed to record payment due to audit log failure. No changes made.",
        error: auditLogError ? auditLogError.message : "Unknown log error"
      });
    }

    await session.commitTransaction();
    session.endSession();

    // Send WhatsApp message if payment recorded and Children has mobile number
    if (paymentStatusChanged) {
      // Only attempt if Children exist
      let patientProfile = booking.patient;
      let userPhone =
        (patientProfile && patientProfile.mobile1) ||
        (patientProfile &&
          patientProfile.userId &&
          patientProfile.userId.phone) ||
        null;

      let userName =
        (patientProfile && patientProfile.name) ||
        (patientProfile &&
          patientProfile.userId &&
          patientProfile.userId.name) ||
        "";

      // Only send if we have a destination phone (prefer mobile1, fallback userId.phone)
      if (userPhone) {
        const { appointmentId } = booking;
        let amountForWhatsapp = (paymentType === "partial")
          ? (payment.amountPaid < amountToCollect ? partialAmount : payment.amountPaid)
          : amountToCollect;

        let paymentStatusTxt =
          payment.status === "paid"
            ? "Full"
            : payment.status === "partiallypaid"
              ? "Partial"
              : payment.status;
        try {
          await WhatsappController.sendPaymentCollectedSuccessfully({
            destination: userPhone,
            userName: userName,
            appointmentId: appointmentId,
            amount: String(amountForWhatsapp),
            paymentStatus: paymentStatusTxt
          });
        } catch (err) {
          console.error(
            "[collectPayment] Error sending WhatsApp payment confirmation:",
            err
          );
        }
      }
    }

    res.json({
      success: true,
      message:
        paymentType === "partial"
          ? payment.status === "paid"
            ? "Partial payment received. Booking now fully paid."
            : "Partial payment received. Remaining balance is due."
          : "Payment recorded successfully.",
      booking,
      payment,
      finance: Array.isArray(financeRecord)
        ? financeRecord[0]
        : financeRecord,
      discount: discountApplied
        ? {
            percent: appliedDiscountPercent,
            discountAmount,
            netAmount: amountToCollect
          }
        : undefined
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[collectPayment] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to record payment.",
      error: error.message
    });
  }
}

// Check-in a Children for a booking
async checkIn(req, res) {
  const session = await Booking.startSession();
  session.startTransaction();
  let auditLogFailed = false;
  let auditLogError = null;
  try {
    const { bookingId, sessionId } = req.body;

    if (!bookingId || !sessionId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "bookingId and sessionId are required."
      });
    }

    // Find the booking (attach the session/tx)
    const booking = await Booking.findById(bookingId)
      .populate([
        { path: "patient", model: "PatientProfile", select: "userId name mobile1", populate: { path: "userId", model: "User", select: "name phone email" } },
        { path: "therapist", model: "TherapistProfile", select: "userId therapistId phoneNo", populate: { path: "userId", model: "User", select: "name phone email" } },
        { path: "sessions.therapist", model: "TherapistProfile", select: "userId therapistId phoneNo", populate: { path: "userId", model: "User", select: "name phone email" } }
      ])
      .session(session);
 
    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Booking not found."
      });
    }

    // Find session index in the booking sessions array
    const sessionIndex = booking.sessions.findIndex(
      (sess) => String(sess._id) === String(sessionId)
    );

    if (sessionIndex === -1) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Session not found in this booking."
      });
    }

    // If already checked in for this session, return idempotent response
    if (booking.sessions[sessionIndex].isCheckedIn) {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({
        success: true,
        message: "Children already checked in for this session.",
        booking
      });
    }

    const date = new Date();
    // Mark this session as checked in and set checkInTime
    booking.sessions[sessionIndex].isCheckedIn = true;
    booking.sessions[sessionIndex].checkInTime = date;
    await booking.save({ session });

    // --- AUDIT LOG ---
    try {
      await AuditLogService.addLog({
        action: "PATIENT_CHECKIN",
        user: req.user.id,
        role: "admin",
        resource: "Booking",
        resourceId: booking._id,
        details: {
          bookingId: booking._id,
          sessionId: sessionId,
          checkedInBy: req.user && req.user._id ? req.user._id : null,
          checkInAt: date,
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] || null,
      });
    } catch (err) {
      auditLogFailed = true;
      auditLogError = err;
      console.error("[checkIn] Error creating audit log:", err);
    }

    if (auditLogFailed) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({
        success: false,
        message: "Check-in was NOT logged in the audit system. No changes made.",
        error: auditLogError ? auditLogError.message : "Unknown log error"
      });
    }

    await session.commitTransaction();
    session.endSession();

    // --- SEND WHATSAPP CHECK-IN NOTIFICATION ---
    // Make sure to send correct data to whatsapp (Children name, phone number, appointmentId, sessionId, checkIn time, therapist, etc.)
    try {
      // Import WhatsappController only when needed to avoid cycles, or move to top if safe
      // import WhatsappController from "../Whatsapp/whatsapp.js";
      const WhatsappController = (await import("../Whatsapp/whatsapp.js")).default;

      // Children profile
      let patientName = "";
      let patientPhone = "";
      if (booking.patient) {
       
          patientName = booking.patient.name || "";
          patientPhone = booking.patient.mobile1 || "";

      }
      // Therapist profile
      let therapistName = "";
      let therapistPhone = "";
      const sessionTherapist = booking.sessions[sessionIndex]?.therapist;
      if (sessionTherapist) {
        if (sessionTherapist.userId) {
          therapistName = sessionTherapist.userId.fullName || "";
          therapistPhone = sessionTherapist.userId.phoneNo || "";
        } else {
          therapistName = sessionTherapist.fullName || "";
          therapistPhone = sessionTherapist.phoneNo || "";
        }
      } else if (booking.therapist) {
        if (booking.therapist.userId) {
          therapistName = booking.therapist.userId.fullName || "";
          therapistPhone = booking.therapist.userId.phoneNo || "";
        } else {
          therapistName = booking.therapist.fullName || "";
          therapistPhone = booking.therapist.phoneNo || "";
        }
      }

      // SessionId for user (if stored), fall back to Mongo id
      const sessionIdToSend =
        booking.sessions[sessionIndex].sessionId ||
        String(booking.sessions[sessionIndex]._id);

      // Send WhatsApp message - customize template params as needed for your template
      await WhatsappController.sendSessionCompleted({
        destination: patientPhone,
        userName: patientName,
        appointmentId: booking.appointmentId || String(booking._id),
        sessionId: sessionIdToSend,
        completedAt: date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
      });
    } catch (wserr) {
      // WhatsApp send error should be logged but should not block check-in success
      console.error("[checkIn] Error sending WhatsApp session completed message:", wserr);
    }

    res.json({
      success: true,
      message: "Children checked in successfully for this session.",
      booking
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[checkIn] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check in patient.",
      error: error.message
    });
  }
}

// Check-in a Children for a booking
// async checkIn(req, res) {
//   const session = await Booking.startSession();
//   session.startTransaction();
//   let auditLogFailed = false;
//   let auditLogError = null;
//   try {
//     const { bookingId, sessionId } = req.body;

//     console.log(bookingId, sessionId );

//     if (!bookingId || !sessionId) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "bookingId and sessionId are required."
//       });
//     }

//     // Find the booking (attach the session/tx)
//     const booking = await Booking.findById(bookingId).session(session);
//     if (!booking) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: "Booking not found."
//       });
//     }

//     // Find session index in the booking sessions array
//     const sessionIndex = booking.sessions.findIndex(
//       (sess) => String(sess._id) === String(sessionId)
//     );

//     if (sessionIndex === -1) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: "Session not found in this booking."
//       });
//     }

//     // If already checked in for this session, return idempotent response
//     if (booking.sessions[sessionIndex].isCheckedIn) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(200).json({
//         success: true,
//         message: "Children already checked in for this session.",
//         booking
//       });
//     }

//     // Mark this session as checked in
//     booking.sessions[sessionIndex].isCheckedIn = true;
//     // booking.sessions[sessionIndex].checkInTime = new Date();
//     await booking.save({ session});

//     // --- AUDIT LOG ---
//     // try {
//     //   await AuditLogService.addLog({
//     //     action: "PATIENT_CHECKIN",
//     //     user: req.user.id ,
//     //     role:"admin",
//     //     resource: "Booking",
//     //     resourceId: booking._id,
//     //     details: {
//     //       bookingId: booking._id,
//     //       sessionId: sessionId,
//     //       checkedInBy: req.user && req.user._id ? req.user._id : null,
//     //       checkInAt: new Date(),
//     //     },
//     //     ipAddress: req.ip,
//     //     userAgent: req.headers["user-agent"] || null,
//     //   });
//     // } catch (err) {
//     //   auditLogFailed = true;
//     //   auditLogError = err;
//     //   console.error("[checkIn] Error creating audit log:", err);
//     // }

//     // if (auditLogFailed) {
//     //   await session.abortTransaction();
//     //   session.endSession();
//     //   return res.status(500).json({
//     //     success: false,
//     //     message: "Check-in was NOT logged in the audit system. No changes made.",
//     //     error: auditLogError ? auditLogError.message : "Unknown log error"
//     //   });
//     // }

//     await session.commitTransaction();
//     session.endSession();

//     res.json({
//       success: true,
//       message: "Children checked in successfully for this session.",
//       booking
//     });
//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();
//     console.error("[checkIn] Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to check in patient.",
//       error: error.message
//     });
//   }
// }

async getReceptionDeskDetails(req, res) {
  try {
    // Get today's date as YYYY-MM-DD format
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;

    // Get Today's Bookings: those with at least one session whose date == today
    // Populate discount details as well
    const rawBookings = await Booking.find({
      "sessions.date": todayStr
    })
      .populate({ path: "patient", model: "PatientProfile", select: "name patientId mobile gender" })
      .populate({ path: "therapy", model: "TherapyType" })
      .populate({
        path: "sessions.therapist",
        model: "TherapistProfile",
        select: "userId therapistId",
        populate: {
          path: "userId",
          model: "User",
          select: "name"
        }
      })
      .populate({
        path: "discountInfo.coupon",
        model: "Discount",
        select: "discountEnabled discount couponCode validityDays createdAt"
      })
      .lean();

    // For each session today, create a booking object where sessions contains only that session.
    const todaysBookings = [];
    rawBookings.forEach(booking => {
      if (Array.isArray(booking.sessions)) {
        booking.sessions.forEach(session => {
          if (session.date === todayStr) {
            const bookingCopy = { ...booking };
            delete bookingCopy.sessions;
            bookingCopy.session = session;
            todaysBookings.push(bookingCopy);
          }
        });
      }
    });

    // Get Pending Payment Bookings: those with no payment or incomplete payment
    // Populate discount details as well
    const pendingPaymentBookings = await Booking.find({})
      .populate({ path: "patient", model: "PatientProfile", select: "name patientId mobile gender" })
      .populate({ path: "therapist", model: "TherapistProfile", select: "name" })
      .populate({ path: "package", model: "Package" })
      .populate({ path: "therapy", model: "TherapyType" })
      .populate({ path: "payment", model: "Payment" })  // Populate payment to check its status
      .populate({
        path: "discountInfo.coupon",
        model: "Discount",
        select: "discountEnabled discount couponCode validityDays createdAt"
      })
      .lean();

    // Filter bookings: payment is missing OR payment.status !== "completed"
    const filteredPendingPaymentBookings = pendingPaymentBookings.filter(b => {
      // No payment linked at all
      if (!b.payment) return true;
      // Payment exists but status not completed
      if (b.payment && b.payment.status && b.payment.status !== "paid") return true;
      // Defensive: if payment exists but has no status field, consider as pending
      if (b.payment && !b.payment.status) return true;
      return false;
    });

    res.json({
      success: true,
      today: todayStr,
      todaysBookings,
      pendingPaymentBookings: filteredPendingPaymentBookings,
    });
  } catch (error) {
    console.error("[getReceptionDeskDetails] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get reception desk details",
      error: error.message
    });
  }
}

/**
 * Returns all sessions (across all bookings), optionally filtered by today's date.
 * Output: Flattened array of sessions, each with booking info, for the frontend "All Sessions" view.
 * Query params supported: date (YYYY-MM-DD), therapistId, patientId, therapyTypeId, isCheckedIn
 */
/**
 * Returns all sessions (across all bookings), optionally filtered by today's date, therapist, patient, therapy type, and checked-in status.
 * Supports: ?date=YYYY-MM-DD&therapistId=xxx&patientId=xxx&therapyTypeId=xxx&isCheckedIn=false/true
 * If isCheckedIn not provided, returns all sessions.
 * If isCheckedIn=false, returns only sessions that are NOT checked in.
 */
async getAllSessions(req, res) {
  try {
    const {
      date,             // YYYY-MM-DD (string)
      therapistId,      // therapist._id as string
      patientId,        // patient._id as string
      therapyTypeId,    // therapyTypeId as string
      isCheckedIn,      // 'true', 'false', or undefined
    } = req.query;

    // We need: 
    // - Booking populated with Children ("PatientProfile"), package, therapy ("TherapyType"), therapist ("TherapistProfile")
    // - Each session in booking.sessions with therapist, therapyTypeId populated
    // - Flatten to array: [{ session, booking }]

    // Build booking query level filters
    const bookingQuery = {};
    if (patientId) bookingQuery.Children = patientId;
    if (therapistId) bookingQuery.therapist = therapistId; // legacy: top-level therapist

    // Fetch bookings
    const bookings = await Booking.find(bookingQuery)
      .populate({
        path: "patient",
        model: "PatientProfile",
        select: "_id userId name patientId gender mobile"
      })
      .populate({
        path: "therapist",
        model: "TherapistProfile",
        select: "_id name therapistId userId"
      })
      .populate({
        path: "therapy",
        model: "TherapyType",
        select: "_id name"
      })
      .populate({
        path: "sessions.therapist",
        model: "TherapistProfile",
        select: "_id name therapistId userId",
        populate: {
          path: "userId",
          select: "name"
        }
      })
      .populate({
        path: "sessions.therapyTypeId",
        model: "TherapyType",
        select: "_id name"
      })
      .lean();

    // Flatten all sessions, annotate with booking info
    let sessions = [];
    for(const booking of bookings) {
      if (Array.isArray(booking.sessions)) {
        for(const session of booking.sessions) {
          // Apply session filters
          if (date && session.date !== date) continue;
          if (therapistId && session.therapist && session.therapist._id?.toString() !== therapistId) continue;
          if (therapyTypeId && session.therapyTypeId && session.therapyTypeId._id?.toString() !== therapyTypeId) continue;
          if (typeof isCheckedIn !== "undefined") {
            if (isCheckedIn === "false" && session.isCheckedIn === true) continue;
            if (isCheckedIn === "true" && session.isCheckedIn !== true) continue;
          }

          const therapyTypeName = session.therapyTypeId;
          // Compose item
          sessions.push({
            bookingId: booking._id,
            appointmentId: booking.appointmentId,
            package: booking.package,
            patient: booking.patient,
            therapist: booking.therapist,
            therapy: therapyTypeName,
            session: session,
            // You can add more fields here as necessary for frontend
          });
        }
      }
    }

    // If isCheckedIn param not provided, return all; if "false", only unchecked; if "true", only checked-in
    // Return currentDate for reference if date is provided
    return res.json({
      success: true,
      date: date || null,
      sessions: sessions
    });
  } catch (error) {
    console.error("[getAllSessions] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get sessions",
      error: error.message
    });
  }
}

// getOverview - Admin dashboard summary endpoint

// Assumes necessary mongoose models: User, TherapistProfile, PatientProfile, Booking, BookingRequest, SessionEditRequest, Task, etc.
// Imports are to be placed at top-level, but omitted here as per instructions.



  // Fetch all bookings with populated therapist and therapyType, with support for search/filter on patient, therapist, therapyType, date, and session status
  async getFullCalendar(req, res) {
    try {
      // Parse possible search/filter parameters
      const {
        search = "",
        therapistId,
        therapyTypeId,
        sessionStatus,
        date,
        patientId
      } = req.query;

      // Filtering bookings via patients or sessions (some must be in-memory after population)
      const bookingQuery = {};

      // If filtering by patientId (from PatientProfile), add a direct filter
      if (patientId) {
        bookingQuery.Children = patientId;
      }

      // Fetch all relevant bookings with population
      const bookings = await Booking.find(bookingQuery)
        .populate({
          path: "patient",
          model: "PatientProfile",
          select: "_id userId name patientId",
        })
        .populate({
          path: "sessions.therapist",
          model: "TherapistProfile",
          select: "_id userId therapistId",
          populate: {
            path: "userId",
            model: "User",
            select: "name"
          }
        })
        .populate({
          path: "sessions.therapyTypeId",
          model: "TherapyType",
          select: "_id name"
        })
        .lean();

      // Fetch all therapy types (for filter options on frontend)
      const allTherapyTypes = await (typeof TherapyType.find === "function"
        ? TherapyType.find({}, "_id name").lean()
        : []);

      let allSessions = [];

      bookings.forEach(booking => {
        if (Array.isArray(booking.sessions)) {
          booking.sessions.forEach(session => {
            // --- Filter logic; apply per session ---
            // 1. filter by therapistId (match session.therapist._id or therapistId)
            if (
              therapistId &&
              (!session.therapist ||
                (
                  (typeof session.therapist === "object" && 
                    ((session.therapist.therapistId || session.therapist._id?.toString()) !== therapistId))
                )
              )
            ) {
              return; // Skip session if therapist does not match
            }
            // 2. filter by therapyTypeId (session.therapyTypeId._id)
            if (
              therapyTypeId &&
              (!session.therapyTypeId ||
                (session.therapyTypeId._id?.toString() !== therapyTypeId))
            ) {
              return;
            }
            // 3. filter by session.status
            if (
              sessionStatus &&
              session.status &&
              String(session.status).toLowerCase() !== String(sessionStatus).toLowerCase()
            ) {
              return;
            }
            // 4. filter by date (session.sessionDate usually stores date as ISO string or y-m-d)
            if (date) {
              let sessionDateVal = session.sessionDate;
              let targetDate = new Date(date).toISOString().slice(0,10);
              // Try extracting date from sessionDate (assume ISO string, or Date object)
              if (!sessionDateVal) return;
              let sD = sessionDateVal instanceof Date
                ? sessionDateVal.toISOString().slice(0,10)
                : (typeof sessionDateVal === "string" && sessionDateVal.length >= 10)
                  ? sessionDateVal.slice(0,10)
                  : undefined;
              if (!sD || sD !== targetDate) return;
            }
            // 5. search: match in Children name, therapist name, therapyType name
            if (search && search.trim().length > 0) {
              const q = search.trim().toLowerCase();

              const patientName = (booking.Children && booking.patient.name) ? booking.patient.name.toLowerCase() : "";
              const therapistName = (session.therapist && session.therapist.userId && session.therapist.userId.name) ? session.therapist.userId.name.toLowerCase() : "";
              const therapyTypeName = (session.therapyTypeId && session.therapyTypeId.name) ? session.therapyTypeId.name.toLowerCase() : "";

              if (
                !(
                  patientName.includes(q) ||
                  therapistName.includes(q) ||
                  therapyTypeName.includes(q)
                )
              ) {
                return;
              }
            }

            // Prepare output fields
            let patientInfo = {
              patientId: booking.Children && booking.patient.patientId ? booking.patient.patientId : undefined,
              name: (booking.Children && booking.patient.name)
                ? booking.patient.name
                : undefined,
            };

            let therapyTypePopulated = null;
            if (session.therapyTypeId && session.therapyTypeId._id && session.therapyTypeId.name) {
              therapyTypePopulated = {
                _id: session.therapyTypeId._id,
                name: session.therapyTypeId.name,
              };
            } else if (booking.therapy && booking.therapy._id && booking.therapy.name) {
              therapyTypePopulated = {
                _id: booking.therapy._id,
                name: booking.therapy.name,
              };
            }

            let therapistPopulated = null;
            if (session.therapist && typeof session.therapist === "object" && session.therapist._id) {
              therapistPopulated = {
                therapistId: session.therapist._id,
                name: session.therapist.userId && session.therapist.userId.name ? session.therapist.userId.name : undefined,
              };
            }

            allSessions.push({
              appointmentId: booking.appointmentId || booking._id,
              patient: patientInfo,
              therapyType: therapyTypePopulated,
              session: session,
              therapist: therapistPopulated,
            });
          });
        }
      });

      res.json({ 
        success: true, 
        data: allSessions,
        therapyTypes: allTherapyTypes || [],
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }






}

export default BookingAdminController;

