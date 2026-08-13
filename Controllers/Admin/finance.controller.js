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
        // Accept query params for search, pagination, sort, and new filters
        let {
          page = 1,pageSize = 10,search = "",sortField = "date",sortOrder = "desc",paymentMethod,creditDebitStatus,childrenName,childrenId,minAmount,maxAmount,startDate,endDate
        } = req.query;

        page = parseInt(page, 10) || 1;
        pageSize = parseInt(pageSize, 10) || 20;

        // Build query object with filters
        let query = { type: "income" };
        if (paymentMethod) query.paymentMethod = paymentMethod;
        if (creditDebitStatus) query.creditDebitStatus = creditDebitStatus;
        if (childrenName) query.childrenName = { $regex: new RegExp(childrenName, "i") };
        if (childrenId) query.childrenId = { $regex: new RegExp(childrenId, "i") };

        if (minAmount !== undefined || maxAmount !== undefined) {
          query.amount = {};
          if (minAmount !== undefined && !isNaN(Number(minAmount))) {
            query.amount.$gte = Number(minAmount);
          }
          if (maxAmount !== undefined && !isNaN(Number(maxAmount))) {
            query.amount.$lte = Number(maxAmount);
          }
          if (Object.keys(query.amount).length === 0) delete query.amount;
        }

        // Date range filtering
        if (startDate || endDate) {
          query.date = {};
          if (startDate) {
            // If date is provided as YYYY-MM-DD, convert to Date object at 00:00:00
            query.date.$gte = new Date(startDate);
          }
          if (endDate) {
            // If date is provided as YYYY-MM-DD, set to end of day
            let end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            query.date.$lte = end;
          }
          if (Object.keys(query.date).length === 0) delete query.date;
        }

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
            (f.date && regex.test(new Date(f.date).toISOString().slice(0, 10))) ||
            (f.paymentMethod && regex.test(f.paymentMethod)) ||
            (f.utr && Array.isArray(f.utr) && f.utr.some(u => regex.test(u))) ||
            (f.childrenName && regex.test(f.childrenName)) ||
            (f.childrenId && regex.test(f.childrenId))
          );
        }

        // Totals for income only
        let totalIncome = 0;
        finances.forEach(finance => {
          totalIncome += finance.amount;
        });

        // Pagination
        const total = finances.length;
        const offset = (page - 1) * pageSize;
        const pagedFinances = finances.slice(offset, offset + pageSize);

        // Prepare logs for output, including childrenName and childrenId
        const financeLogs = pagedFinances.map(finance => ({
          _id: finance._id,
          Date: finance.date,
          Description: finance.description,
          Type: finance.type.charAt(0).toUpperCase() + finance.type.slice(1),
          Amount: finance.amount,
          CreditDebitStatus: finance.creditDebitStatus,
          PaymentMethod: finance.paymentMethod,
          Utr: finance.utr,
          ChildrenName: finance.childrenName,
          ChildrenId: finance.childrenId,
          CreatedAt: finance.createdAt,
          UpdatedAt: finance.updatedAt,
        }));

        return res.json({
          success: true,
          totalIncome,
          // Return 0 for expense and netBalance since only income is included
          totalExpenses: 0,
          netBalance: totalIncome,
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

    // async getFinancesDetails(req, res) {
    //   try {
    //     let {
    //       page = 1,
    //       pageSize = 10,
    //       search = "",
    //       sortField = "date",
    //       sortOrder = "desc"
    //     } = req.query;
    
    //     page = parseInt(page, 10) || 1;
    //     pageSize = parseInt(pageSize, 10) || 10;
    
    //     // --------------------------------------------------
    //     // DATE RANGE
    //     // Current month + previous month only
    //     //
    //     // Example:
    //     // If current month = August
    //     // Included: July + August
    //     // Excluded: June and earlier
    //     // --------------------------------------------------
    //     const now = new Date();
    
    //     // Start of previous month
    //     const startOfPreviousMonth = new Date(
    //       now.getFullYear(),
    //       now.getMonth() - 1,
    //       1,
    //       0,
    //       0,
    //       0,
    //       0
    //     );
    
    //     // Start of next month
    //     // Using $lt means the entire current month is included.
    //     const startOfNextMonth = new Date(
    //       now.getFullYear(),
    //       now.getMonth() + 1,
    //       1,
    //       0,
    //       0,
    //       0,
    //       0
    //     );
    
    //     // --------------------------------------------------
    //     // QUERY
    //     // Only income from previous month + current month
    //     // --------------------------------------------------
    //     const query = {
    //       type: "income",
    //       date: {
    //         $gte: startOfPreviousMonth,
    //         $lt: startOfNextMonth
    //       }
    //     };
    
    //     // --------------------------------------------------
    //     // SORT
    //     // --------------------------------------------------
    //     const sortObj = {};
    
    //     if (sortField) {
    //       sortObj[sortField] =
    //         sortOrder === "asc" ? 1 : -1;
    //     }
    
    //     // --------------------------------------------------
    //     // GET FINANCES
    //     // --------------------------------------------------
    //     let finances = await Finances.find(query)
    //       .sort(sortObj)
    //       .lean();
    
    //     // --------------------------------------------------
    //     // SEARCH
    //     // --------------------------------------------------
    //     if (
    //       search &&
    //       typeof search === "string" &&
    //       search.trim().length > 0
    //     ) {
    //       const regex = new RegExp(search.trim(), "i");
    
    //       finances = finances.filter(finance =>
    //         (finance.description &&
    //           regex.test(finance.description)) ||
    
    //         (finance.creditDebitStatus &&
    //           regex.test(finance.creditDebitStatus)) ||
    
    //         (finance.type &&
    //           regex.test(finance.type)) ||
    
    //         (finance.amount !== undefined &&
    //           finance.amount !== null &&
    //           regex.test(finance.amount.toString())) ||
    
    //         (finance.date &&
    //           regex.test(
    //             new Date(finance.date)
    //               .toISOString()
    //               .slice(0, 10)
    //           )) ||
    
    //         (finance.paymentMethod &&
    //           regex.test(finance.paymentMethod)) ||
    
    //         (finance.utr &&
    //           Array.isArray(finance.utr) &&
    //           finance.utr.some(u => regex.test(u))) ||
    
    //         (finance.childrenName &&
    //           regex.test(finance.childrenName)) ||
    
    //         (finance.childrenId &&
    //           regex.test(finance.childrenId))
    //       );
    //     }
    
    //     // --------------------------------------------------
    //     // TOTAL INCOME
    //     // Only previous month + current month
    //     // --------------------------------------------------
    //     const totalIncome = finances.reduce(
    //       (total, finance) =>
    //         total + Number(finance.amount || 0),
    //       0
    //     );
    
    //     // --------------------------------------------------
    //     // PAGINATION
    //     // --------------------------------------------------
    //     const total = finances.length;
    
    //     const offset = (page - 1) * pageSize;
    
    //     const pagedFinances = finances.slice(
    //       offset,
    //       offset + pageSize
    //     );
    
    //     // --------------------------------------------------
    //     // FORMAT LOGS
    //     // --------------------------------------------------
    //     const financeLogs = pagedFinances.map(finance => ({
    //       _id: finance._id,
    
    //       Date: finance.date,
    
    //       Description: finance.description,
    
    //       Type:
    //         finance.type.charAt(0).toUpperCase() +
    //         finance.type.slice(1),
    
    //       Amount: finance.amount,
    
    //       CreditDebitStatus:
    //         finance.creditDebitStatus,
    
    //       PaymentMethod:
    //         finance.paymentMethod,
    
    //       Utr: finance.utr,
    
    //       ChildrenName:
    //         finance.childrenName,
    
    //       ChildrenId:
    //         finance.childrenId,
    
    //       CreatedAt:
    //         finance.createdAt,
    
    //       UpdatedAt:
    //         finance.updatedAt
    //     }));
    
    //     // --------------------------------------------------
    //     // RESPONSE
    //     // --------------------------------------------------
    //     return res.json({
    //       success: true,
    
    //       // Only previous month + current month
    //       totalIncome,
    
    //       // Since this controller only gets income
    //       totalExpenses: 0,
    
    //       netBalance: totalIncome,
    
    //       page,
    
    //       pageSize,
    
    //       total,
    
    //       totalPages: Math.ceil(total / pageSize),
    
    //       logs: financeLogs
    //     });
    
    //   } catch (error) {
    //     console.error(
    //       "[ADMIN FINANCE DETAILS] Error:",
    //       error
    //     );
    
    //     return res.status(500).json({
    //       success: false,
    //       message: "Failed to fetch finance details",
    //       error: error.message
    //     });
    //   }
    // }

/**
 * Controller to update the payment method of a finance entry by its ID.
 * Body params:
 *   - paymentMethod: string (required, e.g. 'Cash', 'Online', 'Cheque', etc)
 *   - utr: string (optional, for online/utr-type payments)
 */
async updateFinancePaymentMethod(req, res) {
  try {
    const { id } = req.params;
    const { paymentMethod, utr } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Finance log ID required"
      });
    }
    if (!paymentMethod || typeof paymentMethod !== "string") {
      return res.status(400).json({
        success: false,
        message: "A valid paymentMethod is required"
      });
    }
    // You may want to restrict allowed payment methods here

    const update = { paymentMethod: paymentMethod.trim() };
    if (utr !== undefined) {
      update.utr = (typeof utr === "string" && utr.trim() !== "") ? utr.trim() : null;
    }

    // Assuming your model is called FinanceLog or similar
    const updatedFinance = await Finances.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    );

    if (!updatedFinance) {
      return res.status(404).json({
        success: false,
        message: "Finance log not found"
      });
    }

    return res.json({
      success: true,
      message: "Payment method updated successfully",
      finance: updatedFinance
    });
  } catch (error) {
    console.error("[ADMIN UPDATE FINANCE PAYMENT METHOD] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update finance payment method",
      error: error.message
    });
  }
}

}

export default FinancesAdminController;

