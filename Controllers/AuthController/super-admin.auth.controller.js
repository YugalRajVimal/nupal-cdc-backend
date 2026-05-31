import sendMail from "../../config/nodeMailer.config.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User, SuperAdminProfile } from "../../Schema/user.schema.js";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";
import WhatsappController from "../Whatsapp/whatsapp.js"; // Add Whatsapp support like in @auth.controller.js

// Only allow superadmin for these endpoints
const ALLOWED_ROLES = ["superadmin"];

// --- Copy/paste from auth.controller.js (see context, for phone normalization) ---
function normalizeIndianPhone(phone) {
  if (!phone) return phone;
  let np = phone.replace(/\D/g, "");
  while (np.length > 10 && np.startsWith("91")) {
    np = np.slice(2);
  }
  if (np.length > 10) {
    np = np.slice(np.length - 10);
  }
  return np;
}
// -------------------------------------------------------------------------------

class SuperAdminAuthController {
  // Check Auth Token - expects Bearer token in Authorization header
  checkAuth = async (req, res) => {
    try {
      const { id, role } = req.user || {};

      if (role !== "superadmin") {
        return res.status(401).json({ message: "Unauthorized: Role must be superadmin" });
      }

      // Check if superadmin with provided id and role exists in the database
      const dbUser = await User.findOne({ _id: id, role });

      if (!dbUser) {
        return res.status(401).json({ message: "Unauthorized: User not found" });
      }

      return res.status(200).json({ message: "Authorized" });
    } catch (error) {
      return res.status(401).json({ message: "Unauthorized" });
    }
  };

  // Superadmin Login: email/password or phone/password
  login = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      let { email, phone, password } = req.body;
      if ((!email && !phone) || !password) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Email or phone and password are required." });
      }

      let query = { role: "superadmin" };
      // Normalize and support login by email or phone
      if (email) query.email = email.trim().toLowerCase();
      if (phone) query.phone = normalizeIndianPhone(phone);

      const user = await User.findOne(query).session(session);

      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Superadmin not found" });
      }

      if (!user.passwordHash) {
        await session.abortTransaction();
        session.endSession();
        return res.status(401).json({ message: "Invalid credentials." });
      }

      // Compare password
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        await session.abortTransaction();
        session.endSession();
        return res.status(401).json({ message: "Invalid credentials." });
      }

      // Generate JWT
      const payload = {
        id: user._id,
        email: user.email,
        phone: user.phone,
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
              message: `Superadmin login for userId=${user._id} (${user.email || user.phone})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. Login aborted." });
      }

      // // --- Send WhatsApp notification for superadmin login success ---
      // try {
      //   // Use text-based template from @whatsapp.js lines 119-144 for WhatsApp notification
      //   // This matches the WhatsAppController.sendSuperAdminLoginSuccess() signature/documented structure

      //   const destination = user.phone;
      //   const userName = user.name || "";
      //   const userNameParam = user.name || "Superadmin";
      //   const device = req.headers["user-agent"] || "Unknown Device";
      //   // Provide client IP from header or fallback
      //   const location = req.headers["x-forwarded-for"] || req.ip || "Not available";
      //   // Format as per India timezone and readable string
      //   const dateTime = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

      //   // Using the implementation model from whatsapp.js (119-144)
      //   await WhatsappController.sendSuperAdminLoginSuccess({
      //     destination,
      //     userName,
      //     userNameParam,
      //     dateTime,
      //     device,
      //     location
      //   });
      // } catch (waErr) {
      //   // Don't fail the login if WhatsApp notification fails -- log the error.
      //   console.error("Failed to send WhatsApp superadmin login notification:", waErr);
      // }

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message: "Logged in successfully",
        token,
        data: {
          id: user._id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
          status: user.status,
        }
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Forgot Password (superadmin): send OTP to email or phone
  forgotPassword = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      let { email, phone } = req.body;
      if (!email && !phone) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Email or phone is required." });
      }

      // Normalize and prepare query for superadmin
      let query = { role: "superadmin" };
      if (email) query.email = email.trim().toLowerCase();
      if (phone) query.phone = normalizeIndianPhone(phone);

      // Fetch the user based on email or phone (must be superadmin)
      const user = await User.findOne(query).session(session);

      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Superadmin not found" });
      }

      // Ensure we always have both email and phone (fetch from user if missing)
      if (!email) email = user.email;
      if (!phone) phone = user.phone;

      // Safety check
      if (!email && !phone) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Superadmin does not have both email and phone on record." });
      }

      // Generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Save OTP and expiry (10min)
      await User.findByIdAndUpdate(
        user._id,
        {
          otp: otp,
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
        { session }
      );

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

      // Await sending (parallel)
      if (sendEmailPromise) await sendEmailPromise;
      if (sendWhatsappPromise) await sendWhatsappPromise;

      // If both failed, treat as error; else, success if at least one sent
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
            action: "SUPERADMIN_FORGOT_PASSWORD_OTP_SENT",
            user: user._id,
            role: user.role,
            resource: "User",
            resourceId: user._id,
            details: {
              changedFields: {
                otp: { from: undefined, to: otp },
                otpExpiresAt: { from: undefined, to: (new Date(Date.now() + 10 * 60 * 1000)).toISOString() }
              },
              message: `Superadmin forgot password OTP sent for userId=${user._id} (${user.email || user.phone})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. Forgot password OTP not saved." });
      }

      await session.commitTransaction();
      session.endSession();

      // Compose message depending on what worked
      let via = [];
      if (!sendEmailError && email) via.push("email");
      if (!whatsappError && phone) via.push("phone");
      let message = "OTP sent to your registered " + (via.length > 0 ? via.join(" & ") : "contacts");
      if (process.env.NODE_ENV === "development") {
        message += ` (for dev, OTP is ${otp})`;
      }

      return res.status(200).json({
        message
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Verify Account - superadmin only, checks OTP (input by either email or phone)
  verifyAccount = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      let { email, phone, otp } = req.body;
      if ((!email && !phone) || !otp) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Email or phone and OTP are required" });
      }
      let query = { role: "superadmin", otp, otpExpiresAt: { $gte: new Date() } };
      if (email) query.email = email.trim().toLowerCase();
      if (phone) query.phone = normalizeIndianPhone(phone);
      const user = await User.findOneAndUpdate(
        query,
        { $unset: { otp: 1, otpExpiresAt: 1 } },
        { new: true, session }
      ).lean();

      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(401).json({ message: "Invalid credentials or OTP." });
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
              message: `Superadmin verified account with OTP for userId=${user._id} (${user.email || user.phone})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          message: "Audit log creation failed. Account verification not saved."
        });
      }

      // Generate JWT
      const payload = {
        id: user._id,
        email: user.email,
        phone: user.phone,
        role: user.role
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET);

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message: "Account verified, please reset your password",
        token,
        data: {
          id: user._id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
          status: user.status
        }
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Optional: Reset password after verifying OTP (requires token)
  resetPassword = async (req, res) => {
    const session = await User.startSession();
    session.startTransaction();
    try {
      const { id, role } = req.user;

      // Check if user exists and role is superadmin
      if (!id || role !== "superadmin") {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: "Unauthorized. Only superadmin can reset password." });
      }

      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
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
              message: `Superadmin password was reset for userId=${user._id} (${user.email || user.phone})`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (elog) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: "Audit log creation failed. Password reset aborted." });
      }

      await session.commitTransaction();
      session.endSession();

      // === Send WhatsApp notification to superadmin ===
      try {
        // Compose notification details
        const now = new Date();
        const dateTime = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }); // IST
        const userNameParam = user.name || (user.email || user.phone || "Superadmin");
        const device = req.headers["user-agent"] || "Unknown device";
        // Optionally, you could use a geoip lookup here for a real location
        const location = req.headers["x-forwarded-for"] || req.ip || "Unknown location";
        await WhatsappController.sendSuperAdminPasswordResetSuccess({
          destination: user.phone || "", // number in string format with country code, fallback empty
          userName: user.name || "",
          userNameParam,
          dateTime,
          device,
          location
        });
      } catch (waErr) {
        // WhatsApp notification failure should NOT block password reset success
        // Optionally, log this error for system monitoring
        console.error("Failed to send WhatsApp notification to superadmin:", waErr);
      }

      return res.status(200).json({ message: "Password reset successfully." });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

}

export default SuperAdminAuthController;
