import express from "express";
import TherapyAdminController from "../../Controllers/SuperAdmin/therapy.controller.js";


const therapyAdminRouter = express.Router();
const therapyAdminController = new TherapyAdminController();

// baseURL - /api/admin/therapy-types/
// Therapy Type Routes
// Add Therapy Type
therapyAdminRouter.post(
  "/", 
  // jwtAuth, 
  // authorize("admin.write"), 
  (req, res) => {
    therapyAdminController.addTherapyType(req, res);
  }
);

// Edit Therapy Type
therapyAdminRouter.put(
  "/:id", 
  // jwtAuth, 
  // authorize("admin.write"), 
  (req, res) => {
    therapyAdminController.editTherapyType(req, res);
  }
);

// Delete Therapy Type
therapyAdminRouter.delete(
  "/:id", 
  // jwtAuth, 
  // authorize("admin.write"), 
  (req, res) => {
    therapyAdminController.deleteTherapyType(req, res);
  }
);

// Fetch All Therapy Types
therapyAdminRouter.get(
  "/", 
  // jwtAuth, 
  // authorize("admin.read"), 
  (req, res) => {
    therapyAdminController.getAllTherapyTypes(req, res);
  }
);

export default therapyAdminRouter;
