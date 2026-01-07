import express from 'express';
import AavailabilitySlotsAdminController from '../../Controllers/Admin/availability-slots.controller.js';

const availabilitySlotsRouter = express.Router();
const aavailabilitySlotsAdminController = new AavailabilitySlotsAdminController();

// // GET /admin/availability-slots/default-therapist
// availabilitySlotsRouter.get('/default-therapist-count', (req, res) => 
//     aavailabilitySlotsAdminController.getDefaultTherapistSlots(req, res)
//   );
  
  
//   // PUT /admin/availability-slots/default-therapist
//   availabilitySlotsRouter.put('/default-therapist-count', (req, res) => 
//     aavailabilitySlotsAdminController.setDefaultTherapistSlots(req, res)
//   );
// // GET /admin/availability-slots/:date
// availabilitySlotsRouter.get('/:date', (req, res) => 
//   aavailabilitySlotsAdminController.getDailyAvailability(req, res)
// );

// // PUT /admin/availability-slots/:date
// availabilitySlotsRouter.put('/:date', (req, res) => 
//   aavailabilitySlotsAdminController.updateDailyAvailability(req, res)
// );

// // GET /admin/availability-slots/range/:from/:to
// availabilitySlotsRouter.get('/range/:from/:to', (req, res) => 
//   aavailabilitySlotsAdminController.getAvailabilityRange(req, res)
// );

// GET /admin/availability-slots/summary/monthly?month=6&year=2024&therapistId=NPL001 therapistId optional
availabilitySlotsRouter.get('/summary/monthly', (req, res) =>
  aavailabilitySlotsAdminController.getMonthlyAvailabilitySummary(req, res)
);




export default availabilitySlotsRouter;

//adminRouter.use("/availability-slots", availabilitySlotsRouter);