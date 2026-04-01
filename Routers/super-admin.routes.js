import express from "express";



import therapyAdminRouter from "./SuperAdmin/therapy-super-admin.routes.js";

import packagesAdminRouter from "./SuperAdmin/packages-super-admin.routes.js";

import discountCouponRouter from "./SuperAdmin/discount-coupons.super-admin.routes.js";
import usersSuperAdminRouter from "./SuperAdmin/users-super-admin.routes.js";
import appointmentSuperAdminRouter from "./SuperAdmin/appointments-super-admin.routes.js";
import financeSuperAdminRouter from "./SuperAdmin/finance.routes.js";
import { User } from "../Schema/user.schema.js";
import logsSuperAdminRouter from "./SuperAdmin/logs.routes.js";
import jwtAuth from "../middlewares/Auth/auth.middleware.js";



const superAdminRouter = express.Router();


// Welcome route

// superAdminRouter.use(jwtAuth);
// superAdminRouter.use(authorizeRole("admin"));


superAdminRouter.get("/", (req, res) => {
  res.send("Welcome to Nupal CDC Super Admin APIs");
});



superAdminRouter.get("/profile", jwtAuth, async (req, res) => {
  try {
    // req.user should be set by jwtAuth middleware
    if (!req.user || !req.user.id || req.user.role !== "superadmin") {
      return res.status(401).json({
        success: false,
        message: "Invalid or missing super admin token.",
      });
    }

    const admin = await User.findOne(
      { _id: req.user.id, role: "superadmin" },
      "-password"
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found",
      });
    }

    res.json({
      success: true,
      data: admin,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching admin profile",
      error: error.message,
    });
  }
});




superAdminRouter.use("/therapy-types", therapyAdminRouter);


// All routes under /api/admin/packages
superAdminRouter.use("/packages", packagesAdminRouter);




superAdminRouter.use("/discount-coupons", discountCouponRouter);



superAdminRouter.use("/users", usersSuperAdminRouter);


superAdminRouter.use("/all-appointments", appointmentSuperAdminRouter);



superAdminRouter.use("/finance", financeSuperAdminRouter
);



superAdminRouter.use("/logs", logsSuperAdminRouter);







export default superAdminRouter;
