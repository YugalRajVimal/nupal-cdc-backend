import express from "express";
import UsersSuperAdminController from "../../Controllers/SuperAdmin/users.controller.js";



const usersSuperAdminRouter = express.Router();
const usersSuperAdminController = new UsersSuperAdminController();


// GET all users (patients, therapists, subadmins)
usersSuperAdminRouter.get("/", (req, res) => {
    usersSuperAdminController.getAllUsers(req, res);
});

// POST route for super-admin "login as user"
usersSuperAdminRouter.post("/login-as-user", (req, res) => {
    usersSuperAdminController.loginAsUser(req, res);
});





export default usersSuperAdminRouter;
