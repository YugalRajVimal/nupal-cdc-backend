import { PatientProfile, TherapistProfile, User } from "../../Schema/user.schema.js";

class UsersSuperAdminController {

async getAllUsers(req, res) {
    try {
        console.log("Fetching all users for super admin with search and pagination...");

        // Extract query params for search & pagination
        const { role = "all", search = "", page = 1, limit = 20 } = req.query;
        console.log(role);
        const pageNum = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
        const limitNum = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 20;
        const skip = (pageNum - 1) * limitNum;

        // Helper: build search filter for user fields
        const getUserSearchQuery = (searchText) => {
            if (!searchText) return {};
            // You can adapt/add fields to search as required
            return {
                $or: [
                    { name: { $regex: searchText, $options: "i" } },
                    { email: { $regex: searchText, $options: "i" } },
                    { phone: { $regex: searchText, $options: "i" } }
                ]
            };
        };

        let results = {};
        let total = 0;

        // Patients
        if (role === "patients" || role === "all") {
            // Find patients whose related User or any patient details match the search
            // Get matching userIds from User by search
            const userMatchQ = getUserSearchQuery(search);
            let patientQuery = {};
            if (search) {
                // If searching on parent or patient name/email/phone, aggregate
                // Find User _ids that match search
                const userMatches = await User.find(userMatchQ).select("_id");
                const userIdList = userMatches.map(u => u._id);

                patientQuery = {
                    $or: [
                        { userId: { $in: userIdList } },
                        { name:     { $regex: search, $options: "i" } },
                        { fatherFullName: { $regex: search, $options: "i" } },
                        { motherFullName: { $regex: search, $options: "i" } },
                        { parentEmail:    { $regex: search, $options: "i" } },
                        { patientId:      { $regex: search, $options: "i" } },
                        { phone:          { $regex: search, $options: "i" } }
                    ]
                };
            }
            const [patients, patientsTotal] = await Promise.all([
                PatientProfile.find(patientQuery)
                    .populate({ path: 'userId', model: User })
                    .skip(role === "all" ? 0 : skip)
                    .limit(role === "all" ? 0 : limitNum),
                PatientProfile.countDocuments(patientQuery)
            ]);
            results.patients = patients;
            results.patientsTotal = patientsTotal;
            total += patientsTotal;
        } else {
            results.patients = [];
            results.patientsTotal = 0;
        }

        // Therapists
        if (role === "therapists" || role === "all") {
            let therapistQuery = {};
            if (search) {
                const userMatchQ = getUserSearchQuery(search);
                const userMatches = await User.find(userMatchQ).select("_id");
                const userIdList = userMatches.map(u => u._id);

                therapistQuery = {
                    $or: [
                        { userId: { $in: userIdList } },
                        { name:        { $regex: search, $options: "i" } },
                        { therapistId: { $regex: search, $options: "i" } },
                        { email:       { $regex: search, $options: "i" } },
                        { mobile1:     { $regex: search, $options: "i" } },
                        { mobile2:     { $regex: search, $options: "i" } },
                        { fathersName: { $regex: search, $options: "i" } }
                    ]
                };
            }
            const [therapists, therapistsTotal] = await Promise.all([
                TherapistProfile.find(therapistQuery)
                    .populate({ path: 'userId', model: User })
                    .skip(role === "all" ? 0 : skip)
                    .limit(role === "all" ? 0 : limitNum),
                TherapistProfile.countDocuments(therapistQuery)
            ]);
            results.therapists = therapists;
            results.therapistsTotal = therapistsTotal;
            total += therapistsTotal;
        } else {
            results.therapists = [];
            results.therapistsTotal = 0;
        }

        // Admins (subadmins)
        if (role === "admin" || role === "all") {
            let adminQuery = { role: "admin" };
            if (search) {
                adminQuery = {
                    ...adminQuery,
                    ...getUserSearchQuery(search)
                };
            }
            const [admins, adminsTotal] = await Promise.all([
                User.find(adminQuery)
                    .skip(role === "all" ? 0 : skip)
                    .limit(role === "all" ? 0 : limitNum),
                User.countDocuments(adminQuery)
            ]);
            results.admins = admins;
            results.adminsTotal = adminsTotal;
            total += adminsTotal;
        } else {
            results.admins = [];
            results.adminsTotal = 0;
        }

        // If "all", total = sum of all roles, but paginated for each type may be confusing UI-side. 
        // API returns totals for each, and single role's array will be paginated, others can be omitted or sent empty

        res.json({
            ...results,
            total,
            page: pageNum,
            limit: limitNum
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

