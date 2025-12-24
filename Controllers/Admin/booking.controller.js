
import { User, PatientProfile } from "../../Schema/user.schema.js";
import Package from "../../Schema/packages.schema.js";
import { TherapyType } from "../../Schema/therapy-type.schema.js";
import Booking from "../../Schema/booking.schema.js";

class BookingAdminController {
  // Provides data needed for booking home page:
  // - all patient details (id, name, phoneNo)
  // - all therapy types
  // - all packages
  async getBookingHomePageDetails(req, res) {
    try {
      // Get all patients (id, name, phone) -- join User and PatientProfile
      const patientProfiles = await PatientProfile.find({}, "userId mobile1").populate({
        path: "userId",
        select: "name",
      });

      const patients = patientProfiles.map((profile) => ({
        id: profile._id,
        name: profile.userId?.name || "",
        phoneNo: profile.mobile1 || "",
      }));

      // Get all therapy types
      // e.g. fetch fields like id, name, etc., as defined in your schema
      const therapyTypes = await TherapyType.find();

      // Get all packages
      const packages = await Package.find();

      console.log( patients,
        therapyTypes,
        packages);

      return res.json({
        success: true,
        patients,
        therapyTypes,
        packages,
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


  // Create a new booking
  async createBooking(req, res) {
    try {
      // Receive these fields in req.body - @booking.schema.js (12-15)
      // couponCode, discount, discountEnabled, validityDays
      const { couponCode, discount, discountEnabled, validityDays, package: packageId, patient: patientId, sessions, therapy: therapyId } = req.body;

      console.log("[createBooking] req.body:", req.body);

      // Validation checks
      if (!packageId) {
        console.log("[createBooking] Missing field: packageId");
      }
      if (!patientId) {
        console.log("[createBooking] Missing field: patientId");
      }
      if (!therapyId) {
        console.log("[createBooking] Missing field: therapyId");
      }
      if (!sessions) {
        console.log("[createBooking] Missing field: sessions");
      }
      if (sessions && !sessions.length) {
        console.log("[createBooking] Sessions provided but empty array.");
      }
      if (discountEnabled === undefined) {
        console.log("[createBooking] Missing field: discountEnabled");
      }

      // If discountEnabled is true, discount information is required and validated
      if (
        !packageId ||
        !patientId ||
        !therapyId ||
        !sessions ||
        !sessions.length ||
        discountEnabled === undefined ||
        (discountEnabled === true && discount === undefined)
      ) {
        console.log("[createBooking] Validation failed. Not creating booking.");
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }

      // Prepare discountInfo according to whether discount is enabled
      let discountInfo;
      if (discountEnabled) {
        discountInfo = {
          couponCode,
          discount,
          discountEnabled,
          validityDays,
          dateFrom: new Date(),
        };
      } else {
        discountInfo = {
          discountEnabled: false
        };
      }

      const booking = new Booking({
        discountInfo,
        package: packageId,
        patient: patientId,
        sessions,
        therapy: therapyId,
      });

      console.log("[createBooking] Creating new booking:", booking);

      await booking.save();

      console.log("[createBooking] Booking created successfully with ID:", booking._id);

      res.status(201).json({
        success: true,
        booking,
      });
    } catch (error) {
      console.error("[createBooking] Error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create booking.",
        error: error.message,
      });
    }
  }

  // Get all bookings
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

  // Get single booking by id
  async getBookingById(req, res) {
    try {
      const { id } = req.params;
      const booking = await Booking.findById(id)
        .populate("package")
        .populate("patient")
        .populate("therapy");

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

  // Delete booking by id
  async deleteBooking(req, res) {
    try {
      const { id } = req.params;
      const deleted = await Booking.findByIdAndDelete(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: "Booking not found.",
        });
      }

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

  // Edit/Update booking by id
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
        therapy: therapyId
      } = req.body;

      console.log("[updateBooking] req.body:", req.body);

      // Validation checks (match createBooking logic)
      if (!packageId) {
        console.log("[updateBooking] Missing field: packageId");
      }
      if (!patientId) {
        console.log("[updateBooking] Missing field: patientId");
      }
      if (!therapyId) {
        console.log("[updateBooking] Missing field: therapyId");
      }
      if (!sessions) {
        console.log("[updateBooking] Missing field: sessions");
      }
      if (sessions && !sessions.length) {
        console.log("[updateBooking] Sessions provided but empty array.");
      }
      if (discountEnabled === undefined) {
        console.log("[updateBooking] Missing field: discountEnabled");
      }

      if (
        !packageId ||
        !patientId ||
        !therapyId ||
        !sessions ||
        !sessions.length ||
        discountEnabled === undefined ||
        (discountEnabled === true && discount === undefined)
      ) {
        console.log("[updateBooking] Validation failed. Not updating booking.");
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }

      // Prepare discountInfo as in createBooking
      let discountInfo;
      if (discountEnabled) {
        discountInfo = {
          couponCode,
          discount,
          discountEnabled,
          validityDays,
          dateFrom: new Date(),
        };
      } else {
        discountInfo = {
          discountEnabled: false
        };
      }

      // Build update payload
      const updatePayload = {
        discountInfo,
        package: packageId,
        patient: patientId,
        sessions,
        therapy: therapyId,
      };

      console.log("[updateBooking] Update payload:", updatePayload);

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

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found.",
        });
      }

      console.log("[updateBooking] Booking updated successfully with ID:", booking._id);

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
}

export default BookingAdminController;

