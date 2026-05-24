import express from "express";
import ParentController from "../../Controllers/Parent/parent.controller.js";
import jwtAuth from "../../middlewares/Auth/auth.middleware.js";


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

parentRouter.post('/create-booking-request',jwtAuth, (req, res) => parentController.createBookingRequest(req, res));
parentRouter.put('/booking-request/:id',jwtAuth, (req, res) => parentController.updateBookingRequest(req, res));

parentRouter.get('/booking-requests',jwtAuth, (req, res) => parentController.getAllBookingRequests(req, res));
parentRouter.delete('/booking-request/:id',jwtAuth, (req, res) => parentController.deleteBookingRequest(req, res));

parentRouter.get('/booking-requests/:id', (req, res) => parentController.getBookingRequestById(req, res));



// INSERT_YOUR_CODE

// Session Edit Request CRUD routes
parentRouter.post('/session-edit-request-bulk',jwtAuth, (req, res) => parentController.createSessionEditRequest(req, res));
parentRouter.get('/session-edit-request', (req, res) => parentController.getSessionEditRequests(req, res));
parentRouter.put('/session-edit-request/:id',jwtAuth, (req, res) => parentController.updateSessionEditRequest(req, res));
parentRouter.delete('/session-edit-request/:id',jwtAuth, (req, res) => parentController.deleteSessionEditRequest(req, res));



// INSERT_YOUR_CODE
// Route to get invoice and payment details for parent's bookings/appointments
parentRouter.get('/invoice-and-payment',jwtAuth, (req, res) => parentController.getInvoiceAndPayment(req, res));



// INSERT_YOUR_CODE

/**
 * Route to allow parents to raise a support ticket.
 * POST /parent/tickets/raise
 * Body: { subject, description, priority, tags }
 * Protected: requires authentication as a parent
 */
parentRouter.post('/tickets/raise', jwtAuth, (req, res) => parentController.raiseTicket(req, res));


// INSERT_YOUR_CODE

/**
 * Route to allow parents to view all tickets they have raised.
 * GET /parent/tickets
 * Query params: ?page=<number>&limit=<number>
 * Protected: requires authentication as a parent
 */
parentRouter.get('/tickets', jwtAuth, (req, res) => parentController.getAllPatientTickets(req, res));



// INSERT_YOUR_CODE

/**
 * ConsultationBooking endpoints for parents
 */

// Create a consultation booking request
parentRouter.post('/consultation-booking', jwtAuth, (req, res) => parentController.createConsultationBooking(req, res));

// Get all consultation bookings for the authenticated parent (with pagination/filter support)
parentRouter.get('/consultation-bookings', jwtAuth, (req, res) => parentController.getConsultationBookings(req, res));

// Update a consultation booking (e.g. cancel or reschedule, according to implementation)
parentRouter.put('/consultation-bookings/:id', jwtAuth, (req, res) => parentController.updateConsultationBooking(req, res));



parentRouter.get('/slot-availability', jwtAuth, parentController.getMonthlySlotAvailability.bind(parentController));







export default parentRouter;
