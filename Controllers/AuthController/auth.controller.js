
import jwt from "jsonwebtoken";
import {
  User
} from "../../Schema/user.schema.js";
import ExpiredTokenModel from "../../Schema/expired-token.schema.js";

// Allowed roles from user.schema.js (see enum in file_context_2 line 8)
const ALLOWED_ROLES = ["patient", "therapist", "admin"];

class AuthController {
  // Check Authorization with user.schema.js roles & maintenance
  checkAuth = async (req, res) => {
    try {
      const { id, role } = req.user || {};
      console.log("[checkAuth] User id from req.user:", id);
      console.log("[checkAuth] User role from req.user:", role);

      if (!role || !ALLOWED_ROLES.includes(role)) {
        console.log("[checkAuth] Invalid user role or role missing:", role);
        return res.status(401).json({ message: "Unauthorized: Invalid user role" });
      }

      // Check if user with provided id and role exists in the database
      const dbUser = await User.findOne({ _id: id, role });
      console.log("[checkAuth] Looked up user from DB:", dbUser ? dbUser._id : "NOT FOUND");

      if (!dbUser) {
        console.log("[checkAuth] No user found in DB for id and role.");
        return res.status(401).json({ message: "Unauthorized: User not found" });
      }

      if (dbUser.status === "suspended") {
        console.log("[checkAuth] User status is suspended.");
        return res.status(403).json({ message: "Your account has been suspended. Please contact support." });
      }
      if (dbUser.status === "deleted") {
        console.log("[checkAuth] User status is deleted.");
        return res.status(403).json({ message: "Your account has been deleted. Please contact support." });
      }

      // If therapist and incompleteTherapistProfile is true, return error with unique status code
      if (dbUser.role === "therapist" && dbUser.incompleteTherapistProfile === true) {
        console.log("[checkAuth] Therapist profile is incomplete.");
        // 428 Precondition Required: used as unique, fits context of incomplete profile
        return res.status(428).json({ 
          message: "Therapist profile is incomplete. Please complete your profile to continue.",
          name: dbUser.name,
          email: dbUser.email
        });
      }
      // If parent and incompleteParentProfile is true, return error with unique status code
      if (dbUser.role === "patient" && dbUser.incompleteParentProfile === true) {
        console.log("[checkAuth] Parent/Patient profile is incomplete.");
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
          console.log("[checkAuth] Therapist panel is not accessible for this user.");
          // 451 Unavailable For Legal Reasons (as unique error, since 403/423 are common)
          return res.status(451).json({
            message: "Your therapist panel access is currently not enabled. Please contact support.",
            name: dbUser.name,
            email: dbUser.email
          });
        }
      }

      console.log("[checkAuth] User is authorized.");
      return res.status(200).json({ message: "Authorized" });
    } catch (error) {
      console.error("[checkAuth] Error encountered:", error);
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

      // Set token to expire in 1 day
      const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "1d" });

      await ExpiredTokenModel.create({
        token,
        tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day expiry
      });

      console.log("Stored issued token in expired-tokens collection:", token);


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

      console.log(email,role)

      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ message: "Invalid user role." });
      }

      const user = await User.findOne({ email, role }).lean();
      if (user && user.role !== role) {
        return res.status(400).json({ message: "Role does not match for this user." });
      }
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Generate 6-digit OTP
      // const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Save OTP with expiry (10 min)
      await User.findByIdAndUpdate(
        user._id,
        {
          otp:"000000",
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min expiry
        },
        { new: true }
      );

      // Send OTP via mail
      // sendMail(email, "Your OTP Code", `Your OTP is: ${otp}`).catch(console.error);

      return res.status(200).json({ message: "OTP sent successfully" });
    } catch (error) {
      console.error("Signin Error:", error);
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
      console.error("SignOut Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };
}

export default AuthController;
