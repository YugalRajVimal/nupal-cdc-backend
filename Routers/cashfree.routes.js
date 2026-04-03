import express from "express";
import CashfreeController from "../Controllers/Cashfree/cashfree.controller.js";

const router = express.Router();
const cashfreeController = new CashfreeController();

// Route to generate a Cashfree Session ID (order)
router.post("/generate-session-id", (req, res) =>
  cashfreeController.generateSessionId(req, res)
);

// Cashfree webhook handler (for payment status updates)
router.post("/booking-payment-webhook", (req, res) =>
  cashfreeController.handleWebhook(req, res)
);

export default router;