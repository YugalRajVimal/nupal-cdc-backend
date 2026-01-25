import Booking from "../../Schema/booking.schema.js";



class AppointmentSuperAdminController {


  // Get all bookings (populated)
  /**
   * Get all bookings with support for filters, search, and pagination
   * Query params:
   *  - search: search text for patient/therapist/package
   *  - therapistId: filter by therapist
   *  - patientId: filter by patient
   *  - packageId: filter by package
   *  - status: filter by booking status (if any)
   *  - dateFrom, dateTo: filter by booking create/update (ISO string)
   *  - page: page number (default 1)
   *  - limit: page size (default 20)
   */
  async getAllBookings(req, res) {
    try {
      // Extract and normalize query parameters
      const {
        search = "",
        status,
        page = 1,
        limit = 20,
      } = req.query;

      const pageNum = Math.max(Number(page) || 1, 1);
      const limitNum = Math.max(Number(limit) || 20, 1);
      const skip = (pageNum - 1) * limitNum;

      // Build filter query: ONLY status, no date and no id-based filter!
      const bookingQuery = {};
      if (status) bookingQuery.status = status;

      // Only search for all using a unified $or block:
      // - patient.name, therapist.name, package.name, booking._id, patientId, therapistId, appointmentId, booking date (createdAt)
      let pipeline = [{ $match: bookingQuery }];

      if (search && typeof search === "string" && search.trim()) {
        // Attempt to build a date query for createdAt using the search
        let dateRegex = /^(\d{4})-(\d{2})-(\d{2})/; // Looking for yyyy-mm-dd in search
        let datePartMatch = search.trim().match(dateRegex);
        let dateMatchCondition = null;

        if (datePartMatch) {
          // If part of the search looks like a date, search by date part of createdAt
          // We will match the ISODate string for the yyyy-mm-dd portion
          const isoPrefix = datePartMatch[0];
          dateMatchCondition = {
            $expr: {
              $regexMatch: {
                input: { $dateToString: { date: "$createdAt", format: "%Y-%m-%d" } },
                regex: isoPrefix,
                options: "i"
              }
            }
          };
        }

        pipeline = pipeline.concat([
          // Join patient
          {
            $lookup: {
              from: "patientprofiles",
              localField: "patient",
              foreignField: "_id",
              as: "pop_patient"
            }
          },
          { $unwind: { path: "$pop_patient", preserveNullAndEmptyArrays: true } },
          // Join patient.userId
          {
            $lookup: {
              from: "users",
              localField: "pop_patient.userId",
              foreignField: "_id",
              as: "pop_patient_user"
            }
          },
          { $unwind: { path: "$pop_patient_user", preserveNullAndEmptyArrays: true } },

          // Join therapist
          {
            $lookup: {
              from: "therapistprofiles",
              localField: "therapist",
              foreignField: "_id",
              as: "pop_therapist"
            }
          },
          { $unwind: { path: "$pop_therapist", preserveNullAndEmptyArrays: true } },
          // Join therapist.userId
          {
            $lookup: {
              from: "users",
              localField: "pop_therapist.userId",
              foreignField: "_id",
              as: "pop_therapist_user"
            }
          },
          { $unwind: { path: "$pop_therapist_user", preserveNullAndEmptyArrays: true } },

          // Join package
          {
            $lookup: {
              from: "packages",
              localField: "package",
              foreignField: "_id",
              as: "pop_package"
            }
          },
          { $unwind: { path: "$pop_package", preserveNullAndEmptyArrays: true } },

          // Add search fields
          {
            $addFields: {
              patientNameForSearch: {
                $ifNull: ["$pop_patient.name", "$pop_patient_user.name"]
              },
              patientIdForSearch: {
                $ifNull: ["$pop_patient.patientId", "$pop_patient_user.patientId"]
              },
              therapistNameForSearch: {
                $ifNull: ["$pop_therapist.name", "$pop_therapist_user.name"]
              },
              therapistIdForSearch: {
                $ifNull: ["$pop_therapist.therapistId", "$pop_therapist_user.therapistId"]
              },
              packageNameForSearch: "$pop_package.name",
              createdAtString: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
              },
              appointmentIdForSearch: "$appointmentId"
            }
          },
          // Search
          {
            $match: {
              $or: [
                { patientNameForSearch: { $regex: search, $options: "i" } },
                { therapistNameForSearch: { $regex: search, $options: "i" } },
                { packageNameForSearch: { $regex: search, $options: "i" } },
                { patientIdForSearch: { $regex: search, $options: "i" } },
                { therapistIdForSearch: { $regex: search, $options: "i" } },
                { _id: search },
                { appointmentIdForSearch: { $regex: search, $options: "i" } }, // <-- appointmentId search
                // Date string match (for yyyy-mm-dd)
                { createdAtString: { $regex: search, $options: "i" } }
              ].concat(dateMatchCondition ? [dateMatchCondition] : [])
            }
          }
        ]);
      }

      // Count total
      const countPipeline = [...pipeline, { $count: "count" }];
      let totalCount = 0;
      const countResult = await Booking.aggregate(countPipeline);
      totalCount = (countResult && countResult[0] && countResult[0].count) || 0;

      // Pagination
      pipeline.push({ $sort: { createdAt: -1 } });
      pipeline.push({ $skip: skip });
      pipeline.push({ $limit: limitNum });

      // Final bookings
      let bookingsRaw = await Booking.aggregate(pipeline);

      // Populate nested models as before
      const bookingIds = bookingsRaw.map(b => b._id);
      let bookings = [];
      if (bookingIds.length) {
        bookings = await Booking.find({ _id: { $in: bookingIds } })
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
          })
          .sort({ createdAt: -1 });
        bookings = bookingIds.map(id => bookings.find(b => String(b._id) === String(id))).filter(Boolean);
      }

      return res.json({
        success: true,
        bookings,
        page: pageNum,
        limit: limitNum,
        total: totalCount
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

