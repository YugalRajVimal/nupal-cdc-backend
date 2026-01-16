
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

// Utility to get next sequence for an allowed counter
const getNextSequence = async (name) => {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

// Given appointment sequence number, format appointmentId as APT000001 etc.
function generateAppointmentId(seq) {
  return 'APT' + seq.toString().padStart(6, '0');
}

const aavailabilitySlotsAdminController = new AavailabilitySlotsAdminController();

class BookingAdminController {
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
    const mongoose = (await import("mongoose")).default;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Import Payment model here (avoid circular require at top)

      const {
        coupon, // expects coupon to be an id or object with id (frontend should send this)
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
        bookingRequestId
      } = req.body;

      console.log("[CREATE BOOKING CHECK] Incoming body:", req.body);

      if (
        !packageId ||
        !patientId ||
        !therapyId ||
        !therapistId ||
        !Array.isArray(sessions) ||
        !sessions.length
      ) {
        console.log("[CREATE BOOKING CHECK] Missing required fields", {
          packageId, patientId, therapyId, therapistId, sessions
        });
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }

      // --- AVAILABILITY CHECK ACROSS ALL SESSIONS' therapistId (not just booking-level therapist) ---
      // Gather all unique therapistIds from sessions
      const therapistIdsForSessions = Array.from(
        new Set((sessions || []).map(sess => sess.therapistId || therapistId))
      );

      // Fetch all therapist profiles needed for mapping therapistId (ObjectId) to therapistRefId (short id, e.g., "NPL001")
      const therapistProfiles = await TherapistProfile.find({
        _id: { $in: therapistIdsForSessions }
      }).lean();

      // Build map of ObjectId (as string) -> therapistRefId
      const therapistIdToRefIdMap = {};
      therapistProfiles.forEach(tp => {
        therapistIdToRefIdMap[tp._id.toString()] = tp.therapistId;
      });

      // Validate all session therapist refs exist
      if (Object.keys(therapistIdToRefIdMap).length !== therapistIdsForSessions.length) {
        console.log(
          "[BOOKING AVAILABILITY CHECK] One or more therapistIds in sessions not found:",
          therapistIdsForSessions,
          "Known:",
          Object.keys(therapistIdToRefIdMap)
        );
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "One or more therapist(s) referenced in sessions do not exist."
        });
      }

      // Prepare requestedSlots for availability check per session therapist
      const requestedSlots = (sessions || []).map(sess => ({
        date: sess.date,
        slotId: sess.slotId || sess.id,
        therapistId: sess.therapistId || therapistId, // fallback to booking-level for API compatibility
      }));

      // Validate slot data
      if (requestedSlots.some(s => !s.date || !s.slotId || !s.therapistId)) {
        console.log("[CREATE BOOKING CHECK] Invalid session data. Each session needs date, slotId/id and therapistId.", requestedSlots);
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid session data: All sessions must have date, slotId/id, and therapistId."
        });
      }

      // Sort session dates for range query
      let sessionDates = requestedSlots.map(s => s.date).sort();
      const fromDate = sessionDates[0];
      const toDate = sessionDates[sessionDates.length - 1];

      // For multi-therapist, call getAvailabilitySummary for each unique therapistId
      // We'll merge all slotAvailabilityData for all therapist refs
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
          // Compose into allSlotAvailabilityData: structure will be { therapistRefId: { <date keys>: {...} } }
          const therapistRefId = therapistIdToRefIdMap[uniqueTherapistId];
          allSlotAvailabilityData[therapistRefId] = availabilitySummaryResult.data;
        } catch (err) {
          console.error(`[BOOKING CREATE] Failed availabilitySummary call for therapist ${uniqueTherapistId}:`, err);
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({
            success: false,
            message: `Failed to check slot availability for one or more therapists.`,
            error: err.message,
          });
        }
      }

      // Log full availability data
      console.log("[BOOKING AVAILABILITY CHECK] allSlotAvailabilityData:");
      console.dir(allSlotAvailabilityData, { depth: 10 });

      // Now, for each session, check with its therapistId
      let conflicts = [];

      requestedSlots.forEach(sess => {
        const refId = therapistIdToRefIdMap[sess.therapistId];
        const slotAvailabilityData = allSlotAvailabilityData[refId];
        if (!slotAvailabilityData) return; // Defensive: skip if unavailable

        for (const availKey in slotAvailabilityData) {
          // Try to match YYYY-MM-DD to DD-MM-YYYY
          const [d, m, y] = availKey.split('-');
          const keyAsIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          if (
            sess.date === keyAsIso &&
            slotAvailabilityData[availKey]?.BookedSlots &&
            slotAvailabilityData[availKey].BookedSlots[refId] &&
            Array.isArray(slotAvailabilityData[availKey].BookedSlots[refId]) &&
            slotAvailabilityData[availKey].BookedSlots[refId].includes(sess.slotId)
          ) {
            console.log(`[BOOKING AVAILABILITY CHECK] Conflict detected: therapist=${sess.therapistId} (${refId}) on ${sess.date} slotId=${sess.slotId}. BookedSlots[${refId}]=`, slotAvailabilityData[availKey].BookedSlots[refId]);
            conflicts.push({
              date: sess.date,
              slotId: sess.slotId,
              therapistId: sess.therapistId
            });
          }
        }
      });

      if (conflicts.length > 0) {
        console.log("[BOOKING CREATE] Slot conflicts detected. Cannot book. Conflicts:", conflicts);
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          success: false,
          message: "Selected therapist/time slot already booked for one or more session dates.",
          conflicts,
          allSlotAvailabilityData
        });
      } else {
        console.log("[BOOKING AVAILABILITY CHECK] All requested slots are available, proceeding with booking.");
      }

      // -------------------------------------------------------------------------

      // Save only coupon id and the timestamp (if given); ignore the rest
      let discountInfo = undefined;
      if (coupon && coupon.id) {
        discountInfo = {
          coupon: coupon.id,
          time: new Date()
        };
        console.log("[CREATE BOOKING CHECK] Coupon is object with id. Set discountInfo:", discountInfo);
      } else if (typeof coupon === "string" && coupon) {
        discountInfo = {
          coupon: coupon,
          time: new Date()
        };
        console.log("[CREATE BOOKING CHECK] Coupon is string. Set discountInfo:", discountInfo);
      } else {
        console.log("[CREATE BOOKING CHECK] No coupon or invalid coupon info.");
      }

      // Generate new appointmentId inside transaction
      const counter = await Counter.findOneAndUpdate(
        { name: "appointment" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
      );
      const appointmentId = generateAppointmentId(counter.seq);
      console.log("[CREATE BOOKING CHECK] Generated appointmentId:", appointmentId);

      // --- Create default payment ---
      const pkg = await Package.findById(packageId).lean();
      if (!pkg) {
        console.log("[CREATE BOOKING CHECK] Invalid packageId:", packageId);
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid package"
        });
      }

      // Generate Payment ID: INV-YYYY-00001
      const year = new Date().getFullYear();
      const paymentCounter = await Counter.findOneAndUpdate(
        { name: "payment" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
      );
      const paymentId = `INV-${year}-${String(paymentCounter.seq).padStart(5, "0")}`;
      console.log("[CREATE BOOKING CHECK] Generated paymentId:", paymentId);

      // Default payment details (amount: pkg.price, status: 'pending')
      const paymentDoc = new Payment({
        paymentId: paymentId,
        totalAmount: pkg.totalCost,
        amount: pkg.totalCost,
        status: 'pending',
        paymentMethod: 'cash' // default; update later in payment flow
      });
      await paymentDoc.save({ session });
      console.log("[CREATE BOOKING CHECK] Saved paymentDoc:", paymentDoc);

      // --- Normalize/structure sessions array per booking.schema.js ---
      // Each session must be: { date: String, time: String, slotId: String, therapist: ObjectId, therapyTypeId: ObjectId, isCheckedIn: Boolean }
      // Accept possible legacy/variant keys but ensure correct structure before saving to db

      const normalizedSessions = (sessions || []).map(sess => {
        // Accept possible variants, but conform to schema here
        return {
          date: sess.date,
          time: sess.time || "",
          slotId: sess.slotId || sess.id, // fallback to legacy id
          therapist: sess.therapistId || therapistId, // always required
          therapyTypeId: sess.therapyTypeId || sess.therapyType || null,
          isCheckedIn: typeof sess.isCheckedIn !== "undefined" ? sess.isCheckedIn : false
        };
      });

      // Compose booking payload per updated schema (1-68)
      const bookingPayload = {
        appointmentId,
        status,
        notes,
        discountInfo,
        package: packageId,
        patient: patientId,
        therapist: therapistId,
        sessions: normalizedSessions, // use normalized sessions
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

      // Add logging for bookingPayload
      console.log("[CREATE BOOKING CHECK] bookingPayload before cleanup:", bookingPayload);

      Object.keys(bookingPayload).forEach(
        k => bookingPayload[k] === undefined && delete bookingPayload[k]
      );

      console.log("[CREATE BOOKING CHECK] bookingPayload after cleanup:", bookingPayload);

      const booking = new Booking(bookingPayload);

      await booking.save({ session });
      console.log("[CREATE BOOKING CHECK] Booking saved. _id:", booking._id);

      // If this booking is for a booking request, update its status to approved
      if (isBookingRequest && bookingRequestId) {
        // Import BookingRequests model here (to avoid circular require)
        console.log("449", bookingRequestId);

        // Dynamically import the BookingRequests model (to avoid circular dependencies)
        const bookingRequestDoc = await BookingRequests.findById(bookingRequestId).session(session);
        if (bookingRequestDoc) {
          bookingRequestDoc.status = "approved";
          bookingRequestDoc.appointmentId = booking._id;
          await bookingRequestDoc.save({ session });
          console.log("458", bookingRequestDoc);

          console.log(`[CREATE BOOKING CHECK] BookingRequest ${bookingRequestId} updated to approved and linked to booking ${booking._id}`);
        } else {
          console.warn(`[CREATE BOOKING CHECK] bookingRequestId ${bookingRequestId} not found for approval update.`);
        }
      }

      await session.commitTransaction();
      session.endSession();

      // Populate all booking fields for return
      const populatedBooking = await Booking.findById(booking._id)
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
        .populate({ path: "therapist", model: "TherapistProfile" })
        .populate({ path: "payment", model: "Payment" });

      console.log("[CREATE BOOKING CHECK] Final populatedBooking:", populatedBooking);

      res.status(201).json({
        success: true,
        booking: populatedBooking,
      });
    } catch (error) {
      console.log("[CREATE BOOKING CHECK] Error encountered:", error);
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
  async getAllBookings(req, res) {
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
          path: "payment",
          model: "Payment"
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
          path: "sessions.therapist",
          model: "TherapistProfile",
          populate: {
            path: "userId",
            model: "User"
          }
        })
        .populate({
          path: "sessions.therapyTypeId",
          model: "TherapyType"
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

  // Update booking with updated booking schema (1-47)
  async updateBooking(req, res) {
    const mongoose = (await import("mongoose")).default;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
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
      } = req.body;

      console.log(sessions);

      // Validate required fields
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
          message: "Missing required fields"
        });
      }

      // Ensure booking exists
      const prevBooking = await Booking.findById(id).lean();
      if (!prevBooking) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "Booking not found.",
        });
      }

      // Prepare requested slots (include therapist mapping for each slot!)
      const requestedSlots = (sessions || []).map(sess => {
        let therapistValue =
          sess.therapist ||
          sess.therapistId ||
          bodyTherapist ||
          prevBooking.therapist;
        // Extract _id if populated object
        if (therapistValue && typeof therapistValue === "object" && therapistValue._id) {
          therapistValue = therapistValue._id;
        }
        return {
          date: sess.date,
          slotId: sess.slotId || sess.id,
          therapist: therapistValue
        };
      });

      if (requestedSlots.some(s => !s.date || !s.slotId || !s.therapist)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid session data: Each session must have date, slotId, and therapist."
        });
      }

      // For each involved therapist, check their slots in relevant date range, just like in createBooking.
      const therapistToDates = {};
      requestedSlots.forEach(({ date, therapist }) => {
        const key = String(therapist);
        if (!therapistToDates[key]) therapistToDates[key] = new Set();
        therapistToDates[key].add(date);
      });

      // Collect all needed therapist docs so we can get readable .therapistId
      const uniqueTherapistIds = Array.from(
        new Set(requestedSlots.map(r => String(r.therapist)))
      );
      const therapistDocs = await TherapistProfile.find({
        _id: { $in: uniqueTherapistIds }
      }).lean();

      const therapistIdMap = {};
      therapistDocs.forEach(tDoc => {
        therapistIdMap[String(tDoc._id)] = tDoc.therapistId; // may be undefined but that's ok
      });

      // --- Check slot availability for all sessions ---
      let slotAvailabilityDataCacheByTherapist = {};
      let conflicts = [];

      for (const therapistObjId of uniqueTherapistIds) {
        const dates = Array.from(therapistToDates[therapistObjId] || []);
        if (!dates.length) continue;
        const sortedDates = dates.slice().sort();
        const fromDate = sortedDates[0];
        const toDate = sortedDates[sortedDates.length - 1];

        // Call getAvailabilitySummary of slots controller for this therapist
        let slotAvailabilityResult;
        let therapistRefId = therapistIdMap[therapistObjId];
        try {
          let fakeReq = {
            query: {
              therapistId: String(therapistObjId),
              from: fromDate,
              to: toDate
            }
          };
          slotAvailabilityResult = await new Promise((resolve, reject) => {
            aavailabilitySlotsAdminController.getAvailabilitySummary(
              fakeReq,
              {
                json: body => resolve(body),
                status: code => ({
                  json: body => {
                    body.__status = code;
                    resolve(body);
                  }
                })
              }
            );
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
        if (!slotAvailabilityResult || !slotAvailabilityResult.success || !slotAvailabilityResult.data) {
          await session.abortTransaction();
          session.endSession();
          return res.status(409).json({
            success: false,
            message: "Could not fetch therapist's slot availability for update request."
          });
        }
        slotAvailabilityDataCacheByTherapist[therapistObjId] = slotAvailabilityResult.data;

        // Now check for each session for this therapist
        const refId = therapistRefId;
        const slotAvailabilityData = slotAvailabilityResult.data;

        // Only consider new sessions (not ones present in the previous booking with same therapist, date, slotId)
        requestedSlots
          .filter(s => String(s.therapist) === String(therapistObjId))
          .forEach(sess => {
            const alreadyHad =
              Array.isArray(prevBooking.sessions) &&
              prevBooking.sessions.some(
                ps =>
                  String(ps.date) === String(sess.date) &&
                  String(ps.slotId || ps.id) === String(sess.slotId) &&
                  String(ps.therapist || ps.therapistId) === String(sess.therapist)
              );
            if (alreadyHad) return;
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
                  therapist: sess.therapist
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
          message: "Selected therapist/time slot already booked for one or more session dates.",
          conflicts,
        });
      }

      // If all slots clear, proceed with update.
      // Properly build updatedSessions with therapist and therapyType (like createBooking body)
      let updatedSessions = Array.isArray(sessions)
        ? sessions.map(s => {
            let therapistValue =
              s.therapist ||
              s.therapistId ||
              bodyTherapist ||
              prevBooking.therapist;
            if (therapistValue && typeof therapistValue === "object" && therapistValue._id) {
              therapistValue = therapistValue._id;
            }
            // Also populate therapistId (ref code) if available, fallback to empty string if not found
            let therapistIdField = therapistIdMap[String(therapistValue)] || "";

            // For therapyTypeId: populate per-session as required by schema
            // Per @booking.schema.js, this should be "therapyTypeId"
            // - Use: s.therapyTypeId || s.therapyType || therapyId

            let therapyTypeIdValue = s.therapyTypeId || s.therapyType || therapyId; // fallback to global therapy

            return {
              date: s.date,
              slotId: s.slotId || s.id,
              therapist: therapistValue,
              therapistId: therapistIdField, // extra, safe
              therapyTypeId: therapyTypeIdValue, // correct per schema
              ...(s.time && { time: s.time }),
              ...(s.isCheckedIn !== undefined && { isCheckedIn: s.isCheckedIn }),
            };
          })
        : [];

      console.log("--",updatedSessions);

      // Build sets (date|slotId|therapist) for accurate therapist-based slot management
      const sessionKey = (s) =>
        `${s.date}|${s.slotId}|${String(
          typeof s.therapist === "object" && s.therapist?._id
            ? s.therapist._id
            : s.therapist || ""
        )}`;
      const prevSessions = Array.isArray(prevBooking.sessions)
        ? prevBooking.sessions.filter(
            s =>
              s &&
              typeof s.slotId === "string" &&
              s.slotId.trim().length > 0 &&
              typeof s.date === "string"
          )
        : [];
      const nextSessions = updatedSessions.filter(
        s =>
          s &&
          typeof s.slotId === "string" &&
          s.slotId.trim().length > 0 &&
          typeof s.date === "string"
      );

      const prevKeys = new Set(prevSessions.map(sessionKey));
      const nextKeys = new Set(nextSessions.map(sessionKey));

      // To decrement: sessions in prev, but not in next
      const sessionsToDecrement = prevSessions.filter(
        s => !nextKeys.has(sessionKey(s))
      );
      // To increment: sessions in next, but not in prev
      const sessionsToIncrement = nextSessions.filter(
        s => !prevKeys.has(sessionKey(s))
      );

      // Optionally update availability
      // if (sessionsToDecrement.length > 0) await this.adjustAvailabilityCounts(sessionsToDecrement, -1);
      // if (sessionsToIncrement.length > 0) await this.adjustAvailabilityCounts(sessionsToIncrement, 1);

      // Save only coupon id and the timestamp (if given); ignore the rest
      let discountInfo = undefined;
      if (coupon) {
        discountInfo = {
          coupon: coupon.id || coupon._id || coupon,
          time: new Date()
        };
      }

      // Updated booking fields as per schema (make sure sessions have the required therapist and therapyTypeId)
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
        followupDate
      };
      Object.keys(updatePayload).forEach(
        k => updatePayload[k] === undefined && delete updatePayload[k]
      );

      const booking = await Booking.findByIdAndUpdate(id, updatePayload, { new: true })
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
          model: "TherapistProfile"
        })
        .populate({
          path: "payment",
          model: "Payment"
        });

      if (!booking) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "Booking not found.",
        });
      }

      await session.commitTransaction();
      session.endSession();

      res.json({
        success: true,
        booking,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("[updateBooking] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update booking.",
        error: error.message,
      });
    }
  }

  // Delete booking and return result
  async deleteBooking(req, res) {
    try {
      const { id } = req.params;
      const booking = await Booking.findById(id);
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found.",
        });
      }

      if (Array.isArray(booking.sessions)) {
        const validSessions = booking.sessions.filter(
          s => s && typeof s.slotId === "string" && s.slotId.trim().length > 0 && typeof s.date === "string"
        );
        if (validSessions.length > 0) {
          await this.adjustAvailabilityCounts(validSessions, -1);
        } else {
          console.warn("[deleteBooking] No valid sessions with slotId found for decrement!", booking.sessions);
        }
      }

      await Booking.findByIdAndDelete(id);

      res.json({
        success: true,
        message: "Booking deleted successfully.",
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to delete booking.",
        error: error.message,
      });
    }
  }

  // Get all booking requests (admin) from BookingRequests schema/model, now including appointmentId population
  async getAllBookingRequests(req, res) {
    try {
      // Fetch all booking requests with all relations populated
      const bookingRequests = await BookingRequests.find({})
        .populate([
          { path: "patient", select: "name patientId phoneNo userId mobile1 email", model: "PatientProfile", populate: { path: "userId", model: "User", select: "name email" } },
          { path: "therapy", select: "name", model: "TherapyType" },
          { path: "package", select: "name totalSessions sessionCount costPerSession totalCost", model: "Package" },
          { path: "appointmentId", select: "appointmentId patient therapy package sessions", model: "Booking" }
        ]);

      res.json({
        success: true,
        bookingRequests
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

  // Reject a booking request (admin action)
  async rejectBookingRequest(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, message: "Booking request ID required." });
      }

      // Optionally: only allow rejection if not already rejected/handled
      const bookingRequest = await BookingRequests.findById(id);
      if (!bookingRequest) {
        return res.status(404).json({ success: false, message: "Booking request not found." });
      }

      if (bookingRequest.status === "rejected") {
        return res.status(400).json({ success: false, message: "Booking request already rejected." });
      }
      if (bookingRequest.status === "approved") {
        return res.status(400).json({ success: false, message: "Booking request already approved. Cannot reject." });
      }

      bookingRequest.status = "rejected";
      await bookingRequest.save();

      res.json({ success: true, message: "Booking request rejected successfully." });
    } catch (error) {
      console.error("[rejectBookingRequest] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to reject booking request.",
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
    // Populate appointmentId (Booking), also support populating user/child if needed for admin display
    // Using the SessionEditRequest model to query session edit requests.
    // For each SessionEditRequest, the appointmentId field references the Booking model.
    // Booking model fields: patient (Patient model), therapy (Therapy model), package (Package model), sessions, appointmentId.
    // See nupal-cdc-software-backend/Schema/booking.schema.js for model field structure.
    const editRequests = await SessionEditRequest.find()
      .sort({ createdAt: -1 })
      .populate({
        path: 'appointmentId', // This references the Booking model
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
        select: 'patient therapy appointmentId sessions'
      })
      .lean();

      console.log(editRequests);

    res.json({
      success: true,
      editRequests
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

/**
 * Mark payment collection details for a booking.
 * Expects: { payment } in req.body
 * Params: booking id in req.params.id
 */
async collectPayment(req, res) {
  const session = await Booking.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;

    if (!id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Booking ID required."
      });
    }

    // Find and update the booking's payment info and mark as paid
    const booking = await Booking.findById(id).session(session);
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

    // Fetch the payment by paymentId field (may be ObjectId or string)
    const payment = await Payment.findOne({ _id: paymentId }).session(session);

    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Associated payment not found."
      });
    }

    // Mark payment as paid and set paymentTime
    payment.status = "paid";
    payment.paymentTime = new Date();
    await payment.save({ session });

    // Optionally update booking status as well (and link the payment)
    booking.paymentStatus = "paid";
    await booking.save({ session });

    // Record this payment as an income in the finances table
    // Avoid duplicate finance records for the same payment by checking for it
    const financeExists = await Finances.findOne({
      description: { $regex: `Payment for Booking #${booking.appointmentId}`, $options: "i" }
    }).session(session);

    let financeRecord = null;
    if (!financeExists) {
      financeRecord = await Finances.create([{
        date: payment.paymentTime || new Date(),
        description: `Payment for Booking #${booking.appointmentId}`,
        type: "income",
        amount: payment.amount,
        creditDebitStatus: "credited",
      }], { session });
    }

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: "Payment recorded successfully.",
      booking,
      payment,
      finance: financeRecord ? financeRecord[0] : financeExists
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

// Check-in a patient for a booking
async checkIn(req, res) {
  try {
    const { bookingId, sessionId } = req.body;

    if (!bookingId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: "bookingId and sessionId are required."
      });
    }

    // Find the booking
    const booking = await Booking.findById(bookingId);
    if (!booking) {
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
      return res.status(404).json({
        success: false,
        message: "Session not found in this booking."
      });
    }

    // If already checked in for this session, return idempotent response
    if (booking.sessions[sessionIndex].isCheckedIn) {
      return res.status(200).json({
        success: true,
        message: "Patient already checked in for this session.",
        booking
      });
    }

    // Mark this session as checked in
    booking.sessions[sessionIndex].isCheckedIn = true;
    await booking.save();

    res.json({
      success: true,
      message: "Patient checked in successfully for this session.",
      booking
    });
  } catch (error) {
    console.error("[checkIn] Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check in patient.",
      error: error.message
    });
  }
}

async getReceptionDeskDetails(req, res) {
  try {
    // Get today's date as YYYY-MM-DD format
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;

    // Get Today's Bookings: those with at least one session whose date == today
    const todaysBookings = await Booking.find({
      "sessions.date": todayStr
    })
      .populate({ path: "patient", model: "PatientProfile", select: "name patientId mobile gender" })
      .populate({ path: "therapist", model: "TherapistProfile", select: "name therapistId" })
      .populate({ path: "package", model: "Package" })
      .populate({ path: "therapy", model: "TherapyType" })
      .populate({ path: "payment", model: "Payment" })
      // Populate each session's therapist with userId and name
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
      .lean();

    // Get Pending Payment Bookings: those with no payment or incomplete payment
    const pendingPaymentBookings = await Booking.find({})
      .populate({ path: "patient", model: "PatientProfile", select: "name patientId mobile gender" })
      .populate({ path: "therapist", model: "TherapistProfile", select: "name" })
      .populate({ path: "package", model: "Package" })
      .populate({ path: "therapy", model: "TherapyType" })
      .populate({ path: "payment", model: "Payment" })  // Populate payment to check its status
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

    // Use filteredPendingPaymentBookings as pending payments

    res.json({
      success: true,
      today: todayStr,
      todaysBookings,
      pendingPaymentBookings:filteredPendingPaymentBookings,
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

// getOverview - Admin dashboard summary endpoint

// Assumes necessary mongoose models: User, TherapistProfile, PatientProfile, Booking, BookingRequest, SessionEditRequest, Task, etc.
// Imports are to be placed at top-level, but omitted here as per instructions.

async getOverview(req, res) {
  try {
    // 1. Active Children (patients)
    // - User: role = "patient", status = "active"
    // - PatientProfile: not deleted, not suspended (assuming possible status fields)
    const [activePatients, activeTherapists, allBookings, todayBookings, pendingPayments, pendingTasks, pendingBookingRequests, pendingSessionEditRequests] =
      await Promise.all([
        // Active Children
        (async () => {
          // Find all active patient users
          const activePatientUsers = await User.find({ role: "patient", status: "active" }, { _id: 1 });
          const activePatientUserIds = activePatientUsers.map(u => u._id);
          // Count PatientProfiles where userId in these active ids
          return PatientProfile.countDocuments({ userId: { $in: activePatientUserIds } });
        })(),
        // Active Therapists
        User.countDocuments({ role: "therapist", status: "active", isDisabled: { $ne: true } }),
        // All Bookings (for total/pending appointments)
        Booking.find({})
          .populate({ path: "patient", model: "PatientProfile", select: "name patientId mobile gender" })
          .populate({ path: "therapist", model: "TherapistProfile", select: "name" })
          .populate({ path: "package", model: "Package" })
          .populate({ path: "therapy", model: "TherapyType" })
          .populate({ path: "payment", model: "Payment" })  // to check payment status
          .lean(),
        // Bookings for Today
        (async () => {
          // Filter bookings with at least one session for today
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
            .lean();
          return bookings;
        })(),
        // Pending Payments
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
        // Pending Tasks (if Task schema exists and has "pending" status)
        // Correct lead count: Only count "pending" leads that are not "converted" or "visitFinalized" is not "yes"
        (typeof Lead !== "undefined"
          ? Lead.countDocuments({ status: "pending", $or: [ { visitFinalized: { $ne: "yes" } }, { status: { $ne: "converted" } } ] })
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
      ]);

    // 2. Appointments: Pending, Done, etc.

    // Total Pending Appointments: Bookings with at least one session in future and session.status = "pending"
    const now = new Date();
    function sessionIsPending(sess) {
      return (sess.status === "pending" || !sess.status)
        && sess.date && new Date(sess.date) >= now;
    }
    let totalPendingAppointments = 0;
    let totalBookedAppointments = 0;
    let totalAppointments = allBookings.length;

    allBookings.forEach(bk => {
      if (Array.isArray(bk.sessions) && bk.sessions.some(sessionIsPending)) {
        totalPendingAppointments++;
      }
      if (Array.isArray(bk.sessions)) {
        totalBookedAppointments += bk.sessions.length;
      }
    });

    // Today's Appointments
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayISO = `${yyyy}-${mm}-${dd}`;
    let todaysTotalAppointments = 0;
    let todaysPendingAppointments = 0;
    let todaysDoneAppointments = 0;
    todayBookings.forEach(bk => {
      if (!Array.isArray(bk.sessions)) return;
      // Only sessions for today
      bk.sessions.forEach(sess => {
        if (sess.date === todayISO) {
          todaysTotalAppointments++;
          // Treat isCheckedIs true as done
          if (sess.isCheckedIn === true || sess.status === "done" || sess.status === "completed") {
            todaysDoneAppointments++;
          } else {
            // Count not done as pending (including "pending"/"approved"/""/missing)
            todaysPendingAppointments++;
          }
        }
      });
    });

    // 3. Pending Payments count
    const pendingPaymentsCount = pendingPayments.length;

    // 4. Pending Tasks count
    // Already resolved as pendingTasks

    // 5. Pending Booking Requests count
    // Already resolved as pendingBookingRequests

    // 6. Pending Session Edit Requests count
    // Already resolved as pendingSessionEditRequests

    res.json({
      success: true,
      data: {
        activeChildren: activePatients,
        activeTherapists: activeTherapists,
        totalPendingAppointments,
        todaysTotalAppointments,
        todaysPendingAppointments,
        todaysDoneAppointments,
        pendingPayments: pendingPaymentsCount,
        pendingTasks,
        pendingBookingRequests,
        pendingSessionEditRequests
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

  // Fetch all bookings, then for all sessions, match with therapist, and respond with appointmentId, patient, therapyType, this therapist's session details
  // Fully populate inside each session's therapist and therapyType (which means .populate inside each session array)
  async getFullCalendar(req, res) {
    try {
      // Fetch all bookings with all necessary patient info
      const bookings = await Booking.find({})
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

      let allSessions = [];

      bookings.forEach(booking => {
        if (Array.isArray(booking.sessions)) {
          booking.sessions.forEach(session => {
            // Patient minimal info
            let patientInfo = {
              patientId: booking.patient && booking.patient.patientId ? booking.patient.patientId : undefined,
              name: (booking.patient && booking.patient.name)
                ? booking.patient.name
                : undefined,
            };

            // Get the populated therapy type
            let therapyTypePopulated = null;
            if (session.therapyTypeId && session.therapyTypeId._id && session.therapyTypeId.name) {
              therapyTypePopulated = {
                _id: session.therapyTypeId._id,
                name: session.therapyTypeId.name
              };
            } else if (booking.therapy && booking.therapy._id && booking.therapy.name) {
              therapyTypePopulated = {
                _id: booking.therapy._id,
                name: booking.therapy.name
              };
            }

            // Get the populated therapist info for the session
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
              // therapyType: therapyTypePopulated,
              session: session,
              therapist: therapistPopulated
            });
          });
        }
      });

      res.json({ success: true, data: allSessions });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }






}

export default BookingAdminController;

