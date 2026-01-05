
import { User, PatientProfile } from "../../Schema/user.schema.js";
import Package from "../../Schema/packages.schema.js";
import { TherapyType } from "../../Schema/therapy-type.schema.js";
import Booking from "../../Schema/booking.schema.js";
import Counter from "../../Schema/counter.schema.js";
import DailyAvailability from "../../Schema/AvailabilitySlots/daily-availability.schema.js";

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
      const patientProfiles = await PatientProfile.find({}, "userId mobile1").populate({
        path: "userId",
        select: "name",
      });

      const patients = patientProfiles.map((profile) => ({
        id: profile._id,
        patientId:profile.patientId,
        name: profile.userId?.name || "",
        phoneNo: profile.mobile1 || "",
      }));

      // Fetch therapy types and packages
      const therapyTypes = await TherapyType.find();
      const packages = await Package.find();

      // Fetch all active therapists with their holidays
      // We need to import TherapistProfile above if not yet imported
      // Only those whose 'user' is active
      // Fetch all active therapists with their holidays and also fetch bookings count per therapist (grouped by date)

      // 1. Get active therapists with user info
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
      // (Will return: [{therapist: ObjectId, date: 'YYYY-MM-DD', count: Number }, ...])
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
      // Transform into: { therapistId: { "2024-06-09": count, ... }, ... }
      const therapistBookingMap = {};
      bookingCounts.forEach((row) => {
        const therapistId = row._id.therapist.toString();
        const date = row._id.date;
        if (!therapistBookingMap[therapistId]) therapistBookingMap[therapistId] = {};
        therapistBookingMap[therapistId][date] = row.count;
      });

      // 3. Add bookingCounts to each therapist
      const therapistsWithCounts = activeTherapists.map((t) => {
        const bookingsByDate = therapistBookingMap[t._id.toString()] || {};
        return { ...t, bookingsByDate };
      });


      console.log(therapistsWithCounts);


      return res.json({
        success: true,
        patients,
        therapyTypes,
        packages,
        therapists: activeTherapists
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
      const {
        couponCode,
        discount,
        discountEnabled,
        validityDays,
        package: packageId,
        patient: patientId,
        therapist: therapistId, // <-- ADD therapist from request body
        sessions,
        therapy: therapyId,
        payment, // { amount, status, method, ... }
        status,
        notes,
        channel,
        attendedBy,
        referral,
        extra,           // object to allow custom fields
        attendedByType,
        paymentDueDate,
        invoiceNumber,
        followupRequired, // boolean
        followupDate     // date if followupRequired
      } = req.body;

      // Strict validation for new schema
      if (
        !packageId ||
        !patientId ||
        !therapyId ||
        !therapistId ||                                        // <-- Require therapistId
        !Array.isArray(sessions) ||
        !sessions.length ||
        discountEnabled === undefined ||
        (discountEnabled === true && discount === undefined)
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }

      // Build discount info
      let discountInfo;
      if (discountEnabled) {
        discountInfo = {
          couponCode,
          discount,
          discountEnabled,
          validityDays,
          dateFrom: new Date()
        };
      } else {
        discountInfo = { discountEnabled: false };
      }

      // Generate new appointmentId inside transaction
      const counter = await Counter.findOneAndUpdate(
        { name: "appointment" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
      );
      const appointmentId = generateAppointmentId(counter.seq);

      // Compose booking payload per updated schema (1-47)
      const bookingPayload = {
        appointmentId,
        status,
        notes,
        discountInfo,
        package: packageId,
        patient: patientId,
        therapist: therapistId,                            // <-- Add therapistId to payload
        sessions,
        therapy: therapyId,
        payment,
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

      await booking.save({ session });

      // Availability slot bookkeeping
      // for (const sess of sessions) {
      //   const { date, slotId } = sess;
      //   let doc = await DailyAvailability.findOne({ date }).session(session);
      //   if (!doc) {
      //     await session.abortTransaction();
      //     session.endSession();
      //     return res.status(400).json({
      //       success: false,
      //       message: `No Slots available found for date ${date}. Booking not created. Try another date.`,
      //     });
      //   }

      //   const slot = doc.sessions.find(s => s.id === slotId);
      //   if (slot) {
      //     if (typeof slot.booked !== "number") slot.booked = 0;
      //     if (typeof slot.count === "number" && slot.count === 0) {
      //       await session.abortTransaction();
      //       session.endSession();
      //       return res.status(400).json({
      //         success: false,
      //         message: `Slot for date ${date} and time ${slotId} is not available for booking.`,
      //       });
      //     }
      //     if (
      //       typeof slot.count === "number" && slot.count > 0 && slot.booked >= slot.count
      //     ) {
      //       await session.abortTransaction();
      //       session.endSession();
      //       return res.status(400).json({
      //         success: false,
      //         message: `Slot for date ${date} and time ${slotId} is fully booked.`,
      //       });
      //     }
      //     slot.booked += 1;
      //   }
      //   await doc.save({ session });
      // }

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
        .populate({ path: "therapist", model: "TherapistProfile" }); // <-- Populate therapist

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
        couponCode,
        discount,
        discountEnabled,
        validityDays,
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

      if (
        !packageId ||
        !patientId ||
        !therapyId ||
        !Array.isArray(sessions) ||
        !sessions.length ||
        discountEnabled === undefined ||
        (discountEnabled === true && discount === undefined)
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

      let discountInfo;
      if (discountEnabled) {
        discountInfo = {
          couponCode,
          discount,
          discountEnabled,
          validityDays,
          dateFrom: new Date()
        };
      } else {
        discountInfo = { discountEnabled: false };
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

