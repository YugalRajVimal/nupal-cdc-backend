import ConsultationBooking from "../../Schema/consultation-booking.schema.js";
import WhatsappController from "../Whatsapp/whatsapp.js"; 

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
   * else update schedule and approve, then send WhatsApp message to patient
   */
  async statusUpdateConsultationBooking(req, res) {
    try {
      console.log("[ADMIN][statusUpdateConsultationBooking] Start function. req.params:", req.params);
      const { id } = req.params;
      const {
        scheduledAt,
        time,
        durationMinutes,
        adminUpdateReason,
        adminForceUpdate = false,
        status: updateStatus, // allow specifying new status directly (optional)
      } = req.body;
      console.log("[ADMIN][statusUpdateConsultationBooking] Received body:", req.body);

      // Fetch the booking
      let booking = await ConsultationBooking.findById(id)
        .populate([
          {
            path: "client",
            model: "PatientProfile",
            select: "name phoneNumber userId",
            populate: {
              path: "userId",
              model: "User",
              select: "name phone phoneNumber", // Ensure both fields come through
            }
          },
          {
            path: "consultant",
            model: "TherapistProfile",
            select: "name"
          }
        ]);
      console.log("[ADMIN][statusUpdateConsultationBooking] Fetched booking:", booking ? booking._id : "NOT_FOUND");

      // Debug: log if booking not found
      if (!booking) {
        console.log("[ADMIN][statusUpdateConsultationBooking] Booking not found with id:", id);
        return res.status(404).json({
          success: false,
          message: "Consultation booking not found",
        });
      }

      let prevStatus = booking.status;
      let newStatus = booking.status;
      let manualStatus = false;
      console.log("[ADMIN][statusUpdateConsultationBooking] Prev status:", prevStatus, "UpdateStatus from body:", updateStatus);

      // Accept an optional status override
      if (updateStatus && ["pending", "confirmed", "completed", "cancelled"].includes(updateStatus)) {
        newStatus = updateStatus;
        manualStatus = true;
        console.log("[ADMIN][statusUpdateConsultationBooking] Manual status set:", newStatus);
      }

      // Only allow approving if status is 'pending'
      if (!manualStatus) {
        if (booking.status === "completed" || booking.status === "cancelled") {
          console.log(`[ADMIN][statusUpdateConsultationBooking] Cannot approve: status is '${booking.status}' (id: ${booking._id})`);
          await sendConsultationStatusWhatsappMandatory(
            booking,
            booking.status,
            adminUpdateReason,
            "Attempted to approve a booking that is already completed or cancelled."
          );
          return res.json({
            success: false,
            message: `Cannot approve a ${booking.status} booking`,
          });
        }
        if (booking.status === "confirmed") {
          console.log(`[ADMIN][statusUpdateConsultationBooking] Booking already approved (id: ${booking._id})`);
          await sendConsultationStatusWhatsappMandatory(
            booking,
            booking.status,
            adminUpdateReason,
            "Booking is already approved."
          );
          return res.json({
            success: false,
            message: "Booking already approved",
          });
        }
      }

      // Only check availability if consultant exists and we're confirming it (not for completed/cancelled)
      if (
        booking.consultant &&
        (newStatus === "confirmed" || (!manualStatus && booking.status === "pending"))
      ) {
        console.log("[ADMIN][statusUpdateConsultationBooking] Checking for overlapping bookings for consultant:", booking.consultant?._id || booking.consultant);
        const theScheduledAt = scheduledAt ? new Date(scheduledAt) : booking.scheduledAt;
        const theTime = time ?? booking.time;
        const theDuration = durationMinutes || booking.durationMinutes || 60;
        console.log("[ADMIN][statusUpdateConsultationBooking] Time to check overlap: ", {theScheduledAt, theTime, theDuration});

        let bookingStart = new Date(theScheduledAt);

        if (theTime) {
          const [hours, minutes] = theTime.split(":").map(Number);
          bookingStart.setHours(hours, minutes, 0, 0);
        }
        const bookingEnd = new Date(bookingStart.getTime() + theDuration * 60000);

        console.log("[ADMIN][statusUpdateConsultationBooking] bookingStart:", bookingStart, "bookingEnd:", bookingEnd);

        const overlapping = await ConsultationBooking.findOne({
          _id: { $ne: booking._id },
          consultant: booking.consultant._id ? booking.consultant._id : booking.consultant,
          status: "confirmed",
          $expr: {
            $and: [
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

        console.log("[ADMIN][statusUpdateConsultationBooking] Overlapping booking found:", overlapping);

        if (overlapping && !adminForceUpdate) {
          console.log(`[ADMIN][statusUpdateConsultationBooking] Overlap detected! Consultant id: ${booking.consultant?._id || booking.consultant}, bookingId: ${booking._id}`, { conflictBooking: overlapping });
          await sendConsultationStatusWhatsappMandatory(
            booking,
            "overlap",
            adminUpdateReason,
            "Consultant already has a confirmed booking in this period."
          );
          return res.status(400).json({
            success: false,
            message:
              "Consultant already has an approved booking during this session period.",
            conflictBooking: overlapping,
          });
        }
      } else {
        console.log("[ADMIN][statusUpdateConsultationBooking] Skipped overlap check. consultant or status did not match.");
      }

      // Update the booking's details if provided
      if (scheduledAt) {
        booking.adminUpdatedScheduledAt = scheduledAt;
        console.log("[ADMIN][statusUpdateConsultationBooking] Set adminUpdatedScheduledAt:", scheduledAt);
      }
      if (time) {
        booking.adminUpdatedTime = time;
        console.log("[ADMIN][statusUpdateConsultationBooking] Set adminUpdatedTime:", time);
      }
      if (durationMinutes) {
        booking.adminUpdatedDurationMinutes = durationMinutes;
        console.log("[ADMIN][statusUpdateConsultationBooking] Set adminUpdatedDurationMinutes:", durationMinutes);
      }
      if (adminUpdateReason) {
        booking.adminUpdateReason = adminUpdateReason;
        console.log("[ADMIN][statusUpdateConsultationBooking] Set adminUpdateReason:", adminUpdateReason);
      }

      // The main scheduledAt/time/duration used for active booking
      if (scheduledAt){
        booking.scheduledAt = new Date(scheduledAt);
        console.log("[ADMIN][statusUpdateConsultationBooking] Updated scheduledAt to:", booking.scheduledAt);
      }
      if (time){
        booking.time = time;
        console.log("[ADMIN][statusUpdateConsultationBooking] Updated time to:", booking.time);
      }
      if (durationMinutes){
        booking.durationMinutes = durationMinutes;
        console.log("[ADMIN][statusUpdateConsultationBooking] Updated durationMinutes to:", booking.durationMinutes);
      }

      // Status update based on path: approve set to confirmed, direct status update sets to provided value
      let statusChanged = false;
      if (manualStatus) {
        if (booking.status !== newStatus) {
          statusChanged = true;
          booking.status = newStatus;
          console.log("[ADMIN][statusUpdateConsultationBooking] Manual status update applied:", booking.status);
        }
      } else if (booking.status === "pending") {
        booking.status = "confirmed";
        statusChanged = true;
        console.log("[ADMIN][statusUpdateConsultationBooking] Status auto-set to confirmed.");
      }
      console.log("[ADMIN][statusUpdateConsultationBooking] Saving booking with current status:", booking.status, "; Any statusChanged:", statusChanged);

      await booking.save();
      console.log("[ADMIN][statusUpdateConsultationBooking] Booking saved to database.");

      // Always send WhatsApp message for these status updates, all fields are mandatory
      const whatsappResp = {};
      try {
        let statusForMessage = booking.status;
        let patientUser = booking.client?.userId || {};
        let userName = (
          patientUser.name ||
          booking.client?.name ||
          ""
        );
        let phoneNumber = (
          patientUser.phone ||
          patientUser.phoneNumber ||
          booking.client?.phoneNumber ||
          ""
        );
        // Remove consultantName from WhatsApp payloads
        const date = booking.scheduledAt
          ? new Date(booking.scheduledAt).toLocaleDateString("en-IN", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "";
        const sendTime =
          booking.time ||
          (booking.scheduledAt
            ? new Date(booking.scheduledAt).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "");

        // ALWAYS send some extra message
        let extraMessage = `This is an important update from our team.`;
        if (adminUpdateReason) {
          extraMessage += `\nNote from Admin: ${adminUpdateReason}`;
        }

        console.log("[ADMIN][statusUpdateConsultationBooking][WHATSAPP] About to check mandatory fields for WhatsApp message", {
          userName, phoneNumber, statusForMessage, date, sendTime
        });

        // Validate all mandatory fields for WhatsApp (removed consultantName check)
        if (
          !userName ||
          !phoneNumber ||
          !statusForMessage ||
          !date ||
          !sendTime
        ) {
          whatsappResp.error = "All fields for WhatsApp message are mandatory: missing one or more required fields";
          console.error("[ADMIN][WHATSAPP] Mandatory WhatsApp fields missing", {
            userName, phoneNumber, statusForMessage, date, sendTime
          });
        } else {
          if (typeof phoneNumber === "string") {
            phoneNumber = phoneNumber.trim();
            if (phoneNumber.startsWith("0")) {
              phoneNumber = phoneNumber.slice(1);
              console.log("[ADMIN][statusUpdateConsultationBooking][WHATSAPP] Phone number cleaned to remove leading 0:", phoneNumber);
            } else if (
              !phoneNumber.startsWith("+") &&
              phoneNumber.length === 10
            ) {
              phoneNumber = phoneNumber;
              console.log("[ADMIN][statusUpdateConsultationBooking][WHATSAPP] Phone number assumed as is (10 digits):", phoneNumber);
            }
          }
        
          console.log("[ADMIN][statusUpdateConsultationBooking][WHATSAPP] Sending WhatsApp message via controller:", {
            destination: phoneNumber,
            userName: userName,
            status: statusForMessage,
            date,
            time: sendTime,
            extraMessage,
          });

          whatsappResp.whatsapp = await WhatsappController.sendConsultationBookingStatusUpdate({
            destination: phoneNumber,
            userName: userName,
            status: statusForMessage,
            date,
            time: sendTime,
            extraMessage,
          });

          console.log("[ADMIN][statusUpdateConsultationBooking][WHATSAPP] WhatsApp Controller response:", whatsappResp.whatsapp);
        }
      } catch (err) {
        whatsappResp.error = err?.message || err;
        console.error(
          "[ADMIN][WHATSAPP] Error sending consultation booking status WhatsApp notification:",
          err
        );
      }

      // Debug: print outcome
      console.log("[ADMIN][statusUpdateConsultationBooking] Booking status updated", {
        id: booking._id,
        client: booking.client?._id,
        consultant: booking.consultant?._id || booking.consultant,
        scheduledAt: booking.scheduledAt,
        time: booking.time,
        durationMinutes: booking.durationMinutes,
        status: booking.status,
        statusChanged,
        whatsappResp
      });

      return res.json({
        success: true,
        message: `Consultation booking status updated to ${booking.status}`,
        booking,
        whatsapp: whatsappResp,
      });

      // Helper for sending WhatsApp status update in various situations
      async function sendConsultationStatusWhatsappMandatory(booking, status, adminUpdateReason, extraReasonMsg) {
        try {
          console.log("[ADMIN][sendConsultationStatusWhatsappMandatory] Called with:", {
            bookingId: booking?._id, status, adminUpdateReason, extraReasonMsg
          });
          let patientUser = booking.client?.userId || {};
          let userName = (
            patientUser.name ||
            booking.client?.name ||
            ""
          );
          let phoneNumber = (
            patientUser.phone ||
            patientUser.phoneNumber ||
            booking.client?.phoneNumber ||
            ""
          );
          // Remove consultantName from WhatsApp payloads
          const date = booking.scheduledAt
            ? new Date(booking.scheduledAt).toLocaleDateString("en-IN", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : "";
          const sendTime = booking.time ||
            (booking.scheduledAt
              ? new Date(booking.scheduledAt).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "");

          // ALWAYS send some extra message
          let extraMessage = `This is an important update from our team.`;
          if (adminUpdateReason) {
            extraMessage += `Note from Admin: ${adminUpdateReason}`;
          }
          if (extraReasonMsg) {
            extraMessage += `\n${extraReasonMsg}`;
          }

          console.log("[ADMIN][sendConsultationStatusWhatsappMandatory] WhatsApp payload precheck:", {
            userName, phoneNumber, status, date, sendTime, extraMessage
          });

          // Validate all mandatory fields before sending WhatsApp (removed consultantName check)
          if (
            !userName ||
            !phoneNumber ||
            !status ||
            !date ||
            !sendTime
          ) {
            console.error("[ADMIN][WHATSAPP] Mandatory WhatsApp fields missing (helper)", {
              userName, phoneNumber, status, date, sendTime
            });
            return;
          }

          if (typeof phoneNumber === "string") {
            phoneNumber = phoneNumber.trim();
            if (phoneNumber.startsWith("0")) {
              phoneNumber = phoneNumber.slice(1);
              console.log("[ADMIN][sendConsultationStatusWhatsappMandatory] Phone number cleaned to remove leading 0:", phoneNumber);
            } else if (
              !phoneNumber.startsWith("+") &&
              phoneNumber.length === 10
            ) {
              phoneNumber = phoneNumber;
              console.log("[ADMIN][sendConsultationStatusWhatsappMandatory] Phone number assumed as is (10 digits):", phoneNumber);
            }
          }

          console.log("[ADMIN][sendConsultationStatusWhatsappMandatory] Sending WhatsApp with:", {
            destination: phoneNumber,
            userName: userName,
            status: status,
            date,
            time: sendTime,
            extraMessage,
          });

          await WhatsappController.sendConsultationBookingStatusUpdate({
            destination: phoneNumber,
            userName: userName,
            status: status,
            date,
            time: sendTime,
            extraMessage,
          });

          console.log("[ADMIN][sendConsultationStatusWhatsappMandatory] WhatsApp sent successfully!");
        
        } catch (waErr) {
          console.error("[ADMIN][WHATSAPP] Error sending WhatsApp status update (helper):", waErr);
        }
      }
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