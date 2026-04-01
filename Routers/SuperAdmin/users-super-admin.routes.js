import express from "express";
import UsersSuperAdminController from "../../Controllers/SuperAdmin/users.controller.js";
import jwtAuth from "../../middlewares/Auth/auth.middleware.js";



const usersSuperAdminRouter = express.Router();
const usersSuperAdminController = new UsersSuperAdminController();


// GET all users (patients, therapists, subadmins)
usersSuperAdminRouter.get("/", (req, res) => {
    usersSuperAdminController.getAllUsers(req, res);
});

// POST route for super-admin "login as user"
usersSuperAdminRouter.post("/login-as-user",jwtAuth, (req, res) => {
    usersSuperAdminController.loginAsUser(req, res);
});

// Get superadmin profile (singleton)
usersSuperAdminRouter.get("/profile", jwtAuth, (req, res) => {
    usersSuperAdminController.getSuperAdminProfile(req, res);
});


// =====================
// ADMIN MANAGEMENT ROUTES
// =====================

// Get all admins (with optional search, pagination)
usersSuperAdminRouter.get("/admins", jwtAuth, (req, res) => {
    usersSuperAdminController.fetchAllAdmins(req, res);
});

// Create new admin
usersSuperAdminRouter.post("/admins", jwtAuth, (req, res) => {
    usersSuperAdminController.createAdmin(req, res);
});

// Edit admin
usersSuperAdminRouter.put("/admins/:id", jwtAuth, (req, res) => {
    usersSuperAdminController.editAdmin(req, res);
});

// Change admin status (active/suspended/deleted)
usersSuperAdminRouter.patch("/admins/:id/status", jwtAuth, (req, res) => {
    usersSuperAdminController.editAdminStatus(req, res);
});

// Change admin disabled flag
usersSuperAdminRouter.patch("/admins/:id/disabled", jwtAuth, (req, res) => {
    usersSuperAdminController.editAdminDisabled(req, res);
});

// Delete admin
usersSuperAdminRouter.delete("/admins/:id", jwtAuth, (req, res) => {
    usersSuperAdminController.deleteAdmin(req, res);
});






export default usersSuperAdminRouter;
