
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

      // Add check logs
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

      // ---------- AVAILABILITY CHECK USING aavailabilitySlotsAdminController ----------
      // Dynamically import controller & function

      // Fetch therapist to get their .therapistId for mapping with BookedSlots in availability data
      const therapistDoc = await TherapistProfile.findById(therapistId).lean();
      if (!therapistDoc) {
        console.log("[BOOKING AVAILABILITY CHECK] Therapist not found:", therapistId);
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid therapist"
        });
      }
      // therapistDoc.therapistId (example: "NPL001")
      const therapistRefId = therapistDoc.therapistId;
      console.log("[BOOKING AVAILABILITY CHECK] Resolved therapist.therapistId:", therapistRefId);

      // Prepare slot queries
      const requestedSlots = (sessions || []).map(sess => ({
        date: sess.date,
        slotId: sess.slotId || sess.id // Use slotId or fallback to id
      }));

      // Validate slot data
      if (requestedSlots.some(s => !s.date || !s.slotId)) {
        console.log("[CREATE BOOKING CHECK] Invalid session data. Each session needs date and slotId/id.", requestedSlots);
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid session data: All sessions must have date and slotId/id."
        });
      }

      // Sort session dates
      let sessionDates = requestedSlots.map(s => s.date).sort();
      const fromDate = sessionDates[0];
      const toDate = sessionDates[sessionDates.length - 1];

      console.log(
        `[BOOKING AVAILABILITY CHECK] Checking slots for therapistId _id=${therapistId} therapistId=${therapistRefId} from ${fromDate} to ${toDate}`,
        "Requested slots:",
        JSON.stringify(requestedSlots)
      );

      // Call getAvailabilitySummary from controller using fake req/res
      let availabilitySummaryResult = null;
      try {
        let fakeReq = {
          query: {
            therapistId: String(therapistId),
            from: fromDate,
            to: toDate,
          }
        };
        // Fake response object for Promise handoff
        availabilitySummaryResult = await new Promise((resolve, reject) => {
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
        console.log("[BOOKING AVAILABILITY CHECK] Availability summary result:", JSON.stringify(availabilitySummaryResult));
      } catch (err) {
        console.error("[BOOKING CREATE] Failed availabilitySummary call:", err);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          success: false,
          message: "Failed to check slot availability.",
          error: err.message,
        });
      }

      // Check and validate availability response
      if (
        !availabilitySummaryResult ||
        !availabilitySummaryResult.success ||
        !availabilitySummaryResult.data
      ) {
        console.log("[BOOKING AVAILABILITY CHECK] Invalid availability summary result:", availabilitySummaryResult);
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({
          success: false,
          message: "Could not fetch therapist's slot availability for booking request."
        });
      }

      // Process slotAvailabilityData, console.log it clearly
      const slotAvailabilityData = availabilitySummaryResult.data;
      console.log("[BOOKING AVAILABILITY CHECK] slotAvailabilityData:");
      console.dir(slotAvailabilityData, { depth: 10 });

      // Conflict detection based on BookedSlots, using therapist.therapistId (not ObjectId!)
      let conflicts = [];

      requestedSlots.forEach(sess => {
        // The slotAvailabilityData keys are e.g. "19-01-2026"
        for (const availKey in slotAvailabilityData) {
          // Try to match YYYY-MM-DD to DD-MM-YYYY
          const [d, m, y] = availKey.split('-');
          const keyAsIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
          // Properly check using therapistRefId in BookedSlots
          if (
            sess.date === keyAsIso &&
            slotAvailabilityData[availKey]?.BookedSlots &&
            slotAvailabilityData[availKey].BookedSlots[therapistRefId] &&
            Array.isArray(slotAvailabilityData[availKey].BookedSlots[therapistRefId]) &&
            slotAvailabilityData[availKey].BookedSlots[therapistRefId].includes(sess.slotId)
          ) {
            console.log(`[BOOKING AVAILABILITY CHECK] Conflict detected: therapist=${therapistId} (${therapistRefId}) on ${sess.date} slotId=${sess.slotId}. BookedSlots[${therapistRefId}]=`, slotAvailabilityData[availKey].BookedSlots[therapistRefId]);
            conflicts.push({
              date: sess.date,
              slotId: sess.slotId
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
          slotAvailabilityData
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
      // Fetch package info to get price or set amount
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
      // Use a separate "payment" counter
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

      // ---- Ensure all session objects in sessions[] have the correct therapist set (both therapist _id and therapistId/therapistRefId field) ----
      // Add both therapist and therapistId to each session
      const sessionsWithTherapist = (sessions || []).map(sessionObj => ({
        ...sessionObj,
        therapist: therapistId,
        therapistId: therapistRefId // Add the readable/short id as well
      }));

      // Compose booking payload per updated schema (1-47)
      const bookingPayload = {
        appointmentId,
        status,
        notes,
        discountInfo,
        package: packageId,
        patient: patientId,
        therapist: therapistId,
        sessions: sessionsWithTherapist, // Always ensure therapist is set on all sessions
        therapy: therapyId,
        payment: paymentDoc._id, // Store the new payment doc ID
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
        console.log(bookingRequestId);

        // Dynamically import the BookingRequests model (to avoid circular dependencies)
        const bookingRequestDoc = await BookingRequests.findById(bookingRequestId).session(session);
        if (bookingRequestDoc) {
          bookingRequestDoc.status = "approved";
          // Optionally: Link the created booking to the bookingRequest (many UIs expect this)
          bookingRequestDoc.appointmentId = booking._id;
          await bookingRequestDoc.save({ session });
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

      // Determine primary therapist for this booking (fallbacks: request, session, prevBooking)
      // This is needed for main slot check if sessions missing therapist,
      // but for per-session check, loop them all.
      // Pick first valid therapist in this priority:
      // [session.therapist, session.therapistId, bodyTherapist, prevBooking.therapist]
      // We'll do this per-session below.

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
      // Gather all unique {therapist, [dates]} needed for the various sessions.
      // Map: therapistId => [dates]
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
      // Build and run availability checks PER therapist for their own sessions

      // Collect possible conflicts
      let slotAvailabilityDataCacheByTherapist = {};
      let conflicts = [];

      for (const therapistObjId of uniqueTherapistIds) {
        // Compile all dates for this therapist
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
            // skip if already present in prevBooking.sessions (ie, this user's own previous booked slot)
            const alreadyHad =
              Array.isArray(prevBooking.sessions) &&
              prevBooking.sessions.some(
                ps =>
                  String(ps.date) === String(sess.date) &&
                  String(ps.slotId || ps.id) === String(sess.slotId) &&
                  String(ps.therapist || ps.therapistId) === String(sess.therapist)
              );
            if (alreadyHad) return;
            // loop over slotAvailabilityData keys ("19-01-2026"),
            // must match YYYY-MM-DD in sess.date (convert key to ISO string for check)
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
          // Expose availability checked data for debugging if needed
          // slotAvailabilityDataCacheByTherapist
        });
      }

      // If all slots clear, proceed with update.
      // Again, ensure each session has the proper therapist field (like createBooking)
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
            // Also populate therapistId (ref code) if available (as in createBooking),
            // fallback to empty string if not found
            let therapistIdField =
              therapistIdMap[String(therapistValue)] || "";
            return {
              ...s,
              therapist: therapistValue,
              therapistId: therapistIdField
            };
          })
        : [];

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

      // Updated booking fields as per schema (make sure sessions have the required therapist)
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
}

export default BookingAdminController;

