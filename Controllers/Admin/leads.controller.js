
import Lead from "../../Schema/leads.schema.js";
import mongoose from "mongoose";
import Counter from "../../Schema/counter.schema.js";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";
import LeadsFormConfig from "../../Schema/leads-page.schema.js";


// Utility: Get next lead sequence for LeadID generation
const getNextSequence = async (name) => {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

// Format lead ID as L + 5-digit padded number (e.g., L00001, L01234)
const generateLeadId = (seq) => {
  return `L${seq.toString().padStart(5, "0")}`;
};

class LeadsAdminController {

  // Get dropdown options for the lead form
async getLeadFormFields(req, res) {
  try {
    // Dynamically import to avoid circular dependencies if any
    const LeadsFormConfig = (await import("../../Schema/leads-page.schema.js")).default;

    // Always fetch the latest config (if multiple, take the most recent one)
    const config = await LeadsFormConfig.findOne().sort({ updatedAt: -1 });

    if (!config) {
      return res.status(404).json({
        success: false,
        message: "Lead form config not found. Please configure dropdown fields."
      });
    }

    // Only send relevant fields
    const fields = {
      staffMembers: config.staffMembers,
      findUsOptions: config.findUsOptions,
      relationships: config.relationships,
      pincodes: config.pincodes
      // Add more dropdowns as you add them to the schema/config
    };

    return res.json({ success: true, fields });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch lead form fields.",
      error: error.message
    });
  }
}

  // Add a new lead
  async addLead(req, res) {
    try {
      const {
        callDate,
        staff,
        staffOther,
        referralSource,
        parentName,
        parentRelationship,
        parentMobile,
        parentEmail,
        parentArea,
        childName,
        childDOB,
        childGender,
        therapistAlready,
        diagnosis,
        visitFinalized,
        appointmentDate,
        appointmentTime,
        status,
        remarks,
      } = req.body;

      // Required validations
      if (!parentName || !parentMobile || !childName) {
        return res.status(400).json({ message: "parentName, parentMobile, and childName are required." });
      }

      // ===== Lead ID auto-generation using counter =====
      const leadSeq = await getNextSequence("lead");
      const leadId = generateLeadId(leadSeq);

      const lead = new Lead({
        leadId,
        callDate,
        staff,
        staffOther,
        referralSource,
        parentName,
        parentRelationship,
        parentMobile,
        parentEmail,
        parentArea,
        childName,
        childDOB,
        childGender,
        therapistAlready,
        diagnosis,
        visitFinalized,
        appointmentDate,
        appointmentTime,
        remarks,
        status: status || "pending",
      });

      await lead.save();

      // === Add dropdown data if not present in LeadsFormConfig ===
      // Do *not* block lead creation if this fails, but log errors.
      (async () => {
        try {
          // Always update the most recent config
          let config = await LeadsFormConfig.findOne().sort({ updatedAt: -1 });

          // If no config exists, create one
          if (!config) {
            config = new LeadsFormConfig({});
          }

          let updated = false;

          // Add staff to staffMembers (if not present, not null, not empty)
          if (
            staff &&
            typeof staff === "string" &&
            staff.trim() !== "" &&
            !config.staffMembers.includes(staff)
          ) {
            config.staffMembers.push(staff);
            updated = true;
          }

          // Add referralSource to findUsOptions (if not present, not null, not empty)
          if (
            referralSource &&
            typeof referralSource === "string" &&
            !config.findUsOptions.includes(referralSource)
          ) {
            config.findUsOptions.push(referralSource);
            updated = true;
          }

          // Add parentRelationship to relationships (if not present, not null, not empty)
          if (
            parentRelationship &&
            typeof parentRelationship === "string" &&
            !config.relationships.includes(parentRelationship)
          ) {
            config.relationships.push(parentRelationship);
            updated = true;
          }

          // Add parentArea (used as pin code here) to pincodes (if not present, not null, not empty)
          if (
            parentArea &&
            typeof parentArea === "string" &&
            !config.pincodes.includes(parentArea)
          ) {
            config.pincodes.push(parentArea);
            updated = true;
          }

          // Only save if something new was added
          if (updated) {
            await config.save();
          }
        } catch (dropdownErr) {
          console.error("Dropdown config update failed [LeadsFormConfig]:", dropdownErr.message);
        }
      })();

      // --- Audit log ---
      try {
        await AuditLogService.addLog({
          action: "CREATE_LEAD",
          user: req?.user?.id,
          role: req?.user?.role,
          resource: "Lead",
          resourceId: lead._id,
          details: {
            leadId: lead.leadId,
            parentName,
            parentMobile,
            childName,
            createdFields: {
              callDate,
              staff,
              staffOther,
              referralSource,
              parentRelationship,
              parentEmail,
              parentArea,
              childDOB,
              childGender,
              therapistAlready,
              diagnosis,
              visitFinalized,
              appointmentDate,
              appointmentTime,
              status,
              remarks,
            }
          },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        });
      } catch (auditErr) {
        // Don't block, just log
        console.error("Audit log (CREATE_LEAD) failed:", auditErr.message);
      }

      return res.status(201).json({ success: true, message: "Lead added successfully.", lead });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Failed to add lead.", error: error.message });
    }
  }

  // Edit/update a lead
  async editLead(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid lead ID." });
      }

      const update = req.body;
      // Don't allow to unset required fields to null
      if (
        ("parentName" in update && !update.parentName) ||
        ("parentMobile" in update && !update.parentMobile) ||
        ("childName" in update && !update.childName)
      ) {
        return res.status(400).json({ message: "parentName, parentMobile, and childName cannot be empty." });
      }

      const lead = await Lead.findById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found." });
      }

      // Only update allowed fields (match schema)
      const allowedKeys = [
        "callDate",
        "staff",
        "staffOther",
        "referralSource",
        "parentName",
        "parentRelationship",
        "parentMobile",
        "parentEmail",
        "parentArea",
        "childName",
        "childDOB",
        "childGender",
        "therapistAlready",
        "diagnosis",
        "visitFinalized",
        "appointmentDate",
        "appointmentTime",
        "remarks",
        "status",
      ];

      // Collect old values for audit (if needed)
      const prevValues = {};
      const newValues = {};
      for (const key of allowedKeys) {
        if (update[key] !== undefined) {
          prevValues[key] = lead[key];
          lead[key] = update[key];
          newValues[key] = update[key];
        }
      }

      await lead.save();

      // Log all fields relevant to the update for debugging purposes
      console.log("UPDATE_LEAD: AuditLog payload:");
      console.log({
        action: "UPDATE_LEAD",
        user: req?.user?.id,
        role: req?.user?.role,
        resource: "Lead",
        resourceId: lead._id,
        details: {
          leadId: lead.leadId,
          updatedFields: newValues,
          previousFields: prevValues,
          message: `Lead updated by userId=${req?.user?.id || "SYSTEM"}`,
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      });
      // --- Audit log ---
      try {
        await AuditLogService.addLog({
          action: "UPDATE_LEAD",
          user: req?.user?.id,
          role: req?.user?.role,
          resource: "Lead",
          resourceId: lead._id,
          details: {
            leadId: lead.leadId,
            updatedFields: newValues,
            previousFields: prevValues,
            message: `Lead updated by userId=${req?.user?.id || "SYSTEM"}`,
          },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        });
      } catch (auditErr) {
        // Don't block, just log
        console.error("Audit log (UPDATE_LEAD) failed:", auditErr.message);
      }

      return res.json({ success: true, message: "Lead updated successfully.", lead });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to update lead.", error: error.message });
    }
  }

  // Delete lead
  async deleteLead(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid lead ID." });
      }
      const lead = await Lead.findById(id);
      if (!lead) {
        return res.status(404).json({ success: false, message: "Lead not found." });
      }
      await Lead.findByIdAndDelete(id);

      // --- Audit log ---
      try {
        await AuditLogService.addLog({
          action: "DELETE_LEAD",
          user: req?.user?.id,
          role: req?.user?.role,
          resource: "Lead",
          resourceId: lead._id,
          details: {
            leadId: lead.leadId,
            parentName: lead.parentName,
            childName: lead.childName,
            deletedFields: lead.toObject(),
            message: `Lead deleted by userId=${req?.user?.id || "SYSTEM"}`
          },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        });
      } catch (auditErr) {
        // Don't block, just log
        console.error("Audit log (DELETE_LEAD) failed:", auditErr.message);
      }

      return res.json({ success: true, message: "Lead deleted successfully." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to delete lead.", error: error.message });
    }
  }

  // Fetch all leads
  // Fetch leads with search, filter & pagination
  async getAllLeads(req, res) {
    try {
      // Pagination parameters (default page 1, 10 per page)
      let { page = 1, limit = 10, search = "", ...filters } = req.query;
      page = parseInt(page);
      limit = parseInt(limit);

      // Build MongoDB query object
      const query = {};

      // Search functionality (searching on parentName, parentMobile, childName)
      if (search && typeof search === 'string' && search.trim().length > 0) {
        const searchRegex = new RegExp(search.trim(), 'i');
        query.$or = [
          { parentName: searchRegex },
          { parentMobile: searchRegex },
          { parentEmail: searchRegex },
          { childName: searchRegex }
        ];
      }

      // Add filters for allowed fields (and ignore pagination fields)
      // You may add more allowed filter fields as desired
      const allowedFilters = [
        "status", "staff", "referralSource", "parentMobile", "parentName", "childName", "parentArea", "diagnosis"
      ];

      for (const key of allowedFilters) {
        if (filters[key]) {
          query[key] = filters[key];
        }
      }

      // Default to 10 per page
      const skip = (page - 1) * limit;

      // Get total count for pagination
      const total = await Lead.countDocuments(query);

      // Fetch leads with sorting, pagination, filtering, search
      const leads = await Lead.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      return res.json({
        success: true,
        leads,
        page,
        perPage: limit,
        totalPages: Math.ceil(total / limit),
        total
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to fetch leads.", error: error.message });
    }
  }

  // Fetch single lead by ID
  async getLeadById(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid lead ID." });
      }
      const lead = await Lead.findById(id);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found." });
      }
      return res.json({ success: true, lead });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Error fetching lead.", error: error.message });
    }
  }






}

export default LeadsAdminController;

