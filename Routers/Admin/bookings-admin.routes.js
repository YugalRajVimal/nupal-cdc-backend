
import express from "express";
import BookingAdminController from "../../Controllers/Admin/booking.controller.js";
import jwtAuth from "../../middlewares/Auth/auth.middleware.js";

const bookingsAdminRouter = express.Router();
const bookingAdminController = new BookingAdminController();

/**
 * @route GET /api/admin/bookings/home-details
 * @desc Get all patients, therapy types, and packages needed for booking home page
 */
bookingsAdminRouter.get("/home-details", (req, res) => 
  bookingAdminController.getBookingHomePageDetails(req, res)
);


/**
 * @route POST /api/admin/bookings
 * @desc Create a new booking
 */
bookingsAdminRouter.post("/",jwtAuth, (req, res) => 
  bookingAdminController.createBooking(req, res)
);

/**
 * @route GET /api/admin/bookings
 * @desc Get all bookings
 */
bookingsAdminRouter.get("/", (req, res) =>
  bookingAdminController.getAllBookings(req, res)
);


/**
 * @route DELETE /api/admin/bookings/:id
 * @desc Delete booking by id
 */
// bookingsAdminRouter.delete("/:id", (req, res) =>
//   bookingAdminController.deleteBooking(req, res)
// );

/**
 * @route PUT /api/admin/bookings/:id
 * @desc Update booking by id
 */
bookingsAdminRouter.put("/:id",jwtAuth, (req, res) =>
  bookingAdminController.updateBooking(req, res)
);

bookingsAdminRouter.post("/move-session", jwtAuth, (req, res) =>
  bookingAdminController.moveSession(req, res)
);


/**
 * @route GET /api/admin/booking-requests
 * @desc Get all booking requests (admin)
 */
bookingsAdminRouter.get("/booking-requests", (req, res) =>
  bookingAdminController.getAllBookingRequests(req, res)
);

/**
 * @route POST /api/admin/booking-requests/:id/reject
 * @desc Reject a booking request by id (admin)
 */
bookingsAdminRouter.post("/booking-requests/:id/reject",jwtAuth, (req, res) => 
  bookingAdminController.rejectBookingRequest(req, res)
);

/**
 * @route POST /api/admin/bookings/:id/collect-payment
 * @desc Record payment for a booking by id
 */
bookingsAdminRouter.post("/:id/collect-payment",jwtAuth, (req, res) =>
  bookingAdminController.collectPayment(req, res)
);

/**
 * @route POST /api/admin/bookings/check-in
 * @desc Check-in a Children for a booking
 */
bookingsAdminRouter.post("/check-in",jwtAuth, (req, res) =>
  bookingAdminController.checkIn(req, res)
);

/**
 * @route POST /api/admin/bookings/mark-session-missed
 * @desc Mark a specific session as missed for a booking
 * @access Admin (authentication required)
 */
bookingsAdminRouter.post("/mark-session-missed", jwtAuth, (req, res) =>
  bookingAdminController.markSessionMissed(req, res)
);

/**
 * @route POST /api/admin/bookings/mark-session-not-checked-in
 * @desc Mark a session as "Not Checked In" for a booking (undo "checked in")
 * @access Admin (authentication required)
 */
bookingsAdminRouter.post(
  "/mark-session-not-checked-in",
  jwtAuth,
  (req, res) => bookingAdminController.markSessionNotCheckedIn(req, res)
);



/**
 * @route GET /api/admin/bookings/reception-desk
 * @desc Get today's bookings and pending payment bookings (Reception Desk details)
 */
bookingsAdminRouter.get("/reception-desk", (req, res) =>
  bookingAdminController.getReceptionDeskDetails(req, res)
);

/**
 * @route GET /api/admin/bookings/sessions
 * @desc Get all sessions for all bookings, filterable by date, therapist, patient, etc.
 */
bookingsAdminRouter.get("/sessions", (req, res) =>
  bookingAdminController.getAllSessions(req, res)
);


/**
 * @route GET /api/admin/bookings/overview
 * @desc Get admin bookings overview (dashboard summary)
 */
bookingsAdminRouter.get("/overview", (req, res) =>
  bookingAdminController.getOverview(req, res)
);






/**
 * @route GET /api/admin/session-edit-requests
 * @desc Get all session edit requests (admin)
 */
bookingsAdminRouter.get("/session-edit-requests", (req, res) =>
  bookingAdminController.getAllSessionEditRequests(req, res)
);

/**
 * @route POST /api/admin/session-edit-requests/:id/approve
 * @desc Approve a session edit request (admin)
 */
bookingsAdminRouter.post("/session-edit-requests/:id/approve", (req, res) =>
  bookingAdminController.approveSessionEditRequest(req, res)
);

/**
 * @route POST /api/admin/session-edit-requests/:id/reject
 * @desc Reject a session edit request (admin)
 */
bookingsAdminRouter.post("/session-edit-requests/:id/reject", (req, res) =>
  bookingAdminController.rejectSessionEditRequest(req, res)
);


/**
 * @route GET /api/admin/full-calendar
 * @desc Get all sessions from all bookings for the admin full calendar
 */
bookingsAdminRouter.get("/full-calendar", (req, res) =>
  bookingAdminController.getFullCalendar(req, res)
);







// Future: Add more booking-related admin routes here (create booking, update, etc.)

export default bookingsAdminRouter;


