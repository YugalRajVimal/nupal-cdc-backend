import ConsultationBooking from "../../Schema/consultation-booking.schema.js";

class ConsultationBookingAdminController {
  /**
   * Fetch all consultation bookings (optionally filterable by status)
   */
  async getAllConsultationBookings(req, res) {
    try {
      // Optionally support query param ?status=pending/confirmed/completed/cancelled
      const { status } = req.query;
      const query = {};
      if (status) query.status = status;

      // Populate: 
      // - client (PatientProfile) and then its 'userId' field with User
      // - consultant (TherapistProfile)
      // - therapy (TherapyType)
      const bookings = await ConsultationBooking.find(query)
        .populate({
          path: "client",
          model: "PatientProfile",
          select: "name email phoneNumber userId",
          populate: {
            path: "userId",
            model: "User",
            select: "name email phoneNumber"
          }
        })
     
        .populate({
          path: "therapy",
          model: "TherapyType",
          select: "name"
        })
        .sort({ createdAt: -1 })
        .lean();

        console.log("----",bookings);
      return res.json({
        success: true,
        bookings,
      });
    } catch (error) {
      console.error("[ADMIN] Error fetching consultation bookings:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch consultation bookings",
        error: error.message,
      });
    }
  }

  /**
   * Approve a consultation booking by _id,
   * check for overlap/availability, if already has approved booking for consultant at the same date+time, alert,
   * else update schedule and approve
   */
  async approveConsultationBooking(req, res) {
    try {
      const { id } = req.params;
      const {
        scheduledAt,
        time,
        durationMinutes,
        adminUpdateReason,
        adminForceUpdate = false, // if true, allow admin to override conflicts
      } = req.body;

      // Fetch the booking
      let booking = await ConsultationBooking.findById(id);
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Consultation booking not found",
        });
      }

      // If already confirmed, do nothing
      if (booking.status === "confirmed") {
        return res.json({
          success: false,
          message: "Booking already approved",
        });
      }

      // Only check availability if consultant and scheduledAt+time provided
 // Only check availability if consultant exists
if (booking.consultant) {

    const theScheduledAt = scheduledAt ? new Date(scheduledAt) : booking.scheduledAt;
    const theTime = time ?? booking.time;
    const theDuration = durationMinutes || booking.durationMinutes || 60;
  
    // Build NEW booking start datetime
    let bookingStart = new Date(theScheduledAt);
  
    if (theTime) {
      const [hours, minutes] = theTime.split(":").map(Number);
      bookingStart.setHours(hours, minutes, 0, 0);
    }
  
    const bookingEnd = new Date(bookingStart.getTime() + theDuration * 60000);
  
    // 🔥 CLEAN OVERLAP CHECK
    const overlapping = await ConsultationBooking.findOne({
      _id: { $ne: booking._id },
      consultant: booking.consultant,
      status: "confirmed",
  
      $expr: {
        $and: [
          // existingStart < newEnd
          {
            $lt: [
              {
                $add: [
                  "$scheduledAt",
                  {
                    $multiply: [
                      {
                        $let: {
                          vars: { split: { $split: [{ $ifNull: ["$time", "00:00"] }, ":"] } },
                          in: {
                            $add: [
                              { $multiply: [{ $toInt: { $arrayElemAt: ["$$split", 0] } }, 60 * 60000] },
                              { $multiply: [{ $toInt: { $arrayElemAt: ["$$split", 1] } }, 60000] }
                            ]
                          }
                        }
                      },
                      1
                    ]
                  }
                ]
              },
              bookingEnd
            ]
          },
  
          // existingEnd > newStart
          {
            $gt: [
              {
                $add: [
                  {
                    $add: [
                      "$scheduledAt",
                      {
                        $multiply: [
                          {
                            $let: {
                              vars: { split: { $split: [{ $ifNull: ["$time", "00:00"] }, ":"] } },
                              in: {
                                $add: [
                                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$split", 0] } }, 60 * 60000] },
                                  { $multiply: [{ $toInt: { $arrayElemAt: ["$$split", 1] } }, 60000] }
                                ]
                              }
                            }
                          },
                          1
                        ]
                      }
                    ]
                  },
                  {
                    $multiply: [
                      { $ifNull: ["$durationMinutes", 60] },
                      60000
                    ]
                  }
                ]
              },
              bookingStart
            ]
          }
        ]
      }
    });
  
    if (overlapping && !adminForceUpdate) {
      return res.status(400).json({
        success: false,
        message:
          "Consultant already has an approved booking during this session period.",
        conflictBooking: overlapping,
      });
    }
  }
  

      // Update the booking as approved + update date/time/duration/reason if provided
      if (scheduledAt) booking.adminUpdatedScheduledAt = scheduledAt;
      if (time) booking.adminUpdatedTime = time;
      if (durationMinutes) booking.adminUpdatedDurationMinutes = durationMinutes;
      if (adminUpdateReason)
        booking.adminUpdateReason = adminUpdateReason;

      // The main scheduledAt/time/duration used for active booking
      if (scheduledAt) booking.scheduledAt = new Date(scheduledAt);
      if (time) booking.time = time;
      if (durationMinutes) booking.durationMinutes = durationMinutes;

      booking.status = "confirmed";

      await booking.save();

      return res.json({
        success: true,
        message: "Consultation booking approved and schedule updated",
        booking,
      });
    } catch (error) {
      console.error("[ADMIN] Error approving consultation booking:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to approve booking",
        error: error.message,
      });
    }
  }
}

export default ConsultationBookingAdminController;