
import express from "express";

import FinancesAdminController from "../../Controllers/Admin/finance.controller.js";

const financeAdminRouter = express.Router();
const financeAdminController = new FinancesAdminController();

financeAdminRouter.get("/details", (req, res) => financeAdminController.getFinancesDetails(req, res));

financeAdminRouter.patch("/update-payment-method/:id", (req, res) =>
  financeAdminController.updateFinancePaymentMethod(req, res)
);



export default financeAdminRouter;

