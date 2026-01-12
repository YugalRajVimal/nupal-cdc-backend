import Booking from "../../Schema/booking.schema.js";


class FinancesAdminController {

    async getFinancesDetails(req, res) {
        try {
          // IMPORT MODELS

          // For now, let's assume only "Booking" payments are tracked as income.
          // In future, can add more sources or an Expense schema.

          // --- 1. Get all "paid" Bookings (assume payment field references payment doc) ---
          // We assume there is a .payment and its status is "paid"
          // We'll need to populate 'payment' field to access amount/status/date

          console.log("--");

          const paidBookings = await Booking.find()
            .populate({
              path: "payment",
              model: "Payment"
            })
            .populate({
              path: "patient",
              model: "PatientProfile"
            })
            .populate({
              path: "therapy",
              model: "TherapyType"
            })
            .populate({
              path: "package",
              model: "Package"
            })
            .exec();

          // Prepare log rows
          let financeLogs = [];
          let totalIncome = 0;

          // Collect from bookings with paid payment
          paidBookings.forEach(booking => {
            const payment = booking.payment;
            if (payment && payment.status === "paid") {
              financeLogs.push({
                date: payment.paymentDate
                  ? payment.paymentDate
                  : (payment.updatedAt || payment.createdAt),
                description: booking.appointmentId
                  ? `Booking Payment (Appointment ID: ${booking.appointmentId})`
                  : `Booking Payment`,
                type: "Income",
                amount: payment.amount || payment.totalAmount || 0
              });
              totalIncome += payment.amount || payment.totalAmount || 0;
            }
          });

          // --- 2. (Optional) Expenses - not implemented but structure is given ---
          // Suppose there's an Expense schema, you could add expense logs here.
          // Example:
          // const expenses = await Expense.find().exec();
          // expenses.forEach(exp => {
          //    financeLogs.push({... type: "Expense", ...});
          // });

          let totalExpenses = 0; // change if there are expenses

          // Optionally, sort logs by date (descending)
          financeLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

          // --- FINAL STRUCTURE ---
          return res.json({
            success: true,
            totalIncome,
            totalExpenses,
            netBalance: totalIncome - totalExpenses,
            logs: financeLogs.map(log => ({
              Date: log.date,
              Description: log.description,
              Type: log.type,
              Amount: log.amount
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

