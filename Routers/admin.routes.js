import express from "express";

import jwtAuth from "../middlewares/Auth/auth.middleware.js";
import therapyAdminRouter from "./SuperAdmin/therapy-super-admin.routes.js";
import therapistAdminRouter from "./Admin/therapist-admin.routes.js";
import patientAdminRouter from "./Admin/patient-admin.routes.js";
import leadsAdminRouter from "./Admin/leads-admin.routes.js";
import packagesAdminRouter from "./SuperAdmin/packages-super-admin.routes.js";
import bookingsAdminRouter from "./Admin/bookings-admin.routes.js";
import availabilitySlotsRouter from "./Admin/availability-slots.routes.js";
import discountCouponRouter from "./SuperAdmin/discount-coupons.super-admin.routes.js";
import financeAdminRouter from "./Admin/finance.routes.js";
import { User } from "../Schema/user.schema.js";
import ticketsRouter from "./Admin/tickets.routes.js";
import ConsultationBookingRouter from "./Admin/consultation-booking.routes.js";

const adminRouter = express.Router();


// Welcome route

// adminRouter.use(jwtAuth);
// adminRouter.use(authorizeRole("admin"));


adminRouter.get("/", (req, res) => {
  res.send("Welcome to Nupal CDC Admin APIs");
});



adminRouter.use("/therapy-types", therapyAdminRouter);

adminRouter.use("/therapist", therapistAdminRouter);

adminRouter.use("/patients", patientAdminRouter);

adminRouter.use("/leads", leadsAdminRouter);

// PACKAGE MANAGEMENT ADMIN ROUTES

// All routes under /api/admin/packages
adminRouter.use("/packages", packagesAdminRouter);


adminRouter.use("/bookings", bookingsAdminRouter);



adminRouter.use("/availability-slots", availabilitySlotsRouter);



adminRouter.use("/discount-coupons", discountCouponRouter);



adminRouter.use("/finance", financeAdminRouter);


// INSERT_YOUR_CODE



adminRouter.use("/tickets", ticketsRouter);

adminRouter.use(
  "/consultation-bookings",
  ConsultationBookingRouter
);




adminRouter.get("/profile", jwtAuth, async (req, res) => {
  try {
    // Use the id and role from the authenticated token (placed into req.user by jwtAuth middleware)
    if (!req.user || !req.user.id || req.user.role !== "admin") {
      return res.status(401).json({ success: false, message: "Invalid or missing admin token." });
    }

    const adminData = await User.findOne({ _id: req.user.id, role: "admin" }).select("-password");
    if (!adminData) {
      return res.status(404).json({ success: false, message: "Admin not found." });
    }

    res.json({ success: true, data: adminData });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching admin profile", error: error.message });
  }
});


























// adminRouter.get("/get-profile-details", jwtAuth, (req, res) => {
//   adminController.getProfileDetails(req, res);
// });


// adminRouter.get("/get-dashboard-details", jwtAuth, (req, res) => {
//   adminController.getDashboardDetails(req, res);
// });

// // Add Route
// adminRouter.post("/add-route", jwtAuth, (req, res) => {
//   adminController.addRoute(req, res);
// });

// // Edit Route
// adminRouter.put("/edit-route/:id", jwtAuth, (req, res) => {
//   adminController.editRoute(req, res);
// });

// // Delete Route
// adminRouter.delete("/delete-route/:id", jwtAuth, (req, res) => {
//   adminController.deleteRoute(req, res);
// });

// // Fetch All Routes
// adminRouter.get("/get-all-routes", jwtAuth, (req, res) => {
//   adminController.getAllRoutes(req, res);
// });



// adminRouter.post("/onboard-sub-admin", jwtAuth, (req, res) => {
//   adminController.onboardSubAdmin(req, res);
// });

// adminRouter.put("/update-sub-admin/:id", jwtAuth, (req, res) => {
//   adminController.updateSubAdmin(req, res);
// });


// adminRouter.get("/get-all-sub-admins", jwtAuth, (req, res) => {
//   adminController.getAllSubAdmins(req, res);
// });

// adminRouter.get("/get-all-supervisors", jwtAuth, (req, res) => {
//   adminController.getAllSupervisors(req, res);
// });

// adminRouter.get("/get-all-vendors", jwtAuth, (req, res) => {
//   adminController.getAllVendors(req, res);
// });

// adminRouter.get("/get-issued-assets-report", jwtAuth, (req, res) => {
//   adminController.getIssuedAssetsReport(req, res);
// });

// adminRouter.get("/get-all-issued-assets-report", jwtAuth, (req, res) => {
//   adminController.getAllIssuedAssetsReport(req, res);
// });

// adminRouter.post("/add-issued-assets", jwtAuth, (req, res) => {
//   adminController.addIssuedAssets(req, res);
// });

// adminRouter.post("/update-issued-assets", jwtAuth, (req, res) => {
//   adminController.updateIssuedAssets(req, res);
// });

export default adminRouter;
