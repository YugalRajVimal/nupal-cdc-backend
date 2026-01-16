import express from "express";
import TherapistAdminController from "../../Controllers/Admin/therapist.controller.js";
import { upload } from "../../middlewares/fileUpload.middleware.js";

const therapistAdminRouter = express.Router();
const therapistAdminController = new TherapistAdminController();

// Set panel accessibility (set TherapistProfile.isPanelAccessible)
therapistAdminRouter.patch(
  "/:id/panel-access",
  // jwtAuth, 
  // authorize("admin.write"),
  (req, res) => {
    therapistAdminController.setPanelAccessible(req, res);
  }
);

// Add a new therapist
therapistAdminRouter.post(
  "/",
  // jwtAuth, 
  // authorize("admin.write"),
  upload.fields([
    { name: "aadhaarFront", maxCount: 1 },
    { name: "aadhaarBack", maxCount: 1 },
    { name: "photo", maxCount: 1 },
    { name: "resume", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
  ]),
  (req, res) => {
    therapistAdminController.addTherapist(req, res);
  }
);


// Fetch all therapists
therapistAdminRouter.get(
  "/",
  // jwtAuth, 
  // authorize("admin.read"),

  (req, res) => {
    therapistAdminController.fetchTherapists(req, res);
  }
);


// Fetch therapist by ID
therapistAdminRouter.get(
  "/:id",
  // jwtAuth, 
  // authorize("admin.read"),
  (req, res) => {
    therapistAdminController.fetchTherapistById(req, res);
  }
);

// Edit therapist by ID
therapistAdminRouter.put(
  "/:id",
  // jwtAuth, 
  // authorize("admin.write"),
  (req, res) => {
    therapistAdminController.editTherapist(req, res);
  }
);

// Delete therapist (by TherapistProfile _id)
therapistAdminRouter.delete(
  "/:id",
  // jwtAuth, 
  // authorize("admin.write"),
  (req, res) => {
    therapistAdminController.deleteTherapist(req, res);
  }
);




// Disable therapist (set User.isDisabled = true)
therapistAdminRouter.patch(
  "/:id/disable",
  // jwtAuth, 
  // authorize("admin.write"),
  (req, res) => {
    therapistAdminController.disableTherapist(req, res);
  }
);

// Enable therapist (set User.isDisabled = false)
therapistAdminRouter.patch(
  "/:id/enable",
  // jwtAuth, 
  // authorize("admin.write"),
  (req, res) => {
    therapistAdminController.enableTherapist(req, res);
  }
);




// Pay therapist (add entry to earnings array)
therapistAdminRouter.post(
  "/:id/pay",
  // jwtAuth, 
  // authorize("admin.write"),
  (req, res) => {
    therapistAdminController.payTherapist(req, res);
  }
);



// Set holidays for therapist (POST /:id/holidays)
therapistAdminRouter.post(
  "/:id/holidays",
  // jwtAuth, 
  // authorize("admin.write"),
  (req, res) => {
    therapistAdminController.setHolidays(req, res);
  }
);






export default therapistAdminRouter;
