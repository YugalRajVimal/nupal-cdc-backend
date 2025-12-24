
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
 * @route GET /api/admin/bookings/:id
 * @desc Get booking by id
 */
bookingsAdminRouter.get("/:id", (req, res) =>
  bookingAdminController.getBookingById(req, res)
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




// Future: Add more booking-related admin routes here (create booking, update, etc.)

export default bookingsAdminRouter;


