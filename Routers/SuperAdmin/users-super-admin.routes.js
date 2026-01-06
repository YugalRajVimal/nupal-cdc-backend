import express from "express";
import UsersSuperAdminController from "../../Controllers/SuperAdmin/users.controller.js";



const usersSuperAdminRouter = express.Router();
const usersSuperAdminController = new UsersSuperAdminController();


// GET all users (patients, therapists, subadmins)
usersSuperAdminRouter.get("/", (req, res) => {
    usersSuperAdminController.getAllUsers(req, res);
});




export default usersSuperAdminRouter;
