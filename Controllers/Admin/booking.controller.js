
import { User, PatientProfile } from "../../Schema/user.schema.js";
import Package from "../../Schema/packages.schema.js";
import { TherapyType } from "../../Schema/therapy-type.schema.js";
import Booking from "../../Schema/booking.schema.js";
import Counter from "../../Schema/counter.schema.js";
import DailyAvailability from "../../Schema/AvailabilitySlots/daily-availability.schema.js";
import DiscountAdminController from "../SuperAdmin/discount.controller.js";
import DiscountModel from "../../Schema/discount.schema.js";
import Payment from "../../Schema/payment.schema.js";

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
        name: profile.name|| "",
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
        // payment, // Don't take payment from input!
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

      // Compose booking payload per updated schema (1-47)
      const bookingPayload = {
        appointmentId,
        status,
        notes,
        discountInfo,
        package: packageId,
        patient: patientId,
        therapist: therapistId,
        sessions,
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
  async getBookingById(req, res) {
    try {
      const { id } = req.params;
      const booking = await Booking.findById(id)
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
        });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found.",
        });
      }

      res.json({
        success: true,
        booking,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch booking.",
        error: error.message,
      });
    }
  }

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
    try {
      const { id } = req.params;
      const {
        coupon, // expects coupon to be an id or object with id (frontend should send this)
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
        followupDate
      } = req.body;

console.log(coupon)

      if (
        !packageId ||
        !patientId ||
        !therapyId ||
        !Array.isArray(sessions) ||
        !sessions.length
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }

      // Availability logic
      const prevBooking = await Booking.findById(id);
      if (!prevBooking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found.",
        });
      }

      // Find which sessions changed (old sessions to decrement, new sessions to increment)
      const makeKey = (s) => s && s.date && s.slotId ? `${s.date}|${s.slotId}` : null;
      const oldSessions = Array.isArray(prevBooking.sessions) ? prevBooking.sessions : [];
      const newSessions = Array.isArray(sessions) ? sessions : [];

      const oldSet = new Set(oldSessions.map(makeKey).filter(Boolean));
      const newSet = new Set(newSessions.map(makeKey).filter(Boolean));

      const removeSessions = oldSessions.filter(
        s => !newSet.has(makeKey(s)) && s && typeof s.slotId === "string" && s.slotId.trim().length > 0 && typeof s.date === "string"
      );
      const addSessions = newSessions.filter(
        s => !oldSet.has(makeKey(s)) && s && typeof s.slotId === "string" && s.slotId.trim().length > 0 && typeof s.date === "string"
      );

      if (removeSessions.length > 0) {
        await this.adjustAvailabilityCounts(removeSessions, -1);
      }
      if (addSessions.length > 0) {
        await this.adjustAvailabilityCounts(addSessions, 1);
      }

      // Save only coupon id and the timestamp (if given); ignore the rest
      let discountInfo = undefined;
      if (coupon ) {
        discountInfo = {
          coupon: coupon.id,
          time: new Date()
        };
        }

      // Updated booking fields as per schema (1-47)
      const updatePayload = {
        discountInfo,
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
        followupDate
      };
      Object.keys(updatePayload).forEach(
        k => updatePayload[k] === undefined && delete updatePayload[k]
      );

      const booking = await Booking.findByIdAndUpdate(
        id,
        updatePayload,
        { new: true }
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
        .populate({
          path: "therapy",
          model: "TherapyType"
        })
        .populate({
          path: "therapist",
          model: "TherapistProfile"
        });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found.",
        });
      }

      res.json({
        success: true,
        booking,
      });
    } catch (error) {
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
}

export default BookingAdminController;

