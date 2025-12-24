import sendMail from "../../config/nodeMailer.config.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  User,
  PatientProfile,
  TherapistProfile,
  AdminProfile,
  SuperAdminProfile
} from "../../Schema/user.schema.js";
import ExpiredTokenModel from "../../Schema/expired-token.schema.js";
import Maintenance from "../../Schema/maintenance.schema.js";

// Allowed roles from user.schema.js (see enum in file_context_2 line 8)
const ALLOWED_ROLES = ["parent", "therapist", "admin", "superadmin"];

class AuthController {
  // Check Authorization with user.schema.js roles & maintenance
  checkAuth = async (req, res) => {
    try {
      const { role } = req.user || {};

      if (!role || !ALLOWED_ROLES.includes(role)) {
        return res.status(401).json({ message: "Unauthorized: Invalid user role" });
      }

      // Only allow maintenance bypass for 'admin' or 'superadmin'
      if (!["admin", "superadmin"].includes(role)) {
        const maintenanceStatus = await Maintenance.findOne({});
        if (maintenanceStatus && maintenanceStatus.isMaintenanceMode) {
          return res.status(423).json({
            message: "The application is under maintenance. Please try again later.",
          });
        }
      }

      return res.status(200).json({ message: "Authorized" });
    } catch (error) {
      return res.status(401).json({ message: "Unauthorized" });
    }
  };

  // Verify Account with OTP (parent/therapist/admin/superadmin) using user.schema.js
  verifyAccount = async (req, res) => {
    try {
      let { email, otp, role } = req.body;

      if (!email || !otp || !role) {
        return res.status(400).json({ message: "Email, OTP, and Role are required" });
      }

      email = email.trim().toLowerCase();
      role = role.trim();

      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ message: "Invalid user role." });
      }

      // Find user by email, role and OTP (atomic find+verify OTP+clear OTP)
      const user = await User.findOneAndUpdate(
        {
          email,
          role,
          otp
        },
        { $unset: { otp: 1 }, lastLogin: new Date() },
        { new: true }
      ).lean();

      if (!user) {
        return res.status(401).json({ message: "Invalid credentials or OTP" });
      }

      // Generate JWT with profile info optionally
      const tokenPayload = {
        id: user._id,
        email: user.email,
        role: user.role
      };

      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET);

      return res
        .status(200)
        .json({ message: "Account verified successfully", token });
    } catch (error) {
      console.error("VerifyAccount Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Sign In → Send OTP, only for known roles
  signin = async (req, res) => {
    try {
      let { email, role } = req.body;

      if (!email || !role) {
        return res.status(400).json({ message: "Email and role are required" });
      }

      email = email.trim().toLowerCase();
      role = role.trim();

      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ message: "Invalid user role." });
      }

      const user = await User.findOne({ email, role }).lean();
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Save OTP with expiry (10 min)
      await User.findByIdAndUpdate(
        user._id,
        {
          otp,
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min expiry
        },
        { new: true }
      );

      // Send OTP via mail
      sendMail(email, "Your OTP Code", `Your OTP is: ${otp}`).catch(console.error);

      return res.status(200).json({ message: "OTP sent successfully" });
    } catch (error) {
      console.error("Signin Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Vendor/Supervisor-style signin for therapist/parent (no "SubAdmin" logic - not in user.schema.js)
  vendorSupervisorSignin = async (req, res) => {
    try {
      let { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      email = email.trim().toLowerCase();

      const user = await User.findOne({ email }).lean();
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { role, status } = user;

      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(403).json({ message: "Invalid role for login" });
      }

      if (["suspended", "deleted"].includes(status)) {
        return res.status(403).json({ message: `User account is ${status}. Please contact support.` });
      }

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Save OTP with expiry (10 minutes)
      await User.findByIdAndUpdate(
        user._id,
        {
          otp,
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min expiry
        },
        { new: true }
      );

      // Send OTP async (real app: uncomment below)
      // sendMail(email, "Your OTP Code", `Your OTP is: ${otp}`).catch(console.error);

      return res.status(200).json({ message: "OTP sent successfully", role });
    } catch (error) {
      console.error("Signin Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Vendor/Supervisor-style OTP verify for therapist/parent (role determined by email lookup)
  vendorSupervisorVerifyAccount = async (req, res) => {
    try {
      let { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({ message: "Email and OTP are required" });
      }

      email = email.trim().toLowerCase();

      // Find user by email/OTP (atomic)
      const user = await User.findOneAndUpdate(
        { email, otp },
        { $unset: { otp: 1 }, lastLogin: new Date() },
        { new: true }
      ).lean();

      if (!user) {
        return res.status(401).json({ message: "Invalid credentials or OTP" });
      }

      if (!ALLOWED_ROLES.includes(user.role)) {
        return res.status(401).json({ message: "Unauthorized role" });
      }

      // Generate JWT
      const token = jwt.sign(
        {
          id: user._id,
          email: user.email,
          role: user.role,
        },
        process.env.JWT_SECRET
      );

      return res
        .status(200)
        .json({
          message: "Account verified successfully",
          token,
          role: user.role,
        });
    } catch (error) {
      console.error("VerifyAccount Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };
}

export default AuthController;
