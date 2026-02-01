import sendMail from "../../config/nodeMailer.config.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User, SuperAdminProfile } from "../../Schema/user.schema.js";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";


// Only allow superadmin for these endpoints
const ALLOWED_ROLES = ["superadmin"];

class SuperAdminAuthController {
  // Check Auth Token - expects Bearer token in Authorization header
  checkAuth = async (req, res) => {
    try {
      const { id, role } = req.user || {};
      console.log(req);
      console.log("[SuperAdmin checkAuth] User id from req.user:", id);
      console.log("[SuperAdmin checkAuth] User role from req.user:", role);

      if (role !== "superadmin") {
        console.log("[SuperAdmin checkAuth] Role is not superadmin:", role);
        return res.status(401).json({ message: "Unauthorized: Role must be superadmin" });
      }

      // Check if superadmin with provided id and role exists in the database
      const dbUser = await User.findOne({ _id: id, role });
      console.log("[SuperAdmin checkAuth] Looked up user from DB:", dbUser ? dbUser._id : "NOT FOUND");

      if (!dbUser) {
        console.log("[SuperAdmin checkAuth] No user found in DB for id and role.");
        return res.status(401).json({ message: "Unauthorized: User not found" });
      }

      console.log("[SuperAdmin checkAuth] User is authorized.");
      return res.status(200).json({ message: "Authorized" });
    } catch (error) {
      console.error("[SuperAdmin checkAuth] Error encountered:", error);
      return res.status(401).json({ message: "Unauthorized" });
    }
  };

  // Superadmin Login: with email and password
  login = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        console.log("Login failed: email or password missing");
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Email and password are required." });
      }

      const user = await User.findOne({ email: email.trim().toLowerCase(), role: "superadmin" }).session(session);
      console.log("Login user lookup:", user);
      if (!user) {
        console.log("Login failed: user not found");
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Superadmin not found" });
      }

      // Check for passwordHash existence
      if (!user.passwordHash) {
        console.log("Login failed: password hash not present");
        await session.abortTransaction();
        session.endSession();
        return res.status(401).json({ message: "Invalid credentials." });
      }

      // Compare password
      const match = await bcrypt.compare(password, user.passwordHash);
      console.log("Password match result:", match);
      if (!match) {
        console.log("Login failed: password does not match");
        await session.abortTransaction();
        session.endSession();
        return res.status(401).json({ message: "Invalid credentials." });
      }

      // Generate JWT
      const payload = {
        id: user._id,
        email: user.email,
        role: user.role
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET);

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "SUPERADMIN_LOGIN",
            user: user._id,
            role: user.role,
            resource: "User",
            resourceId: user._id,
            details: {
              message: `Superadmin login for userId=${user._id} (${user.email})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        console.error("[superadmin.login] Error writing audit log:", elog);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. Login aborted." });
      }

      await session.commitTransaction();
      session.endSession();

      console.log("SuperAdmin login successful:", user.email);

      return res.status(200).json({
        message: "Logged in successfully",
        token,
        data: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
        }
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.log("Login error:", err);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Forgot Password (superadmin): send OTP (always 000000 for now)
  forgotPassword = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      const { email } = req.body;
      if (!email) {
        console.log("Forgot password: email missing");
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Email is required." });
      }

      const user = await User.findOne({ email: email.trim().toLowerCase(), role: "superadmin" }).session(session);
      console.log("Forgot password user lookup:", user);
      if (!user) {
        console.log("Forgot password: superadmin not found");
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Superadmin not found" });
      }

      // Save OTP ("000000") and expiry (optionally 10min)
      await User.findByIdAndUpdate(
        user._id,
        {
          otp: "000000",
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
        { session }
      );

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "SUPERADMIN_FORGOT_PASSWORD_OTP_SENT",
            user: user._id,
            role: user.role,
            resource: "User",
            resourceId: user._id,
            details: {
              changedFields: {
                otp: { from: undefined, to: "000000" },
                otpExpiresAt: { from: undefined, to: (new Date(Date.now() + 10 * 60 * 1000)).toISOString() }
              },
              message: `Superadmin forgot password OTP sent for userId=${user._id} (${user.email})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        console.error("[superadmin.forgotPassword] Error writing audit log:", elog);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. Forgot password OTP not saved." });
      }

      await session.commitTransaction();
      session.endSession();

      // Optionally send email (for dev, just say sent)
      console.log("OTP set for superadmin:", email);
      // await sendMail(email, "Your OTP Code", `Your OTP is: 000000`);
      return res.status(200).json({ message: "OTP sent to your registered email (for demo, OTP is 000000)" });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      console.log("Forgot password error:", err);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Verify Account - superadmin only, checks OTP (default 000000)
  verifyAccount = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      let { email, otp } = req.body;
      if (!email || !otp) {
        console.log("Verify account: email or otp missing");
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Email and OTP are required" });
      }
      email = email.trim().toLowerCase();
      // Find superadmin with OTP (default OTP is 000000)
      const user = await User.findOneAndUpdate(
        {
          email,
          role: "superadmin",
          otp,
          otpExpiresAt: { $gte: new Date() },
        },
        { $unset: { otp: 1, otpExpiresAt: 1 } },
        { new: true, session }
      ).lean();

      console.log("Verify account lookup result:", user);

      if (!user) {
        console.log("Verify account: invalid email or otp");
        await session.abortTransaction();
        session.endSession();
        return res.status(401).json({ message: "Invalid email or OTP." });
      }

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "SUPERADMIN_ACCOUNT_VERIFIED",
            user: user._id,
            role: user.role,
            resource: "User",
            resourceId: user._id,
            details: {
              changedFields: {
                otp: { from: otp, to: undefined }
              },
              message: `Superadmin verified account with OTP for userId=${user._id} (${user.email})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        console.error("[superadmin.verifyAccount] Error writing audit log:", elog);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. Account verification not saved." });
      }

      // Generate JWT
      const payload = {
        id: user._id,
        email: user.email,
        role: user.role
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET);

      await session.commitTransaction();
      session.endSession();

      console.log("SuperAdmin OTP verified:", user.email);

      return res.status(200).json({
        message: "Account verified, please reset your password",
        token,
        data: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status
        }
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.log("Verify account error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Optional: Reset password after verifying OTP (requires token)
  resetPassword = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      const { id, role } = req.user;
      console.log("ResetPassword req.user:", req.user);

      // Check if user exists and role is superadmin
      if (!id || role !== "superadmin") {
        console.log("ResetPassword - Unauthorized: id missing or role not superadmin");
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: "Unauthorized. Only superadmin can reset password." });
      }

      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
        console.log("ResetPassword - Invalid newPassword: missing or too short");
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }

      // Fetch the superadmin user and update their password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);
      const user = await User.findOneAndUpdate(
        { _id: id, role: "superadmin" },
        { passwordHash: newPasswordHash },
        { new: true, session }
      );

      if (!user) {
        console.log("ResetPassword - Superadmin not found:", id);
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Superadmin not found." });
      }

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "SUPERADMIN_PASSWORD_RESET",
            user: user._id,
            role: user.role,
            resource: "User",
            resourceId: user._id,
            details: {
              changedFields: {
                passwordHash: { from: "hidden", to: "hidden" }
              },
              message: `Superadmin password was reset for userId=${user._id} (${user.email})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        console.error("[superadmin.resetPassword] Error writing audit log:", elog);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. Password reset aborted." });
      }

      await session.commitTransaction();
      session.endSession();

      console.log("Superadmin password reset:", user.email || user._id);
      return res.status(200).json({ message: "Password reset successfully." });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.log("ResetPassword error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

}

export default SuperAdminAuthController;
