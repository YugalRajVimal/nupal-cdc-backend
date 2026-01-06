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
        const subAdmins = await User.find({ role: "SubAdmin" });
        console.log("Fetched subAdmins:", subAdmins.length);

        res.json({
            patients,
            therapists,
            subAdmins
        });
    } catch (error) {
        console.error("Error fetching users for super admin:", error);
        res.status(500).json({ error: "Failed to fetch users", details: error.message });
    }
}
    
}

export default UsersSuperAdminController;

