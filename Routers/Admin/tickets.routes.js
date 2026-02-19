import express from "express";
import TicketsAdminController from "../../Controllers/Admin/tickets.controller.js";
import jwtAuth from "../../middlewares/Auth/auth.middleware.js";

const ticketsRouter = express.Router();
const ticketsAdminController = new TicketsAdminController();

/**
 * @route   GET /admin/tickets
 * @desc    Admin: Get all tickets with optional filters, pagination and sorting
 * @query   status, priority, raisedByRole, page, limit, sort
 */
ticketsRouter.get("/", (req, res) => ticketsAdminController.getTickets(req, res));

/**
 * @route   GET /admin/tickets/:id
 * @desc    Admin: Get a single ticket by ID
 */
ticketsRouter.get("/:id", (req, res) => ticketsAdminController.getTicketById(req, res));

/**
 * @route   PATCH /admin/tickets/:id/status
 * @desc    Admin: Change ticket status (e.g., open, closed)
 * @body    { status }
 */
ticketsRouter.patch("/:id/status", (req, res) => ticketsAdminController.changeStatus(req, res));

/**
 * @route   POST /admin/tickets/:id/respond
 * @desc    Admin: Respond to a ticket (add a response)
 * @body    { responseText }
 */
ticketsRouter.post("/:id/respond",jwtAuth, (req, res) => ticketsAdminController.respondToTicket(req, res));

export default ticketsRouter;