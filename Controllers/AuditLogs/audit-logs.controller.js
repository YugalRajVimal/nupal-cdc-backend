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
}

export default new AuditLogService();
