import express from "express";


const subAdminRouter = express.Router();



subAdminRouter.get("/", (req, res) => {
  res.send("Welcome to Nupal CDC  Admin APIs");
});



export default subAdminRouter;
