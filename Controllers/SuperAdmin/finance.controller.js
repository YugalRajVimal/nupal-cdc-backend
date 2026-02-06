import Booking from "../../Schema/booking.schema.js";
import Finances from "../../Schema/finances.schema.js";
import { TherapistProfile } from "../../Schema/user.schema.js";


class FinancesSuperAdminController {

  async getFinancesDetails(req, res) {
    try {
      // Accept query params for search, pagination, sort
      let {
        page = 1,
        pageSize = 10,
        search = "",
        sortField = "date",
        sortOrder = "desc"
      } = req.query;

      page = parseInt(page, 10) || 1;
      pageSize = parseInt(pageSize, 10) || 20;

      // Build sorting object
      let sortObj = {};
      if (sortField) sortObj[sortField] = sortOrder === "asc" ? 1 : -1;

      // Fetch all finance records (both income and expense)
      let finances = await Finances.find({})
        .sort(sortObj)
        .lean();

      // In-memory search filtering
      if (search && typeof search === "string" && search.trim().length > 0) {
        const regex = new RegExp(search.trim(), "i");
        finances = finances.filter(f =>
          (f.description && regex.test(f.description)) ||
          (f.creditDebitStatus && regex.test(f.creditDebitStatus)) ||
          (f.type && regex.test(f.type)) ||
          (f.amount !== undefined && f.amount !== null && regex.test(f.amount.toString())) ||
          (f.date && regex.test(new Date(f.date).toISOString().slice(0, 10)))
        );
      }

      // Calculate total income and expenses
      let totalIncome = 0;
      let totalExpenses = 0;
      finances.forEach(finance => {
        if (finance.type && finance.type.toLowerCase() === "income") {
          totalIncome += finance.amount;
        } else if (finance.type && finance.type.toLowerCase() === "expense") {
          totalExpenses += finance.amount;
        }
      });

      // Pagination
      const total = finances.length;
      const offset = (page - 1) * pageSize;
      const pagedFinances = finances.slice(offset, offset + pageSize);

      // Prepare logs for output
      const financeLogs = pagedFinances.map(finance => ({
        Date: finance.date,
        Description: finance.description,
        Type: finance.type.charAt(0).toUpperCase() + finance.type.slice(1),
        Amount: finance.amount,
        CreditDebitStatus: finance.creditDebitStatus
      }));

      // Calculate net balance
      const netBalance = totalIncome - totalExpenses;

      return res.json({
        success: true,
        totalIncome,
        totalExpenses,
        netBalance,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        logs: financeLogs
      });
    } catch (error) {
      console.error("[SUPERADMIN FINANCE DETAILS] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch finance details",
        error: error.message
      });
    }
  }

  getAllTherapistsSalarySessionComparison = async (req, res) => {
    /**
     * GOAL:
     * For each therapist:
     *   - Aggregate all their earnings and sessions in the given periods
     *   - Return a merged object per therapist containing:
     *     therapist info,
     *     an array of earnings (with session/sum info for each),
     *     total sessionDeliveredSumCost (all earnings),
     *     total earningAmount (all earnings),
     *     total difference (all earnings)
     *
     * NOTE: Only match therapist using session.therapist, not booking.therapist.
     */

    console.log("[getAllTherapistsSalarySessionComparison] Controller Called");

    let Types;
    try {
      Types = (await import('mongoose')).Types;
      console.log("[getAllTherapistsSalarySessionComparison] mongoose.Types imported OK");
    } catch (e) {
      console.log("[getAllTherapistsSalarySessionComparison] ERROR importing mongoose.Types", e);
      return res.status(500).json({ error: "Error importing mongoose.Types in getAllTherapistsSalarySessionComparison" });
    }

    let therapists;
    try {
      therapists = await TherapistProfile.find({}).lean();
      if (!Array.isArray(therapists)) {
        console.log("[getAllTherapistsSalarySessionComparison] therapists not array");
        return res.status(500).json({ error: "Could not fetch therapist profiles in getAllTherapistsSalarySessionComparison." });
      }
      console.log(`[getAllTherapistsSalarySessionComparison] Fetched ${therapists.length} therapists`);
    } catch (e) {
      console.log("[getAllTherapistsSalarySessionComparison] ERROR fetching therapists", e);
      return res.status(500).json({ error: "Error fetching therapists in getAllTherapistsSalarySessionComparison" });
    }

    let bookings;
    try {
      bookings = await Booking.find({})
        .populate({ path: "package", model: "Package" })
        .populate({ path: "patient", model: "PatientProfile", select: "name patientId" })
        // Note: no need for .populate("therapist"), we will only use session.therapist
        .lean();
      console.log(`[getAllTherapistsSalarySessionComparison] Fetched ${bookings.length} bookings`);
    } catch (e) {
      console.log("[getAllTherapistsSalarySessionComparison] ERROR fetching bookings", e);
      return res.status(500).json({ error: "Error fetching bookings in getAllTherapistsSalarySessionComparison" });
    }

    // Build result per therapist (merged earnings and sessions by therapist)
    const result = [];

    try {
      for (const therapist of therapists) {
        let therapistIdStr;
        try {
          therapistIdStr = therapist._id.toString();
        } catch (e) {
          console.log(`[getAllTherapistsSalarySessionComparison] Error extracting therapistId for:`, therapist);
          result.push({
            therapist: {
              _id: therapist._id,
              therapistId: therapist.therapistId,
              name: therapist.name,
              userId: therapist.userId,
              experienceYears: therapist.experienceYears
            },
            warning: `Error extracting therapistId, therapist skipped in getAllTherapistsSalarySessionComparison`,
            error: true,
          });
          continue;
        }

        if (!Types.ObjectId.isValid(therapistIdStr)) {
          console.log(`[getAllTherapistsSalarySessionComparison] Invalid therapistId for therapist: ${therapistIdStr}`);
          result.push({
            therapist: {
              _id: therapist._id,
              therapistId: therapist.therapistId,
              name: therapist.name,
              userId: therapist.userId,
              experienceYears: therapist.experienceYears
            },
            warning: `Invalid therapistId for therapist: ${therapistIdStr} in getAllTherapistsSalarySessionComparison`,
            error: true,
          });
          continue;
        }

        // Skip if no earnings array at all
        if (!Array.isArray(therapist.earnings)) {
          console.log(`[getAllTherapistsSalarySessionComparison] Therapist (${therapistIdStr}) has no earnings array, skipped.`);
          continue;
        }

        // Structure: aggregate at therapist level
        let therapistAggregate = {
          therapist: {
            _id: therapist._id,
            therapistId: therapist.therapistId,
            name: therapist.name,
            userId: therapist.userId,
            experienceYears: therapist.experienceYears,
          },
          earnings: [],
          totalSessionDeliveredSumCost: 0,
          totalEarningAmount: 0,
          totalDifference: 0
        };

        for (const earning of therapist.earnings) {
          if (!earning.fromDate || !earning.toDate) {
            console.log(`[getAllTherapistsSalarySessionComparison] Skipped earning for missing fromDate/toDate`, earning);
            continue;
          }

          const sessionsMatched = [];
          let sumOfSessionPrices = 0;

          let earningFrom, earningTo;
          try {
            earningFrom = new Date(earning.fromDate);
            earningTo = new Date(earning.toDate);
          } catch (e) {
            console.log("[getAllTherapistsSalarySessionComparison] Error parsing earning date range", e, earning);
            sessionsMatched.push({
              warning: "Error parsing earning date range in getAllTherapistsSalarySessionComparison",
              earning,
            });
            // Don't include, this period is broken
            continue;
          }

          // For this earning, scan ALL bookings, all sessions
          for (const booking of bookings) {
            if (!Array.isArray(booking.sessions)) continue;

            let sessionPrice = (booking.package && typeof booking.package.costPerSession === "number") 
              ? booking.package.costPerSession 
              : undefined;

            for (const session of booking.sessions) {
              try {
                // Match therapist by session.therapist only!
                if (!session.therapist) continue;

                let sessionTherapistId;
                if (typeof session.therapist === "object" && session.therapist.toString) {
                  sessionTherapistId = session.therapist.toString();
                } else if (typeof session.therapist === "string") {
                  sessionTherapistId = session.therapist;
                }

                if (!Types.ObjectId.isValid(sessionTherapistId)) {
                  continue;
                }

                if (sessionTherapistId !== therapistIdStr) {
                  continue;
                }

                // Only consider checked-in sessions
                if (!session.isCheckedIn) continue;

                // session.date exists & in range?
                if (!session.date) continue;
                let sessionDateObj;
                try {
                  sessionDateObj = new Date(session.date);
                  if (isNaN(sessionDateObj.valueOf())) throw new Error("Invalid date");
                } catch (e) {
                  continue;
                }

                if (sessionDateObj < earningFrom || sessionDateObj > earningTo) {
                  continue;
                }

                let price = typeof session.price === "number"
                  ? session.price
                  : (typeof sessionPrice === "number" ? sessionPrice : 0);

                sumOfSessionPrices += price;

                sessionsMatched.push({
                  date: session.date,
                  sessionId: session.sessionId || undefined,
                  slotId: session.slotId,
                  isCheckedIn: session.isCheckedIn,
                  price,
                  bookingId: booking._id,
                  package: booking.package
                    ? {
                        _id: booking.package._id,
                        name: booking.package.name,
                        costPerSession: booking.package.costPerSession,
                        totalCost: booking.package.totalCost,
                        sessionCount: booking.package.sessionCount,
                      }
                    : undefined,
                  patient: booking.patient
                    ? {
                        _id: booking.patient._id,
                        name: booking.patient.name,
                        patientId: booking.patient.patientId,
                      }
                    : undefined,
                });
              } catch (e) {
                continue;
              }
            }
          }

          let difference = earning.amount - sumOfSessionPrices;

          // Add to therapist-aggregate earnings:
          therapistAggregate.earnings.push({
            earning, // full earning object
            sessions: sessionsMatched,
            sessionDeliveredSumCost: sumOfSessionPrices,
            earningAmount: earning.amount,
            difference
          });

          therapistAggregate.totalSessionDeliveredSumCost += sumOfSessionPrices;
          therapistAggregate.totalEarningAmount += earning.amount;
          therapistAggregate.totalDifference += difference;
        }

        // Only push if there are earning records (otherwise a therapist with 0 earnings not shown)
        if (therapistAggregate.earnings.length > 0) {
          result.push(therapistAggregate);
        }
      }

      console.log(`[getAllTherapistsSalarySessionComparison] Build aggregated result complete. Therapist entries: ${result.length}`);
      return res.json(result);
    } catch (e) {
      console.log("[getAllTherapistsSalarySessionComparison] ERROR building result object", e);
      return res.status(500).json({
        error: "Error building result in getAllTherapistsSalarySessionComparison",
      });
    }
  };

   
}

export default FinancesSuperAdminController;

