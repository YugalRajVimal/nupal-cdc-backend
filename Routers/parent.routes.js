import express from "express";
import ParentController from "../Controllers/Parent/parent.controller.js";


const parentRouter = express.Router();
const parentController = new ParentController();


// INSERT_YOUR_CODE

// Dashboard details for parent
parentRouter.get('/dashboard', (req, res) => parentController.getDashboardDetails(req, res));

// Get profile details for parent
parentRouter.get('/profile', (req, res) => parentController.getProfileDetails(req, res));

// Get all children for the parent
parentRouter.get('/childrens', (req, res) => parentController.getAllChildrens(req, res));

// Get all appointments for the parent's children
parentRouter.get('/appointments', (req, res) => parentController.getAllAppointments(req, res));





export default parentRouter;
