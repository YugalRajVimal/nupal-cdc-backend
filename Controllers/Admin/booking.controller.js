
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

import Wallet from "../../Schema/wallet.schema.js";
import {
  getOrCreateWallet,
  creditWallet,
  debitWallet,
  findCheckinDebitTransaction,
  reverseCheckinDebit,
  getPerSessionRate,
} from "../../Services/wallet.services.js";


  // Create a new booking with updated booking schema (1-47)
  // Slot/config for session time resolution
  const SESSION_TIME_OPTIONS = [
    { id: '1000-1045', label: '10:00 to 10:45', limited: false },
    { id: '1045-1130', label: '10:45 to 11:30', limited: false },
    { id: '1130-1215', label: '11:30 to 12:15', limited: false },
    { id: '1215-1300', label: '12:15 to 13:00', limited: false },
    { id: '1300-1345', label: '13:00 to 13:45', limited: false },
    { id: '1415-1500', label: '14:15 to 15:00', limited: false },
    { id: '1500-1545', label: '15:00 to 15:45', limited: false },
    { id: '1545-1630', label: '15:45 to 16:30', limited: false },
    { id: '1630-1715', label: '16:30 to 17:15', limited: false },
    { id: '1715-1800', label: '17:15 to 18:00', limited: false },
    { id: '0830-0915', label: '08:30 to 09:15', limited: true },
    { id: '0915-1000', label: '09:15 to 10:00', limited: true },
    { id: '1800-1845', label: '18:00 to 18:45', limited: true },
    { id: '1845-1930', label: '18:45 to 19:30', limited: true },
    { id: '1930-2015', label: '19:30 to 20:15', limited: true }
  ];

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
      // const bookingCounts = await Booking.aggregate([
      //   {
      //     $unwind: "$sessions"
      //   },
      //   {
      //     $group: {
      //       _id: { therapist: "$sessions.therapist", date: "$sessions.date" },
      //       count: { $sum: 1 },
      //       slots: { $addToSet: "$sessions.slotId" }
      //     }
      //   }
      // ]);
      // Get bookings count per therapist grouped by date
const bookingCounts = await Booking.aggregate([
  { $unwind: "$sessions" },
  { $match: { "sessions.status": { $ne: "Missed" } } },   // ← ADD THIS
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

      // Fetch patient wallet details for all patients in the result set
      // Import Wallet model if not already imported
      // import Wallet from '../../Schema/wallet.schema.js'; // assumed at top of file

      // Get all patient IDs from current bookings
      const patientIds = Array.from(
        new Set(
          bookings
            .filter(b => b.patient && b.patient._id)
            .map(b => b.patient._id.toString())
        )
      );

      // Fetch wallets for these patients
      const wallets = await Wallet.find({ patient: { $in: patientIds } }).lean();

      // Construct wallet map for fast access by patientId string
      const walletMap = {};
      for (const wallet of wallets) {
        walletMap[wallet.patient.toString()] = wallet;
      }

      // Attach walletSummary to each booking (or null if not found)
      const bookingsWithWallet = bookings.map(booking => {
        let walletSummary = null;
        if (booking.patient && booking.patient._id) {
          const w = walletMap[booking.patient._id.toString()];
          if (w) {
            walletSummary = {
              balance: w.balance,
              patient: w.patient, // optionally add patient ref
              latestTransaction:
                Array.isArray(w.transactions) && w.transactions.length
                  ? {
                      type: w.transactions[w.transactions.length - 1].type,
                      amount: w.transactions[w.transactions.length - 1].amount,
                      reason: w.transactions[w.transactions.length - 1].reason,
                      balanceAfter: w.transactions[w.transactions.length - 1].balanceAfter,
                      createdAt: w.transactions[w.transactions.length - 1].createdAt,
                      remark: w.transactions[w.transactions.length - 1].remark,
                    }
                  : null,
              // To send more transaction history, add here if wanted (up to N latest, etc)
              // transactions: w.transactions.slice(-3)
            };
          }
        }
        return {
          ...booking.toObject(),
          wallet: walletSummary,
        };
      });

      res.json({
        success: true,
        bookings: bookingsWithWallet,
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

  getTimeLabelFromSlotId(slotId) {
    if (!slotId) return '';
    const entry = SESSION_TIME_OPTIONS.find(s => s.id === slotId);
    return entry ? entry.label : '';
  }

  /**
   * Creates a new booking with transaction & validation logic.
   * - Validates all required fields
   * - Checks slot/therapist/session conflicts
   * - Generates appointment/payment/session IDs
   * - Handles booking request approval if needed
   * - Persists all via MongoDB transaction
   * - Sends WhatsApp on completion (non-blocking)
   */
  async createBooking(req, res) {
    const session = await mongoose.startSession();
    try {
      await session.startTransaction();

      // Destructure and alias critical booking fields from req.body
      const {
        coupon, package: packageId, patient: patientId, therapist: therapistId,
        sessions, therapy: therapyId, status, notes, channel, attendedBy,
        referral, extra, attendedByType, paymentDueDate, invoiceNumber,
        followupRequired, followupDate, isBookingRequest, bookingRequestId,
        remark
      } = req.body;

      // Validate presence of required data
      if (!packageId || !patientId || !therapyId || !therapistId ||
          !Array.isArray(sessions) || !sessions.length) {
        await session.abortTransaction();
        session.endSession();
        console.log("Missing required fields:", { packageId, patientId, therapyId, therapistId, sessions });
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }

      // Build and validate therapist references for all sessions
      const therapistIdsForSessions = Array.from(
        new Set((sessions || []).map(sess => sess.therapistId || therapistId))
      );
      const therapistProfiles = await TherapistProfile.find({ _id: { $in: therapistIdsForSessions } }).lean();
      const therapistIdToRefIdMap = {};
      therapistProfiles.forEach(tp => {
        therapistIdToRefIdMap[tp._id.toString()] = tp.therapistId;
      });
      if (Object.keys(therapistIdToRefIdMap).length !== therapistIdsForSessions.length) {
        await session.abortTransaction();
        session.endSession();
        console.log("Therapist(s) referenced in sessions do not exist:", { therapistIdsForSessions, therapistIdToRefIdMap });
        return res.status(400).json({
          success: false,
          message: "One or more therapist(s) referenced in sessions do not exist."
        });
      }

      // Compose slots required for booking, ensuring essential fields
      const requestedSlots = (sessions || []).map(sess => ({
        date: sess.date,
        slotId: sess.slotId || sess.id,
        therapistId: sess.therapistId || therapistId
      }));
      if (requestedSlots.some(s => !s.date || !s.slotId || !s.therapistId)) {
        await session.abortTransaction();
        session.endSession();
        console.log("Invalid session data:", requestedSlots);
        return res.status(400).json({
          success: false,
          message: "Invalid session data: All sessions must have date, slotId/id, and therapistId."
        });
      }

      // Calculate booking period (earliest to latest session date)
      let sessionDates = requestedSlots.map(s => s.date).sort();
      const fromDate = sessionDates[0];
      const toDate = sessionDates[sessionDates.length - 1];

      // Check slot availability for each involved therapist
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
          let availabilitySummaryResult = await new Promise((resolve) => {
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
            console.log("Invalid response from getAvailabilitySummary:", { availabilitySummaryResult });
            throw new Error("Invalid response from getAvailabilitySummary");
          }
          const therapistRefId = therapistIdToRefIdMap[uniqueTherapistId];
          allSlotAvailabilityData[therapistRefId] = availabilitySummaryResult.data;
        } catch (err) {
          await session.abortTransaction();
          session.endSession();
          console.log(`Failed to check slot availability for therapist ${uniqueTherapistId}:`, err && err.message, err);
          return res.status(500).json({
            success: false,
            message: `Failed to check slot availability for one or more therapists.`,
            error: err.message,
          });
        }
      }

      // Detect session conflicts by therapistId/slotId/date
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
        console.log("Conflict detected in session slots:", { conflicts, allSlotAvailabilityData });
        return res.status(409).json({
          success: false,
          message: "Selected therapist/time slot already booked for one or more session dates.",
          conflicts,
          allSlotAvailabilityData
        });
      }

      // Build discount/coupon info if present
      let discountInfo;
      if (coupon && coupon.id) {
        discountInfo = { coupon: coupon.id, time: new Date() };
      } else if (typeof coupon === "string" && coupon) {
        discountInfo = { coupon: coupon, time: new Date() };
      }

      // Generate appointmentId and paymentId within tx
      const counter = await Counter.findOneAndUpdate(
        { name: "appointment" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
      );
      const appointmentId = generateAppointmentId(counter.seq);

      // Find target package and ensure it exists
      const pkg = await Package.findById(packageId).lean();
      if (!pkg) {
        await session.abortTransaction();
        session.endSession();
        console.log("Invalid package:", { packageId });
        return res.status(400).json({
          success: false,
          message: "Invalid package"
        });
      }

      // Generate invoice/payment doc
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

      // Prepare session documents (stable sorted, generate sessionId)
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
      let sortedSessions = Array.isArray(sessions)
        ? sessions.map((s, origIdx) => ({ ...s, __origIdx: origIdx }))
            .sort((a, b) => {
              if (a.date < b.date) return -1;
              if (a.date > b.date) return 1;
              return a.__origIdx - b.__origIdx;
            })
        : [];

      const normalizedSessions = (sortedSessions || []).map((sess, idx) => {
        const slotId = sess.slotId || sess.id;
        const resolvedTime = this.getTimeLabelFromSlotId(slotId);
        return {
          sessionId: `S${String(sessionCounterStart + idx).padStart(6, "0")}`,
          date: sess.date,
          time: resolvedTime || '',
          slotId: slotId,
          therapist: sess.therapistId || therapistId,
          therapyTypeId: sess.therapyTypeId || sess.therapyType || null,
          isCheckedIn: typeof sess.isCheckedIn !== "undefined" ? sess.isCheckedIn : false,
          status: typeof sess.status !== "undefined" && sess.status !== null ? sess.status : 'NotCheckedIn'
        };
      });

      // Prepare booking document, prune undefined fields
      const bookingPayload = {
        appointmentId, status, notes, remark, discountInfo,
        package: packageId, patient: patientId, therapist: therapistId,
        sessions: normalizedSessions, therapy: therapyId,
        payment: paymentDoc._id, channel, attendedBy, referral, extra,
        attendedByType, paymentDueDate, invoiceNumber, followupRequired, followupDate
      };
      for (const k in bookingPayload) {
        if (bookingPayload[k] === undefined) delete bookingPayload[k];
      }
      const booking = new Booking(bookingPayload);

      await booking.save({ session });

      // If booking request, approve and log it within transaction
      if (isBookingRequest && bookingRequestId) {
        const bookingRequestDoc = await BookingRequests.findById(bookingRequestId).session(session);
        if (bookingRequestDoc) {
          const previousBookingRequest = bookingRequestDoc.toObject();
          bookingRequestDoc.status = "approved";
          bookingRequestDoc.appointmentId = booking._id;
          await bookingRequestDoc.save({ session });

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
            console.log("Failed to approve booking request (audit log failure):", logError && logError.message, logError);
            return res.status(500).json({
              success: false,
              message: "Failed to approve booking request (audit log failure).",
              error: logError?.message || "Audit logging failed.",
            });
          }
        }
      }

      // Log booking creation (mandatory to succeed transaction)
      try {
        await AuditLogService.addLog({
          action: "BOOKING_CREATED",
          user: req.user?.id,
          role: "admin",
          resource: "Booking",
          resourceId: booking._id,
          details: {
            patientId, therapistId, appointmentId: booking.appointmentId,
            packageId, therapyId, channel, sessions: normalizedSessions.length,
            invoiceNumber, remark, status,
            message: `Booking created for children ${patientId} with therapist ${therapistId}, package ${packageId}, therapy ${therapyId}`
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }, session);
      } catch (logError) {
        await session.abortTransaction();
        session.endSession();
        console.log("Failed to create booking (audit log failure):", logError && logError.message, logError);
        return res.status(500).json({
          success: false,
          message: "Failed to create booking (audit log failure).",
          error: logError?.message || "Audit logging failed.",
        });
      }

      // Commit the successful transaction
      await session.commitTransaction();
      session.endSession();

      // Populate booking & references for return
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

      // WhatsApp notification (async, do not fail booking if error)
      try {
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

        let sessionsData = [];
        if (Array.isArray(populatedBooking.sessions)) {
          sessionsData = populatedBooking.sessions.map((ses) => ({
            date: ses.date,
            time: this.getTimeLabelFromSlotId(ses.slotId)
          }));
        }

        if (phoneNo) {
          // const sessionsText = Array.isArray(sessionsData) && sessionsData.length
          //   ? sessionsData.map(
          //       (s, i) =>
          //         `Session ${i + 1}: Date: ${s.date || '-'}, Time: ${s.time ? s.time : '-'}`
          //     ).join(",")
          //   : "";

          const sessionsText = Array.isArray(sessionsData) && sessionsData.length
  ? `${sessionsData.length} sessions`
  : "0 sessions";


          let waPaymentId = populatedBooking?.payment?.paymentId;

          console.log("Sending WhatsApp booking completed notification:", {
            destination: phoneNo,
            userName: patientName,
            appointmentId: populatedBooking.appointmentId,
            patientName: patientName,
            totalSessions: sessionsText,
            paymentId: waPaymentId
          });

          await WhatsappController.sendBookingCreationCompleted({
            destination: phoneNo,
            userName: patientName,
            appointmentId: populatedBooking.appointmentId,
            patientName: patientName,
            totalSessions: sessionsText,
            paymentId: waPaymentId
          });
        }
      } catch (waErr) {
        console.error("Failed to send WhatsApp message:", waErr?.message || waErr);
      }

      res.status(201).json({
        success: true,
        booking: populatedBooking,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.log("Failed to create booking:", error && error.message, error);
      res.status(500).json({
        success: false,
        message: "Failed to create booking.",
        error: error.message,
      });
    }
  }

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
        // let therapistValue =
        //   sess.therapist ||
        //   sess.therapistId ||
        //   bodyTherapist ||
        //   prevBooking.therapist;

          let therapistValue =
  sess.therapistId ||   // ← frontend sends therapistId (string)
  sess.therapist ||     // ← fallback
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
          // Pass excludeBookingId so availability does NOT count this booking's own sessions — preventing its slots from appearing as "already booked".
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
          // CONSOLE.LOG CHECK
          console.log("[updateBooking][CONFLICTS] Failed to check slot availability:", err);
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
          // CONSOLE.LOG CHECK
          console.log("[updateBooking][CONFLICTS] Could not fetch therapist's slot availability for update request.", {
            therapistObjId,
            slotAvailabilityResult
          });
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
        // CONSOLE.LOG CHECK
        console.log("[updateBooking][CONFLICTS] Slot conflicts found:", conflicts);
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

      // ── 7b. Build prev-session status map ─────────────────────────────────────
      // Map: sessionKey → { isCheckedIn, status } from the previously saved booking.
      // Used in step 11 to ensure existing sessions never lose their check-in state.
      const prevSessionStatusMap = {};
      prevSessions.forEach((sess) => {
        prevSessionStatusMap[sessionKey(sess)] = {
          isCheckedIn: sess.isCheckedIn,
          status: sess.status,
        };
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
        );
        counterStart = sessionCounterDoc.seq - indicesNeedingNewId.length + 1;
        // preserve any original non-conflict log here (unchanged)
        console.log(
          `[updateBooking] Allocated session counter block: start=${counterStart}, count=${indicesNeedingNewId.length}`
        );
      }

      // Map: sortedIndex → allocated counter value
      const newIdBySortedIndex = {};
      indicesNeedingNewId.forEach((sortedIdx, i) => {
        newIdBySortedIndex[sortedIdx] = counterStart + i;
      });

      // ── 11. Build updatedSessions with correct sessionIds + preserved status ──
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

        // ── sessionId resolution ──────────────────────────────────────────────
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

        // ── isCheckedIn / status resolution ──────────────────────────────────
        // For sessions that already existed (key found in prevSessionStatusMap),
        // ALWAYS carry forward the stored isCheckedIn and status regardless of
        // what the frontend sent — this prevents accidental resets of
        // CheckedIn / Missed sessions during a booking edit.
        //
        // For brand-new sessions (no previous record), fall back to whatever
        // the incoming payload carries, or the schema defaults.
        const prevStatus = prevSessionStatusMap[key];

        const isCheckedInValue = prevStatus
          ? prevStatus.isCheckedIn
          : (s.isCheckedIn !== undefined ? s.isCheckedIn : false);

        const statusValue = prevStatus
          ? prevStatus.status
          : (s.status !== undefined ? s.status : "NotCheckedIn");

        return {
          date: s.date,
          slotId: s.slotId || s.id,
          therapist: therapistValue,
          therapistId: therapistIdField,
          therapyTypeId: therapyTypeIdValue,
          sessionId: sessionIdValue,
          isCheckedIn: isCheckedInValue,
          status: statusValue,
          ...(s.time !== undefined && { time: s.time }),
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
      // removed log: console.log("[updateBooking] Session delta:", {...})

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
        // retain log for DB error (not a conflict check)
        console.log("[updateBooking] Booking update DB error:", err);
      }

      if (!bookingUpdated || !booking) {
        await session.abortTransaction();
        session.endSession();
        // retain log for not updated (not a conflict check)
        console.log("[updateBooking] Booking not updated", {
          bookingUpdateError
        });
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
        // retain log for audit log error (not a conflict check)
        console.log("[AUDIT LOG] Failed to record booking_updated log:", err);
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
            patientName:
              patientName && booking.patient._id
                ? `${patientName} - (${
                    booking.patient.patientId?.toString?.() ||
                    booking.patient.patientId ||
                    ""
                  })`
                : patientName,
            totalSessions: Array.isArray(booking.sessions)
              ? booking.sessions.length
              : 0,
            status: "Updated",
          });
        } catch (waErr) {
          // retain log for whatsapp error (not a conflict check)
          console.log("WhatsApp sending failed on booking update:", waErr);
        }
      }

      // ── 17. Commit ────────────────────────────────────────────────────────────
      await session.commitTransaction();
      session.endSession();

      // removed non-conflict success log: console.log(`[updateBooking] Successful for booking _id: ${id}`);
      return res.json({ success: true, booking });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      // retain error log (not a conflict check)
      console.log("[updateBooking] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update booking.",
        error: error.message,
      });
    }
  }

  /**
 * ============================================================
 * ADD THIS METHOD to BookingAdminController (booking.controller.js)
 * ============================================================
 *
 * Moves a single session to a new date / slot / therapist.
 * Unlike updateBooking(), this does NOT touch the other sessions
 * in the booking, and does NOT allow changing a session's
 * sessionId, isCheckedIn or status — it purely re-schedules it.
 *
 * Body: {
 *   bookingId: string,       // Booking._id
 *   sessionId: string,       // sessions[].._id (the subdocument _id)
 *   newDate: "YYYY-MM-DD",
 *   newSlotId: string,       // e.g. "1000-1045"
 *   newTherapistId: string   // TherapistProfile._id
 * }
 *
 * Guardrails:
 *  - Refuses to move a session that is already CheckedIn (billed).
 *    Admin should use markSessionNotCheckedIn first if they really
 *    need to move a billed session — keeps invoice math honest.
 *  - Rejects the move if the target therapist already has a
 *    DIFFERENT session (in ANY booking) at that date+slot.
 *  - Rejects if you try to drop two sessions from the SAME booking
 *    onto the same date+slot+therapist (duplicate).
 */
async moveSession(req, res) {
  const session = await Booking.startSession();
  session.startTransaction();
  try {
    const { bookingId, sessionId, newDate, newSlotId, newTherapistId } = req.body;

    console.log(req.body);

    if (!bookingId || !sessionId || !newDate || !newSlotId || !newTherapistId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "bookingId, sessionId, newDate, newSlotId and newTherapistId are required.",
      });
    }

    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Booking not found." });
    }

    const sessionIndex = booking.sessions.findIndex(
      (s) => String(s._id) === String(sessionId)
    );
    if (sessionIndex === -1) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "Session not found in this booking." });
    }

    const targetSession = booking.sessions[sessionIndex];

    // --- Guardrail: never silently move a billed/checked-in session ---
    if (targetSession.status === "CheckedIn" || targetSession.isCheckedIn) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message:
          "This session is already checked in and billed. Undo the check-in before moving it.",
      });
    }

    // --- Validate new slot id exists ---
    const slotDef = SESSION_TIME_OPTIONS.find((o) => o.id === newSlotId);
    if (!slotDef) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Invalid newSlotId." });
    }

    // --- Validate target therapist exists ---
    const therapistDoc = await TherapistProfile.findById(newTherapistId).session(session);
    if (!therapistDoc) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Target therapist not found." });
    }

    // --- Conflict check: does any OTHER booking already have a session
    //     at this exact date + slot + therapist? ---
    // const conflictBooking = await Booking.findOne({
    //   _id: { $ne: booking._id },
    //   sessions: {
    //     $elemMatch: {
    //       date: newDate,
    //       slotId: newSlotId,
    //       therapist: therapistDoc._id,
    //     },
    //   },
    // }).session(session);

    const conflictBooking = await Booking.findOne({
      _id: { $ne: booking._id },
      sessions: {
        $elemMatch: {
          date: newDate,
          slotId: newSlotId,
          therapist: therapistDoc._id,
          status: { $ne: "Missed" },   // ← ADD THIS
        },
      },
    }).session(session);

    if (conflictBooking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: `That slot is already taken — Booking #${conflictBooking.appointmentId} has a session there for this therapist.`,
      });
    }

    // --- Conflict check within the SAME booking (avoid duplicate slot) ---
    const dupeInSameBooking = booking.sessions.some(
      (s, idx) =>
        idx !== sessionIndex &&
        s.date === newDate &&
        s.slotId === newSlotId &&
        String(s.therapist) === String(therapistDoc._id)
    );
    if (dupeInSameBooking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: "This booking already has another session at that exact date/slot/therapist.",
      });
    }

    const previousSnapshot = {
      date: targetSession.date,
      slotId: targetSession.slotId,
      therapist: targetSession.therapist,
    };

    // --- Apply the move ---
    targetSession.date = newDate;
    targetSession.slotId = newSlotId;
    targetSession.therapist = therapistDoc._id;
    targetSession.time = this.getTimeLabelFromSlotId(newSlotId);

    await booking.save({ session });

    // --- Mandatory audit log (roll back if it fails, matching your existing pattern) ---
    try {
      await AuditLogService.addLog(
        {
          action: "SESSION_MOVED",
          user: req.user?.id,
          role: "admin",
          resource: "Booking",
          resourceId: booking._id,
          details: {
            bookingId: booking._id,
            sessionId,
            appointmentId: booking.appointmentId,
            previous: previousSnapshot,
            updated: {
              date: newDate,
              slotId: newSlotId,
              therapist: therapistDoc._id,
              therapistName: therapistDoc.name || therapistDoc.fullName,
            },
            message: `Session ${sessionId} on Booking #${booking.appointmentId} moved from ${previousSnapshot.date} / ${previousSnapshot.slotId} to ${newDate} / ${newSlotId} (therapist: ${therapistDoc.therapistId || therapistDoc._id}).`,
          },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
        session
      );
    } catch (logErr) {
      await session.abortTransaction();
      session.endSession();
      console.error("[moveSession] Audit log failed, rolling back:", logErr);
      return res.status(500).json({
        success: false,
        message: "Failed to move session (audit log failure). No changes made.",
        error: logErr?.message || "Audit logging failed.",
      });
    }

    await session.commitTransaction();
    session.endSession();

    const populatedBooking = await Booking.findById(booking._id)
      .populate({
        path: "sessions.therapist",
        model: "TherapistProfile",
        select: "_id userId therapistId",
        populate: { path: "userId", model: "User", select: "name" },
      })
      .populate({ path: "sessions.therapyTypeId", model: "TherapyType" })
      .populate({ path: "patient", model: "PatientProfile", select: "name patientId" });

    return res.json({
      success: true,
      message: "Session moved successfully.",
      booking: populatedBooking,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[moveSession] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to move session.",
      error: error.message,
    });
  }
}

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
   * After a wallet credit (overpayment routed to wallet), immediately sweep
   * that balance across the SAME patient's other bookings that still have a
   * balance due (invoiceAmount > amountPaid), oldest booking first.
   *
   * For each booking it touches:
   *   - debits the wallet by the amount applied (reason: due_settlement_debit)
   *   - increments that booking's payment.amountPaid
   *   - recomputes that booking's payment.status / booking.paymentStatus
   *   - creates a Finance income record for the amount applied
   *   - writes an audit log entry
   *
   * Stops as soon as the wallet balance hits 0, or there are no more dues.
   * Must be called with the same mongoose transaction `session` that the
   * calling request is already using.
   *
   * @param {ObjectId|string} patientId
   * @param {ObjectId|string} excludeBookingId - the booking that generated
   *        the credit; we don't want to immediately re-apply it to itself.
   * @param {mongoose.ClientSession} session
   * @param {object} req - the original request, for audit log ip/userAgent/user
   * @returns {Promise<Array>} list of { bookingId, appointmentId, amountApplied }
   */
async sweepWalletToOtherDues(patientId,id,name, excludeBookingId, session, req) {
  const applied = [];
  if (!patientId) return applied;

  // Find this patient's other bookings that still have something due.
  // invoiceAmount is only meaningful once the running-invoice model is in
  // place (defaults to 0 on brand-new bookings with nothing checked in yet,
  // which naturally excludes them here since due = invoiceAmount - paid <= 0).
  const otherBookings = await Booking.find({
    patient: patientId,
    _id: { $ne: excludeBookingId },
  })
    .populate({ path: "payment", model: "Payment" })
    .sort({ createdAt: 1 }) // oldest booking's due gets settled first
    .session(session);

  for (const otherBooking of otherBookings) {
    // Re-check wallet balance fresh each iteration since debitWallet mutates it.
    const wallet = await getOrCreateWallet(patientId, session);
    if (!wallet || wallet.balance <= 0) break;

    const otherPayment = otherBooking.payment;
    if (!otherPayment) continue;

    const invoiceAmount = otherBooking.invoiceAmount || 0;
    const alreadyPaid = otherPayment.amountPaid || 0;
    const due = Math.max(0, invoiceAmount - alreadyPaid);
    if (due <= 0) continue;

    const { amountDebited } = await debitWallet(
      {
        patientId,
        amount: due,
        reason: "due_settlement_debit",
        booking: otherBooking._id,
        remark: `Auto-applied from wallet advance to settle due on Booking #${otherBooking.appointmentId}`,
      },
      session
    );
    if (amountDebited <= 0) continue;

    // Update the OTHER booking's payment record
    otherPayment.amountPaid = alreadyPaid + amountDebited;
    otherPayment.status = otherPayment.amountPaid >= invoiceAmount ? "paid" : "partiallypaid";
    await otherPayment.save({ session });

    otherBooking.paymentStatus = otherPayment.status;
    await otherBooking.save({ session });

    // Finance record for this settlement
    await Finances.create(
      [
        {
          date: new Date(),
          description: `Wallet advance applied to Booking #${otherBooking.appointmentId} (due settlement)`,
          type: "income",
          amount: amountDebited,
          creditDebitStatus: "credited",
          paymentMethod: "wallet",
          utr: [],
          childrenName: name, // patient name not loaded here; safe to omit
          childrenId: id,
          booking: otherBooking._id,
        },
      ],
      { session }
    );

    // Audit log (best-effort — do not fail the whole sweep if logging fails)
    try {
      await AuditLogService.addLog(
        {
          action: "BOOKING_PAYMENT_UPDATE",
          user: req?.user?.id,
          role: "admin",
          resource: "Booking",
          resourceId: otherBooking._id,
          details: {
            patientId,
            appointmentId: otherBooking.appointmentId,
            message: `Wallet advance auto-applied to settle due of Rs.${amountDebited} on Booking #${otherBooking.appointmentId}.`,
            amountApplied: amountDebited,
            source: "wallet_sweep",
          },
          ipAddress: req?.ip,
          userAgent: req?.headers?.["user-agent"],
        },
        session
      );
    } catch (logErr) {
      console.error("[sweepWalletToOtherDues] Audit log failed (non-fatal):", logErr);
    }

    applied.push({
      bookingId: otherBooking._id,
      appointmentId: otherBooking.appointmentId,
      amountApplied: amountDebited,
    });
  }

  return applied;
}


/**
 * Mark payment collection details for a booking.
 * Expects: { payment } in req.body
 * Params: booking id in req.params.id
 * Sends WhatsApp message (see @whatsapp.js sendPaymentCollectedSuccessfully) 
 */
// async collectPayment(req, res) {
//   const session = await Booking.startSession();
//   session.startTransaction();

//   let auditLogFailed = false;
//   let auditLogError = null;

//   try {
//     const { id } = req.params;
//     const {
//       paymentType = "full",
//       partialAmount,
//       discountApplied = false,
//       paymentMethod,
//       utr,
//       paymentTime
//     } = req.body;

//     if (!id) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "Booking ID required."
//       });
//     }

//     // Populate patient, discountInfo for WhatsApp and discount calculation
//     const booking = await Booking.findById(id)
//       .populate([
//         {
//           path: "patient",
//           model: "PatientProfile",
//           select: "name mobile1 patientId userId",
//           populate: {
//             path: "userId",
//             model: "User",
//             select: "phone name"
//           }
//         },
//         {
//           path: "discountInfo.coupon",
//           model: "Discount"
//         }
//       ])
//       .session(session);

//     if (!booking) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: "Booking not found."
//       });
//     }

//     const paymentId = booking.payment;
//     if (!paymentId) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "This booking has no associated payment record."
//       });
//     }

//     const payment = await Payment.findOne({ _id: paymentId }).session(session);

//     if (!payment) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: "Associated payment not found."
//       });
//     }

//     // Ensure 'utr' field is always an array
//     // if (!Array.isArray(payment.utr)) {
//     //   payment.utr = payment.utr ? [payment.utr] : [];
//     // }

//     // // --- Discount Logic ---
//     // let originalAmount = payment.amount;
//     // let amountToCollect = originalAmount;
//     // let discountAmount = 0;
//     // let appliedDiscountPercent = 0;

//     // if (
//     //   discountApplied &&
//     //   booking.discountInfo &&
//     //   booking.discountInfo.coupon &&
//     //   typeof booking.discountInfo.coupon.discount === "number"
//     // ) {
//     //   appliedDiscountPercent = booking.discountInfo.coupon.discount;
//     //   if (appliedDiscountPercent > 0) {
//     //     discountAmount = Math.round((originalAmount * appliedDiscountPercent) / 100);
//     //     amountToCollect = originalAmount - discountAmount;
//     //   }
//     // }

//     // ---------------------------

//     // Ensure 'utr' field is always an array
//     if (!Array.isArray(payment.utr)) {
//       payment.utr = payment.utr ? [payment.utr] : [];
//     }

//     // --- Discount Logic (kept for reference / legacy display only) ---
//     let originalAmount = payment.amount;
//     let discountAmount = 0;
//     let appliedDiscountPercent = 0;
//     if (
//       discountApplied &&
//       booking.discountInfo &&
//       booking.discountInfo.coupon &&
//       typeof booking.discountInfo.coupon.discount === "number"
//     ) {
//       appliedDiscountPercent = booking.discountInfo.coupon.discount;
//       if (appliedDiscountPercent > 0) {
//         discountAmount = Math.round((originalAmount * appliedDiscountPercent) / 100);
//       }
//     }

//     // --- Option A: "amountToCollect" is now the CURRENT INVOICE DUE, ---
//     // --- not the whole package total. ---
//     const currentInvoice = booking.invoiceAmount || 0;
//     const amountToCollect = Math.max(0, currentInvoice - (payment.amountPaid || 0));

//     // ---------------------------


//     // let financeRecord = null;
//     // let auditLogMessage = "";
//     // let paymentStatusChanged = false;
//     // let paymentStatusForWhatsapp = "";
//     // let remainingToPay;
//     let financeRecord = null;
//     let auditLogMessage = "";
//     let paymentStatusChanged = false;
//     let paymentStatusForWhatsapp = "";
//     let remainingToPay;
//     let sweepResults = [];

//     // -------- PARTIAL PAYMENT --------
//     // if (paymentType === "partial") {
//     //   const { amountPaid = 0 } = payment;
//     //   let actualAmountToCompare = amountToCollect;
//     //   let remaining = actualAmountToCompare - amountPaid;

//     //   if (
//     //     typeof partialAmount !== "number" ||
//     //     partialAmount <= 0 ||
//     //     partialAmount > remaining
//     //   ) {
//     //     await session.abortTransaction();
//     //     session.endSession();
//     //     return res.status(400).json({
//     //       success: false,
//     //       message: `Partial amount to pay must be a number > 0 and <= remaining amount (${remaining}).`
//     //     });
//     //   }

//     //   payment.amountPaid = (payment.amountPaid || 0) + partialAmount;


//     // ------------------------------------
// // -------- PARTIAL PAYMENT --------
// if (paymentType === "partial") {
//   if (typeof partialAmount !== "number" || partialAmount <= 0) {
//     await session.abortTransaction();
//     session.endSession();
//     return res.status(400).json({
//       success: false,
//       message: `Partial amount to pay must be a number > 0.`
//     });
//   }

//   // Anything beyond what's currently due goes to wallet, not to payment.amountPaid
//   const dueNow = amountToCollect; // invoice - already paid
//   const appliedToInvoice = Math.min(partialAmount, dueNow);
//   const overflowToWallet = partialAmount - appliedToInvoice;

//   payment.amountPaid = (payment.amountPaid || 0) + appliedToInvoice;
//     // ------------------------------------




//       if (paymentMethod) payment.paymentMethod = paymentMethod;
//       if (utr) payment.utr.push(utr);

     

//       if (payment.amountPaid < currentInvoice) {
//         payment.status = "partiallypaid";
//         payment.paymentTime = paymentTime ? new Date(paymentTime) : new Date();
//         booking.paymentStatus = "partiallypaid";
//         auditLogMessage = `[collectPayment] Partial payment of Rs.${partialAmount} received for Booking #${booking.appointmentId}. Applied to invoice: Rs.${appliedToInvoice}. Remaining on current invoice: Rs.${currentInvoice - payment.amountPaid}.${overflowToWallet > 0 ? ` Rs.${overflowToWallet} routed to wallet as advance.` : ""}`;
//         paymentStatusForWhatsapp = "Partial";
//         paymentStatusChanged = true;
//       } else {
//         payment.status = "paid"; // paid up to the current invoice
//         payment.paymentTime = paymentTime ? new Date(paymentTime) : new Date();
//         booking.paymentStatus = "paid";
//         auditLogMessage = `[collectPayment] Booking #${booking.appointmentId} paid up to current invoice (Rs.${currentInvoice}) after Rs.${partialAmount} collected.${overflowToWallet > 0 ? ` Rs.${overflowToWallet} routed to wallet as advance.` : ""}`;
//         paymentStatusForWhatsapp = "Full";
//         paymentStatusChanged = true;
//       }

//    // Route any overflow to the wallet as an advance credit
//    let sweepResults = [];
//    if (overflowToWallet > 0) {
//      await creditWallet(
//        {
//          patientId: booking.patient?._id || booking.patient,
//          amount: overflowToWallet,
//          reason: "advance_payment",
//          booking: booking._id,
//          remark: `Overpayment during partial collection for Booking #${booking.appointmentId}`,
//        },
//        session
//      );

//      // Immediately sweep that new wallet balance across the patient's
//      // OTHER bookings that still have something due.
//      sweepResults = await this.sweepWalletToOtherDues(
//        booking.patient?._id || booking.patient,
//        booking.patient?.patientId,
//        booking.patient.name,
//        booking._id,
//        session,
//        req
//      );
//      if (sweepResults.length > 0) {
//        auditLogMessage += ` Wallet advance also auto-applied to ${sweepResults.length} other booking(s): ${sweepResults
//          .map((s) => `#${s.appointmentId} (Rs.${s.amountApplied})`)
//          .join(", ")}.`;
//      }
//    }

//    await payment.save({ session });
//    await booking.save({ session });


   


//       if (appliedToInvoice > 0) {
//         financeRecord = await Finances.create([
//           {
//             date: new Date(),
//             description: `Partial Payment for Booking #${booking.appointmentId}${discountApplied ? " (DISCOUNT APPLIED)" : ""}`,
//             type: "income",
//             amount: appliedToInvoice,
//             creditDebitStatus: "credited",
//             paymentMethod: paymentMethod || payment.paymentMethod || null,
//             utr: payment.utr,
//             childrenName: booking?.patient?.name || booking?.patientName || "",
//             childrenId: booking?.patient?.patientId || booking?.patientId || "",
//             booking: booking._id
//           }
//         ], { session });
//       }
 

//     } else {
 
//       remainingToPay = amountToCollect; // amountToCollect == dueNow == invoice - amountPaid

//       payment.status = "paid"; // paid up to current invoice
//       payment.paymentTime = paymentTime ? new Date(paymentTime) : new Date();
//       payment.amountPaid = (payment.amountPaid || 0) + remainingToPay;
//       if (paymentMethod) payment.paymentMethod = paymentMethod;
//       if (utr) payment.utr.push(utr);

//       await payment.save({ session });

//       booking.paymentStatus = "paid";
//       auditLogMessage = `[collectPayment] Booking #${booking.appointmentId} paid up to current invoice (Rs.${currentInvoice}) after Rs.${remainingToPay} collected.`;
//       paymentStatusForWhatsapp = "Full";
//       paymentStatusChanged = true;
//       await booking.save({ session });

//   // Optional: if req.body includes `advanceAmount` (money collected beyond
//       // what's due, e.g. receptionist takes Rs.7000 when Rs.5000 is due), credit
//       // the excess to the wallet, then immediately sweep it across the
//       // patient's other bookings that still have something due.
//       if (typeof req.body.advanceAmount === "number" && req.body.advanceAmount > 0) {
//         await creditWallet(
//           {
//             patientId: booking.patient?._id || booking.patient,
//             amount: req.body.advanceAmount,
//             reason: "advance_payment",
//             booking: booking._id,
//             remark: `Advance collected alongside full invoice payment for Booking #${booking.appointmentId}`,
//           },
//           session
//         );

//         const sweepResults = await this.sweepWalletToOtherDues(
//           booking.patient?._id || booking.patient,
//           booking.patient?.patientId,
//           booking.patient.name,
//           booking._id,
//           session,
//           req
//         );
//         if (sweepResults.length > 0) {
//           auditLogMessage += ` Advance also auto-applied to ${sweepResults.length} other booking(s): ${sweepResults
//             .map((s) => `#${s.appointmentId} (Rs.${s.amountApplied})`)
//             .join(", ")}.`;
//         }
//       }

//     }

//     // Add audit log for payment collection if payment status changed
//     if (paymentStatusChanged) {
//       const auditLogPayload = {
//         action: "BOOKING_PAYMENT_UPDATE",
//         user: req.user?.id,
//         role: "admin",
//         resource: "Booking",
//         resourceId: booking._id,
//         details: {
//           patientId: booking.patient?._id || booking.patient,
//           therapistId: booking.therapist?._id || booking.therapist,
//           appointmentId: booking.appointmentId,
//           packageId: booking.package?._id || booking.package,
//           therapyId: booking.therapy?._id || booking.therapy,
//           channel: booking.channel,
//           sessions: Array.isArray(booking.sessions) ? booking.sessions.length : 0,
//           invoiceNumber: booking.invoiceNumber,
//           remark: booking.remark,
//           status: booking.paymentStatus,
//           message: auditLogMessage,
//           discountApplied,
//           discountPercent: appliedDiscountPercent,
//           totalAmount: originalAmount,
//           discountAmount,
//           netAmount: amountToCollect,
//           paymentMethod: paymentMethod || payment.paymentMethod || null,
//           utr: payment.utr,
//         },
//         ipAddress: req.ip,
//         userAgent: req.headers["user-agent"]
//       };
//       try {
//         await AuditLogService.addLog(auditLogPayload);
//       } catch (err) {
//         auditLogFailed = true;
//         auditLogError = err;
//         console.error("[collectPayment] Error creating audit log:", err);
//       }
//     }

//     if (paymentStatusChanged && auditLogFailed) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(500).json({
//         success: false,
//         message: "Failed to record payment due to audit log failure. No changes made.",
//         error: auditLogError ? auditLogError.message : "Unknown log error"
//       });
//     }

//     await session.commitTransaction();
//     session.endSession();

//     // WhatsApp Notification if payment recorded and patient mobile exists
//     if (paymentStatusChanged) {
//       let patientProfile = booking.patient;
//       let userPhone =
//         (patientProfile && patientProfile.mobile1) ||
//         (patientProfile &&
//           patientProfile.userId &&
//           patientProfile.userId.phone) ||
//         null;
//       let userName =
//         (patientProfile && patientProfile.name) ||
//         (patientProfile &&
//           patientProfile.userId &&
//           patientProfile.userId.name) ||
//         "";

//       if (userPhone) {
//         const { appointmentId } = booking;
//         let amountForWhatsapp;
//         if (paymentType === "partial") {
//           amountForWhatsapp = payment.amountPaid < amountToCollect ? partialAmount : payment.amountPaid;
//         } else {
//           amountForWhatsapp = typeof remainingToPay !== "undefined"
//             ? remainingToPay
//             : amountToCollect;
//         }

//         let paymentStatusTxt =
//           payment.status === "paid"
//             ? "Full"
//             : payment.status === "partiallypaid"
//               ? "Partial"
//               : payment.status;

//         try {
//           await WhatsappController.sendPaymentCollectedSuccessfully({
//             destination: userPhone,
//             userName,
//             appointmentId,
//             amount: String(amountForWhatsapp),
//             paymentStatus: paymentStatusTxt,
//             paymentMethod: paymentMethod || payment.paymentMethod || null,
//             utr: payment.utr,
//           });
//         } catch (err) {
//           console.error(
//             "[collectPayment] Error sending WhatsApp payment confirmation:",
//             err
//           );
//         }
//       }
//     }

//     res.json({
//       success: true,
//       message:
//         paymentType === "partial"
//           ? payment.status === "paid"
//             ? "Partial payment received. Booking now fully paid."
//             : "Partial payment received. Remaining balance is due."
//           : "Payment recorded successfully.",
//       booking,
//       payment,
//       wallet: await (async () => {
//         const w = await Wallet.findOne({ patient: booking.patient?._id || booking.patient }).lean();
//         return w ? { balance: w.balance } : { balance: 0 };
//       })(),
//       appliedToOtherBookings: typeof sweepResults !== "undefined" ? sweepResults : [],
//       finance: Array.isArray(financeRecord) ? financeRecord[0] : financeRecord,
//       discount: discountApplied
//         ? {
//             percent: appliedDiscountPercent,
//             discountAmount,
//             netAmount: amountToCollect
//           }
//         : undefined
//     });

//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();
//     console.error("[collectPayment] Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to record payment.",
//       error: error.message
//     });
//   }
// }

// Check-in a Children for a booking

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
      discountApplied = false,
      paymentMethod,
      utr,
      paymentTime
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

    // Ensure 'utr' field is always an array
    if (!Array.isArray(payment.utr)) {
      payment.utr = payment.utr ? [payment.utr] : [];
    }

    // --- Discount Logic (kept for reference / legacy display only) ---
    let originalAmount = payment.amount;
    let discountAmount = 0;
    let appliedDiscountPercent = 0;
    if (
      discountApplied &&
      booking.discountInfo &&
      booking.discountInfo.coupon &&
      typeof booking.discountInfo.coupon.discount === "number"
    ) {
      appliedDiscountPercent = booking.discountInfo.coupon.discount;
      if (appliedDiscountPercent > 0) {
        discountAmount = Math.round((originalAmount * appliedDiscountPercent) / 100);
      }
    }

    // --- Option A: "amountToCollect" is now the CURRENT INVOICE DUE, ---
    // --- not the whole package total. ---
    const currentInvoice = booking.invoiceAmount || 0;
    const amountToCollect = Math.max(0, currentInvoice - (payment.amountPaid || 0));

    // ---------------------------

    let financeRecord = null;
    let auditLogMessage = "";
    let paymentStatusChanged = false;
    let paymentStatusForWhatsapp = "";
    let remainingToPay;
    let sweepResults = [];

    // -------- PARTIAL PAYMENT --------
    if (paymentType === "partial") {
      if (typeof partialAmount !== "number" || partialAmount <= 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Partial amount to pay must be a number > 0.`
        });
      }

      // Anything beyond what's currently due goes to wallet, not to payment.amountPaid
      const dueNow = amountToCollect; // invoice - already paid
      const appliedToInvoice = Math.min(partialAmount, dueNow);
      const overflowToWallet = partialAmount - appliedToInvoice;

      payment.amountPaid = (payment.amountPaid || 0) + appliedToInvoice;

      if (paymentMethod) payment.paymentMethod = paymentMethod;
      if (utr) payment.utr.push(utr);

      payment.paymentTime = paymentTime ? new Date(paymentTime) : new Date();

      if (payment.amountPaid < currentInvoice) {
        payment.status = "partiallypaid";
        booking.paymentStatus = "partiallypaid";
        auditLogMessage = `[collectPayment] Partial payment of Rs.${partialAmount} received for Booking #${booking.appointmentId}. Applied to invoice: Rs.${appliedToInvoice}. Remaining on current invoice: Rs.${currentInvoice - payment.amountPaid}.${overflowToWallet > 0 ? ` Rs.${overflowToWallet} routed to wallet as advance.` : ""}`;
        paymentStatusForWhatsapp = "Partial";
        paymentStatusChanged = true;
      } else {
        payment.status = "paid"; // paid up to the current invoice
        booking.paymentStatus = "paid";
        auditLogMessage = `[collectPayment] Booking #${booking.appointmentId} paid up to current invoice (Rs.${currentInvoice}) after Rs.${partialAmount} collected.${overflowToWallet > 0 ? ` Rs.${overflowToWallet} routed to wallet as advance.` : ""}`;
        paymentStatusForWhatsapp = "Full";
        paymentStatusChanged = true;
      }

      // Route any overflow to the wallet as an advance credit
      if (overflowToWallet > 0) {
        await creditWallet(
          {
            patientId: booking.patient?._id || booking.patient,
            amount: overflowToWallet,
            reason: "advance_payment",
            booking: booking._id,
            remark: `Overpayment during partial collection for Booking #${booking.appointmentId}`,
          },
          session
        );

        // Immediately sweep that new wallet balance across the patient's
        // OTHER bookings that still have something due.
        sweepResults = await this.sweepWalletToOtherDues(
          booking.patient?._id || booking.patient,
          booking.patient?.patientId,
          booking.patient.name,
          booking._id,
          session,
          req
        );
        if (sweepResults.length > 0) {
          auditLogMessage += ` Wallet advance also auto-applied to ${sweepResults.length} other booking(s): ${sweepResults
            .map((s) => `#${s.appointmentId} (Rs.${s.amountApplied})`)
            .join(", ")}.`;
        }
      }

      await payment.save({ session });
      await booking.save({ session });

      if (appliedToInvoice > 0) {
        financeRecord = await Finances.create([
          {
            date: payment.paymentTime || new Date(),
            description: `Partial Payment for Booking #${booking.appointmentId}${discountApplied ? " (DISCOUNT APPLIED)" : ""}`,
            type: "income",
            amount: appliedToInvoice,
            creditDebitStatus: "credited",
            paymentMethod: paymentMethod || payment.paymentMethod || null,
            utr: payment.utr,
            childrenName: booking?.patient?.name || booking?.patientName || "",
            childrenId: booking?.patient?.patientId || booking?.patientId || "",
            booking: booking._id
          }
        ], { session });
      }

    } else {

      remainingToPay = amountToCollect; // amountToCollect == dueNow == invoice - amountPaid

      payment.status = "paid"; // paid up to current invoice
      payment.paymentTime = paymentTime ? new Date(paymentTime) : new Date();
      payment.amountPaid = (payment.amountPaid || 0) + remainingToPay;
      if (paymentMethod) payment.paymentMethod = paymentMethod;
      if (utr) payment.utr.push(utr);

      await payment.save({ session });

      booking.paymentStatus = "paid";
      auditLogMessage = `[collectPayment] Booking #${booking.appointmentId} paid up to current invoice (Rs.${currentInvoice}) after Rs.${remainingToPay} collected.`;
      paymentStatusForWhatsapp = "Full";
      paymentStatusChanged = true;
      await booking.save({ session });

      if (remainingToPay > 0) {
        financeRecord = await Finances.create([
          {
            date: payment.paymentTime || new Date(),
            description: `Full Payment for Booking #${booking.appointmentId}${discountApplied ? " (DISCOUNT APPLIED)" : ""}`,
            type: "income",
            amount: remainingToPay,
            creditDebitStatus: "credited",
            paymentMethod: paymentMethod || payment.paymentMethod || null,
            utr: payment.utr,
            childrenName: booking?.patient?.name || booking?.patientName || "",
            childrenId: booking?.patient?.patientId || booking?.patientId || "",
            booking: booking._id
          }
        ], { session });
      }

      // Optional: if req.body includes `advanceAmount` (money collected beyond
      // what's due, e.g. receptionist takes Rs.7000 when Rs.5000 is due), credit
      // the excess to the wallet, then immediately sweep it across the
      // patient's other bookings that still have something due.
      if (typeof req.body.advanceAmount === "number" && req.body.advanceAmount > 0) {
        await creditWallet(
          {
            patientId: booking.patient?._id || booking.patient,
            amount: req.body.advanceAmount,
            reason: "advance_payment",
            booking: booking._id,
            remark: `Advance collected alongside full invoice payment for Booking #${booking.appointmentId}`,
          },
          session
        );

        sweepResults = await this.sweepWalletToOtherDues(
          booking.patient?._id || booking.patient,
          booking.patient?.patientId,
          booking.patient.name,
          booking._id,
          session,
          req
        );
        if (sweepResults.length > 0) {
          auditLogMessage += ` Advance also auto-applied to ${sweepResults.length} other booking(s): ${sweepResults
            .map((s) => `#${s.appointmentId} (Rs.${s.amountApplied})`)
            .join(", ")}.`;
        }
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
          netAmount: amountToCollect,
          paymentMethod: paymentMethod || payment.paymentMethod || null,
          utr: payment.utr,
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

    // WhatsApp Notification if payment recorded and patient mobile exists
    if (paymentStatusChanged) {
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

      if (userPhone) {
        const { appointmentId } = booking;
        let amountForWhatsapp;
        if (paymentType === "partial") {
          amountForWhatsapp = payment.amountPaid < amountToCollect ? partialAmount : payment.amountPaid;
        } else {
          amountForWhatsapp = typeof remainingToPay !== "undefined"
            ? remainingToPay
            : amountToCollect;
        }

        let paymentStatusTxt =
          payment.status === "paid"
            ? "Full"
            : payment.status === "partiallypaid"
              ? "Partial"
              : payment.status;

        try {
          await WhatsappController.sendPaymentCollectedSuccessfully({
            destination: userPhone,
            userName,
            appointmentId,
            amount: String(amountForWhatsapp),
            paymentStatus: paymentStatusTxt,
            paymentMethod: paymentMethod || payment.paymentMethod || null,
            utr: payment.utr,
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
      wallet: await (async () => {
        const w = await Wallet.findOne({ patient: booking.patient?._id || booking.patient }).lean();
        return w ? { balance: w.balance } : { balance: 0 };
      })(),
      appliedToOtherBookings: typeof sweepResults !== "undefined" ? sweepResults : [],
      finance: Array.isArray(financeRecord) ? financeRecord[0] : financeRecord,
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


async checkIn(req, res) {
  const session = await Booking.startSession();
  session.startTransaction();

  let auditLogFailed = false;
  let auditLogError = null;
  try {
    const { bookingId, sessionId } = req.body;

    console.log("[checkIn] Incoming request body:", req.body);

    if (!bookingId || !sessionId) {
      console.log("[checkIn] Missing bookingId or sessionId", { bookingId, sessionId });
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "bookingId and sessionId are required."
      });
    }

    // Find the booking (attach the session/tx)
    console.log("[checkIn] Finding booking by ID:", bookingId);
    const booking = await Booking.findById(bookingId)
      .populate([
        { path: "patient", model: "PatientProfile", select: "userId name mobile1", populate: { path: "userId", model: "User", select: "name phone email" } },
        { path: "therapist", model: "TherapistProfile", select: "userId therapistId phoneNo", populate: { path: "userId", model: "User", select: "name phone email" } },
        { path: "sessions.therapist", model: "TherapistProfile", select: "userId therapistId phoneNo", populate: { path: "userId", model: "User", select: "name phone email" } }
      ])
      .session(session);

    if (!booking) {
      console.log("[checkIn] Booking not found.");
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Booking not found."
      });
    } else {
      console.log("[checkIn] Fetched booking:", booking._id);
    }

    // Find session index in the booking sessions array
    const sessionIndex = booking.sessions.findIndex(
      (sess) => String(sess._id) === String(sessionId)
    );
    console.log("[checkIn] Session index in booking.sessions:", sessionIndex);

    if (sessionIndex === -1) {
      console.log("[checkIn] Session not found in booking.");
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Session not found in this booking."
      });
    }



    // If already checked in for this session, return idempotent response
    if (booking.sessions[sessionIndex].isCheckedIn) {
      console.log("[checkIn] Session already checked in.");
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({
        success: true,
        message: "Children already checked in for this session.",
        booking
      });
    }

    const date = new Date();
    // Mark this session as checked in, set checkInTime and update status as "CheckedIn"
    booking.sessions[sessionIndex].isCheckedIn = true;
    booking.sessions[sessionIndex].status = "CheckedIn";
    booking.sessions[sessionIndex].checkInTime = date;
    console.log("[checkIn] Updating session status for sessionIndex:", sessionIndex);

    // ---- INVOICE UPDATE ----
    // Bill only for CheckedIn sessions. Rate = package.costPerSession * (1 - discount%).
    const pkgForInvoice = await Package.findById(booking.package).session(session);
    let discountPercent = 0;
    if (booking.discountInfo && booking.discountInfo.coupon) {
      const DiscountModel = (await import("../../Schema/discount.schema.js")).default;
      const couponDoc = await DiscountModel.findById(booking.discountInfo.coupon).session(session);
      if (couponDoc && typeof couponDoc.discount === "number") {
        discountPercent = couponDoc.discount;
      }
    }
    const perSessionRate = getPerSessionRate(pkgForInvoice, discountPercent);
    booking.invoiceAmount = (booking.invoiceAmount || 0) + perSessionRate;

    await booking.save({ session });

    // ---- WALLET AUTO-DEBIT ----
    // If the patient has wallet balance, silently apply it to cover this session's charge.
    let walletDebitApplied = 0;
    if (perSessionRate > 0 && booking.patient) {
      const patientIdForWallet = booking.patient._id || booking.patient;
      const { amountDebited } = await debitWallet(
        {
          patientId: patientIdForWallet,
          amount: perSessionRate,
          reason: "session_checkin_debit",
          booking: booking._id,
          sessionId: String(booking.sessions[sessionIndex]._id),
          remark: `Auto-applied for session check-in (${booking.appointmentId || booking._id})`,
        },
        session
      );
      walletDebitApplied = amountDebited;

      if (walletDebitApplied > 0 && booking.payment) {
        const Payment = (await import("../../Schema/payment.schema.js")).default;
        const paymentDoc = await Payment.findById(booking.payment).session(session);
        if (paymentDoc) {
          paymentDoc.amountPaid = (paymentDoc.amountPaid || 0) + walletDebitApplied;
          // Recompute status against the running invoice, not the whole package
          if (paymentDoc.amountPaid >= booking.invoiceAmount) {
            paymentDoc.status = paymentDoc.amountPaid >= paymentDoc.amount ? "paid" : "partiallypaid";
          } else {
            paymentDoc.status = "partiallypaid";
          }
          await paymentDoc.save({ session });
        }
      }
    }
    console.log("[checkIn] Invoice updated:", {
      invoiceAmount: booking.invoiceAmount,
      perSessionRate,
      walletDebitApplied,
    });
// ----------  ------
    // --- AUDIT LOG ---
    try {
      console.log("[checkIn] Writing audit log for check-in...");
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
      console.log("[checkIn] Audit log complete");
    } catch (err) {
      auditLogFailed = true;
      auditLogError = err;
      console.error("[checkIn] Error creating audit log:", err);
    }

    if (auditLogFailed) {
      console.log("[checkIn] Audit log failed. Aborting transaction.");
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
    console.log("[checkIn] Transaction committed and session ended.");

    // --- SEND WHATSAPP CHECK-IN NOTIFICATION ---
    // Make sure to send correct data to whatsapp (Children name, phone number, appointmentId, sessionId, checkIn time, therapist, etc.)
    try {
      console.log("[checkIn] Preparing to send WhatsApp check-in notification…");
      // Import WhatsappController only when needed to avoid cycles, or move to top if safe
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

      console.log("[checkIn] WhatsApp check-in notification sent for appointmentId:", booking.appointmentId || String(booking._id));
    } catch (wserr) {
      // WhatsApp send error should be logged but should not block check-in success
      console.error("[checkIn] Error sending WhatsApp session completed message:", wserr);
    }

    console.log("[checkIn] Success. Sending success response.");
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

/**
 * Mark a session as missed for a booking.
 * Expects: { bookingId, sessionId }
 * Only marks as missed if current status is NOT 'CheckedIn'.
 * Sets isCheckedIn = false and status = "Missed".
 */
async markSessionMissed(req, res) {
  const session = await Booking.startSession();
  session.startTransaction();
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
    const booking = await Booking.findById(bookingId).session(session);

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

    // Do NOT mark as missed if already checked-in
    if (
      booking.sessions[sessionIndex].status === "CheckedIn" ||
      booking.sessions[sessionIndex].isCheckedIn
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: "Session has already been checked in. Cannot mark as missed."
      });
    }

    // Mark as missed
    booking.sessions[sessionIndex].isCheckedIn = false;
    booking.sessions[sessionIndex].status = "Missed";
    await booking.save({ session });

    // Optionally: Add to audit log
    try {
      await AuditLogService.addLog({
        action: "SESSION_MARKED_MISSED",
        user: req.user && req.user.id ? req.user.id : null,
        role: "admin",
        resource: "Booking",
        resourceId: booking._id,
        details: {
          bookingId: booking._id,
          sessionId,
          markedMissedBy: req.user && req.user._id ? req.user._id : null,
          markedAt: new Date(),
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] || null,
      });
    } catch (err) {
      console.error("[markSessionMissed] Error creating audit log:", err);
      // If audit log fails, do not revert the change.
    }

    await session.commitTransaction();
    session.endSession();
    return res.json({
      success: true,
      message: "Session marked as missed successfully.",
      booking
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[markSessionMissed] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark session as missed.",
      error: error.message
    });
  }
}

// Mark a session as "Not Checked In" for a booking (undo "checked in" in a deliberate way)
async markSessionNotCheckedIn(req, res) {
  const session = await Booking.startSession();
  session.startTransaction();

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

    // If the session is already not checked in (no matter the previous status), return idempotent response
    if (
      booking.sessions[sessionIndex].isCheckedIn === false &&
      booking.sessions[sessionIndex].status === "NotCheckedIn"
    ) {
      await session.commitTransaction();
      session.endSession();
      return res.json({
        success: true,
        message: "Session is already not checked in.",
        booking
      });
    }

    // Mark as "Not Checked In" even if previous status was "Missed" or anything else
    // booking.sessions[sessionIndex].isCheckedIn = false;
    // booking.sessions[sessionIndex].status = "NotCheckedIn";
    // await booking.save({ session });

// --------------------

const wasCheckedIn = booking.sessions[sessionIndex].status === "CheckedIn";

    // Mark as "Not Checked In" even if previous status was "Missed" or anything else
    booking.sessions[sessionIndex].isCheckedIn = false;
    booking.sessions[sessionIndex].status = "NotCheckedIn";

    // ---- INVOICE + WALLET REVERSAL ----
    // Only reverse if it was actually CheckedIn before (Missed/NotCheckedIn never billed).
    if (wasCheckedIn) {
      const pkgForInvoice = await Package.findById(booking.package).session(session);
      let discountPercent = 0;
      if (booking.discountInfo && booking.discountInfo.coupon) {
        const DiscountModel = (await import("../../Schema/discount.schema.js")).default;
        const couponDoc = await DiscountModel.findById(booking.discountInfo.coupon).session(session);
        if (couponDoc && typeof couponDoc.discount === "number") {
          discountPercent = couponDoc.discount;
        }
      }
      const perSessionRate = getPerSessionRate(pkgForInvoice, discountPercent);
      booking.invoiceAmount = Math.max(0, (booking.invoiceAmount || 0) - perSessionRate);

      // Reverse any wallet debit that was auto-applied specifically for this session
      const patientIdForWallet = booking.patient?._id || booking.patient;
      const { wallet, txn } = await findCheckinDebitTransaction(
        patientIdForWallet,
        booking._id,
        String(booking.sessions[sessionIndex]._id),
        session
      );
      if (txn) {
        const { amountReversed } = await reverseCheckinDebit(wallet, txn, session);
        if (amountReversed > 0 && booking.payment) {
          const Payment = (await import("../../Schema/payment.schema.js")).default;
          const paymentDoc = await Payment.findById(booking.payment).session(session);
          if (paymentDoc) {
            paymentDoc.amountPaid = Math.max(0, (paymentDoc.amountPaid || 0) - amountReversed);
            paymentDoc.status = paymentDoc.amountPaid <= 0 ? "pending" : "partiallypaid";
            await paymentDoc.save({ session });
          }
        }
      }
    }

    await booking.save({ session });

// --------------------

    // Optionally log this action
    try {
      await AuditLogService.addLog({
        action: "SESSION_MARKED_NOT_CHECKED_IN",
        user: req.user && req.user.id ? req.user.id : null,
        role: "admin",
        resource: "Booking",
        resourceId: booking._id,
        details: {
          bookingId: booking._id,
          sessionId,
          markedNotCheckedInBy: req.user && req.user._id ? req.user._id : null,
          markedAt: new Date(),
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] || null,
      });
    } catch (err) {
      console.error("[markSessionNotCheckedIn] Error creating audit log:", err);
      // Do not revert transaction if logging fails
    }

    await session.commitTransaction();
    session.endSession();
    return res.json({
      success: true,
      message: "Session marked as not checked in successfully.",
      booking
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[markSessionNotCheckedIn] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark session as not checked in.",
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
    // Also ensure session._id is present in the bookingCopy.session
    const todaysBookings = [];
    rawBookings.forEach(booking => {
      if (Array.isArray(booking.sessions)) {
        booking.sessions.forEach(session => {
          if (session.date === todayStr) {
            const bookingCopy = { ...booking };
            delete bookingCopy.sessions;
            // Ensure session._id is present and send as sessionId for convenience
            bookingCopy.session = {
              ...session,
              _id: session._id, // send _id
              sessionId: session.sessionId || (session._id ? session._id.toString() : undefined) // fallback
            };
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
      date,             // Single day filter (YYYY-MM-DD)
      from,             // Start date (YYYY-MM-DD)
      to,               // End date (YYYY-MM-DD)
      therapistId,      // therapist._id as string
      patientId,        // patient._id as string
      therapyTypeId,    // therapyTypeId as string
      isCheckedIn,      // 'true', 'false', or undefined
      search,           // General search string
    } = req.query;

    // Build booking query level filters
    const bookingQuery = {};
    if (patientId) bookingQuery.Children = patientId;
    if (therapistId) bookingQuery.therapist = therapistId;

    // Fetch bookings with population
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
        path: "package",
        model: "Package",
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

    // Helper: date filter check (from/to inclusive)
    function isWithinRange(dateStr, fromStr, toStr) {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      const fromD = fromStr ? new Date(fromStr) : null;
      const toD = toStr ? new Date(toStr) : null;
      if (fromD && d < fromD) return false;
      if (toD && d > toD) return false;
      return true;
    }
    function safeString(v) { return (typeof v === "undefined" || v === null) ? "" : String(v); }

    // Compose normalized sessions array
    let sessions = [];
    for (const booking of bookings) {
      if (Array.isArray(booking.sessions)) {
        for (const session of booking.sessions) {
          // ---- Date Filtering ----
          // Single date priority, otherwise from-to
          if (date && session.date !== date) continue;
          if (!date) {
            if (from && !to && session.date < from) continue;
            if (to && !from && session.date > to) continue;
            if (from && to && !isWithinRange(session.date, from, to)) continue;
          }
          // ---- Session-level filtering ----
          if (therapistId && session.therapist && session.therapist._id?.toString() !== therapistId) continue;
          if (therapyTypeId && session.therapyTypeId && session.therapyTypeId._id?.toString() !== therapyTypeId) continue;
          if (typeof isCheckedIn !== "undefined") {
            if (isCheckedIn === "false" && session.isCheckedIn === true) continue;
            if (isCheckedIn === "true" && session.isCheckedIn !== true) continue;
          }

          // Extract data for search fields & output
          // Patient Name
          const patientName = safeString(booking.patient?.name);
          // Therapist Name: prefer session.therapist (populated) if present
          let therapistName = "";
          if (session.therapist && typeof session.therapist === "object") {
            // populated therapist on session
            therapistName =
              safeString(session.therapist.name) ||
              safeString(session.therapist.userId?.name) ||
              "";
          } else if (booking.therapist && typeof booking.therapist === "object") {
            therapistName =
              safeString(booking.therapist.name) ||
              safeString(booking.therapist.userId?.name) ||
              "";
          }

          // Therapy Name: prefer session's populated therapyTypeId if present
          let therapyName = "";
          if (session.therapyTypeId && typeof session.therapyTypeId === "object") {
            therapyName = safeString(session.therapyTypeId.name);
          } else if (booking.therapy && typeof booking.therapy === "object") {
            therapyName = safeString(booking.therapy.name);
          }

          // Session ID
          let sessionId = safeString(session.sessionId || session._id);

          // Time slot: prefer slotId for human label, fallback to timeSlot/time
          let timeSlot = "";
          if (session.slotId) timeSlot = safeString(session.slotId);
          else if (session.timeSlot) timeSlot = safeString(session.timeSlot);
          else if (session.time) timeSlot = safeString(session.time);

          // Compose output as per shape required
          sessions.push({
            bookingId: booking._id,
            appointmentId: safeString(booking.appointmentId),
            package: booking.package?._id ? booking.package._id : booking.package,
            patient: booking.patient,
            therapist: booking.therapist,
            therapy: session.therapyTypeId && typeof session.therapyTypeId === "object"
              ? { _id: session.therapyTypeId._id, name: session.therapyTypeId.name }
              : (booking.therapy && typeof booking.therapy === "object"
                  ? { _id: booking.therapy._id, name: booking.therapy.name }
                  : booking.therapy),
            session: {
              ...session,
              sessionId, // ensure sessionId on session object
            },
            searchFields: {
              sessionId,
              date: safeString(session.date),
              timeSlot: timeSlot,
              patient: patientName,
              therapist: therapistName,
              therapy: therapyName,
              appointmentId: safeString(booking.appointmentId),
            }
          });
        }
      }
    }

    // ---- Search Filtering (after flattening) ----
    let filteredSessions = sessions;
    if (search && search.trim() !== "") {
      const lower = search.trim().toLowerCase();
      filteredSessions = sessions.filter(({ searchFields }) => {
        return (
          safeString(searchFields.sessionId).toLowerCase().includes(lower) ||
          safeString(searchFields.date).toLowerCase().includes(lower) ||
          safeString(searchFields.timeSlot).toLowerCase().includes(lower) ||
          safeString(searchFields.patient).toLowerCase().includes(lower) ||
          safeString(searchFields.therapist).toLowerCase().includes(lower) ||
          safeString(searchFields.therapy).toLowerCase().includes(lower) ||
          safeString(searchFields.appointmentId).toLowerCase().includes(lower)
        );
      });
    }

    return res.json({
      success: true,
      date: date || null,
      from: from || null,
      to: to || null,
      search: search || null,
      sessions: filteredSessions
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
              patientId: booking.patient && booking.patient.patientId ? booking.patient.patientId : undefined,
              name: booking.patient && booking.patient.name ? booking.patient.name : undefined,
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
              bookingId:booking._id,
              appointmentId: booking.appointmentId,
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

