
import { TherapyType } from "../../Schema/therapy-type.schema.js";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";

class TherapyAdminController {
  // Add Therapy Type
  async addTherapyType(req, res) {
    const session = await TherapyType.startSession();
    try {
      session.startTransaction();

      const { name, description, isActive } = req.body;
      if (!name) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ error: "Therapy name is required" });
      }

      // Check if a therapy type with the same name exists
      const existingTherapy = await TherapyType.findOne({ name: name.trim() }).session(session);
      if (existingTherapy) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ error: "Therapy type with this name already exists" });
      }

      const newTherapy = new TherapyType({
        name: name.trim(),
        description,
        isActive
      });

      await newTherapy.save({ session });

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "ADD_THERAPY_TYPE",
            user: req.user && req.user.id ? req.user.id : null,
            role: req.user && req.user.role ? req.user.role : undefined,
            resource: "TherapyType",
            resourceId: newTherapy._id,
            details: {
              changedFields: {
                name: { from: undefined, to: name.trim() },
                description: { from: undefined, to: description },
                isActive: { from: undefined, to: isActive }
              },
              message: `Therapy type "${name.trim()}" created by userId=${req.user ? req.user.id : "?"}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        console.error("[addTherapyType] Error writing audit log:", elog);
        return res.status(500).json({ message: "Audit log creation failed. Therapy type not saved." });
      }

      await session.commitTransaction();
      session.endSession();

      res.status(201).json({ message: "Therapy type added successfully", therapyType: newTherapy });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      res.status(500).json({ error: "Failed to add therapy type", details: error.message });
    }
  }

  // Edit Therapy Type
  async editTherapyType(req, res) {
    const session = await TherapyType.startSession();
    try {
      session.startTransaction();

      const { id } = req.params;
      const { name, description, isActive } = req.body;

      const therapyType = await TherapyType.findById(id).session(session);
      if (!therapyType) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ error: "Therapy type not found" });
      }

      let changedFields = {};
      if (name && name.trim() !== therapyType.name) {
        // Check for duplicate therapy name, excluding current document
        const existing = await TherapyType.findOne({
          name: name.trim(),
          _id: { $ne: id }
        }).session(session);
        if (existing) {
          await session.abortTransaction();
          session.endSession();
          return res.status(409).json({ error: "Another therapy type with this name already exists" });
        }
        changedFields.name = { from: therapyType.name, to: name.trim() };
        therapyType.name = name.trim();
      }
      if (typeof description !== "undefined" && description !== therapyType.description) {
        changedFields.description = { from: therapyType.description, to: description };
        therapyType.description = description;
      }
      if (typeof isActive !== "undefined" && isActive !== therapyType.isActive) {
        changedFields.isActive = { from: therapyType.isActive, to: isActive };
        therapyType.isActive = isActive;
      }

      await therapyType.save({ session });

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "EDIT_THERAPY_TYPE",
            user: req.user && req.user.id ? req.user.id : null,
            role: req.user && req.user.role ? req.user.role : undefined,
            resource: "TherapyType",
            resourceId: therapyType._id,
            details: {
              changedFields,
              message: `Therapy type "${therapyType.name}" updated by userId=${req.user ? req.user.id : "?"}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        console.error("[editTherapyType] Error writing audit log:", elog);
        return res.status(500).json({ message: "Audit log creation failed. Therapy type update not saved." });
      }

      await session.commitTransaction();
      session.endSession();

      res.json({ message: "Therapy type updated successfully", therapyType });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      res.status(500).json({ error: "Failed to update therapy type", details: error.message });
    }
  }

  // Delete Therapy Type
  // async deleteTherapyType(req, res) {
  //   const session = await TherapyType.startSession();
  //   try {
  //     session.startTransaction();

  //     const { id } = req.params;
  //     const therapyType = await TherapyType.findById(id).session(session);
  //     if (!therapyType) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       return res.status(404).json({ error: "Therapy type not found" });
  //     }

  //     await TherapyType.findByIdAndDelete(id).session(session);

  //     // === Mandatory Audit Log (must succeed for transaction) ===
  //     try {
  //       await AuditLogService.addLog(
  //         {
  //           action: "DELETE_THERAPY_TYPE",
  //           user: req.user && req.user.id ? req.user.id : null,
  //           role: req.user && req.user.role ? req.user.role : undefined,
  //           resource: "TherapyType",
  //           resourceId: therapyType._id,
  //           details: {
  //             changedFields: {
  //               name: { from: therapyType.name, to: undefined },
  //               description: { from: therapyType.description, to: undefined },
  //               isActive: { from: therapyType.isActive, to: undefined },
  //             },
  //             message: `Therapy type "${therapyType.name}" deleted by userId=${req.user ? req.user.id : "?"}`
  //           },
  //           ipAddress: req.ip,
  //           userAgent: req.headers["user-agent"]
  //         },
  //         { session }
  //       );
  //     } catch (elog) {
  //       await session.abortTransaction();
  //       session.endSession();
  //       console.error("[deleteTherapyType] Error writing audit log:", elog);
  //       return res.status(500).json({ message: "Audit log creation failed. Therapy type not deleted." });
  //     }

  //     await session.commitTransaction();
  //     session.endSession();

  //     res.json({ message: "Therapy type deleted successfully" });
  //   } catch (error) {
  //     await session.abortTransaction();
  //     session.endSession();
  //     res.status(500).json({ error: "Failed to delete therapy type", details: error.message });
  //   }
  // }

  // Fetch All Therapy Types
  async getAllTherapyTypes(req, res) {
    try {
      const therapyTypes = await TherapyType.find();
      res.json({ therapyTypes });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch therapy types", details: error.message });
    }
  }
}

export default TherapyAdminController;

