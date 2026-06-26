/**
 * TherapistReassignmentController.js
 *
 * Handles the "departing therapist" workflow:
 *  GET  /api/admin/therapists/:therapistId/reassignment-suggestions
 *       → Analyses all future NotCheckedIn sessions owned by the departing
 *         therapist, computes per-therapist coverage, and returns a greedy
 *         chain plan that minimises unresolvable sessions.
 *
 *  POST /api/admin/therapists/:therapistId/execute-reassignment
 *       Body: { assignments: [{ bookingId, sessionMongoId, newTherapistId }] }
 *       → Applies the (possibly admin-overridden) plan in a single transaction.
 *
 * Add to routes:
 *   router.get('/therapists/:therapistId/reassignment-suggestions', auth, ctrl.getSuggestions);
 *   router.post('/therapists/:therapistId/execute-reassignment',    auth, ctrl.executeReassignment);
 */

import Booking from '../../Schema/booking.schema.js';
import { TherapistProfile } from '../../Schema/user.schema.js';
import AuditLogService from '../AuditLogs/audit-logs.controller.js';
import mongoose from 'mongoose';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" for today */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Greedy chain-plan algorithm.
 *
 * At each step:
 *   1. Find the therapist who can absorb the most remaining sessions.
 *   2. Assign those sessions to that therapist.
 *   3. Recursively handle the leftover sessions with the remaining therapists.
 *
 * Returns a flat array of assignments, each annotated with:
 *   { ...session, suggestedTherapistId, suggestedTherapistName, chainLevel, isUnresolvable }
 */
function buildChainPlan(remainingSessions, availableTherapists, isAvailableFn, level = 0) {
  if (remainingSessions.length === 0) return [];

  if (availableTherapists.length === 0) {
    // No therapist can cover these – mark unresolvable
    return remainingSessions.map(s => ({
      ...s,
      suggestedTherapistId: null,
      suggestedTherapistName: 'Unassignable',
      chainLevel: level,
      isUnresolvable: true,
    }));
  }

  // Find therapist with maximum coverage of remaining sessions
  let bestTherapist = null;
  let bestCanTake   = [];

  for (const t of availableTherapists) {
    const canTake = remainingSessions.filter(s => isAvailableFn(t, s.date, s.slotId));
    if (canTake.length > bestCanTake.length) {
      bestTherapist = t;
      bestCanTake   = canTake;
    }
  }

  if (!bestTherapist || bestCanTake.length === 0) {
    // No therapist can take any remaining session
    return remainingSessions.map(s => ({
      ...s,
      suggestedTherapistId: null,
      suggestedTherapistName: 'Unassignable',
      chainLevel: level,
      isUnresolvable: true,
    }));
  }

  const assigned = bestCanTake.map(s => ({
    ...s,
    suggestedTherapistId: String(bestTherapist._id),
    suggestedTherapistName: bestTherapist.name,
    chainLevel: level,
    isUnresolvable: false,
  }));

  const bestCanTakeIds  = new Set(bestCanTake.map(s => s.sessionMongoId));
  const remaining       = remainingSessions.filter(s => !bestCanTakeIds.has(s.sessionMongoId));
  const nextTherapists  = availableTherapists.filter(t => String(t._id) !== String(bestTherapist._id));

  return [...assigned, ...buildChainPlan(remaining, nextTherapists, isAvailableFn, level + 1)];
}

// ─── Controller ───────────────────────────────────────────────────────────────

class TherapistReassignmentController {

  /**
   * GET /api/admin/therapists/:therapistId/reassignment-suggestions
   */
  async getSuggestions(req, res) {
    try {
      const { therapistId } = req.params;
      const today = todayISO();

      // ── 1. Collect future NotCheckedIn sessions owned by departing therapist ──
      const bookings = await Booking.find({ 'sessions.therapist': new mongoose.Types.ObjectId(therapistId) })
        .populate({ path: 'patient', model: 'PatientProfile', select: 'name patientId mobile1' })
        .lean();

      const sessionsToReassign = [];
      bookings.forEach(booking => {
        (booking.sessions || []).forEach(session => {
          if (
            String(session.therapist) === String(therapistId) &&
            session.status       === 'NotCheckedIn' &&
            session.date         >= today
          ) {
            sessionsToReassign.push({
              bookingId:      String(booking._id),
              appointmentId:  booking.appointmentId || '',
              sessionMongoId: String(session._id),
              sessionId:      session.sessionId || String(session._id),
              date:           session.date,
              slotId:         session.slotId,
              patient: {
                _id:       String(booking.patient?._id || ''),
                name:      booking.patient?.name      || '—',
                patientId: booking.patient?.patientId || '',
              },
            });
          }
        });
      });

      if (sessionsToReassign.length === 0) {
        return res.json({
          success:             true,
          sessionsToReassign:  [],
          therapistAnalysis:   [],
          suggestedPlan:       [],
          allAvailableTherapists: [],
          message:             'No future pending sessions found for this therapist.',
        });
      }

      // ── 2. Fetch all other active therapists ──────────────────────────────────
      const allTherapists = await TherapistProfile.aggregate([
        {
          $lookup: {
            from:         'users',
            localField:   'userId',
            foreignField: '_id',
            as:           'user',
          },
        },
        { $unwind: '$user' },
        {
          $match: {
            'user.status':     'active',
            'user.isDisabled': { $ne: true },
            _id:               { $ne: new mongoose.Types.ObjectId(therapistId) },
          },
        },
        {
          $project: {
            _id:        1,
            therapistId: 1,
            name:       '$user.name',
            holidays:   1,
          },
        },
      ]);

      // ── 3. Build occupied-slot set across all relevant dates ──────────────────
      const relevantDates = [...new Set(sessionsToReassign.map(s => s.date))];

      const existingSlots = await Booking.aggregate([
        { $unwind: '$sessions' },
        {
          $match: {
            'sessions.date':   { $in: relevantDates },
            'sessions.status': { $in: ['NotCheckedIn', 'CheckedIn'] },
          },
        },
        {
          $group: {
            _id: {
              therapist: '$sessions.therapist',
              date:      '$sessions.date',
              slotId:    '$sessions.slotId',
            },
          },
        },
      ]);

      // "therapistObjId|date|slotId" → occupied
      const occupiedSet = new Set(
        existingSlots.map(r => `${r._id.therapist}|${r._id.date}|${r._id.slotId}`)
      );

      // ── 4. Availability check function ────────────────────────────────────────
      const isAvailable = (therapist, date, slotId) => {
        // Holiday check
        const holiday = (therapist.holidays || []).find(h => h.date === date);
        if (holiday) {
          if (holiday.isFullDay === true || holiday.isFullDay === undefined) return false;
          if (holiday.isFullDay === false && (holiday.slots || []).some(s => s.slotId === slotId)) return false;
        }
        // Existing booking check
        return !occupiedSet.has(`${therapist._id}|${date}|${slotId}`);
      };

      // ── 5. Per-therapist coverage analysis ───────────────────────────────────
      const therapistAnalysis = allTherapists
        .map(t => {
          const canTake   = sessionsToReassign.filter(s =>  isAvailable(t, s.date, s.slotId));
          const conflicts = sessionsToReassign.filter(s => !isAvailable(t, s.date, s.slotId));
          return {
            therapist: { _id: String(t._id), name: t.name, therapistId: t.therapistId },
            canTakeCount:   canTake.length,
            conflictCount:  conflicts.length,
            conflictSessionIds: conflicts.map(s => s.sessionMongoId),
          };
        })
        .sort((a, b) => b.canTakeCount - a.canTakeCount || a.conflictCount - b.conflictCount);

      // ── 6. Greedy chain plan ──────────────────────────────────────────────────
      const suggestedPlan = buildChainPlan(sessionsToReassign, allTherapists, isAvailable);

      return res.json({
        success:             true,
        departingTherapistId: String(therapistId),
        sessionsToReassign,
        therapistAnalysis:   therapistAnalysis.slice(0, 10), // Top 10 candidates
        suggestedPlan,
        allAvailableTherapists: allTherapists.map(t => ({
          _id:         String(t._id),
          name:        t.name,
          therapistId: t.therapistId,
        })),
      });

    } catch (error) {
      console.error('[getSuggestions] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to compute reassignment suggestions.',
        error:   error.message,
      });
    }
  }

  /**
   * POST /api/admin/therapists/:therapistId/execute-reassignment
   * Body: { assignments: [{ bookingId, sessionMongoId, newTherapistId }] }
   *
   * Groups assignments by bookingId and updates each booking in one transaction.
   * Rolls back if audit log fails.
   */
  async executeReassignment(req, res) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { therapistId } = req.params;
      const { assignments }  = req.body;

      if (!Array.isArray(assignments) || assignments.length === 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: 'No assignments provided.' });
      }

      // Validate – every assignment must have the three required fields
      const invalid = assignments.find(a => !a.bookingId || !a.sessionMongoId || !a.newTherapistId);
      if (invalid) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Each assignment must include bookingId, sessionMongoId, and newTherapistId.',
        });
      }

      // ── Group by bookingId to minimise DB round-trips ─────────────────────────
      const byBooking = {};
      assignments.forEach(a => {
        (byBooking[a.bookingId] = byBooking[a.bookingId] || []).push(a);
      });

      let totalUpdated = 0;
      const results    = [];

      for (const bookingId of Object.keys(byBooking)) {
        const booking = await Booking.findById(bookingId).session(session);
        if (!booking) {
          results.push({ bookingId, updated: 0, error: 'Booking not found' });
          continue;
        }

        let sessionUpdated = 0;
        byBooking[bookingId].forEach(change => {
          const sess = booking.sessions.id(change.sessionMongoId);
          if (sess) {
            sess.therapist = new mongoose.Types.ObjectId(change.newTherapistId);
            sessionUpdated++;
          }
        });

        if (sessionUpdated > 0) {
          await booking.save({ session });
          totalUpdated += sessionUpdated;
        }

        results.push({ bookingId, updated: sessionUpdated });
      }

      // ── Mandatory audit log ───────────────────────────────────────────────────
      try {
        await AuditLogService.addLog(
          {
            action:     'THERAPIST_SESSIONS_REASSIGNED',
            user:       req.user?.id,
            role:       'admin',
            resource:   'TherapistReassignment',
            resourceId: therapistId,
            details: {
              departingTherapistId: therapistId,
              totalSessionsReassigned: totalUpdated,
              bookingsAffected: Object.keys(byBooking).length,
              assignments,
              message: `${totalUpdated} sessions reassigned from therapist ${therapistId} by admin`,
            },
            ipAddress:  req.ip,
            userAgent:  req.headers['user-agent'],
          },
          session
        );
      } catch (logErr) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          success: false,
          message: 'Audit log failed. No changes were saved.',
          error:   logErr.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      return res.json({
        success:      true,
        message:      `Successfully reassigned ${totalUpdated} sessions across ${Object.keys(byBooking).length} booking(s).`,
        totalUpdated,
        results,
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error('[executeReassignment] Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to execute reassignment.',
        error:   error.message,
      });
    }
  }
}

export default TherapistReassignmentController;