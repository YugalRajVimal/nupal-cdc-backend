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
        // Accept query params for search, pagination, sort
        let {
          page = 1,
          pageSize = 10,
          search = "",
          sortField = "date",
          sortOrder = "desc"
        } = req.query;

        page = parseInt(page, 10) || 1;
        pageSize = parseInt(pageSize, 10) || 20;

        // Only get "income"
        let query = { type: "income" };

        // Build sorting object
        let sortObj = {};
        if (sortField) sortObj[sortField] = sortOrder === "asc" ? 1 : -1;

        let finances = await Finances.find(query)
          .sort(sortObj)
          .lean();

        // In-memory search filtering
        if (search && typeof search === "string" && search.trim().length > 0) {
          const regex = new RegExp(search.trim(), "i");
          finances = finances.filter(f =>
            (f.description && regex.test(f.description)) ||
            (f.creditDebitStatus && regex.test(f.creditDebitStatus)) ||
            (f.type && regex.test(f.type)) ||
            (f.amount !== undefined && f.amount !== null && regex.test(f.amount.toString())) ||
            (f.date && regex.test(new Date(f.date).toISOString().slice(0, 10)))
          );
        }

        // Calculate only income totals
        let totalIncome = 0;
        finances.forEach(finance => {
          totalIncome += finance.amount;
        });

        // Pagination
        const total = finances.length;
        const offset = (page - 1) * pageSize;
        const pagedFinances = finances.slice(offset, offset + pageSize);

        // Prepare logs for output
        const financeLogs = pagedFinances.map(finance => ({
          Date: finance.date,
          Description: finance.description,
          Type: finance.type.charAt(0).toUpperCase() + finance.type.slice(1),
          Amount: finance.amount,
          CreditDebitStatus: finance.creditDebitStatus
        }));

        return res.json({
          success: true,
          totalIncome,
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
          logs: financeLogs
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

