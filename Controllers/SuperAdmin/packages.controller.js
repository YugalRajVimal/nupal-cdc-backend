
import Package from "../../Schema/packages.schema.js";
import mongoose from "mongoose";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";

class PackagesAdminController {
  // Add a new package
  async addPackage(req, res) {
    const session = await Package.startSession();
    try {
      session.startTransaction();

      const {
        name,
        sessionCount,
        costPerSession,
        totalCost,
      } = req.body;

      // Required validations
      if (
        !name ||
        typeof sessionCount === "undefined" ||
        typeof costPerSession === "undefined" ||
        typeof totalCost === "undefined"
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "name, sessionCount, costPerSession, and totalCost are required.",
        });
      }

      const pkg = new Package({
        name: name.trim(),
        sessionCount,
        costPerSession,
        totalCost,
      });

      await pkg.save({ session });

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "ADD_PACKAGE",
            user: req.user && req.user.id ? req.user.id : null,
            role: req.user && req.user.role ? req.user.role : undefined,
            resource: "Package",
            resourceId: pkg._id,
            details: {
              changedFields: {
                name: { from: undefined, to: name.trim() },
                sessionCount: { from: undefined, to: sessionCount },
                costPerSession: { from: undefined, to: costPerSession },
                totalCost: { from: undefined, to: totalCost }
              },
              message: `Package "${name.trim()}" created by userId=${req.user ? req.user.id : "?"}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        console.error("[addPackage] Error writing audit log:", elog);
        return res.status(500).json({
          success: false,
          message: "Audit log creation failed. Package not saved.",
        });
      }

      await session.commitTransaction();
      session.endSession();
      return res.status(201).json({
        success: true,
        message: "Package added successfully.",
        package: pkg,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Failed to add package.",
        error: error.message,
      });
    }
  }

  // Fetch all packages
  async getAllPackages(req, res) {
    try {
      const packages = await Package.find().sort({ createdAt: -1 }); // most recent first
      return res.json({ success: true, packages });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch packages.",
        error: error.message,
      });
    }
  }

  // Fetch single package by ID
  async getPackageById(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid package ID." });
      }
      const pkg = await Package.findById(id);
      if (!pkg) {
        return res.status(404).json({ success: false, message: "Package not found." });
      }
      return res.json({ success: true, package: pkg });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error fetching package.",
        error: error.message,
      });
    }
  }

  // Edit/update a package
  async editPackage(req, res) {
    const session = await Package.startSession();
    try {
      session.startTransaction();

      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Invalid package ID." });
      }

      const update = req.body;
      // Don't allow to unset required fields to null/empty
      if (
        ("name" in update && !update.name) ||
        ("sessionCount" in update && (update.sessionCount === null || update.sessionCount === "")) ||
        ("costPerSession" in update && (update.costPerSession === null || update.costPerSession === "")) ||
        ("totalCost" in update && (update.totalCost === null || update.totalCost === ""))
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "name, sessionCount, costPerSession, and totalCost cannot be empty.",
        });
      }

      const pkg = await Package.findById(id).session(session);
      if (!pkg) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Package not found." });
      }

      // Track changed fields
      let changedFields = {};

      for (const key of ["name", "sessionCount", "costPerSession", "totalCost"]) {
        if (update[key] !== undefined && pkg[key] !== update[key]) {
          changedFields[key] = { from: pkg[key], to: update[key] };
          pkg[key] = update[key];
        }
      }

      await pkg.save({ session });

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "EDIT_PACKAGE",
            user: req.user && req.user.id ? req.user.id : null,
            role: req.user && req.user.role ? req.user.role : undefined,
            resource: "Package",
            resourceId: pkg._id,
            details: {
              changedFields,
              message: `Package "${pkg.name}" updated by userId=${req.user ? req.user.id : "?"}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        console.error("[editPackage] Error writing audit log:", elog);
        return res.status(500).json({
          success: false,
          message: "Audit log creation failed. Package update not saved.",
        });
      }

      await session.commitTransaction();
      session.endSession();
      return res.json({
        success: true,
        message: "Package updated successfully.",
        package: pkg,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({
        success: false,
        message: "Failed to update package.",
        error: error.message,
      });
    }
  }

  // Delete a package
  async deletePackage(req, res) {
    const session = await Package.startSession();
    try {
      session.startTransaction();

      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Invalid package ID." });
      }
      const pkg = await Package.findById(id).session(session);
      if (!pkg) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Package not found." });
      }

      await Package.findByIdAndDelete(id).session(session);

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "DELETE_PACKAGE",
            user: req.user && req.user.id ? req.user.id : null,
            role: req.user && req.user.role ? req.user.role : undefined,
            resource: "Package",
            resourceId: pkg._id,
            details: {
              changedFields: {
                name: { from: pkg.name, to: undefined },
                sessionCount: { from: pkg.sessionCount, to: undefined },
                costPerSession: { from: pkg.costPerSession, to: undefined },
                totalCost: { from: pkg.totalCost, to: undefined }
              },
              message: `Package "${pkg.name}" deleted by userId=${req.user ? req.user.id : "?"}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        console.error("[deletePackage] Error writing audit log:", elog);
        return res.status(500).json({
          success: false,
          message: "Audit log creation failed. Package not deleted.",
        });
      }

      await session.commitTransaction();
      session.endSession();
      return res.json({ success: true, message: "Package deleted successfully." });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({
        success: false,
        message: "Failed to delete package.",
        error: error.message,
      });
    }
  }
}

export default PackagesAdminController;

