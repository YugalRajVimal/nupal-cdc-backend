import Booking from "../../Schema/booking.schema.js";
import Finances from "../../Schema/finances.schema.js";


class FinancesSuperAdminController {

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

      // Build sorting object
      let sortObj = {};
      if (sortField) sortObj[sortField] = sortOrder === "asc" ? 1 : -1;

      // Fetch all finance records (both income and expense)
      let finances = await Finances.find({})
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

      // Calculate total income and expenses
      let totalIncome = 0;
      let totalExpenses = 0;
      finances.forEach(finance => {
        if (finance.type && finance.type.toLowerCase() === "income") {
          totalIncome += finance.amount;
        } else if (finance.type && finance.type.toLowerCase() === "expense") {
          totalExpenses += finance.amount;
        }
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

      // Calculate net balance
      const netBalance = totalIncome - totalExpenses;

      return res.json({
        success: true,
        totalIncome,
        totalExpenses,
        netBalance,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        logs: financeLogs
      });
    } catch (error) {
      console.error("[SUPERADMIN FINANCE DETAILS] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch finance details",
        error: error.message
      });
    }
  }

   
}

export default FinancesSuperAdminController;

