
import express from "express";

import FinancesSuperAdminController from "../../Controllers/SuperAdmin/finance.controller.js";

const financeSuperAdminRouter = express.Router();
const financeSuperAdminController = new FinancesSuperAdminController();

financeSuperAdminRouter.get("/details", (req, res) => financeSuperAdminController.getFinancesDetails(req, res));

// Therapist Salary vs Sessions Comparison
financeSuperAdminRouter.get(
  "/therapist/salary-session-comparison",
  async (req, res) => {
    await financeSuperAdminController.getAllTherapistsSalarySessionComparison(req, res);
  }
);





export default financeSuperAdminRouter;

