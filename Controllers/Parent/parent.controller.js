import Booking from '../../Schema/booking.schema.js';
import { PatientProfile, User } from '../../Schema/user.schema.js';




class ParentController {

  async getDashboardDetails(req, res) {

    try {
      // Placeholder parentId for local/dev, replace with extraction from req.user or token in prod
      const parentId = "69528597c72027c7f0b2a17a";
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
      const parentId = "69528597c72027c7f0b2a17a";
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
      const parentId = "69528597c72027c7f0b2a17a";
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
      const parentId = "69528597c72027c7f0b2a17a";
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


}

export default ParentController;
