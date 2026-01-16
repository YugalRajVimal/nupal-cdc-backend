import Booking from '../../Schema/booking.schema.js';
import { TherapistProfile, User } from '../../Schema/user.schema.js';

// Optionally import Therapist schema if you have one
// import { TherapistProfile } from '../../Schema/therapist.schema.js';

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


class TherapistController {


  async getDashboardDetails(req, res) {
    try {
      // Use id from JWT user
      const therapistId = req.user.id;
      console.log("Therapist Dashboard: therapistId from JWT:", therapistId);

      if (!therapistId) {
        console.log("Unauthorized: No therapistId in JWT user object");
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      // Fetch therapist user
      const therapist = await User.findById(therapistId).lean();
      console.log("Fetched therapist user by ID:", therapist ? therapist._id : null);

      if (!therapist) {
        console.log("Therapist user not found for ID:", therapistId);
        return res.status(404).json({ success: false, message: "Therapist user not found." });
      }

      // Fetch therapist profile for total earnings
      const therapistProfile = await TherapistProfile.findOne({ userId: therapist._id }).lean();
      console.log("Fetched therapistProfile for userId:", therapist._id, "->", therapistProfile ? therapistProfile._id : null);

      if (!therapistProfile) {
        console.log("Therapist profile not found for userId:", therapist._id);
        return res.status(404).json({ success: false, message: "Therapist profile not found." });
      }

      // Fetch all bookings (don't filter at query level by therapist, filter on sessions below)
      const appointments = await Booking.find({})
        .populate({ path: 'patient', model: 'PatientProfile', select: 'name _id patientId' })
        .populate({ path: 'therapy', model: 'TherapyType', select: 'name _id' })
        .lean();

      console.log("All Appointments found in system:", appointments.length);

      let totalAppointments = 0; // Will count bookings in which therapist has at least one session
      let totalSessions = 0;
      let upcomingSessions = 0;
      let checkedInSessions = 0;

      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];

      const upcomingSessionDetails = [];

      for (const booking of appointments) {
        // Check if this booking contains at least one session for this therapist
        let hasTherapistSession = false;

        // Count sessions assigned to this therapist in this booking
        let sessionCountForTherapist = 0;
        let pkgSessionCountForTherapist = 0;

        if (Array.isArray(booking.sessions)) {
          for (const session of booking.sessions) {
            // Ensure the session is for this therapist
            if (session && (String(session.therapist) === String(therapistProfile._id) || String(session.therapist) === String(therapistProfile._id) )) {
              hasTherapistSession = true;

              // Count session as part of this therapist's tally
              sessionCountForTherapist++;

              // Only count non-cancelled sessions for relevant stats
              if (session && session.date && (!session.status || session.status !== "Cancelled")) {
                const sessionDateObj = new Date(session.date);
                const sessionDateStr = session.date.length >= 10 ? session.date.slice(0, 10) : session.date;

                // Count as upcoming session if session date is in the future OR is today
                if (
                  sessionDateObj > now || 
                  sessionDateStr === todayStr
                ) {
                  upcomingSessions++;
                  // Find slotTime label from SESSION_TIME_OPTIONS by session.slotId or session.time
                  let slotTime = "";
                  if (session.slotId) {
                    const slotObj = SESSION_TIME_OPTIONS.find(
                      option => option.id === session.slotId
                    );
                    slotTime = slotObj ? slotObj.label : session.slotId;
                  } else if (session.time) {
                    slotTime = session.time;
                  }

                  let patientName = "";
                  let patientId = "";
                  if (booking.patient && typeof booking.patient === "object") {
                    patientName = booking.patient.name || "";
                    patientId = booking.patient.patientId ? booking.patient.patientId.toString() : "";
                  } else if (typeof booking.patient === "string") {
                    patientId = booking.patient;
                  }
                  let therapyTypeName = "";
                  if (booking.therapy && typeof booking.therapy === "object") {
                    therapyTypeName = booking.therapy.name || "";
                  }
                  upcomingSessionDetails.push({
                    date: session.date,
                    slotTime,
                    patientName,
                    patientId,
                    therapyTypeName,
                    appointmentId: booking.appointmentId ? booking.appointmentId.toString() : undefined
                  });
                }

                // checkedIn (completed) -- use isCheckedIn boolean field from schema
                if (session.isCheckedIn === true) {
                  checkedInSessions++;
                }
              }
            }
          }
        }

        // Add package session counts IF there's a way to link to session's therapistId
        // Most schemas do not put therapist assignment at package level, so SKIP package counting for this dashboard (usually the dashboard user expects real delivered sessions)
        // pkgSessionCountForTherapist left at zero

        totalSessions += sessionCountForTherapist + pkgSessionCountForTherapist;

        // Only count this booking as therapist's appointment if any sessions are assigned to this therapist
        if (hasTherapistSession) {
          totalAppointments++;
        }
      }

      // Use earnings from TherapistProfile, or fallback 0
      let totalEarnings = 0;
      if (therapistProfile && typeof therapistProfile.totalEarnings === "number") {
        totalEarnings = therapistProfile.totalEarnings;
        console.log("TherapistProfile.totalEarnings used:", totalEarnings);
      } else if (therapistProfile && Array.isArray(therapistProfile.earnings)) {
        totalEarnings = therapistProfile.earnings.reduce((sum, e) => {
          return typeof e.amount === "number" ? sum + e.amount : sum;
        }, 0);
        console.log("TherapistProfile.earnings array reduced, total:", totalEarnings);
      }

      const dashboardData = {
        totalAppointments,
        totalSessions,
        upcomingSessions,
        checkedInSessions,
        totalEarnings,
        upcomingSessionDetails,
      };

      console.log("Dashboard data prepared to return:", dashboardData);

      res.json({ success: true, data: dashboardData });
    } catch (err) {
      console.log("Error in getDashboardDetails:", err);
      res.status(500).json({
        success: false,
        error: err.message || String(err)
      });
    }
  }
  // Therapist profile fetch
  async getProfileDetails(req, res) {
    try {
      const therapistId = req.user.id;
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      // Find user by ID and get raw object
      const user = await User.findById(therapistId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // Find therapist profile by userId and get raw object, populate all subdocuments possible
      // Populate every possible subdocument/field as per TherapistProfileSchema (user.schema.js)
      const therapistProfile = await TherapistProfile.findOne({ userId: user._id })
        .populate({ path: "userId", model: "User" })
        .populate({
          path: "holidays.slots", // If slots were a referenced model (they are embedded, so this may have no effect)
        })
        // If there are any other ref-type fields added in TherapistProfileSchema, add additional populates here
        .lean();
        
      if (!therapistProfile) {
        return res.status(404).json({ success: false, message: "Therapist profile not found." });
      }

      const profileData = {
        user,
        therapistProfile
      };

      res.json({ success: true, data: profileData });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }


  // Get all appointments assigned to this therapist
  async getAllTherapistAppointments(req, res) {
    try {
      const therapistId = req.user.id;
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

    

      // Find user document
      const user = await User.findById(therapistId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // Find therapist profile associated with this user
      const therapistProfile = await TherapistProfile.findOne({ userId: user._id }).lean();
      if (!therapistProfile) {
        return res.status(404).json({ success: false, message: "Therapist profile not found." });
      }

      // Use therapist profile's id to find appointments/bookings
      // Fetch appointments but do not populate or return therapist or payment info
      const appointmentsWithAllButNoTherapistOrPayment = await Booking.find({ therapist: therapistProfile._id })
        .populate({
          path: "package",
          model: "Package",
          select: "-costPerSession -totalCost"
        })
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User"
          }
        })
        // REMOVE therapist and payment population
        .populate({
          path: "therapy",
          model: "TherapyType"
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
        })
        .lean();

      // Remove therapist and payment data (and ids) from each appointment
      const appointments = appointmentsWithAllButNoTherapistOrPayment.map(app => {
        const clean = { ...app };
        // Remove top-level fields
        delete clean.payment;
        delete clean.therapist;
        delete clean.discountInfo;


        // If therapist is present inside sessions, also remove from sessions
        if (Array.isArray(clean.sessions)) {
          clean.sessions = clean.sessions.map(session => {
            const s = { ...session };
            delete s.therapist; // this removes the therapist info from each session
            return s;
          });
        }

        return clean;
      });


        console.log(appointments);

      res.json({ success: true, data: appointments });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // Fetch all bookings, then for all sessions, match with therapist, and respond with appointmentId, patient, therapyType, this therapist's session details
  async getAllTherapistSessions(req, res) {
    try {
      const therapistId = req.user.id;
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      // Find user document
      const user = await User.findById(therapistId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // Find therapist profile associated with this user
      const therapistProfile = await TherapistProfile.findOne({ userId: user._id }).lean();
      if (!therapistProfile) {
        return res.status(404).json({ success: false, message: "Therapist profile not found." });
      }

      // Fetch all bookings
      const bookings = await Booking.find({})
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
        .lean();

      // Build filtered therapist sessions
      let therapistSessions = [];

      bookings.forEach(booking => {
        if (Array.isArray(booking.sessions)) {
          booking.sessions.forEach(session => {
            if (session.therapist && String(session.therapist) === String(therapistProfile._id)) {
              therapistSessions.push({
                appointmentId: booking.appointmentId || booking._id,
                patient: booking.patient,
                therapyType: booking.therapy,
                session: session
              });
            }
          });
        }
      });

      res.json({ success: true, data: therapistSessions });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // Schedule & Calendar: Returns all sessions with their dates for this therapist
  async getScheduleCalendar(req, res) {
    try {
      const therapistId = req.user.id;
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      // Fetch the User document using therapistId
      const user = await User.findById(therapistId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      // Fetch the TherapistProfile linked to the user
      const therapistProfile = await TherapistProfile.findOne({ userId: user._id }).lean();
      if (!therapistProfile) {
        return res.status(404).json({ success: false, message: "Therapist profile not found." });
      }

      // Fetch ALL appointments (not just filtered by therapist)
      const appointments = await Booking.find({})
        .populate({
          path: 'patient',
          model: 'PatientProfile',
          select: 'name patientId',
        })
        .populate({
          path: 'therapy',
          model: 'TherapyType',
          select: 'name',
        })
        .lean();

      // Collect all sessions where session.therapist (therapistId) matches this therapistProfile._id
      let allSessions = [];
      appointments.forEach(appointment => {
        if (Array.isArray(appointment.sessions)) {
          appointment.sessions.forEach(session => {
            // Note: session.therapist could be an ObjectId or string; make both strings for comparison
            if (
              session.therapist &&
              String(session.therapist) === String(therapistProfile._id)
            ) {
              allSessions.push({
                ...session,
                appointmentId: appointment.appointmentId,
                patient: appointment.patient,
                therapist: appointment.therapist,
                therapyType: appointment.therapy,
              });
            }
          });
        }
      });

      res.json({ success: true, data: allSessions });

    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // Therapist earnings report/summary (by month, optional)
  // async getEarnings(req, res) {
  //   try {
  //     const therapistId = req.user.id;
  //     if (!therapistId) {
  //       return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
  //     }

  //     // Fetch the User document using therapistId
  //     const user = await User.findById(therapistId).lean();
  //     if (!user) {
  //       return res.status(404).json({ success: false, message: "User not found." });
  //     }
  //     // Fetch the TherapistProfile where userId matches the found user's _id
  //     const therapistProfile = await TherapistProfile.findOne({ userId: user._id }).lean();
  //     if (!therapistProfile) {
  //       return res.status(404).json({ success: false, message: "Therapist profile not found." });
  //     }

  //     const { month, year } = req.query;
  //     // Query filter
  //     let filter = { therapist: therapistProfile._id, paymentStatus: "Paid" };
  //     // Optionally filter by paid date/month
  //     if (month && year) {
  //       const from = new Date(year, month - 1, 1);
  //       const to = new Date(year, month, 1);
  //       filter.paymentDate = { $gte: from, $lt: to };
  //     }

  //     const paidBookings = await Booking.find(filter).lean();

  //     let totalEarnings = 0;
  //     paidBookings.forEach(booking => {
  //       if (booking.therapistAmount) {
  //         totalEarnings += booking.therapistAmount;
  //       }
  //     });

  //     res.json({
  //       success: true,
  //       data: {
  //         totalEarnings,
  //         totalBookings: paidBookings.length,
  //         details: paidBookings
  //       }
  //     });
  //   } catch (err) {
  //     res.status(500).json({ success: false, error: err.message || String(err) });
  //   }
  // }

  /**
   * Therapist earnings summary/report endpoint based on TherapistProfile.earnings array.
   * GET /api/therapist/earnings
   * Optionally filter by month & year (?month=MM&year=YYYY) based on the earnings.fromDate/toDate/paidOn.
   */
  async getEarnings(req, res) {
    try {
      const therapistId = req.user.id;
      if (!therapistId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
      }

      // Fetch the User document using therapistId
      const user = await User.findById(therapistId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      // Fetch the TherapistProfile where userId matches the found user's _id
      const therapistProfile = await TherapistProfile.findOne({ userId: user._id }).lean();
      if (!therapistProfile) {
        return res.status(404).json({ success: false, message: "Therapist profile not found." });
      }

      const { month, year } = req.query;

      let filteredEarnings = Array.isArray(therapistProfile.earnings)
        ? therapistProfile.earnings
        : [];

      // Filter by month/year if provided -- based on paidOn or fromDate
      if (month && year) {
        const monthNum = parseInt(month, 10);
        const yearNum = parseInt(year, 10);
        filteredEarnings = filteredEarnings.filter((earning) => {
          let paidDate = earning.paidOn || earning.fromDate;
          if (!paidDate) return false;
          const paidD = new Date(paidDate);
          return (
            paidD.getFullYear() === yearNum &&
            paidD.getMonth() === monthNum - 1
          );
        });
      }

      let totalEarnings = 0;
      filteredEarnings.forEach(entry => {
        if (typeof entry.amount === "number") {
          totalEarnings += entry.amount;
        }
      });

      // "details" may match frontend usage, provide id and all fields
      res.json({
        success: true,
        data: {
          totalEarnings,
          totalBookings: filteredEarnings.length,
          details: filteredEarnings.map(item => ({
            _id: item._id,
            amount: item.amount,
            type: item.type,
            fromDate: item.fromDate,
            toDate: item.toDate,
            remark: item.remark,
            paidOn: item.paidOn,
          }))
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  /**
   * Old-style CSV export of therapist earnings from TherapistProfile.earnings array.
   */
  // async getEarningsCsv(req, res) {
  //   try {
  //     const therapistId = req.user.id;
  //     if (!therapistId) {
  //       return res.status(401).json({ success: false, message: "Unauthorized: Therapist not found from token." });
  //     }
  //     const user = await User.findById(therapistId).lean();
  //     if (!user) {
  //       return res.status(404).json({ success: false, message: "User not found." });
  //     }
  //     const therapistProfile = await TherapistProfile.findOne({ userId: user._id }).lean();
  //     if (!therapistProfile) {
  //       return res.status(404).json({ success: false, message: "Therapist profile not found." });
  //     }

  //     const { month, year } = req.query;
  //     let earnings = Array.isArray(therapistProfile.earnings) ? therapistProfile.earnings : [];

  //     // Filter by month/year if provided
  //     if (month && year) {
  //       const monthNum = parseInt(month, 10);
  //       const yearNum = parseInt(year, 10);
  //       earnings = earnings.filter((earning) => {
  //         let paidDate = earning.paidOn || earning.fromDate;
  //         if (!paidDate) return false;
  //         const paidD = new Date(paidDate);
  //         return (
  //           paidD.getFullYear() === yearNum &&
  //           paidD.getMonth() === monthNum - 1
  //         );
  //       });
  //     }

  //     // Prepare CSV headers
  //     const headers = [
  //       "Paid On",
  //       "Amount",
  //       "Type",
  //       "From Date",
  //       "To Date",
  //       "Remark"
  //     ];
  //     // Prepare data rows
  //     const rows = earnings.map(earning => [
  //       earning.paidOn ? new Date(earning.paidOn).toLocaleDateString('en-GB') : (earning.fromDate ? new Date(earning.fromDate).toLocaleDateString('en-GB') : ""),
  //       earning.amount != null ? earning.amount : "",
  //       earning.type || "",
  //       earning.fromDate ? new Date(earning.fromDate).toLocaleDateString('en-GB') : "",
  //       earning.toDate ? new Date(earning.toDate).toLocaleDateString('en-GB') : "",
  //       earning.remark || ""
  //     ]);

  //     function csvEscape(val) {
  //       if (val === undefined || val === null) return "";
  //       val = String(val);
  //       if (val.indexOf(",") !== -1 || val.indexOf('"') !== -1 || val.indexOf("\n") !== -1) {
  //         return `"${val.replace(/"/g, '""')}"`;
  //       }
  //       return val;
  //     }

  //     const csv =
  //       headers.join(",") +
  //       "\n" +
  //       rows
  //         .map(row => row.map(csvEscape).join(","))
  //         .join("\n");

  //     res.setHeader("Content-Type", "text/csv");
  //     res.setHeader("Content-Disposition", `attachment; filename="therapist-earnings.csv"`);
  //     res.send(csv);
  //   } catch (err) {
  //     res.status(500).json({ success: false, error: err.message || String(err) });
  //   }
  // }
}

export default TherapistController;
