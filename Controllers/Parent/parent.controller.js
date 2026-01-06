import BookingRequests from '../../Schema/booking-request.schema.js';
import Booking from '../../Schema/booking.schema.js';
import counterSchema from '../../Schema/counter.schema.js';
import DiscountModel from '../../Schema/discount.schema.js';
import Package from '../../Schema/packages.schema.js';
import { TherapyType } from '../../Schema/therapy-type.schema.js';
import { PatientProfile, User } from '../../Schema/user.schema.js';




class ParentController {

  async getDashboardDetails(req, res) {

    try {
      // Placeholder parentId for local/dev, replace with extraction from req.user or token in prod
      const parentId = "695c204620ee4e5e88e2ef3b";
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      // Fetch user from User schema using id
      const user = await User.findById(parentId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "Parent user not found." });
      }

      // Fetch all PatientProfiles with userId of that user
      const children = await PatientProfile.find({ userId: user._id }).lean();
      console.log(children)

      // Prepare childIds (these are _id of PatientProfile)
      const childIds = children.map(child => child._id);

      // Find all bookings (appointments) where patient is one of these children
      const appointments = await Booking.find({ patient: { $in: childIds } }).lean();

      // Total appointments
      const totalAppointments = appointments.length;

      // Flatten all sessions from all bookings to count upcoming ones
      let upcomingAppointments = 0;
      const now = new Date();

      appointments.forEach(booking => {
        if (Array.isArray(booking.sessions)) {
          for (const session of booking.sessions) {
            if (session.date) {
              const sessionDate = new Date(session.date);
              if (sessionDate > now) {
                upcomingAppointments++;
              }
            }
          }
        }
      });

      // Compose dashboard data (with place-holder payments for now)
      const dashboardData = {
        childrenCount: children.length,
        children: children, // Might want to pick only minimal fields for dashboard
        totalAppointments,
        upcomingAppointments,
        totalPaid: 3,
        totalUnpaid: 2,
        totalPayments: 5,
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
      const parentId = "695c204620ee4e5e88e2ef3b";
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
      const parentId = "695c204620ee4e5e88e2ef3b";
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

      // 3. Fetch all bookings where userId is any of the children
      // NOTE: In your Booking schema, 'userId' refers to patient/child's _id.
      // Optionally, populate child information and therapist/therapyType if needed
      // Corrected: should query 'userId' (the patient _id), not 'id'
      const appointments = await Booking.find({ patient: { $in: childIds } })
        .populate({ path: 'package'})
        .populate({ path: 'patient', model: 'PatientProfile' })
        .lean();

        console.log(appointments);

      res.json({ success: true, data: appointments });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // Returns profile details for the parent user
  async getProfileDetails(req, res) {
    try {
      const parentId = "695c204620ee4e5e88e2ef3b";
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }
      // Replace with your actual Parent/User schema/model
      const parent = await User.findById(parentId).lean();
      if (!parent) {
        return res.status(404).json({ success: false, message: "Parent profile not found." });
      }
      res.json({ success: true, data: parent });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  async getRequestAppointmentHomePage(req, res) {
    try {
      const parentId = "695c204620ee4e5e88e2ef3b";

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
      const parentUserId = req.user?._id || req.user?.id;

      // Support filter: only my requests
      const filter = {};
      if (parentUserId) {
        // Find all PatientProfiles for this parent
        const PatientProfile = (await import('../../Schema/patient-profile.schema.js')).default;
        const myPatients = await PatientProfile.find({ parent: parentUserId }, '_id').lean();
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

  


}

export default ParentController;
