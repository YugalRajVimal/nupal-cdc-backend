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

      // Ensure numbers are parsed and fallback to defaults if invalid
      page = parseInt(page, 10) || 1;
      pageSize = parseInt(pageSize, 10) || 20;

      // Build sorting object for mongo sort
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
          (f.date && regex.test(new Date(f.date).toISOString().slice(0, 10))) ||
          (f.paymentMethod && regex.test(f.paymentMethod)) ||
          (f.utr && Array.isArray(f.utr) && f.utr.some(u => regex.test(u))) ||
          (f.childrenName && regex.test(f.childrenName)) ||
          (f.childrenId && regex.test(f.childrenId?.toString()))
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

      // Prepare logs for output, match all details as in finances.schema.js
      const financeLogs = pagedFinances.map(finance => ({
        _id: finance._id,
        Date: finance.date,
        Description: finance.description,
        Type: finance.type.charAt(0).toUpperCase() + finance.type.slice(1),
        Amount: finance.amount,
        CreditDebitStatus: finance.creditDebitStatus,
        PaymentMethod: finance.paymentMethod,
        Utr: finance.utr,
        CreatedAt: finance.createdAt,
        UpdatedAt: finance.updatedAt,
        ChildrenName: finance.childrenName,
        ChildrenId: finance.childrenId,
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
     * UPDATED GOAL (now for ACTIVE therapists only!):
     * For each therapist:
     *   - If they have earnings, aggregate all their earnings and sessions in the given periods (as before)
     *   - If they have NO earnings but have completed (checked-in) sessions, 
     *     send a result object for them with earnings: [] but session details included in a separate field
     *   - Every therapist should thus always have a result entry, including those with no earnings but with checked-in sessions
     * 
     * NOTE: Only match therapist using session.therapist, not booking.therapist.
     * ONLY include active therapists (user.status: 'active')!
     */

    console.log("Step 1: [getAllTherapistsSalarySessionComparison] Controller Called");

    let Types;
    try {
      Types = (await import('mongoose')).Types;
      console.log("Step 2: [getAllTherapistsSalarySessionComparison] mongoose.Types imported OK");
    } catch (e) {
      console.log("Step 2: [getAllTherapistsSalarySessionComparison] ERROR importing mongoose.Types", e);
      return res.status(500).json({ error: "Error importing mongoose.Types in getAllTherapistsSalarySessionComparison" });
    }

    // -- Step 3: Fetch ACTIVE therapists only --
    let therapists;
    try {
      // We must join TherapistProfile with User where user.status === "active".
      // To do this efficiently, first find userIds of therapist users who are active.
      // Assuming TherapistProfile.userId references User._id
      const User = (await import('../../Schema/user.schema.js')).User;

      // Find userIds for active therapist users
      const activeTherapistUsers = await User.find({ 
        role: 'therapist', 
      }, { _id: 1 }).lean();
 

      const activeTherapistUserIds = activeTherapistUsers.map(u => u._id);

      therapists = await TherapistProfile.find({
        userId: { $in: activeTherapistUserIds }
      })
        .populate({ path: 'userId', model: 'User', select: 'status isDisabled name email' })
        .lean();
 

      if (!Array.isArray(therapists)) {
        console.log("Step 3: [getAllTherapistsSalarySessionComparison] therapists not array");
        return res.status(500).json({ error: "Could not fetch therapist profiles in getAllTherapistsSalarySessionComparison." });
      }
      console.log(`Step 3: [getAllTherapistsSalarySessionComparison] Fetched ${therapists.length} ACTIVE therapists`);
    } catch (e) {
      console.log("Step 3: [getAllTherapistsSalarySessionComparison] ERROR fetching active therapists", e);
      return res.status(500).json({ error: "Error fetching (active) therapists in getAllTherapistsSalarySessionComparison" });
    }

    let bookings;
    try {
      bookings = await Booking.find({})
        .populate({ path: "package", model: "Package" })
        .populate({ path: "patient", model: "PatientProfile", select: "name patientId" })
        // No need for .populate("therapist"), we will only use session.therapist
        .lean();
      console.log(`Step 4: [getAllTherapistsSalarySessionComparison] Fetched ${bookings.length} bookings`);
    } catch (e) {
      console.log("Step 4: [getAllTherapistsSalarySessionComparison] ERROR fetching bookings", e);
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
          console.log(`Step 5: [getAllTherapistsSalarySessionComparison] Error extracting therapistId for:`, therapist);
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
          console.log(`Step 6: [getAllTherapistsSalarySessionComparison] Invalid therapistId for therapist: ${therapistIdStr}`);
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

        // Use empty array for earnings if missing or not an array
        let earningsArr = Array.isArray(therapist.earnings) ? therapist.earnings : [];

        // Aggregate as before
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
          totalDifference: 0,
          sessionsWithoutEarning: [] // <--- we will populate this if needed (see below)
        };

        // 1. Handle earning ranges as before
        for (const earning of earningsArr) {
          if (!earning.fromDate || !earning.toDate) {
            console.log(`Step 8: [getAllTherapistsSalarySessionComparison] Skipped earning for missing fromDate/toDate`, earning);
            continue;
          }

          const sessionsMatched = [];
          let sumOfSessionPrices = 0;

          let earningFrom, earningTo;
          try {
            earningFrom = new Date(earning.fromDate);
            earningTo = new Date(earning.toDate);
          } catch (e) {
            console.log("Step 9: [getAllTherapistsSalarySessionComparison] Error parsing earning date range", e, earning);
            sessionsMatched.push({
              warning: "Error parsing earning date range in getAllTherapistsSalarySessionComparison",
              earning,
            });
            // Don't include, this period is broken
            continue;
          }

          // For this earning, scan ALL bookings, all sessions for this therapist
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

        // 2. If no earnings (or empty earnings), still check if there are completed sessions for this therapist
        if (therapistAggregate.earnings.length === 0) {
          // Find all checked-in sessions for this therapist
          let therapistCheckedInSessions = [];
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
                if (!session.date) continue;

                let price = typeof session.price === "number"
                  ? session.price
                  : (typeof sessionPrice === "number" ? sessionPrice : 0);

                therapistCheckedInSessions.push({
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
          therapistAggregate.sessionsWithoutEarning = therapistCheckedInSessions;
          therapistAggregate.totalSessionDeliveredSumCost = therapistCheckedInSessions.reduce((acc, s) => acc + (s.price || 0), 0);
          // earning amount and difference stay zero
        } else {
          // For therapists with earnings, optional: still include checked-in sessions NOT covered by any earning?
          // For now, do not include additional sessions. All sessions relevant are with earnings range.
        }

        // Always push (as per requirement: always send data for all therapists)
        result.push(therapistAggregate);
      }

      console.log(`Step 10: [getAllTherapistsSalarySessionComparison] Build aggregated result complete. Therapist entries: ${result.length}`);
      return res.json(result);
    } catch (e) {
      console.log("Step 11: [getAllTherapistsSalarySessionComparison] ERROR building result object", e);
      return res.status(500).json({
        error: "Error building result in getAllTherapistsSalarySessionComparison",
      });
    }
  };

   
}

export default FinancesSuperAdminController;

