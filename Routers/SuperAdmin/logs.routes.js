
import express from "express";
import AuditLogService from "../../Controllers/AuditLogs/audit-logs.controller.js";

const logsSuperAdminRouter = express.Router();

/**
 * GET /super-admin/logs
 * Query params: page, limit, (optional) filter, sort
 * Returns paginated list of audit logs.
 */
logsSuperAdminRouter.get("/", async (req, res) => {
  try {
    // Support pagination & basic filtering via query params
    const { page = 1, limit = 50, ...rawFilter } = req.query;
    // Remove non-mongo filter fields
    const { sort, ...filter } = rawFilter;

    // Parse page/limit as Numbers
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(parseInt(limit, 10) || 50, 200));

    // Optional sort, e.g. ?sort=-createdAt or ?sort=action
    let sortObj = { createdAt: -1 };
    if (sort) {
      if (sort.startsWith("-")) {
        sortObj = { [sort.slice(1)]: -1 };
      } else {
        sortObj = { [sort]: 1 };
      }
    }

    // Get logs from service
    const result = await AuditLogService.getAllLogs({
      filter,
      sort: sortObj,
      page: pageNum,
      limit: limitNum
    });

    return res.json({
      success: true,
      logs: result.logs,
      total: result.total,
      page: pageNum,
      limit: limitNum
    });
  } catch (err) {
    console.error("GET /super-admin/logs error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch audit logs."
    });
  }
});

export default logsSuperAdminRouter;
