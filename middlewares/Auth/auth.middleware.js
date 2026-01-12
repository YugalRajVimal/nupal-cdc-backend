import jwt from "jsonwebtoken";
import ExpiredTokenModel from "../../Schema/expired-token.schema.js";
import { User } from "../../Schema/user.schema.js";

const jwtAuth = async (req, res, next) => {
  // Read the token from the Authorization header
  const token = req.headers["authorization"];
  console.log("[jwtAuth] Token received from headers:", token);

  // If no token is present, return an error
  if (!token) {
    console.log("[jwtAuth] No token present. Unauthorized.");
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Check if token is in the expired tokens collection
  try {
    const existingExpiredToken = await ExpiredTokenModel.findOne({ token });
    console.log("[jwtAuth] Token check in ExpiredTokenModel:", !!existingExpiredToken);
    // Check standard expiry as well as tokenExpiry field if present
    if (existingExpiredToken) {
      // If tokenExpiry is set, enforce expiry time
      if (existingExpiredToken.tokenExpiry) {
        const now = new Date();
        console.log(
          "[jwtAuth] TokenExpiry present. Now:", now,
          "TokenExpiry:", existingExpiredToken.tokenExpiry
        );
        if (now > existingExpiredToken.tokenExpiry) {
          console.log("[jwtAuth] Token is in expired collection AND reached expiry. Blocking.");
          return res.status(401).json({
            message: "Unauthorized: Token expired, please log in again.",
          });
        }
        // else (now >= expiredAt) -- allow through (token filled by mistake, ignore), or remove from db
        // console.log("[jwtAuth] Token expired, but now >= tokenExpiry. Ignoring expired collection entry.");
        console.log("[jwtAuth] Token not expired, now < tokenExpiry. Ignoring expired collection entry.");

      } else {
        // If no expiry attached, deny by default
        console.log("[jwtAuth] Token is in expired collection with NO expiry. Denying by default.");
        return res.status(401).json({
          message: "Unauthorized: Token expired, please log in again.",
        });
      }
    } else {
      console.log("[jwtAuth] Token NOT present in ExpiredTokenModel. Proceeding.");
    }
  } catch (err) {
    // In case of DB errors, fail secure
    console.log("[jwtAuth] Error during expired token DB check:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    console.log("[jwtAuth] JWT payload after verification:", payload);
    if (!payload) {
      console.log("[jwtAuth] Empty payload after verification. Unauthorized Access.");
      return res.status(401).json({ error: "Unauthorized Access" });
    }

    // Attach user info to req for downstream usage
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    };
    console.log("[jwtAuth] req.user set to:", req.user);

    // Acceptable roles as defined in user.schema.js
    const validRoles = ["patient", "therapist", "admin", "superadmin"];
    if (!validRoles.includes(payload.role)) {
      console.log("[jwtAuth] Invalid user role found in payload:", payload.role);
      return res.status(401).json({ error: "Unauthorized: Invalid user role." });
    }

    const dbUser = await User.findOne({
      _id: payload.id,
      role: payload.role,
    });
    console.log("[jwtAuth] User found in DB?", !!dbUser, dbUser ? `Status: ${dbUser.status}` : "");

    if (!dbUser) {
      console.log("[jwtAuth] No user found in database for given id/role.");
      return res
        .status(401)
        .json({ error: "Unauthorized: User not found in database." });
    }

    if (["suspended", "deleted"].includes(dbUser.status)) {
      console.log(`[jwtAuth] User account is ${dbUser.status}. Blocking access.`);
      return res
        .status(403)
        .json({ error: `User account is ${dbUser.status}. Please contact support.` });
    }

    // Optionally, check for further restrictions if needed

    // Proceed to the next middleware or route handler
    console.log("[jwtAuth] All checks passed. Proceeding to next middleware.");
    next();
  } catch (error) {
    // If the token is not valid, return an error
    console.log("[jwtAuth] JWT verification failed:", error);
    return res.status(401).json({ error: "Unauthorized Access" });
  }
};

export default jwtAuth;
