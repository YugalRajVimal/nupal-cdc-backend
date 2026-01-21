import express from "express";
import ParentController from "../Controllers/Parent/parent.controller.js";
import jwtAuth from "../middlewares/Auth/auth.middleware.js";


const parentRouter = express.Router();
const parentController = new ParentController();


// INSERT_YOUR_CODE
// INSERT_YOUR_CODE

// Parent sign up - Send OTP
parentRouter.post('/signup', (req, res) => parentController.parentSignUpSendOTP(req, res));

// Parent sign up - Verify OTP
parentRouter.post('/verify-otp', (req, res) => parentController.parentSignUpVerifyOTP(req, res));

// Complete parent profile (and create child profile/patientProfile)
// Protected: requires authentication
parentRouter.post('/complete-profile', jwtAuth, (req, res) => parentController.completeParentProfile(req, res));



// Dashboard details for parent
parentRouter.get('/dashboard',jwtAuth, (req, res) => parentController.getDashboardDetails(req, res));

// Get profile details for parent
parentRouter.get('/profile',jwtAuth, (req, res) => parentController.getProfileDetails(req, res));

// Get all children for the parent
parentRouter.get('/childrens',jwtAuth, (req, res) => parentController.getAllChildrens(req, res));

// Get all appointments for the parent's children
parentRouter.get('/appointments',jwtAuth, (req, res) => parentController.getAllAppointments(req, res));

parentRouter.get('/request-appointment-homepage',jwtAuth, (req, res) => parentController.getRequestAppointmentHomePage(req, res));

parentRouter.get('/all-bookings', (req, res) =>
  parentController.allBookings(req, res)
);

parentRouter.post('/create-booking-request', (req, res) => parentController.createBookingRequest(req, res));
parentRouter.put('/booking-request/:id', (req, res) => parentController.updateBookingRequest(req, res));

parentRouter.get('/booking-requests',jwtAuth, (req, res) => parentController.getAllBookingRequests(req, res));
parentRouter.delete('/booking-request/:id', (req, res) => parentController.deleteBookingRequest(req, res));

parentRouter.get('/booking-requests/:id', (req, res) => parentController.getBookingRequestById(req, res));



// INSERT_YOUR_CODE

// Session Edit Request CRUD routes
parentRouter.post('/session-edit-request-bulk', (req, res) => parentController.createSessionEditRequest(req, res));
parentRouter.get('/session-edit-request', (req, res) => parentController.getSessionEditRequests(req, res));
parentRouter.put('/session-edit-request/:id', (req, res) => parentController.updateSessionEditRequest(req, res));
parentRouter.delete('/session-edit-request/:id', (req, res) => parentController.deleteSessionEditRequest(req, res));



// INSERT_YOUR_CODE
// Route to get invoice and payment details for parent's bookings/appointments
parentRouter.get('/invoice-and-payment',jwtAuth, (req, res) => parentController.getInvoiceAndPayment(req, res));










export default parentRouter;
