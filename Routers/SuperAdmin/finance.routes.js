
import express from "express";

import FinancesSuperAdminController from "../../Controllers/SuperAdmin/finance.controller.js";

const financeSuperAdminRouter = express.Router();
const financeSuperAdminController = new FinancesSuperAdminController();

financeSuperAdminRouter.get("/details", (req, res) => financeSuperAdminController.getFinancesDetails(req, res));




export default financeSuperAdminRouter;

