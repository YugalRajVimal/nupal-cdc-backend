import express from "express";
import AppointmentSuperAdminController from "../../Controllers/SuperAdmin/appointments.controller.js";


const appointmentSuperAdminRouter = express.Router();
const appointmentSuperAdminController = new AppointmentSuperAdminController();

// Route: GET /super-admin/appointments
appointmentSuperAdminRouter.get("/", (req, res) => appointmentSuperAdminController.getAllBookings(req, res));

export default appointmentSuperAdminRouter;
