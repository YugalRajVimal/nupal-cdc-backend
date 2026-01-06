import Booking from '../../Schema/booking.schema.js';
import { TherapistProfile, User } from '../../Schema/user.schema.js';

// Optionally import Therapist schema if you have one
// import { TherapistProfile } from '../../Schema/therapist.schema.js';

class TherapistController {

  // Get therapist dashboard (stats summary)
  async getDashboardDetails(req, res) {
    try {
      // Replace with extraction from req.user._id in production
      const therapistId = "69528541c72027c7f0b2a165";
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      // Fetch therapist user
      const therapist = await User.findById(therapistId).lean();
      if (!therapist) {
        return res.status(404).json({ success: false, message: "Therapist user not found." });
      }

      // Find all bookings where therapist = therapistId
      const appointments = await Booking.find({ therapist: therapist._id }).lean();

      // Dashboard stats
      const totalAppointments = appointments.length;
      let upcomingAppointments = 0;
      let completedAppointments = 0;
      let totalEarnings = 0;
      const now = new Date();

      appointments.forEach(booking => {
        // Payment and earnings - naive, assumes booking.paid and booking.paymentAmount
        if (booking.paymentStatus === "Paid" && booking.therapistAmount) {
          totalEarnings += booking.therapistAmount;
        }
        if (Array.isArray(booking.sessions)) {
          let hasUpcoming = false;
          let allCompleted = true;
          for (const session of booking.sessions) {
            if (session.date) {
              const sessionDate = new Date(session.date);
              if (sessionDate > now && (!session.status || session.status !== "Cancelled")) {
                hasUpcoming = true;
              }
              if (!session.status || session.status !== "Completed") {
                allCompleted = false;
              }
            }
          }
          if (hasUpcoming) upcomingAppointments++;
          if (allCompleted) completedAppointments++;
        }
      });

      const dashboardData = {
        totalAppointments,
        completedAppointments,
        upcomingAppointments,
        totalEarnings,
      };

      res.json({ success: true, data: dashboardData });

    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message || String(err)
      });
    }
  }

  // Therapist profile fetch
  async getProfileDetails(req, res) {
    try {
      const therapistId = "69528541c72027c7f0b2a165";
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      // Replace with your Therapist/User schema/model
      const therapist = await User.findById(therapistId).lean();
      if (!therapist) {
        return res.status(404).json({ success: false, message: "Therapist profile not found." });
      }

      // If additional profile model exists, populate/join here

      res.json({ success: true, data: therapist });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }


  // Get all appointments assigned to this therapist
  async getAllTherapistAppointments(req, res) {
    try {
      const therapistId = "69528541c72027c7f0b2a165";
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      

      // Find user from request (assuming therapist is authenticated and user id is in req.userId)
      const userId = req.userId || "69528541c72027c7f0b2a165"; // fallback for demo/testing
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized: User not found from token." });
      }

      // Find user document
      const user = await User.findById(userId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // Find therapist profile associated with this user
      const therapistProfile = await TherapistProfile.findOne({ userId: user._id }).lean();
      if (!therapistProfile) {
        return res.status(404).json({ success: false, message: "Therapist profile not found." });
      }

      // Use therapist profile's id to find appointments/bookings
      const appointments = await Booking.find({ therapist: therapistProfile._id })
        .populate({ path: 'patient', model: 'PatientProfile' })
        .populate({ path: 'package' })
        .lean();


        console.log(appointments);

      res.json({ success: true, data: appointments });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // Schedule & Calendar: Returns all sessions with their dates for this therapist
  async getScheduleCalendar(req, res) {
    try {
      const therapistId = "69528541c72027c7f0b2a165";
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      // Find all bookings for this therapist
      const appointments = await Booking.find({ therapist: therapistId })
        .populate({ path: 'patient', model: 'PatientProfile' })
        .lean();

      // Aggregate all sessions for calendar
      let sessions = [];
      appointments.forEach(booking => {
        if (Array.isArray(booking.sessions)) {
          booking.sessions.forEach(session => {
            sessions.push({
              ...session,
              appointmentId: booking._id,
              patient: booking.patient,
              package: booking.package,
            });
          });
        }
      });

      res.json({ success: true, data: sessions });

    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // Therapist earnings report/summary (by month, optional)
  async getEarnings(req, res) {
    try {
      const therapistId = "69528541c72027c7f0b2a165";
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      const { month, year } = req.query;
      // Query filter
      let filter = { therapist: therapistId, paymentStatus: "Paid" };
      // Optionally filter by paid date/month
      if (month && year) {
        const from = new Date(year, month - 1, 1);
        const to = new Date(year, month, 1);
        filter.paymentDate = { $gte: from, $lt: to };
      }

      const paidBookings = await Booking.find(filter).lean();

      let totalEarnings = 0;
      paidBookings.forEach(booking => {
        if (booking.therapistAmount) {
          totalEarnings += booking.therapistAmount;
        }
      });

      res.json({
        success: true,
        data: {
          totalEarnings,
          totalBookings: paidBookings.length,
          details: paidBookings
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }
}

export default TherapistController;
