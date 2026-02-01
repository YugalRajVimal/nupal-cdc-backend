
import express from "express";

import LeadsAdminController from "../../Controllers/Admin/leads.controller.js";
import jwtAuth from "../../middlewares/Auth/auth.middleware.js";

const leadsAdminRouter = express.Router();
const leadsAdminController = new LeadsAdminController();

leadsAdminRouter.post("/",jwtAuth, (req, res) => leadsAdminController.addLead(req, res));
leadsAdminRouter.get("/", (req, res) => leadsAdminController.getAllLeads(req, res));
leadsAdminRouter.get("/:id", (req, res) => leadsAdminController.getLeadById(req, res));
leadsAdminRouter.put("/:id",jwtAuth,  (req, res) => leadsAdminController.editLead(req, res));
leadsAdminRouter.delete("/:id",jwtAuth,  (req, res) => leadsAdminController.deleteLead(req, res));


export default leadsAdminRouter;

