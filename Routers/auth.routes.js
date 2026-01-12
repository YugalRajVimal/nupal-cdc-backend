import express from "express";

import AuthController from "../Controllers/AuthController/auth.controller.js";
import jwtAuth from "../middlewares/Auth/auth.middleware.js";

const authRouter = express.Router();

const authController = new AuthController();

authRouter.post("/", jwtAuth, authController.checkAuth);

authRouter.post("/signin", authController.signin);

authRouter.post("/verify-account", authController.verifyAccount);

authRouter.post("/signout", jwtAuth, authController.signOut);



export default authRouter;
