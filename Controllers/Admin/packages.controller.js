
import Package from "../../Schema/packages.schema.js";
import mongoose from "mongoose";

class PackagesAdminController {
  // Add a new package
  async addPackage(req, res) {
    try {
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

      await pkg.save();

      return res.status(201).json({
        success: true,
        message: "Package added successfully.",
        package: pkg,
      });
    } catch (error) {
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
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
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
        return res.status(400).json({
          success: false,
          message: "name, sessionCount, costPerSession, and totalCost cannot be empty.",
        });
      }

      const pkg = await Package.findById(id);
      if (!pkg) {
        return res.status(404).json({ success: false, message: "Package not found." });
      }

      // Only update allowed fields (match schema)
      for (const key of ["name", "sessionCount", "costPerSession", "totalCost"]) {
        if (update[key] !== undefined) {
          pkg[key] = update[key];
        }
      }

      await pkg.save();
      return res.json({
        success: true,
        message: "Package updated successfully.",
        package: pkg,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to update package.",
        error: error.message,
      });
    }
  }

  // Delete a package
  async deletePackage(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid package ID." });
      }
      const pkg = await Package.findById(id);
      if (!pkg) {
        return res.status(404).json({ success: false, message: "Package not found." });
      }
      await Package.findByIdAndDelete(id);
      return res.json({ success: true, message: "Package deleted successfully." });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete package.",
        error: error.message,
      });
    }
  }
}

export default PackagesAdminController;

