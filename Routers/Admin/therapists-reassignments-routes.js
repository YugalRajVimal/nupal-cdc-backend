import express from "express";
import jwtAuth from "../../middlewares/Auth/auth.middleware.js";

// Therapist reassignment (departing workflow)
import TherapistReassignmentController from "../../Controllers/Admin/therapistReassignmentController.js";


const therapistReassignmentRoutes = express.Router();
const therapistReassignmentController = new TherapistReassignmentController();






therapistReassignmentRoutes.get(
  '/:therapistId/reassignment-suggestions',
  jwtAuth,
  therapistReassignmentController.getSuggestions.bind(therapistReassignmentController)
);

therapistReassignmentRoutes.post(
  '/:therapistId/execute-reassignment',
  jwtAuth,
  therapistReassignmentController.executeReassignment.bind(therapistReassignmentController)
);




export default therapistReassignmentRoutes;
