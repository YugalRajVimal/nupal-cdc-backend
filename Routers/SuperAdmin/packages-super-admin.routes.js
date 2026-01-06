
import express from "express";

import PackagesAdminController from "../../Controllers/SuperAdmin/packages.controller.js";

const packagesAdminRouter = express.Router();
const packagesAdminController = new PackagesAdminController();

// Create a new package
packagesAdminRouter.post("/", (req, res) => packagesAdminController.addPackage(req, res));

// Get all packages
packagesAdminRouter.get("/", (req, res) => packagesAdminController.getAllPackages(req, res));

// Get a package by ID
packagesAdminRouter.get("/:id", (req, res) => packagesAdminController.getPackageById(req, res));

// Update a package by ID
packagesAdminRouter.put("/:id", (req, res) => packagesAdminController.editPackage(req, res));

// Delete a package by ID
packagesAdminRouter.delete("/:id", (req, res) => packagesAdminController.deletePackage(req, res));

export default packagesAdminRouter;


