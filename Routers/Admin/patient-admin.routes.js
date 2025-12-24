
import express from "express";
import PatientAdminController from "../../Controllers/Admin/patient.controller.js";
import { upload } from "../../middlewares/fileUpload.middleware.js";

const patientAdminRouter = express.Router();
const patientAdminController = new PatientAdminController();

/**
 * @route POST /admin/patients
 * @desc Add a new patient
 * @note The "otherDocument" should be sent as a file upload; the backend will process and store its file path.
 */

patientAdminRouter.post(
  "/",
  upload.single("otherDocument"),
  (req, res) => patientAdminController.addPatient(req, res)
);

/**
 * @route GET /admin/patients
 * @desc Get all patients
 */
patientAdminRouter.get("/", (req, res) => patientAdminController.getAllPatients(req, res));

/**
 * @route GET /admin/patients/:id
 * @desc Get a single patient by id (profile)
 */
patientAdminRouter.get("/:id", (req, res) => patientAdminController.getPatientById(req, res));

/**
 * @route PUT /admin/patients/:id
 * @desc Edit a patient profile
 */
patientAdminRouter.put("/:id", (req, res) => patientAdminController.editPatient(req, res));

/**
 * @route DELETE /admin/patients/:id
 * @desc Delete a patient by id (removes both User and PatientProfile)
 */
patientAdminRouter.delete("/:id", (req, res) => patientAdminController.deletePatient(req, res));

export default patientAdminRouter;

