import jwt from "jsonwebtoken";
import ExpiredTokenModel from "../../Schema/expired-token.schema.js";
import { User } from "../../Schema/user.schema.js";

const jwtAuth = async (req, res, next) => {
  // Read the token from the Authorization header
  const token = req.headers["authorization"];

  // If no token is present, return an error
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Check if token is in the expired tokens collection
  try {
    const existingExpiredToken = await ExpiredTokenModel.findOne({ token });
    if (existingExpiredToken) {
      return res.status(401).json({
        message: "Unauthorized: Token expired, please log in again.",
      });
    }
  } catch (err) {
    // In case of DB errors, fail secure
    return res.status(500).json({ error: "Internal Server Error" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload) {
      return res.status(401).json({ error: "Unauthorized Access" });
    }

    // Attach user info to req for downstream usage
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
    };

    // Acceptable roles as defined in user.schema.js
    const validRoles = ["parent", "therapist", "admin", "superadmin"];
    if (!validRoles.includes(payload.role)) {
      return res.status(401).json({ error: "Unauthorized: Invalid user role." });
    }

    const dbUser = await User.findOne({
      _id: payload.id,
      role: payload.role,
    });

    if (!dbUser) {
      return res
        .status(401)
        .json({ error: "Unauthorized: User not found in database." });
    }

    if (["suspended", "deleted"].includes(dbUser.status)) {
      return res
        .status(403)
        .json({ error: `User account is ${dbUser.status}. Please contact support.` });
    }

    // Optionally, check for further restrictions if needed

    // Proceed to the next middleware or route handler
    next();
  } catch (error) {
    // If the token is not valid, return an error
    return res.status(401).json({ error: "Unauthorized Access" });
  }
};

export default jwtAuth;
