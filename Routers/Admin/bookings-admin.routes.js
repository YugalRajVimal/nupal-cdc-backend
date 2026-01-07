
import express from "express";
import BookingAdminController from "../../Controllers/Admin/booking.controller.js";

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
bookingsAdminRouter.post("/", (req, res) => 
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
bookingsAdminRouter.delete("/:id", (req, res) =>
  bookingAdminController.deleteBooking(req, res)
);

/**
 * @route PUT /api/admin/bookings/:id
 * @desc Update booking by id
 */
bookingsAdminRouter.put("/:id", (req, res) =>
  bookingAdminController.updateBooking(req, res)
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
bookingsAdminRouter.post("/booking-requests/:id/reject", (req, res) => 
  bookingAdminController.rejectBookingRequest(req, res)
);








// Future: Add more booking-related admin routes here (create booking, update, etc.)

export default bookingsAdminRouter;


