import Booking from "../../Schema/booking.schema.js";
import Finances from "../../Schema/finances.schema.js";


class FinancesSuperAdminController {
  
  async getFinancesDetails(req, res) {
    try {
      // Fetch all finance records (both income and expense)
      const finances = await Finances.find({}).sort({ date: -1 }).lean();

      let totalIncome = 0;
      let totalExpenses = 0;
      let financeLogs = [];

      finances.forEach(finance => {
        const type =
          finance.type.charAt(0).toUpperCase() + finance.type.slice(1); // "Income" or "Expense"
        
        financeLogs.push({
          date: finance.date,
          description: finance.description,
          type,
          amount: finance.amount,
          creditDebitStatus: finance.creditDebitStatus
        });

        if (finance.type.toLowerCase() === "income") {
          totalIncome += finance.amount;
        } else if (finance.type.toLowerCase() === "expense") {
          totalExpenses += finance.amount;
        }
      });

      // Logs sorted already by date latest first

      const netBalance = totalIncome - totalExpenses;



      return res.json({
        success: true,
        totalIncome,
        totalExpenses,
        netBalance,
        logs: financeLogs.map(log => ({
          Date: log.date,
          Description: log.description,
          Type: log.type,
          Amount: log.amount,
          CreditDebitStatus: log.creditDebitStatus
        }))
      });
    } catch (error) {
      console.error("[ADMIN FINANCE DETAILS] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch finance details",
        error: error.message
      });
    }
  }
   
}

export default FinancesSuperAdminController;

