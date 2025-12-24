import express from "express";


import jwtAuth from "../middlewares/Auth/auth.middleware.js";
import therapyAdminRouter from "./Admin/therapy-admin.routes.js";
import therapistAdminRouter from "./Admin/therapist-admin.routes.js";
import patientAdminRouter from "./Admin/patient-admin.routes.js";
import leadsAdminRouter from "./Admin/leads-admin.routes.js";
import packagesAdminRouter from "./Admin/packages-admin.routes.js";
import bookingsAdminRouter from "./Admin/bookings-admin.routes.js";


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
