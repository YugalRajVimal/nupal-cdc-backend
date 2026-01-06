import express from "express";



import therapyAdminRouter from "./SuperAdmin/therapy-super-admin.routes.js";

import packagesAdminRouter from "./SuperAdmin/packages-super-admin.routes.js";

import discountCouponRouter from "./SuperAdmin/discount-coupons.super-admin.routes.js";
import usersSuperAdminRouter from "./SuperAdmin/users-super-admin.routes.js";
import appointmentSuperAdminRouter from "./SuperAdmin/appointments-super-admin.routes.js";



const superAdminRouter = express.Router();


// Welcome route

// superAdminRouter.use(jwtAuth);
// superAdminRouter.use(authorizeRole("admin"));


superAdminRouter.get("/", (req, res) => {
  res.send("Welcome to Nupal CDC Super Admin APIs");
});



superAdminRouter.use("/therapy-types", therapyAdminRouter);


// All routes under /api/admin/packages
superAdminRouter.use("/packages", packagesAdminRouter);




superAdminRouter.use("/discount-coupons", discountCouponRouter);



superAdminRouter.use("/users", usersSuperAdminRouter);


superAdminRouter.use("/all-appointments", appointmentSuperAdminRouter);



















export default superAdminRouter;
