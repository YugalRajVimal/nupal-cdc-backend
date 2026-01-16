import { PatientProfile, TherapistProfile, User } from "../../Schema/user.schema.js";

class UsersSuperAdminController {

async getAllUsers(req, res) {
    try {
        console.log("Fetching all users for super admin...");

        // Get all Patients, populated with User model
        const patients = await PatientProfile.find().populate({ path: 'userId', model: User });
        console.log("Fetched patients:", patients.length);

        // Get all Therapists, populated with User model
        const therapists = await TherapistProfile.find().populate({ path: 'userId', model: User });
        console.log("Fetched therapists:", therapists.length);

        // Get all SubAdmins (no population specified)
        const admins = await User.find({ role: "admin" });
        console.log("Fetched Admins:", admins.length);

        res.json({
            patients,
            therapists,
            admins
        });
    } catch (error) {
        console.error("Error fetching users for super admin:", error);
        res.status(500).json({ error: "Failed to fetch users", details: error.message });
    }
}

async loginAsUser(req, res) {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        // Try to find user by ID in User collection
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Generate token: Assume we have a JWT utility, e.g. import jwt from 'jsonwebtoken';
        // and a JWT_SECRET env variable (or hardcoded, but preferably in env).
        // You might already have jwt setup in your project.
        const jwt = (await import('jsonwebtoken')).default || (await import('jsonwebtoken'));

        // Generate JWT with profile info
        const tokenPayload = {
          id: user._id,
          email: user.email,
          role: user.role
        };

        // Set token to expire in 1 day
        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "1d" });

        // Optionally store the token and expiry in ExpiredTokenModel (as in auth controller)
        // await ExpiredTokenModel.create({
        //   token,
        //   tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day expiry
        // });


          // Return the token & role info
          return res.json({
              success: true,
              token,
              role: user.role,
              user: {
                _id: user._id,
                email: user.email,
                name: user.name,
              }
          });
    } catch (error) {
        console.error("Error in loginAsUser:", error);
        return res.status(500).json({ error: "Internal server error", details: error.message });
    }
}
    
}

export default UsersSuperAdminController;

