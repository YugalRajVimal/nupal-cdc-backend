import { TherapistProfile, User } from "../../Schema/user.schema.js";

class AavailabilitySlotsAdminController {


async getAvailabilitySummary(req, res) {
  try {
    // 1. Get all active therapists (not suspended or deleted)
    let therapistProfiles = await TherapistProfile.find({}).lean();
    const userIds = therapistProfiles.map(t => t.userId).filter(Boolean);

    // Only therapists with active "user" are considered.
    const users = await User.find({
      _id: { $in: userIds },
      role: "therapist",
      status: "active"
    }, { _id: 1 }).lean();

    let activeTherapists = therapistProfiles.filter(tp =>
      users.some(u => String(u._id) === String(tp.userId))
    );

    // If therapistId query param is present, filter by therapistId (ObjectID string on _id)
    let filterTherapistId = null;
    if (req.query && req.query.therapistId) {
      filterTherapistId = String(req.query.therapistId);
      // Find matching by _id (ObjectID):
      activeTherapists = activeTherapists.filter(tp => String(tp._id) === filterTherapistId);
      // If no such therapist, return empty data
      if (activeTherapists.length === 0) {
        return res.json({ success: true, data: {} });
      }
    }

    // Map therapist db _id to "therapistId"
    const therapistIdMap = {};
    activeTherapists.forEach(tp => {
      therapistIdMap[String(tp._id)] = tp.therapistId;
    });

    // Holidays map for each therapist: _id(str) -> [YYYY-MM-DD]
    function formatDateIso(date) {
      if (!date) return "";
      let dObj = (date instanceof Date) ? date : new Date(date);
      if (isNaN(dObj)) return "";
      return dObj.toISOString().slice(0, 10);
    }
    const holidaysByTherapist = {};
    for (const tp of activeTherapists) {
      holidaysByTherapist[String(tp._id)] = Array.isArray(tp.holidays)
        ? tp.holidays.map(h => formatDateIso(h.date)).filter(Boolean)
        : [];
    }

    // 2. Build dateKeys for required window
    let fromDate, toDate;
    if (
      req.query &&
      req.query.from &&
      req.query.to &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
    ) {
      fromDate = new Date(req.query.from);
      toDate = new Date(req.query.to);
    } else {
      // Fallback: next 14 days, as previous logic
      fromDate = new Date();
      toDate = new Date();
      toDate.setDate(fromDate.getDate() + 13);
    }
    if (isNaN(fromDate) || isNaN(toDate)) {
      return res.status(400).json({ success: false, error: "Invalid from/to date range" });
    }

    // Generate dateKeys from fromDate to toDate inclusive
    const dateKeys = [];
    let d = new Date(fromDate);
    while (d <= toDate) {
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      dateKeys.push({
        display: `${day}-${month}-${year}`,
        iso: `${year}-${month}-${day}`,
      });
      d.setDate(d.getDate() + 1);
    }

    // 3. Session times
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

    const limitedSlotsSet = new Set(SESSION_TIME_OPTIONS.filter(s => s.limited).map(s => s.id));

    // 4. Gather all bookings that overlap the window and are by the active therapists
    const Booking = (await import("../../Schema/booking.schema.js")).default;
    const therapistsObjIds = activeTherapists.map(tp => tp._id);
    const allIsoDates = dateKeys.map(dk => dk.iso);
    const bookings = await Booking.find({
      "therapist": { $in: therapistsObjIds },
      "sessions.date": { $in: allIsoDates }
    }, { sessions: 1, therapist: 1 }).lean();

    // Aggregate per date/therapist/slot
    const bookedSlotsByDate = {};
    for (const bk of bookings) {
      const therapistObjId = String(bk.therapist);
      const therapistId = therapistIdMap[therapistObjId];
      if (!therapistId) continue;
      if (!bk.sessions || !Array.isArray(bk.sessions)) continue;
      for (const sess of bk.sessions) {
        const sessDate = sess.date;
        const slotId = sess.slotId || sess.id;
        if (!sessDate || !slotId) continue;
        if (!bookedSlotsByDate[sessDate]) bookedSlotsByDate[sessDate] = {};
        if (!bookedSlotsByDate[sessDate][therapistId]) bookedSlotsByDate[sessDate][therapistId] = new Set();
        bookedSlotsByDate[sessDate][therapistId].add(slotId);
      }
    }

    // 5. For each day, calculate the totals in alignment with session options and frontend
    const availability = {};
    for (const { display, iso } of dateKeys) {
      // Filter therapists that are not on holiday for this day
      let availableTherapists = activeTherapists.filter(tp => {
        const holidaysArr = holidaysByTherapist[String(tp._id)] || [];
        return !holidaysArr.includes(iso);
      });

      // If therapistId is specified, only count that single therapist for slots/limits etc
      if (filterTherapistId) {
        // availableTherapists should only contain one therapist with this ObjectId
        availableTherapists = availableTherapists.filter(tp => String(tp._id) === filterTherapistId);
      }

      // Frontend session tally: 10 regular + 5 limited per therapist
      const totalNormalSlots = availableTherapists.length * SESSION_TIME_OPTIONS.filter(s => !s.limited).length;
      const totalLimitedSlots = availableTherapists.length * SESSION_TIME_OPTIONS.filter(s => s.limited).length;

      // For BookedSlots object: key = therapistId, vals = [slotId,...]
      let bookedSlotsObj = {};
      if (bookedSlotsByDate[iso]) {
        for (const therapistId in bookedSlotsByDate[iso]) {
          // Only include this therapist if therapistId is specified, otherwise include all
          if (!filterTherapistId || therapistId === therapistIdMap[filterTherapistId])
            bookedSlotsObj[therapistId] = Array.from(bookedSlotsByDate[iso][therapistId]);
        }
      }

      let bookedSlots = 0, limitedBookedSlots = 0;
      if (bookedSlotsObj) {
        for (const tId in bookedSlotsObj) {
          // Only count this therapist if therapistId is specified, otherwise sum all
          if (!filterTherapistId || tId === therapistIdMap[filterTherapistId]) {
            for (const slotId of bookedSlotsObj[tId]) {
              if (limitedSlotsSet.has(slotId)) limitedBookedSlots++;
              else bookedSlots++;
            }
          }
        }
      }

      availability[display] = {
        bookedSlots,
        totalAvailableSlots: totalNormalSlots,
        limitedBookedSlots,
        totalLimitedAvailableSlots: totalLimitedSlots,
        BookedSlots: bookedSlotsObj
      };
    }

    res.json({ success: true, data: availability });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
}

getMonthlyAvailabilitySummary = async (req, res) => {
  try {
    let { month, year, therapistId } = req.query;

    month = parseInt(month, 10);
    year = parseInt(year, 10);

    if (
      !month ||
      !year ||
      isNaN(month) ||
      isNaN(year) ||
      month < 1 ||
      month > 12
    ) {
      return res.status(400).json({
        success: false,
        error: "month (1-12) and year are required as numbers",
      });
    }

    // Calculate first and last date of the requested month
    const firstDate = new Date(year, month - 1, 1);
    const lastDate = new Date(year, month, 0);

    const from = firstDate.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const to = lastDate.toISOString().slice(0, 10); // "YYYY-MM-DD"

    // Prepare query for getAvailabilitySummary
    const reqMock = {
      query: {
        from,
        to,
      }
    };
    if (therapistId) reqMock.query.therapistId = therapistId;

    // We'll use a Promise to capture the .json() call result
    const result = await new Promise((resolve, reject) => {
      // Dummy res object
      const resMock = {
        json: (obj) => resolve(obj),
        status: (code) => ({
          json: (obj) => reject({ code, obj }),
        }),
      };
      // getAvailabilitySummary MUST be bound to this class/context!
      this.getAvailabilitySummary.call(this, reqMock, resMock);
    }).catch(e => {
      // If error, structure into result
      return { error: e && e.obj ? e.obj : e };
    });

    res.json({ success: true, data: result });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
}





}

export default AavailabilitySlotsAdminController;
