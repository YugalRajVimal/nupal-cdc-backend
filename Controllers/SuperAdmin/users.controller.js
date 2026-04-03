import { PatientProfile, TherapistProfile, User } from "../../Schema/user.schema.js";
import AuditLogService from "../AuditLogs/audit-logs.controller.js";

class UsersSuperAdminController {

async getAllUsers(req, res) {
    try {
        // Extract query params for search & pagination
        const { role = "all", search = "", page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
        const limitNum = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 20;
        const skip = (pageNum - 1) * limitNum;

        // Helper: build search filter for user fields
        const getUserSearchQuery = (searchText) => {
            if (!searchText) return {};
            return {
                $or: [
                    { name: { $regex: searchText, $options: "i" } },
                    { email: { $regex: searchText, $options: "i" } },
                    { phone: { $regex: searchText, $options: "i" } }
                ]
            };
        };

        let responseResults = {};
        let totals = {};

        // Patients - only paginated if role === "patients"
        if (role === "patients" || role === "all") {
            const userMatchQ = getUserSearchQuery(search);
            let patientQuery = {};
            if (search) {
                const userMatches = await User.find(userMatchQ).select("_id");
                const userIdList = userMatches.map(u => u._id);

                patientQuery = {
                    $or: [
                        { userId: { $in: userIdList } },
                        { name:          { $regex: search, $options: "i" } },
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
                    .skip(role === "patients" ? skip : 0)
                    .limit(role === "patients" ? limitNum : 0),
                PatientProfile.countDocuments(patientQuery)
            ]);
            responseResults.patients = patients;
            responseResults.patientsTotal = patientsTotal;
            totals.patientsTotal = patientsTotal;
        } else {
            responseResults.patients = [];
            responseResults.patientsTotal = 0;
            totals.patientsTotal = 0;
        }

        // Therapists - only paginated if role === "therapists"
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
                    .skip(role === "therapists" ? skip : 0)
                    .limit(role === "therapists" ? limitNum : 0),
                TherapistProfile.countDocuments(therapistQuery)
            ]);
            responseResults.therapists = therapists;
            responseResults.therapistsTotal = therapistsTotal;
            totals.therapistsTotal = therapistsTotal;
        } else {
            responseResults.therapists = [];
            responseResults.therapistsTotal = 0;
            totals.therapistsTotal = 0;
        }

        // Admins - only paginated if role === "admin"
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
                    .skip(role === "admin" ? skip : 0)
                    .limit(role === "admin" ? limitNum : 0),
                User.countDocuments(adminQuery)
            ]);
            responseResults.admins = admins;
            responseResults.adminsTotal = adminsTotal;
            totals.adminsTotal = adminsTotal;
        } else {
            responseResults.admins = [];
            responseResults.adminsTotal = 0;
            totals.adminsTotal = 0;
        }

        // For UI: total and paginated arrays are specific to the selected role.
        // For "all": returns unpaginated lists (limit 0 == unlimited), totals are still valid.
        // For single role: returns paginated list of that role.
        // Also return total for all, regardless of role, for UI-friendly pagination controls.

        // Get a global total (sum of all)
        responseResults.total = (totals.patientsTotal || 0) + (totals.therapistsTotal || 0) + (totals.adminsTotal || 0);
        responseResults.page = pageNum;
        responseResults.limit = limitNum;

        res.json(responseResults);

    } catch (error) {
        console.error("Error fetching users for super admin:", error);
        res.status(500).json({ error: "Failed to fetch users", details: error.message });
    }
}

async loginAsUser(req, res) {
    const session = await User.startSession();
    try {
        session.startTransaction();
        const { userId } = req.body;

        if (!userId) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ error: "userId is required" });
        }

        // Try to find user by ID in User collection (in transaction session)
        const user = await User.findById(userId).session(session);
        if (!user) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ error: "User not found" });
        }

        // Generate JWT with profile info
        const jwt = (await import('jsonwebtoken')).default || (await import('jsonwebtoken'));
        const tokenPayload = {
            id: user._id,
            email: user.email,
            role: user.role
        };
        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "1d" });

        // === Mandatory Audit Log (must succeed for transaction, else revert everything) ===
        try {
            await AuditLogService.addLog(
                {
                    action: "SUPERADMIN_LOGIN_AS_USER",
                    user: req.user && req.user.id ? req.user.id : null,
                    role: req.user && req.user.role ? req.user.role : undefined,
                    resource: user.role,          // log the role we are logging in as
                    resourceId: user._id,         // id of the user we are logging in as
                    details: {
                        changedFields: {},
                        message: `Superadmin logged in as userId=${user._id} (${user.email}) with role "${user.role}"`
                    },
                    ipAddress: req.ip,
                    userAgent: req.headers["user-agent"]
                },
                { session }
            );
        } catch (elog) {
            // If log not created, revert everything (abort and do not commit)
            console.error("[loginAsUser] Error writing audit log:", elog);
            await session.abortTransaction();
            session.endSession();
            return res.status(500).json({ message: "Audit log creation failed. Login as user aborted. All changes reverted." });
        }

        // Commit everything only if log succeeded
        await session.commitTransaction();
        session.endSession();

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
        await session.abortTransaction();
        session.endSession();
        console.error("Error in loginAsUser:", error);
        return res.status(500).json({ error: "Internal server error", details: error.message });
    }
}


// Get superadmin profile (singleton)
async getSuperAdminProfile(req, res) {
    try {
        // Find the main superadmin from User schema by role
        const admin = await User.findOne(
            { role: "superadmin" },
            "-password" // Exclude the password field
        );

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: "Superadmin profile not found",
            });
        }

        return res.json({
            success: true,
            data: admin,
        });
    } catch (error) {
        console.error("Error fetching superadmin profile:", error);
        return res.status(500).json({
            success: false,
            message: "Error fetching superadmin profile",
            error: error.message,
        });
    }
}


// =====================
// ADMIN MANAGEMENT APIS
// =====================
// Create new admin
// Create new admin (User schema only)
async createAdmin(req, res) {
    try {
        const { name, email, phone, status = "active", isDisabled = false } = req.body;
        if (!name || !email) {
            return res.status(400).json({ message: "Name and email are required." });
        }

        // Check for existing user with same email
        let existing = await User.findOne({ email: email.toLowerCase(), role: "admin" });
        if (existing) {
            return res.status(409).json({ message: "Admin with this email already exists." });
        }

        // Create User (User schema only)
        const adminUser = await User.create({
            role: "admin",
            name,
            phone,
            email: email.toLowerCase(),
            authProvider: "password",
            status,
            isDisabled
        });

        return res.status(201).json({ message: "Admin created.", user: adminUser });
    } catch (err) {
        console.error("Error creating admin:", err);
        return res.status(500).json({ message: "Failed to create admin.", error: err.message });
    }
}

// Get all admins (User schema only)
async fetchAllAdmins(req, res) {
    try {
        // Support pagination & search (optional)
        const { search = "", page = 1, limit = 50 } = req.query;
        const query = { role: "admin" };
        if (search.trim()) {
            query.$or = [
                { name: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } }
            ];
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const users = await User.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();
        return res.json(users);
    } catch (err) {
        console.error("Error fetching admins:", err);
        return res.status(500).json({ message: "Failed to fetch admins.", error: err.message });
    }
}

// Edit admin (by id, User schema only)
async editAdmin(req, res) {
    try {
        const { id } = req.params;
        const { name, email, phone, status, isDisabled } = req.body;
        const user = await User.findOne({ _id: id, role: "admin" });
        if (!user) return res.status(404).json({ message: "Admin not found." });

        if (typeof name === "string") user.name = name;
        if (typeof email === "string") user.email = email.toLowerCase();
        if (typeof phone === "string") user.phone = phone;
        if (typeof status !== "undefined") user.status = status;
        if (typeof isDisabled !== "undefined") user.isDisabled = isDisabled;

        await user.save();

        return res.json({ message: "Admin updated.", user });
    } catch (err) {
        console.error("Error updating admin:", err);
        return res.status(500).json({ message: "Update failed", error: err.message });
    }
}

// Change admin status (active/suspended/deleted) by id (User schema only)
async editAdminStatus(req, res) {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!["active", "suspended", "deleted"].includes(status)) {
            return res.status(400).json({ message: "Invalid status." });
        }
        const user = await User.findOneAndUpdate(
            { _id: id, role: "admin" },
            { $set: { status } },
            { new: true }
        );
        if (!user) return res.status(404).json({ message: "Admin not found." });
        return res.json({ message: "Status updated.", user });
    } catch (err) {
        console.error("Error updating admin status:", err);
        return res.status(500).json({ message: "Failed to update status", error: err.message });
    }
}

// Edit admin disabled (isDisabled) flag (User schema only)
async editAdminDisabled(req, res) {
    try {
        const { id } = req.params;
        const { isDisabled } = req.body;
        if (typeof isDisabled !== "boolean") {
            return res.status(400).json({ message: "isDisabled must be a boolean." });
        }
        const user = await User.findOneAndUpdate(
            { _id: id, role: "admin" },
            { $set: { isDisabled } },
            { new: true }
        );
        if (!user) return res.status(404).json({ message: "Admin not found." });
        return res.json({ message: "Disabled flag updated.", user });
    } catch (err) {
        console.error("Error updating admin disabled:", err);
        return res.status(500).json({ message: "Failed to update disabled status", error: err.message });
    }
}

// Delete admin (by id, User schema only)
async deleteAdmin(req, res) {
    try {
        const { id } = req.params;
        const user = await User.findOneAndDelete({ _id: id, role: "admin" });
        if (!user) return res.status(404).json({ message: "Admin not found." });

        return res.json({ message: "Admin deleted." });
    } catch (err) {
        console.error("Error deleting admin:", err);
        return res.status(500).json({ message: "Failed to delete admin.", error: err.message });
    }
}


    
}

export default UsersSuperAdminController;

