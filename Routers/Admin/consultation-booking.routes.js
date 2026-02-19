import express from 'express';
import ConsultationBookingAdminController from '../../Controllers/Admin/consultation-booking.controller.js';

const ConsultationBookingRouter = express.Router();
const consultationBookingAdminController = new ConsultationBookingAdminController();

// Route: Fetch all consultation bookings (admin, optionally filterable by status)
ConsultationBookingRouter.get(
  '/',
  (req, res) => consultationBookingAdminController.getAllConsultationBookings(req, res)
);

// Route: Approve a consultation booking by id
ConsultationBookingRouter.put(
  '/:id/approve',
  (req, res) => consultationBookingAdminController.approveConsultationBooking(req, res)
);


export default ConsultationBookingRouter;
