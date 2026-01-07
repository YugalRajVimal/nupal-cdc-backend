
import { User, PatientProfile } from "../../Schema/user.schema.js";
import Package from "../../Schema/packages.schema.js";
import { TherapyType } from "../../Schema/therapy-type.schema.js";
import Booking from "../../Schema/booking.schema.js";
import Counter from "../../Schema/counter.schema.js";
import DailyAvailability from "../../Schema/AvailabilitySlots/daily-availability.schema.js";
import DiscountAdminController from "../SuperAdmin/discount.controller.js";
import DiscountModel from "../../Schema/discount.schema.js";
import Payment from "../../Schema/payment.schema.js";
import BookingRequests from "../../Schema/booking-request.schema.js";

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

      // ---- REWRITE: Ensure all session objects in sessions[] have the correct therapist set ----
      // This enforces @booking.schema.js (4-15): save the same therapist in all session slots.
      const sessionsWithTherapist = (sessions || []).map(sessionObj => ({
        ...sessionObj,
        therapist: therapistId
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
        followupDate
      } = req.body;



      // Validate required fields
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

      // Ensure booking exists
      const prevBooking = await Booking.findById(id);
      if (!prevBooking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found.",
        });
      }

      // Fix: Set therapist of each slot (session) as required in SessionSchema
      // If session.therapist is missing but a session.therapistId exists in payload, or if not, use the overall booking therapist
      let updatedSessions = Array.isArray(sessions) ? sessions.map(s => {
        // If the frontend sends both s.therapist and s.therapistId, prefer s.therapist
        // If neither, fall back to req.body.therapist (the overall therapist for booking)
        // Allow passing therapist as either an ObjectId, populated object with _id, or string

        let therapistValue = (
          s.therapist ||
          s.therapistId ||
          req.body.therapist || // fallback, though not explicitly destructured above
          prevBooking.therapist // last fallback; should normally always be present on booking
        );

        // Extract ._id if provided as populated object
        if (typeof therapistValue === "object" && therapistValue !== null && therapistValue._id) {
          therapistValue = therapistValue._id;
        }

        return {
          ...s,
          therapist: therapistValue
        };
      }) : [];

      // Build sets (date|slotId|therapist) for accurate therapist-based slot management
      const sessionKey = (s) => `${s.date}|${s.slotId}|${String((typeof s.therapist === "object" && s.therapist?._id) ? s.therapist._id : s.therapist || "")}`;
      const prevSessions = Array.isArray(prevBooking.sessions)
        ? prevBooking.sessions.filter(
            s => s && typeof s.slotId === "string" && s.slotId.trim().length > 0 && typeof s.date === "string"
          )
        : [];
      const nextSessions = updatedSessions.filter(
        s => s && typeof s.slotId === "string" && s.slotId.trim().length > 0 && typeof s.date === "string"
      );

      const prevKeys = new Set(prevSessions.map(sessionKey));
      const nextKeys = new Set(nextSessions.map(sessionKey));

      // To decrement: sessions in prev, but not in next
      const sessionsToDecrement = prevSessions.filter(s => !nextKeys.has(sessionKey(s)));
      // To increment: sessions in next, but not in prev
      const sessionsToIncrement = nextSessions.filter(s => !prevKeys.has(sessionKey(s)));

      // If you want to adjust slot counts, uncomment below:
      // if (sessionsToDecrement.length > 0) {
      //   await this.adjustAvailabilityCounts(sessionsToDecrement, -1);
      // }
      // if (sessionsToIncrement.length > 0) {
      //   await this.adjustAvailabilityCounts(sessionsToIncrement, 1);
      // }

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

