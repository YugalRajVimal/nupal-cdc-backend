import express from "express";
import TherapistController from "../Controllers/Therapist/therapist.controller.js";


const therapistRouter = express.Router();
const therapistController = new TherapistController();

// Dashboard details for therapist
therapistRouter.get('/dashboard', (req, res) => therapistController.getDashboardDetails(req, res));

// Get profile details for therapist
therapistRouter.get('/profile', (req, res) => therapistController.getProfileDetails
  ? therapistController.getProfileDetails(req, res)
  : res.status(501).json({ success: false, message: "Not implemented" })
);

// Get all patients for the therapist
therapistRouter.get('/patients', (req, res) => therapistController.getAllPatients
  ? therapistController.getAllPatients(req, res)
  : res.status(501).json({ success: false, message: "Not implemented" })
);

// Get all appointments for the therapist
therapistRouter.get('/appointments', (req, res) => therapistController.getAllTherapistAppointments
  ? therapistController.getAllTherapistAppointments(req, res)
  : res.status(501).json({ success: false, message: "Not implemented" })
);

export default therapistRouter;
