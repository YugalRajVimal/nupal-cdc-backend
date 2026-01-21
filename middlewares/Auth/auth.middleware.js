import jwt from "jsonwebtoken";
import ExpiredTokenModel from "../../Schema/expired-token.schema.js";
import { User } from "../../Schema/user.schema.js";

const jwtAuth = async (req, res, next) => {
  // Read the token from the Authorization header
  const token = req.headers["authorization"];
  console.log("[jwtAuth] Authorization header received:", token);

  // If no token is present, return an error
  if (!token) {
    console.log("[jwtAuth] No token found in headers. Unauthorized.");
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Check if token is in the expired tokens collection
  try {
    const existingExpiredToken = await ExpiredTokenModel.findOne({ token });
    if (existingExpiredToken) {
      console.log("[jwtAuth] Token found in expired tokens collection.");
      // If tokenExpiry is set, enforce expiry time
      if (existingExpiredToken.tokenExpiry) {
        const now = new Date();
        console.log(
          "[jwtAuth] tokenExpiry is set:",
          existingExpiredToken.tokenExpiry,
          "Now:",
          now
        );
        if (now > existingExpiredToken.tokenExpiry) {
          console.log("[jwtAuth] Token has expired according to expiry in db.");
          return res.status(401).json({
            message: "Unauthorized: Token expired, please log in again.",
          });
        }
        // else (now <= tokenExpiry) -- allow through (token filled by mistake, ignore), or remove from db
        console.log("[jwtAuth] Token is not expired yet (allowing through).");
      } else {
        // If no expiry attached, deny by default
        console.log(
          "[jwtAuth] Expired token has no expiry field; denying by default."
        );
        return res.status(401).json({
          message: "Unauthorized: Token expired, please log in again.",
        });
      }
    } else {
      console.log("[jwtAuth] Token not found in expired tokens collection.");
    }
  } catch (err) {
    // In case of DB errors, fail secure
    console.error("[jwtAuth] Error querying for expired token:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    console.log("[jwtAuth] Token successfully verified:", payload);
    if (!payload) {
      console.log("[jwtAuth] No payload decoded from jwt.verify, unauthorized.");
      return res.status(401).json({ error: "Unauthorized Access" });
    }

    // Attach user info to req for downstream usage
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    };
    console.log("[jwtAuth] User info from decoded token:", req.user);

    // Acceptable roles as defined in user.schema.js
    const validRoles = ["patient", "therapist", "admin", "superadmin"];
    if (!validRoles.includes(payload.role)) {
      console.log(
        `[jwtAuth] Invalid user role found in payload: ${payload.role}.`
      );
      return res
        .status(401)
        .json({ error: "Unauthorized: Invalid user role." });
    }

    const dbUser = await User.findOne({
      _id: payload.id,
      role: payload.role,
    });

    if (!dbUser) {
      console.log(
        "[jwtAuth] No user found in db with id and role:",
        payload.id,
        payload.role
      );
      return res
        .status(401)
        .json({ error: "Unauthorized: User not found in database." });
    } else {
      console.log("[jwtAuth] User found in db:", dbUser._id);
    }

    if (["suspended", "deleted"].includes(dbUser.status)) {
      console.log(
        `[jwtAuth] User account status is ${dbUser.status}, denying access.`
      );
      return res
        .status(403)
        .json({
          error: `User account is ${dbUser.status}. Please contact support.`,
        });
    }

    // Proceed to the next middleware or route handler
    console.log("[jwtAuth] Auth checks passed. Calling next().--");
    next();
  } catch (error) {
    // If the token is not valid, return an error
    console.error("[jwtAuth] Error in jwt.verify or DB user check:", error);
    return res.status(401).json({ error: "Unauthorized Access" });
  }
};

export default jwtAuth;
