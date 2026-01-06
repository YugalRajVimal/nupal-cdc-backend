
import { TherapyType } from "../../Schema/therapy-type.schema.js";

class TherapyAdminController {
  // Add Therapy Type
  async addTherapyType(req, res) {
    try {
      const { name, description, isActive } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Therapy name is required" });
      }
      // Check if a therapy type with the same name exists
      const existingTherapy = await TherapyType.findOne({ name: name.trim() });
      if (existingTherapy) {
        return res.status(409).json({ error: "Therapy type with this name already exists" });
      }

      const newTherapy = new TherapyType({
        name: name.trim(),
        description,
        isActive
      });
      await newTherapy.save();
      res.status(201).json({ message: "Therapy type added successfully", therapyType: newTherapy });
    } catch (error) {
      res.status(500).json({ error: "Failed to add therapy type", details: error.message });
    }
  }

  // Edit Therapy Type
  async editTherapyType(req, res) {
    try {
      const { id } = req.params;
      const { name, description, isActive } = req.body;

      const therapyType = await TherapyType.findById(id);
      if (!therapyType) {
        return res.status(404).json({ error: "Therapy type not found" });
      }

      if (name) {
        // Check for duplicate therapy name, excluding current document
        const existing = await TherapyType.findOne({
          name: name.trim(),
          _id: { $ne: id }
        });
        if (existing) {
          return res.status(409).json({ error: "Another therapy type with this name already exists" });
        }
        therapyType.name = name.trim();
      }
      if (typeof description !== "undefined") therapyType.description = description;
      if (typeof isActive !== "undefined") therapyType.isActive = isActive;

      await therapyType.save();
      res.json({ message: "Therapy type updated successfully", therapyType });
    } catch (error) {
      res.status(500).json({ error: "Failed to update therapy type", details: error.message });
    }
  }

  // Delete Therapy Type
  async deleteTherapyType(req, res) {
    try {
      const { id } = req.params;
      const therapyType = await TherapyType.findByIdAndDelete(id);
      if (!therapyType) {
        return res.status(404).json({ error: "Therapy type not found" });
      }
      res.json({ message: "Therapy type deleted successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete therapy type", details: error.message });
    }
  }

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

