import sendMail from "../../config/nodeMailer.config.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { User, SuperAdminProfile } from "../../Schema/user.schema.js";

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
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        console.log("Login failed: email or password missing");
        return res.status(400).json({ message: "Email and password are required." });
      }

      const user = await User.findOne({ email: email.trim().toLowerCase(), role: "superadmin" });
      console.log("Login user lookup:", user);
      if (!user) {
        console.log("Login failed: user not found");
        return res.status(404).json({ message: "Superadmin not found" });
      }

      // Check for passwordHash existence
      if (!user.passwordHash) {
        console.log("Login failed: password hash not present");
        return res.status(401).json({ message: "Invalid credentials." });
      }

      // Compare password
      const match = await bcrypt.compare(password, user.passwordHash);
      console.log("Password match result:", match);
      if (!match) {
        console.log("Login failed: password does not match");
        return res.status(401).json({ message: "Invalid credentials." });
      }


      // Generate JWT
      const payload = {
        id: user._id,
        email: user.email,
        role: user.role
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET);

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
      console.log("Login error:", err);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Forgot Password (superadmin): send OTP (always 000000 for now)
  forgotPassword = async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        console.log("Forgot password: email missing");
        return res.status(400).json({ message: "Email is required." });
      }

      const user = await User.findOne({ email: email.trim().toLowerCase(), role: "superadmin" });
      console.log("Forgot password user lookup:", user);
      if (!user) {
        console.log("Forgot password: superadmin not found");
        return res.status(404).json({ message: "Superadmin not found" });
      }

      // Save OTP ("000000") and expiry (optionally 10min)
      await User.findByIdAndUpdate(user._id, {
        otp: "000000",
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      // Optionally send email (for dev, just say sent)
      console.log("OTP set for superadmin:", email);
      // await sendMail(email, "Your OTP Code", `Your OTP is: 000000`);
      return res.status(200).json({ message: "OTP sent to your registered email (for demo, OTP is 000000)" });
    } catch (err) {
      console.log("Forgot password error:", err);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Verify Account - superadmin only, checks OTP (default 000000)
  verifyAccount = async (req, res) => {
    try {
      let { email, otp } = req.body;
      if (!email || !otp) {
        console.log("Verify account: email or otp missing");
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
        { new: true }
      ).lean();

      console.log("Verify account lookup result:", user);

      if (!user) {
        console.log("Verify account: invalid email or otp");
        return res.status(401).json({ message: "Invalid email or OTP." });
      }

      // Generate JWT
      const payload = {
        id: user._id,
        email: user.email,
        role: user.role
      };
      const token = jwt.sign(payload, process.env.JWT_SECRET);

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
      console.log("Verify account error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  // Optional: Reset password after verifying OTP (requires token)
  resetPassword = async (req, res) => {
    try {
      // The token should be extracted from the Authorization header as "Bearer <token>"
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Authorization token missing." });
      }

      const token = authHeader.split(' ')[1];
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ message: "Invalid token." });
      }

      if (!decoded || decoded.role !== "superadmin" || !decoded.id) {
        return res.status(401).json({ message: "Invalid credentials." });
      }

      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }

      // Fetch the superadmin user and update their password
      const user = await User.findOneAndUpdate(
        { _id: decoded.id, role: "superadmin" },
        { password: await bcrypt.hash(newPassword, 10) },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({ message: "Superadmin not found." });
      }

      return res.status(200).json({ message: "Password reset successfully." });
    } catch (error) {
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

}

export default SuperAdminAuthController;
