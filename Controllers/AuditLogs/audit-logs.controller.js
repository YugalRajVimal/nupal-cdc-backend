import { AuditLog } from "../../Schema/logs.schema.js";

class AuditLogService {
  async addLog({
    action,
    user,
    role,
    resource = null,
    resourceId = null,
    details = {},
    ipAddress = null,
    userAgent = null,
  }) {
    // Audit logs must NEVER block the request
    try {
      if (!action || !user || !role) return;

      await AuditLog.create({
        action: action.toUpperCase(), // normalize
        user,
        role,
        resource,
        resourceId,
        details,
        ipAddress,
        userAgent,
      });
    } catch (err) {
      // Log internally, but NEVER throw
      console.error("Audit log failed:", err.message);
    }
  }

  /**
   * Fetch all audit logs (with optional pagination, filtering).
   * @param {Object} params Supports: { filter, sort, page, limit }
   * @returns {Promise<{ logs: Array, total: Number }>}
   */
  async getAllLogs({ filter = {}, sort = { createdAt: -1 }, page = 1, limit = 50 } = {}) {
    try {
      const skip = (page - 1) * limit;
      const logsRaw = await AuditLog.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();

      // Prepare sets for efficient lookups
      const userIdsToPatient = new Set();
      const userIdsToTherapist = new Set();
      const userIdsToAdmin = new Set();
      const userIdsToSuperAdmin = new Set();
      const resourceIdsToPatient = new Set();
      const resourceIdsToTherapist = new Set();

      logsRaw.forEach(log => {
        // For parent & patient roles, user field may need patientId lookup
        if (
          (log.role === "parent" || log.role === "patient") &&
          log.user
        ) {
          userIdsToPatient.add(log.user.toString());
        }
        if (
          log.role === "therapist" &&
          log.user
        ) {
          userIdsToTherapist.add(log.user.toString());
        }
        if (
          log.role === "admin" &&
          log.user
        ) {
          userIdsToAdmin.add(log.user.toString());
        }
        if (
          log.role === "superadmin" &&
          log.user
        ) {
          userIdsToSuperAdmin.add(log.user.toString());
        }
        // For ParentProfile/Patient resource, resourceId is likely patientProfile._id
        if (
          (log.resource === "ParentProfile" || log.resource === "Parent" || log.resource === "patient") &&
          log.resourceId
        ) {
          resourceIdsToPatient.add(log.resourceId.toString());
        }
        // For TherapistProfile/Therapist resource, resourceId is likely therapistProfile._id
        if (
          (log.resource === "TherapistProfile" || log.resource === "Therapist" || log.resource === "therapist") &&
          log.resourceId
        ) {
          resourceIdsToTherapist.add(log.resourceId.toString());
        }
      });

      // Import model classes dynamically to avoid circular dependency
      let PatientProfile, TherapistProfile, User;
      const needPatientQuery = userIdsToPatient.size > 0 || resourceIdsToPatient.size > 0;
      const needTherapistQuery = userIdsToTherapist.size > 0 || resourceIdsToTherapist.size > 0;
      const needAdminQuery = userIdsToAdmin.size > 0;
      const needSuperAdminQuery = userIdsToSuperAdmin.size > 0;
      if (needPatientQuery) {
        ({ PatientProfile } = await import("../../Schema/user.schema.js"));
      }
      if (needTherapistQuery) {
        ({ TherapistProfile } = await import("../../Schema/user.schema.js"));
      }
      if (needAdminQuery || needSuperAdminQuery) {
        ({ User } = await import("../../Schema/user.schema.js"));
      }

      // Batch queries to map ObjectIds <=> patientId/therapistId names
      const patientProfilesByUserId = {};
      const therapistProfilesByUserId = {};
      const patientProfilesById = {};
      const therapistProfilesById = {};
      const adminNamesByUserId = {};
      const superAdminNamesByUserId = {};

      if (needPatientQuery) {
        // Get PatientProfiles by userId (for parent/patient role user field)
        if (userIdsToPatient.size > 0) {
          const profiles = await PatientProfile.find(
            { userId: { $in: Array.from(userIdsToPatient) } },
            { userId: 1, patientId: 1, _id: 1 }
          ).lean();
          profiles.forEach(p => {
            if (p.userId) patientProfilesByUserId[p.userId.toString()] = p.patientId;
            if (p._id) patientProfilesById[p._id.toString()] = p.patientId;
          });
        }
        // Get PatientProfiles by _id (for resourceId field for Parent/Patient/ParentProfile resource)
        if (resourceIdsToPatient.size > 0) {
          const profiles = await PatientProfile.find(
            { _id: { $in: Array.from(resourceIdsToPatient) } },
            { _id: 1, patientId: 1 }
          ).lean();
          profiles.forEach(p => { if (p._id) patientProfilesById[p._id.toString()] = p.patientId; });
        }
      }
      if (needTherapistQuery) {
        // Get TherapistProfiles by userId (for therapist role user field)
        if (userIdsToTherapist.size > 0) {
          const profiles = await TherapistProfile.find(
            { userId: { $in: Array.from(userIdsToTherapist) } },
            { userId: 1, therapistId: 1, _id: 1 }
          ).lean();
          profiles.forEach(t => {
            if (t.userId) therapistProfilesByUserId[t.userId.toString()] = t.therapistId;
            if (t._id) therapistProfilesById[t._id.toString()] = t.therapistId;
          });
        }
        // Get TherapistProfiles by _id (for resourceId field for Therapist/TherapistProfile resource)
        if (resourceIdsToTherapist.size > 0) {
          const profiles = await TherapistProfile.find(
            { _id: { $in: Array.from(resourceIdsToTherapist) } },
            { _id: 1, therapistId: 1 }
          ).lean();
          profiles.forEach(t => { if (t._id) therapistProfilesById[t._id.toString()] = t.therapistId; });
        }
      }
      if (needAdminQuery) {
        // Get admin users by userIds (for admin role field)
        const users = await User.find(
          { _id: { $in: Array.from(userIdsToAdmin) } },
          { _id: 1, name: 1 }
        ).lean();
        users.forEach(u => {
          if (u._id) adminNamesByUserId[u._id.toString()] = u.name || "-";
        });
      }
      if (needSuperAdminQuery) {
        // Get superadmin users by userIds (for superadmin role field)
        const users = await User.find(
          { _id: { $in: Array.from(userIdsToSuperAdmin) } },
          { _id: 1, name: 1 }
        ).lean();
        users.forEach(u => {
          if (u._id) superAdminNamesByUserId[u._id.toString()] = u.name || "-";
        });
      }

      // Map logs: convert user ids and resource ids to patientId/therapistId/admin name/superadmin name where possible, else keep as ObjectId string
      const logs = logsRaw.map(log => {
        const newLog = { ...log };

        // --- User field mapping ---
        if (log.role === "superadmin" && log.user) {
          // Provide superadmin name if available
          const superAdminName = superAdminNamesByUserId[log.user?.toString()];
          newLog.user = superAdminName ? superAdminName : log.user?.toString();
        } else if (log.role === "admin" && log.user) {
          // Attempt to show admin name if available, else "-"
          const adminName = adminNamesByUserId[log.user?.toString()];
          newLog.user = adminName ? adminName : log.user?.toString();
        } else if ((log.role === "parent" || log.role === "patient") && log.user) {
          // If patientId available, substitute
          const pid = patientProfilesByUserId[log.user?.toString()];
          newLog.user = pid ? pid : log.user?.toString();
        } else if (log.role === "therapist" && log.user) {
          const tid = therapistProfilesByUserId[log.user?.toString()];
          newLog.user = tid ? tid : log.user?.toString();
        } else if (log.user) {
          newLog.user = log.user?.toString();
        }

        // --- resourceId field mapping ---

          if (
            log.resource &&
            log.resource.toUpperCase() === "USER" &&
            log.user
          ) {
            // If resource is USER, set resourceId = user id string
            newLog.resourceId = log.user?.toString();
          } 
          else if (
            log.resource &&
            (log.resource.toUpperCase() === "BOOKING" || log.resource.toLowerCase() === "booking") &&
            log.details &&
            log.details.appointmentId
          ) {
            // If resource is BOOKING and appointmentId is present in details, substitute
            newLog.resourceId = log.details.appointmentId?.toString();
          }
          else if (
            (log.resource === "ParentProfile" || log.resource === "Parent" || log.resource === "patient") &&
            log.resourceId
          ) {
            // If for Parent/Patient/ParentProfile resource, use patientId if present
            const pid = patientProfilesById[log.resourceId?.toString()];
            newLog.resourceId = pid ? pid : log.resourceId?.toString();
          } 
          else if (
            (log.resource === "TherapistProfile" || log.resource === "Therapist" || log.resource === "therapist") &&
            log.resourceId
          ) {
            // For Therapist resources, use therapistId if present
            const tid = therapistProfilesById[log.resourceId?.toString()];
            newLog.resourceId = tid ? tid : log.resourceId?.toString();
          } 
          else if (
            log.resource &&
            (log.resource === "Lead" || log.resource === "lead") && 
            log.details && 
            log.details.leadId
          ) {
            // For Lead resources, use leadId if present
            newLog.resourceId = log.details.leadId?.toString();
          }
          else if (log.resourceId) {
            newLog.resourceId = log.resourceId?.toString();
          }

        // Always ensure _id as string as well (for frontend consistency)
        if (newLog._id) {
          newLog._id = newLog._id.toString();
        }

        return newLog;
      });

      const total = await AuditLog.countDocuments(filter);
      return { logs, total };
    } catch (err) {
      console.error("Failed to fetch audit logs:", err.message);
      return { logs: [], total: 0 };
    }
  }
}

export default new AuditLogService();
