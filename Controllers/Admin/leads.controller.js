
import Lead from "../../Schema/leads.schema.js";
import mongoose from "mongoose";

class LeadsAdminController {
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
      } = req.body;

      // Required validations
      if (!parentName || !parentMobile || !childName) {
        return res.status(400).json({ message: "parentName, parentMobile, and childName are required." });
      }

      const lead = new Lead({
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
        status: status || "pending",
      });

      await lead.save();

      return res.status(201).json({ success: true, message: "Lead added successfully.", lead });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Failed to add lead.", error: error.message });
    }
  }

  // Fetch all leads
  async getAllLeads(req, res) {
    try {
      const leads = await Lead.find().sort({ createdAt: -1 }); // most recent first
      return res.json({ success: true, leads });
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
      for (const key of [
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
        "status",
      ]) {
        if (update[key] !== undefined) {
          lead[key] = update[key];
        }
      }

      await lead.save();
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
      return res.json({ success: true, message: "Lead deleted successfully." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Failed to delete lead.", error: error.message });
    }
  }
}

export default LeadsAdminController;

