import Booking from "../../Schema/booking.schema.js";



class AppointmentSuperAdminController {


  // Get all bookings (populated)
  async getAllBookings(req, res) {
    try {
      const bookings = await Booking.find()
        .populate({
          path: "package",
          model: "Package"
        })
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User"
          }
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
        .populate({
          path: "discountInfo.coupon",
          model: "Discount"
        })
        .populate({
          path: "payment",
          model: "Payment"
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

export default AppointmentSuperAdminController;

