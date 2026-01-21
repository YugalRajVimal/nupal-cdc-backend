import express from "express";
import TherapistController from "../Controllers/Therapist/therapist.controller.js";
import jwtAuth from "../middlewares/Auth/auth.middleware.js";
import { upload } from "../middlewares/fileUpload.middleware.js";


const therapistRouter = express.Router();
const therapistController = new TherapistController();

// Therapist sign-up with email OTP (send OTP)
therapistRouter.post(
  '/signup/send-otp',
  (req, res) => therapistController.therapistSignUpSendOTP(req, res)
);

// Therapist sign-up (verify OTP)
therapistRouter.post(
  '/signup/verify-otp',
  (req, res) => therapistController.therapistSignUpVerifyOTP(req, res)
);

// Therapist completes their profile (only allowed if incomplete)
therapistRouter.post(
  '/complete-profile',
  jwtAuth,
  upload.fields([
    { name: "aadhaarFront", maxCount: 1 },
    { name: "aadhaarBack", maxCount: 1 },
    { name: "photo", maxCount: 1 },
    { name: "resume", maxCount: 1 },
    { name: "certificate", maxCount: 1 },
  ]),
  (req, res) => therapistController.completeProfile(req, res)
);


// Dashboard details for therapist
therapistRouter.get('/dashboard',jwtAuth, (req, res) => therapistController.getDashboardDetails(req, res));

// Get profile details for therapist
therapistRouter.get('/profile',jwtAuth, (req, res) => therapistController.getProfileDetails
  ? therapistController.getProfileDetails(req, res)
  : res.status(501).json({ success: false, message: "Not implemented" })
);

// Get all patients for the therapist
therapistRouter.get('/patients',jwtAuth, (req, res) => therapistController.getAllPatients
  ? therapistController.getAllPatients(req, res)
  : res.status(501).json({ success: false, message: "Not implemented" })
);

// Get all appointments for the therapist
therapistRouter.get('/appointments',jwtAuth, (req, res) => therapistController.getAllTherapistAppointments
  ? therapistController.getAllTherapistAppointments(req, res)
  : res.status(501).json({ success: false, message: "Not implemented" })
);

// Get all therapist's session participation (each actual session, not full bookings)
therapistRouter.get('/sessions', jwtAuth, (req, res) => therapistController.getAllTherapistSessions
  ? therapistController.getAllTherapistSessions(req, res)
  : res.status(501).json({ success: false, message: "Not implemented" })
);


// Get therapist's schedule calendar
therapistRouter.get('/schedule-calendar', jwtAuth, (req, res) => therapistController.getScheduleCalendar
  ? therapistController.getScheduleCalendar(req, res)
  : res.status(501).json({ success: false, message: "Not implemented" })
);


// Therapist earnings summary/report endpoint
therapistRouter.get('/earnings', jwtAuth, (req, res) => therapistController.getEarnings
  ? therapistController.getEarnings(req, res)
  : res.status(501).json({ success: false, message: "Not implemented" })
);


export default therapistRouter;
