import DailyAvailability from '../../Schema/AvailabilitySlots/daily-availability.schema.js';
import DefaultTherapistForSlots from '../../Schema/AvailabilitySlots/default-therapist-for-slots.schema.js';

/**
 * Controller for Admin availability slots management.
 * Handles CRUD for daily slots and default therapist slot number (global).
 */
class AavailabilitySlotsAdminController {
  // GET /admin/availability-slots/:date
getDailyAvailability = async (req, res) => {
    try {
      const { date } = req.params;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Date parameter invalid or missing. Use format YYYY-MM-DD.' });
      }
      let day = await DailyAvailability.findOne({ date });
      if (!day) {
        // Auto-create entry if not found (default blank slots)
        day = new DailyAvailability({ date });
        await day.save();
      }
      res.json({ success: true, data: day });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // PUT /admin/availability-slots/:date
  // body: { sessions: [{id,label,limited,count}] }
updateDailyAvailability = async (req, res) => {
    try {
      const { date } = req.params;
      const { sessions } = req.body;
      if (!date || !sessions || !Array.isArray(sessions)) {
        return res.status(400).json({ error: "date param and sessions[] body required." });
      }
      // Validate slots basic structure (ids and counts)
      for (const slot of sessions) {
        if (
          typeof slot.id !== "string" ||
          typeof slot.count !== "number" ||
          slot.count < 0
        ) {
          return res.status(400).json({ error: "Each session must have string id and non-negative count." });
        }
      }

      let doc = await DailyAvailability.findOne({ date });
      if (!doc) {
        // If not found, initialize with this date and the provided counts (booked stays at default 0)
        doc = new DailyAvailability({ date });
      }

      // Only update the 'count' for corresponding slots, leave 'booked' untouched
      if (doc.sessions && Array.isArray(doc.sessions)) {
        for (const slot of sessions) {
          const existing = doc.sessions.find(s => s.id === slot.id);
          if (existing) {
            // If trying to decrease count below already booked, disallow
            if (typeof existing.booked === "number" && slot.count < existing.booked) {
              return res.status(400).json({
                error: `Cannot decrease count below current booked (${existing.booked}) for slot ${slot.id}. Already booked.`
              });
            }
            existing.count = slot.count;
            // Do NOT update existing.booked
          }
          // If the slot.id does not exist, skip it (do not add new slots here, slots are fixed by schema)
        }
      }

      doc.updatedAt = Date.now();
      await doc.save();

      res.json({ success: true, message: "Daily slots updated (count only)", data: doc });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // GET /admin/availability-slots/range/:from/:to
  // Retrieve all daily availabilities in date range [from, to]
getAvailabilityRange = async (req, res) => {

    try {
      const { from, to } = req.params;
      // For checks: log parsed query range

      if (
        !from ||
        !to ||
        !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(to)
      ) {

        return res.status(400).json({ error: 'Both from and to dates (YYYY-MM-DD) required.' });
      }
      const result = await DailyAvailability.find({
        date: { $gte: from, $lte: to },
      }).sort({ date: 1 });

      // For checks: log result count

      
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[Availability] Error in getAvailabilityRange:', err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // GET /admin/availability-slots/default-therapist
getDefaultTherapistSlots = async (req, res) => {

    try {
      let doc = await DefaultTherapistForSlots.findOne();
      // If never set, we should return a default of 0
      res.json({
        success: true,
        data: { defaultCapacity: doc ? doc.defaultCapacity : 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  // PUT /admin/availability-slots/default-therapist
  // body: { defaultCapacity: number }
setDefaultTherapistSlots = async (req, res) => {
    try {
      const { defaultCapacity } = req.body;
      console.log(defaultCapacity);

      if (
        typeof defaultCapacity !== "number" ||
        defaultCapacity < 0 ||
        !Number.isInteger(defaultCapacity)
      ) {
        return res.status(400).json({ error: 'defaultCapacity must be a non-negative integer.' });
      }

      // Update the default therapist capacity in settings
      const updated = await DefaultTherapistForSlots.findOneAndUpdate(
        {},
        { defaultCapacity, updatedAt: Date.now() },
        { upsert: true, new: true }
      );

      // --- Update next 14 days for daily availability (set all session slots except limited to defaultCapacity) ---
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 1; i <= 14; i++) {
        const nextDay = new Date(today);
        nextDay.setDate(today.getDate() + i);
        const yyyy = nextDay.getFullYear();
        const mm = String(nextDay.getMonth() + 1).padStart(2, '0');
        const dd = String(nextDay.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        // Check if the day is Sunday
        const isSunday = nextDay.getDay() === 0; // Sunday = 0

        if (isSunday) {
          // If Sunday, keep it as it is in the DB (do not modify)
          continue;
        }

        const sessionSlots = [
          { id: '0830-0915', label: '08:30 to 09:15', limited: true },
          { id: '0915-1000', label: '09:15 to 10:00', limited: true },
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
          { id: '1800-1845', label: '18:00 to 18:45', limited: true },
          { id: '1845-1930', label: '18:45 to 19:30', limited: true },
          { id: '1930-2015', label: '19:30 to 20:15', limited: true }
        ];

        const sessions = sessionSlots.map(s => ({
          id: s.id,
          slotId: s.id,
          label: s.label,
          limited: s.limited,
          count: s.limited ? 0 : defaultCapacity
        }));

        // Upsert daily slot for this day (overwrite only if not Sunday)
        await DailyAvailability.findOneAndUpdate(
          { date: dateStr },
          { sessions, updatedAt: Date.now() },
          { upsert: true }
        );
      }

      res.json({
        success: true,
        message: "Default slot therapist capacity updated (and slots for next 14 days filled for non-limited sessions, Sundays unchanged).",
        data: updated,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }
}

export default AavailabilitySlotsAdminController;
