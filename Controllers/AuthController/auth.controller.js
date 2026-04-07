
import jwt from "jsonwebtoken";
import {
  User
} from "../../Schema/user.schema.js";
import ExpiredTokenModel from "../../Schema/expired-token.schema.js";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";
import sendMail from "../../config/nodeMailer.config.js";
import WhatsappController from "../Whatsapp/whatsapp.js"; // Make sure the path is correct based on your project structure


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
      const query = { role };
      if (email) {
        query.email = email;
      } else if (phone) {
        query.phone = phone;
      }

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

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Save OTP with expiry (10 min)
      user.otp = otp;
      user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
      await user.save({ session });

      // Send OTP via mail or WhatsApp (if phone is provided)
      if (email) {
        sendMail(email, "Your OTP Code", `Your OTP is: ${otp}`).catch(console.error);
      } else if (phone) {
        // Send OTP via WhatsApp using WhatsappController
        try {
          await WhatsappController.sendOtpVerification({
            destination: phone, // Already normalized
            userName: user.name || "", // Optionally fallback to ""
            otp
          });
        } catch (waErr) {
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({ message: "Failed to send OTP via WhatsApp", error: waErr });
        }
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
      return res.status(200).json({ message: "OTP sent successfully" });
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
}

export default AuthController;
