import Booking from "../../Schema/booking.schema.js";
import Finances from "../../Schema/finances.schema.js";


class FinancesAdminController {

  // async getFinancesDetails(req, res) {
  //   try {
  //     // Fetch all finance records
  //     const finances = await Finances.find().sort({ date: -1 }).lean();

  //     let totalIncome = 0;
  //     let totalExpenses = 0;
  //     let financeLogs = [];

  //     finances.forEach(finance => {
  //       financeLogs.push({
  //         date: finance.date,
  //         description: finance.description,
  //         type: finance.type.charAt(0).toUpperCase() + finance.type.slice(1), // "income"/"expense" -> "Income"/"Expense"
  //         amount: finance.amount,
  //         creditDebitStatus: finance.creditDebitStatus
  //       });

  //       if (finance.type === "income") {
  //         totalIncome += finance.amount;
  //       } else if (finance.type === "expense") {
  //         totalExpenses += finance.amount;
  //       }
  //     });

  //     // Optionally: sort logs again (should already be sorted by date latest first)
  //     financeLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

  //     return res.json({
  //       success: true,
  //       totalIncome,
  //       totalExpenses,
  //       netBalance: totalIncome - totalExpenses,
  //       logs: financeLogs.map(log => ({
  //         Date: log.date,
  //         Description: log.description,
  //         Type: log.type,
  //         Amount: log.amount,
  //         CreditDebitStatus: log.creditDebitStatus
  //       }))
  //     });
  //   } catch (error) {
  //     console.error("[ADMIN FINANCE DETAILS] Error:", error);
  //     return res.status(500).json({
  //       success: false,
  //       message: "Failed to fetch finance details",
  //       error: error.message
  //     });
  //   }
  // }

    async getFinancesDetails(req, res) {
      try {
        // Fetch only finance records where type is "income"
        const finances = await Finances.find({ type: "income" }).sort({ date: -1 }).lean();

        let totalIncome = 0;
        let financeLogs = [];

        finances.forEach(finance => {
          financeLogs.push({
            date: finance.date,
            description: finance.description,
            type: finance.type.charAt(0).toUpperCase() + finance.type.slice(1), // "Income"
            amount: finance.amount,
            creditDebitStatus: finance.creditDebitStatus
          });

          totalIncome += finance.amount;
        });

        // Optionally: sort logs again (should already be sorted by date latest first)
        financeLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

        return res.json({
          success: true,
          totalIncome,
          totalExpenses: 0,
          netBalance: totalIncome,
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

export default FinancesAdminController;

