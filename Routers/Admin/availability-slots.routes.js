import express from 'express';
import AavailabilitySlotsAdminController from '../../Controllers/Admin/availability-slots.controller.js';

const availabilitySlotsRouter = express.Router();
const aavailabilitySlotsAdminController = new AavailabilitySlotsAdminController();

// GET /admin/availability-slots/summary/monthly?month=6&year=2024&therapistId=NPL001 therapistId optional
availabilitySlotsRouter.get('/summary/monthly', (req, res) =>
  aavailabilitySlotsAdminController.getMonthlyAvailabilitySummary(req, res)
);




export default availabilitySlotsRouter;
