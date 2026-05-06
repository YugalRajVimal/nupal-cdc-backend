
import jwt from "jsonwebtoken";
import {
  User
} from "../../Schema/user.schema.js";
import ExpiredTokenModel from "../../Schema/expired-token.schema.js";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";
import sendMail from "../../config/nodeMailer.config.js";
import WhatsappController from "../Whatsapp/whatsapp.js"; // Make sure the path is correct based on your project structure
import bcrypt from "bcrypt";

// Allowed roles from user.schema.js (see enum in file_context_2 line 8)
const ALLOWED_ROLES = ["patient", "therapist", "admin"];

class AuthController {
  // Check Authorization with user.schema.js roles & maintenance
  checkAuth = async (req, res) => {
    try {
      const { id, role } = req.user || {};

      if (!role || !ALLOWED_ROLES.includes(role)) {
        return res.status(401).json({ message: "Unauthorized: Invalid user role" });
      }

      // Check if user with provided id and role exists in the database
      const dbUser = await User.findOne({ _id: id, role });

      if (!dbUser) {
        return res.status(401).json({ message: "Unauthorized: User not found" });
      }

      if (dbUser.status === "suspended") {
        return res.status(403).json({ message: "Your account has been suspended. Please contact support." });
      }
      if (dbUser.status === "deleted") {
        return res.status(403).json({ message: "Your account has been deleted. Please contact support." });
      }

      // If therapist and incompleteTherapistProfile is true, return error with unique status code
      if (dbUser.role === "therapist" && dbUser.incompleteTherapistProfile === true) {
        // 428 Precondition Required: used as unique, fits context of incomplete profile
        return res.status(428).json({ 
          message: "Therapist profile is incomplete. Please complete your profile to continue.",
          name: dbUser.name,
          email: dbUser.email
        });
      }
      // If parent and incompleteParentProfile is true, return error with unique status code
      if (dbUser.role === "patient" && dbUser.incompleteParentProfile === true) {
        // 428 Precondition Required, as above
        return res.status(428).json({ 
          message: "Parent profile is incomplete. Please complete your profile to continue.",
          name: dbUser.name,
          email: dbUser.email
        });
      }
      // If therapist and profile complete, but therapist panel is not accessible
      if (dbUser.role === "therapist" && dbUser.incompleteTherapistProfile === false) {
        // Need to check TherapistProfile for isPanelAccessible
        const therapistProfile = await (await import("../../Schema/user.schema.js")).TherapistProfile.findOne({ userId: dbUser._id }).lean();
        if (therapistProfile && therapistProfile.isPanelAccessible === false) {
          // 451 Unavailable For Legal Reasons (as unique error, since 403/423 are common)
          return res.status(451).json({
            message: "Your therapist panel access is currently not enabled. Please contact support.",
            name: dbUser.name,
            email: dbUser.email
          });
        }
      }

      return res.status(200).json({ 
        message: "Authorized",
        name: dbUser.name,
        email: dbUser.email
      });
    } catch (error) {
      return res.status(401).json({ message: "Unauthorized" });
    }
  };

  // Helper function: Normalize Indian phone numbers (works for +919837114001, 919837114001, 9837114001 to 9837114001)
  normalizeIndianPhone(phone) {
    if (!phone) return phone;
    // Remove all non-digit characters
    let np = phone.replace(/\D/g, "");
    // Remove all leading '91' until we're down to 10 digits
    while (np.length > 10 && np.startsWith("91")) {
      np = np.slice(2);
    }
    // Finally, return last 10 digits (in case user enters extras like 000919837114001)
    if (np.length > 10) {
      np = np.slice(np.length - 10);
    }
    return np;
  }

  // Verify Account with OTP (parent/therapist/admin/superadmin) using user.schema.js
  verifyAccount = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      let { email, phone, otp, role } = req.body;

      if ((!email && !phone) || !otp || !role) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Email or phone, OTP, and Role are required" });
      }

      // Normalize
      if (email) email = email.trim().toLowerCase();
      if (phone) phone = this.normalizeIndianPhone(phone);
      role = role.trim();

      if (!ALLOWED_ROLES.includes(role)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Invalid user role." });
      }

      // Build query for user (either by email or by phone)
      const query = { role, otp };
      if (email) {
        query.email = email;
      } else if (phone) {
        query.phone = phone;
      }

      // Find user by email OR phone, role and OTP (inside transaction)
      const user = await User.findOne(query).session(session);

      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(401).json({ message: "Invalid credentials or OTP" });
      }

      // Clear OTP and set lastLogin
      user.otp = undefined;
      user.lastLogin = new Date();
      await user.save({ session });

      // Generate JWT with profile info optionally
      const tokenPayload = {
        id: user._id,
        email: user.email,
        phone: user.phone,
        role: user.role
      };

      // Set token to expire in 1 day
      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "1d" });

      await ExpiredTokenModel.create([{
        token,
        tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day expiry
      }], { session });

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "USER_ACCOUNT_VERIFIED",
            user: user._id,
            role: user.role === "patient" ? "parent" : user.role,
            resource: "User",
            resourceId: user._id,
            details: {
              changedFields: {
                otp: { from: otp, to: undefined },
                lastLogin: { from: null, to: (new Date()).toISOString() }
              },
              message: `Account verified with OTP for userId=${user._id} (${user.email || user.phone})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. Account verification not saved." });
      }

      await session.commitTransaction();
      session.endSession();

      return res
        .status(200)
        .json({ message: "Account verified successfully", token });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Sign In → Send OTP, only for known roles, using email OR phone

  signin = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      let { email, phone, role } = req.body;

      if ((!email && !phone) || !role) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Email or phone and role are required" });
      }

      // Normalize inputs
      if (email) email = email.trim().toLowerCase();
      if (phone) phone = this.normalizeIndianPhone(phone);
      role = role.trim();

      if (!ALLOWED_ROLES.includes(role)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Invalid user role." });
      }

      // Always build query with role + either email or phone (prefer email if present)
      const query = { role };
      if (email) {
        query.email = email;
      } else if (phone) {
        query.phone = phone;
      }

      // Find user by either email/role or phone/role
      const user = await User.findOne(query).session(session);

      if (user && user.role !== role) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Role does not match for this user." });
      }
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "User not found" });
      }

      // If one of email/phone is missing, get from user's record
      if (!email) email = user.email;
      if (!phone) phone = user.phone;

      // Sanity: if neither from record, still error
      if (!email && !phone) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "User does not have both email and phone on record" });
      }

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Save OTP with expiry (10 min)
      user.otp = otp;
      user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
      await user.save({ session });

      // Send OTP to both email and WhatsApp (if present)
      let sendEmailError = null, whatsappError = null;
      let sendEmailPromise = null, sendWhatsappPromise = null;

      if (email) {
        sendEmailPromise = sendMail(email, "Your OTP Code", `Your OTP is: ${otp}`)
          .catch((err) => { sendEmailError = err; });
      }
      if (phone) {
        sendWhatsappPromise = WhatsappController.sendOtpVerification({
          destination: phone,
          userName: user.name || "",
          otp
        }).catch((err) => { whatsappError = err; });
      }

      // Await the sending (both in parallel)
      if (sendEmailPromise) await sendEmailPromise;
      if (sendWhatsappPromise) await sendWhatsappPromise;

      // If both failed, treat as error; if at least one sent, consider successful
      if (sendEmailError && whatsappError) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          message: "Failed to send OTP on both email and WhatsApp.",
          emailError: sendEmailError,
          whatsappError: whatsappError
        });
      }

      // === Mandatory Audit Log (must succeed for transaction) ===
      try {
        await AuditLogService.addLog(
          {
            action: "USER_SIGNIN_OTP_SENT",
            user: user._id,
            role: user.role === "patient" ? "parent" : user.role,
            resource: "User",
            resourceId: user._id,
            details: {
              changedFields: {
                otp,
                otpExpiresAt: { from: null, to: (user.otpExpiresAt).toISOString() }
              },
              message: `Signin OTP sent to userId=${user._id} (${user.email || user.phone})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. OTP not sent." });
      }

      await session.commitTransaction();
      session.endSession();
      return res.status(200).json({ 
        message: "OTP sent successfully" + 
          ((sendEmailError && !whatsappError) ? " (Email failed, WhatsApp sent)" :
           (!sendEmailError && whatsappError) ? " (WhatsApp failed, Email sent)" : "")
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Sign Out → Mark token as immediately expired
  signOut = async (req, res) => {
    try {
      // Get token from Authorization header
      const token = req.headers["authorization"];
      if (!token) {
        return res.status(401).json({ message: "Unauthorized: Token missing" });
      }

      // Set tokenExpiry to now so it is immediately considered expired
      const now = new Date();

      await ExpiredTokenModel.create({
        token,
        tokenExpiry: now,
      });

      return res.status(200).json({ message: "Signed out successfully" });
    } catch (error) {
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };


  // Login with email/phone and password (for patient, therapist, admin)
  loginWithPassword = async (req, res) => {
    try {
      const { email, phone, password } = req.body;
      if ((!email && !phone) || !password) {
        return res.status(400).json({ message: "Email or phone and password are required." });
      }

      // Normalize input
      let query = {};
      if (email) query.email = (email || "").trim().toLowerCase();
      if (phone) query.phone = (phone || "").trim();
      // Only allow patient, therapist, admin
      query.role = { $in: ["patient", "therapist", "admin"] };

      const user = await User.findOne(query);

      if (!user) {
        return res.status(401).json({ message: "Invalid credentials." });
      }

      // Check if passwordHash is set (for this user/role)
      if (!user.passwordHash) {
        return res.status(401).json({ message: "Password login is not available for this user." });
      }

      // Compare password
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid credentials." });
      }

      // Check user status, suspension, etc.
      if (user.status === "suspended" || user.isDisabled) {
        return res.status(403).json({ message: "Account is suspended or disabled." });
      }

      // Prepare JWT payload
      const payload = {
        id: user._id,
        role: user.role,
        name: user.name,
        email: user.email,
        phone: user.phone,
      };

      // Issue token (use your secret and setup)
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "24h" });

      // Audit log
      try {
        await AuditLogService.addLog({
          action: `${user.role.toUpperCase()}_LOGIN_PASSWORD`,
          user: user._id,
          role: user.role,
          resource: "User",
          resourceId: user._id,
          details: {
            message: `User logged in via password for userId=${user._id} (${user.email || user.phone})`
          },
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"]
        });
      } catch (elog) {
        // Don't block login, but log error for monitoring
        console.error("AuditLogService login error:", elog);
      }

      return res.status(200).json({
        message: "Login successful",
        token,
        user: {
          id: user._id,
          role: user.role,
          name: user.name,
          email: user.email,
          phone: user.phone
        }
      });
    } catch (err) {
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Reset password for parent, therapist, and admin (NOT superadmin)
  resetPassword = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      const { id, role } = req.user;

      // Console log the requesting user info
      console.log(`[resetPassword] Requested by User: id=${id}, role=${role}`);

      // Only allow for patient, therapist, admin (not superadmin)
      if (!id || !["patient", "therapist", "admin"].includes(role)) {
        console.log(`[resetPassword] Unauthorized attempt by id=${id}, role=${role}`);
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: "Unauthorized. Only parent (patient), therapist, or admin can reset password." });
      }

      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
        console.log(`[resetPassword] Invalid password length: length=${newPassword ? newPassword.length : 'undefined'}`);
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }

      // Fetch the user and update password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);
      const user = await User.findOneAndUpdate(
        { _id: id, role },
        { passwordHash: newPasswordHash },
        { new: true, session }
      );

      if (!user) {
        console.log(`[resetPassword] User not found for id=${id}, role=${role}`);
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "User not found." });
      }

      // Audit Log (must succeed for transaction)
      try {
        await AuditLogService.addLog(
          {
            action: `${role.toUpperCase()}_PASSWORD_RESET`,
            user: user._id,
            role: user.role,
            resource: "User",
            resourceId: user._id,
            details: {
              changedFields: {
                passwordHash: { from: "hidden", to: "hidden" }
              },
              message: `${role.charAt(0).toUpperCase() + role.slice(1)} password was reset for userId=${user._id} (${user.email || user.phone})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
        console.log(`[resetPassword] Audit log added for userId=${user._id}, role=${role}`);
      } catch (elog) {
        console.log(`[resetPassword] Audit log creation failed, aborting transaction. userId=${user._id}, role=${role}`, elog);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. Password reset aborted." });
      }

      await session.commitTransaction();
      session.endSession();
      console.log(`[resetPassword] Password reset committed for userId=${user._id}, role=${role}`);

      // Optional: Send notification to user (email/whatsapp) on password reset
      try {
        const now = new Date();
        const dateTime = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        const userNameParam = user.name || (user.email || user.phone || "User");
        const device = req.headers["user-agent"] || "Unknown device";
        const location = req.headers["x-forwarded-for"] || req.ip || "Unknown location";
        // Send email if user has email
        if (user.email) {
          await sendMail(
            user.email,
            "Your Password Was Reset",
            `Hi ${user.name || ""},\n\nYour password was successfully reset on ${dateTime} IST, from device: ${device} and IP: ${location}.\nIf you did not perform this action, please contact support immediately.`
          );
          console.log(`[resetPassword] Email sent for userId=${user._id}, email=${user.email}`);
        }
        // Send WhatsApp if user has phone
        if (user.phone && WhatsappController && typeof WhatsappController.sendUserPasswordResetSuccess === "function") {
          await WhatsappController.sendUserPasswordResetSuccess({
            destination: user.phone,
            userName: user.name || "",
            userNameParam,
            dateTime,
            device,
            location,
            role,
          });
          console.log(`[resetPassword] WhatsApp notification sent for userId=${user._id}, phone=${user.phone}`);
        }
      } catch (notifyErr) {
        // Notification errors are not blocking
        console.log(`[resetPassword] Failed to notify ${role} of password reset, userId=${user._id}`, notifyErr);
      }

      return res.status(200).json({ message: "Password reset successfully." });
    } catch (error) {
      console.log(`[resetPassword] Internal server error, user.id=${req.user?.id}, role=${req.user?.role}`, error);
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };
}

export default AuthController;
