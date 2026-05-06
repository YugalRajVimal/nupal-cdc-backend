import { AuditLog } from "../../Schema/logs.schema.js";
import Package from "../../Schema/packages.schema.js";
import { TherapyType } from "../../Schema/therapy-type.schema.js";
import { PatientProfile, TherapistProfile, User } from "../../Schema/user.schema.js";
import WhatsappController from "../Whatsapp/whatsapp.js"; // Make sure the path is correct based on your project structure


 // Whatsapp notification for critical audit log events


class AuditLogService {
  async addLog({
    action,
    user,
    role,
    resource = null,
    resourceId = null,
    details = {},
    ipAddress = null,
    userAgent = null,
  }) {
    // Audit logs must NEVER block the request
    try {
      if (!action || !user || !role) return;

      await AuditLog.create({
        action: action.toUpperCase(), // normalize
        user,
        role,
        resource,
        resourceId,
        details,
        ipAddress,
        userAgent,
      });
    } catch (err) {
      // Log internally, but NEVER throw
      console.error("Audit log failed:", err.message);
    }
  }

  /**
   * Fetch all audit logs (with optional pagination, filtering).
   * @param {Object} params Supports: { filter, sort, page, limit }
   * @returns {Promise<{ logs: Array, total: Number }>}
   */
  async getAllLogs({ filter = {}, sort = { createdAt: -1 }, page = 1, limit = 50 } = {}) {
    try {
      const skip = (page - 1) * limit;
      const logsRaw = await AuditLog.find({})
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();

      // Prepare sets for efficient lookups
      const userIdsToChildren = new Set();
      const userIdsToTherapist = new Set();
      const userIdsToAdmin = new Set();
      const userIdsToSuperAdmin = new Set();
      const resourceIdsToChildren = new Set();
      const resourceIdsToTherapist = new Set();
      const resourceIdsToBookingRequest = new Set();
      const resourceIdsToUserForAdmin = new Set(); // Only for admin and superadmin
      const resourceIdsToUserForTherapist = new Set(); // For therapist role, resource: User
      const resourceIdsToPackage = new Set(); // For package: collect package ids
      const resourceIdsToDiscount = new Set(); // For Discount: collect discount ids
      const resourceIdsToTherapyType = new Set(); // NEW: TherapyType resource ids
      const resourceIdsToAdmin = new Set(); // For admin resource, collect admin user ids

      // For Parent role + User resource, collect user for patient-ids mapping
      const userIdsForParentResourceUser = new Set();

      logsRaw.forEach(log => {
        // For parent & Children roles, user field may need patientId lookup
        if (
          (log.role === "parent" || log.role === "patient") &&
          log.user
        ) {
          userIdsToPatient.add(log.user.toString());
        }
        if (
          log.role === "therapist" &&
          log.user
        ) {
          userIdsToTherapist.add(log.user.toString());
        }
        if (
          log.role === "admin" &&
          log.user
        ) {
          userIdsToAdmin.add(log.user.toString());
        }
        if (
          log.role === "superadmin" &&
          log.user
        ) {
          userIdsToSuperAdmin.add(log.user.toString());
        }
        // For ParentProfile/Children resource, resourceId is likely patientProfile._id
        if (
          (log.resource === "ParentProfile" || log.resource === "Parent" || log.resource === "patient") &&
          log.resourceId
        ) {
          resourceIdsToPatient.add(log.resourceId.toString());
        }
        // For TherapistProfile/Therapist resource, resourceId is likely therapistProfile._id
        if (
          (log.resource === "TherapistProfile" || log.resource === "Therapist" || log.resource === "therapist") &&
          log.resourceId
        ) {
          resourceIdsToTherapist.add(log.resourceId.toString());
        }
        // For BookingRequest resource, resourceId is bookingRequests _id (will need to resolve to requestId)
        if (
          log.resource &&
          (log.resource === "BookingRequest" || log.resource === "bookingrequest" || log.resource === "bookingRequest") &&
          log.resourceId
        ) {
          resourceIdsToBookingRequest.add(log.resourceId.toString());
        }
        // For User resource, resourceId is a userId (will be mapped to name) - ONLY if log.role == admin or superadmin
        if (
          log.resource &&
          log.resource.toUpperCase() === "USER" &&
          log.resourceId &&
          (log.role === "admin" || log.role === "superadmin")
        ) {
          resourceIdsToUserForAdmin.add(log.resourceId.toString());
        }
        // For User resource and role is therapist, resourceId is for therapistId lookup
        if (
          log.resource &&
          log.resource.toUpperCase() === "USER" &&
          log.resourceId &&
          log.role === "therapist"
        ) {
          resourceIdsToUserForTherapist.add(log.resourceId.toString());
        }
        // For Parent role and resource is User, collect user ID for Children ids mapping (our custom logic)
        if (
          log.resource &&
          log.resource.toUpperCase() === "USER" &&
          log.role === "parent" &&
          log.user
        ) {
          userIdsForParentResourceUser.add(log.user.toString());
        }
        // For Package resource, prepare to map packageId -> packageName
        if (
          log.resource &&
          (log.resource === "Package" || log.resource === "package") &&
          log.resourceId
        ) {
          resourceIdsToPackage.add(log.resourceId.toString());
        }
        // For Discount resource, add id for mapping couponCode
        if (
          log.resource &&
          (log.resource === "Discount" || log.resource === "discount") &&
          log.resourceId
        ) {
          resourceIdsToDiscount.add(log.resourceId.toString());
        }
        // For TherapyType resource, add id for mapping name
        if (
          log.resource &&
          (log.resource === "TherapyType" || log.resource === "therapytype" || log.resource === "therapyType") &&
          log.resourceId
        ) {
          resourceIdsToTherapyType.add(log.resourceId.toString());
        }
        // For admin resource, collect resourceId as admin _id
        if (
          log.resource &&
          (log.resource === "Admin" || log.resource === "admin") &&
          log.resourceId
        ) {
          resourceIdsToAdmin.add(log.resourceId.toString());
        }
      });

      // Import model classes dynamically to avoid circular dependency
      let  BookingRequests, Discount;
      const needPatientQuery = userIdsToPatient.size > 0 || resourceIdsToPatient.size > 0 || userIdsForParentResourceUser.size > 0;
      const needTherapistQuery = userIdsToTherapist.size > 0 || resourceIdsToTherapist.size > 0 || resourceIdsToUserForTherapist.size > 0;
      const needAdminQuery = userIdsToAdmin.size > 0;
      const needSuperAdminQuery = userIdsToSuperAdmin.size > 0;
      const needBookingRequestQuery = resourceIdsToBookingRequest.size > 0;
      const needUserQuery = resourceIdsToUserForAdmin.size > 0 || needAdminQuery || needSuperAdminQuery;
      const needPackageQuery = resourceIdsToPackage.size > 0;
      const needDiscountQuery = resourceIdsToDiscount.size > 0;
      const needTherapyTypeQuery = resourceIdsToTherapyType.size > 0; // NEW
      const needAdminResourceQuery = resourceIdsToAdmin.size > 0; // For admin resourceId to name

      if (needBookingRequestQuery) {
        ({ default: BookingRequests } = await import("../../Schema/booking-request.schema.js"));
      }
      if (needDiscountQuery) {
        ({ default: Discount } = await import("../../Schema/discount.schema.js"));
      }

      // Batch queries to map ObjectIds <=> patientId/therapistId names/requestIds, and User names
      const patientProfilesByUserId = {};
      const therapistProfilesByUserId = {};
      const patientProfilesById = {};
      const therapistProfilesById = {};
      const adminNamesByUserId = {};
      const superAdminNamesByUserId = {};
      const bookingRequestIdsByObjectId = {};
      const userNamesByIdForAdmin = {}; // For resourceId/user lookup for admin/superadmin
      const therapistProfilesByUserIdForResource = {}; // For therapistId lookup for User resource and therapist role
      const packageNamesById = {}; // For Package resource: packageId -> packageName
      const discountCodesById = {}; // For Discount resource: discountId -> couponCode
      const therapyTypeNamesById = {}; // NEW: For TherapyType resource: therapyTypeId -> name
      const adminNamesByIdForResource = {}; // For admin resource: adminId -> admin name

      // Custom mapping for parent role + resource == User: userId => all patientIds
      const patientIdsByUserIdForParentResourceUser = {};

      if (needPatientQuery) {
        // Get PatientProfiles by userId (for parent/Children role user field)
        const userIds = Array.from(new Set([
          ...userIdsToPatient,
          ...userIdsForParentResourceUser
        ]));
        if (userIds.length > 0) {
          // 1. Fetch all PatientProfiles for (userIdsToPatient) + (userIdsForParentResourceUser)
          const profiles = await PatientProfile.find(
            { userId: { $in: userIds } },
            { userId: 1, patientId: 1, _id: 1 }
          ).lean();

          // 2. Map of userId => list of patientIds (collect all by userId)
          const userIdToPatientIds = {};
          profiles.forEach(p => {
            const userIdStr = p.userId ? p.userId.toString() : null;
            if (userIdStr) {
              if (!userIdToPatientIds[userIdStr]) userIdToPatientIds[userIdStr] = [];
              if (p.patientId) userIdToPatientIds[userIdStr].push(p.patientId);
            }
            if (p._id) patientProfilesById[p._id.toString()] = p.patientId;
          });

          // 3. Convert list of patientIds to comma-separated string, fill both general and parent-specific map
          Object.entries(userIdToPatientIds).forEach(([userId, patientIds]) => {
            patientProfilesByUserId[userId] = patientIds.join(", ");
            // add to custom mapping as well for Parent+User logic
            patientIdsByUserIdForParentResourceUser[userId] = patientIds.join(", ");
          });
        }
        // Get PatientProfiles by _id (for resourceId field for Parent/Patient/ParentProfile resource)
        if (resourceIdsToPatient.size > 0) {
          const profiles = await PatientProfile.find(
            { _id: { $in: Array.from(resourceIdsToPatient) } },
            { _id: 1, patientId: 1 }
          ).lean();
          profiles.forEach(p => { if (p._id) patientProfilesById[p._id.toString()] = p.patientId; });
        }
      }
      if (needTherapistQuery) {
        // Get TherapistProfiles by userId (for therapist role user field)
        if (userIdsToTherapist.size > 0) {
          const profiles = await TherapistProfile.find(
            { userId: { $in: Array.from(userIdsToTherapist) } },
            { userId: 1, therapistId: 1, _id: 1 }
          ).lean();
          profiles.forEach(t => {
            if (t.userId) therapistProfilesByUserId[t.userId.toString()] = t.therapistId;
            if (t._id) therapistProfilesById[t._id.toString()] = t.therapistId;
          });
        }
        // Get TherapistProfiles by _id (for resourceId field for Therapist/TherapistProfile resource)
        if (resourceIdsToTherapist.size > 0) {
          const profiles = await TherapistProfile.find(
            { _id: { $in: Array.from(resourceIdsToTherapist) } },
            { _id: 1, therapistId: 1 }
          ).lean();
          profiles.forEach(t => { if (t._id) therapistProfilesById[t._id.toString()] = t.therapistId; });
        }
        // Get TherapistProfiles by userId (for User resource and therapist role)
        if (resourceIdsToUserForTherapist.size > 0) {
          const therapistProfiles = await TherapistProfile.find(
            { userId: { $in: Array.from(resourceIdsToUserForTherapist) } },
            { userId: 1, therapistId: 1 }
          ).lean();
          therapistProfiles.forEach(t => {
            if (t.userId) therapistProfilesByUserIdForResource[t.userId.toString()] = t.therapistId;
          });
        }
      }
      if (needAdminQuery) {
        // Get admin users by userIds (for admin role field)
        const users = await User.find(
          { _id: { $in: Array.from(userIdsToAdmin) } },
          { _id: 1, name: 1 }
        ).lean();
        users.forEach(u => {
          if (u._id) adminNamesByUserId[u._id.toString()] = u.name || "-";
        });
      }
      if (needSuperAdminQuery) {
        // Get superadmin users by userIds (for superadmin role field)
        const users = await User.find(
          { _id: { $in: Array.from(userIdsToSuperAdmin) } },
          { _id: 1, name: 1 }
        ).lean();
        users.forEach(u => {
          if (u._id) superAdminNamesByUserId[u._id.toString()] = u.name || "-";
        });
      }
      if (needBookingRequestQuery) {
        // Get BookingRequests by _id in resourceIdsToBookingRequest (for BookingRequest resource)
        const requests = await BookingRequests.find(
          { _id: { $in: Array.from(resourceIdsToBookingRequest) } },
          { _id: 1, requestId: 1 }
        ).lean();
        requests.forEach(b => {
          if (b._id) bookingRequestIdsByObjectId[b._id.toString()] = b.requestId;
        });
      }
      if (resourceIdsToUserForAdmin.size > 0) {
        // Get User names by _id for USER resource (admin & superadmin only)
        const users = await User.find(
          { _id: { $in: Array.from(resourceIdsToUserForAdmin) } },
          { _id: 1, name: 1 }
        ).lean();
        users.forEach(u => {
          if (u._id) userNamesByIdForAdmin[u._id.toString()] = u.name || u._id.toString();
        });
      }
      if (needAdminResourceQuery) {
        // Get admin user names by _id for admin resource
        const adminUsers = await User.find(
          { _id: { $in: Array.from(resourceIdsToAdmin) } },
          { _id: 1, name: 1 }
        ).lean();
        adminUsers.forEach(u => {
          if (u._id) adminNamesByIdForResource[u._id.toString()] = u.name || u._id.toString();
        });
      }
      if (needPackageQuery) {
        // Import Package model and fetch packageNames by _id in resourceIdsToPackage
        const packages = await Package.find(
          { _id: { $in: Array.from(resourceIdsToPackage) } },
          { _id: 1, name: 1 }
        ).lean();
        console.log(packages);
        packages.forEach(pkg => {
          if (pkg._id) packageNamesById[pkg._id.toString()] = pkg.name || pkg._id.toString();
        });
      }
      if (needDiscountQuery) {
        // Import Discount model and fetch couponCodes by _id in resourceIdsToDiscount
        const discounts = await Discount.find(
          { _id: { $in: Array.from(resourceIdsToDiscount) } },
          { _id: 1, couponCode: 1 }
        ).lean();
        discounts.forEach(discount => {
          if (discount._id) discountCodesById[discount._id.toString()] = discount.couponCode || discount._id.toString();
        });
      }
      if (needTherapyTypeQuery) {
        // NEW: Import TherapyType model and fetch therapyType names by _id in resourceIdsToTherapyType
        const types = await TherapyType.find(
          { _id: { $in: Array.from(resourceIdsToTherapyType) } },
          { _id: 1, name: 1 }
        ).lean();
        types.forEach(type => {
          if (type._id) therapyTypeNamesById[type._id.toString()] = type.name || type._id.toString();
        });
      }

      // Map logs: convert user ids and resource ids to patientId/therapistId/admin/superadmin/bookingRequest requestID/name/couponCode/therapyTypeName where possible, else keep as string
      const logs = logsRaw.map(log => {
        const newLog = { ...log };

        // --- User field mapping ---
        if (log.role === "superadmin" && log.user) {
          // Provide superadmin name if available
          const superAdminName = superAdminNamesByUserId[log.user?.toString()];
          newLog.user = superAdminName ? superAdminName : log.user?.toString();
        } else if (log.role === "admin" && log.user) {
          // Attempt to show admin name if available, else "-"
          const adminName = adminNamesByUserId[log.user?.toString()];
          newLog.user = adminName ? adminName : log.user?.toString();
        } else if ((log.role === "parent" || log.role === "patient") && log.user) {
          // If patientId available, substitute
          const pid = patientProfilesByUserId[log.user?.toString()];
          newLog.user = pid ? pid : log.user?.toString();
        } else if (log.role === "therapist" && log.user) {
          const tid = therapistProfilesByUserId[log.user?.toString()];
          newLog.user = tid ? tid : log.user?.toString();
        } else if (log.user) {
          newLog.user = log.user?.toString();
        }

        // --- resourceId field mapping ---
        // Custom: For Parent role and resource is User, set resourceId to all patientIds of the user
        if (
          log.resource &&
          log.resource.toUpperCase() === "USER" &&
          log.role === "parent" &&
          log.user
        ) {
          // Map to the same as the user field (which is all patientIds), fallback to userId string if not mapped
          const patientIds = patientIdsByUserIdForParentResourceUser[log.user?.toString()];
          newLog.resourceId = patientIds ? patientIds : log.user?.toString();
        }
        else if (
          log.resource &&
          log.resource.toUpperCase() === "USER" &&
          log.resourceId &&
          (log.role === "admin" || log.role === "superadmin")
        ) {
          // If resource is USER & role is admin/superadmin, set resourceId = user name if available
          const name = userNamesByIdForAdmin[log.resourceId?.toString()];
          newLog.resourceId = name ? name : log.resourceId?.toString();
        }
        else if (
          log.resource &&
          log.resource.toUpperCase() === "USER" &&
          log.resourceId &&
          log.role === "therapist"
        ) {
          // If resource is USER & role is therapist, set resourceId = therapistId (from TherapistProfile by userId)
          const therapistId = therapistProfilesByUserIdForResource[log.resourceId?.toString()];
          newLog.resourceId = therapistId ? therapistId : log.resourceId?.toString();
        }
        else if (
          log.resource &&
          (log.resource.toUpperCase() === "BOOKING" || log.resource.toLowerCase() === "booking") &&
          log.details &&
          log.details.appointmentId
        ) {
          // If resource is BOOKING and appointmentId is present in details, substitute
          newLog.resourceId = log.details.appointmentId?.toString();
        }
        else if (
          (log.resource === "ParentProfile" || log.resource === "Parent" || log.resource === "patient") &&
          log.resourceId
        ) {
          // If for Parent/Patient/ParentProfile resource, use patientId if present
          const pid = patientProfilesById[log.resourceId?.toString()];
          newLog.resourceId = pid ? pid : log.resourceId?.toString();
        }
        else if (
          (log.resource === "TherapistProfile" || log.resource === "Therapist" || log.resource === "therapist") &&
          log.resourceId
        ) {
          // For Therapist resources, use therapistId if present
          const tid = therapistProfilesById[log.resourceId?.toString()];
          newLog.resourceId = tid ? tid : log.resourceId?.toString();
        }
        else if (
          log.resource &&
          (log.resource === "Discount" || log.resource === "discount") &&
          log.resourceId
        ) {
          // For Discount resource, use couponCode if available, else fallback to id
          const code = discountCodesById[log.resourceId?.toString()];
          newLog.resourceId = code ? code : log.resourceId?.toString();
        }
        else if (
          log.resource &&
          (log.resource === "Lead" || log.resource === "lead") && 
          log.details && 
          log.details.leadId
        ) {
          // For Lead resources, use leadId if present
          newLog.resourceId = log.details.leadId?.toString();
        }
        else if (
          log.resource &&
          (log.resource === "BookingRequest" || log.resource === "bookingrequest" || log.resource === "bookingRequest") &&
          log.resourceId
        ) {
          // For BookingRequest resource, use requestId if found
          const reqId = bookingRequestIdsByObjectId[log.resourceId?.toString()];
          newLog.resourceId = reqId ? reqId : log.resourceId?.toString();
        }
        else if (
          log.resource &&
          (log.resource === "Package" || log.resource === "package") &&
          log.resourceId
        ) {
          // For Package resource, use packageName if found
          const pkgName = packageNamesById[log.resourceId?.toString()];
          newLog.resourceId = pkgName ? pkgName : log.resourceId?.toString();
        }
        else if (
          log.resource &&
          (log.resource === "TherapyType" || log.resource === "therapytype" || log.resource === "therapyType") &&
          log.resourceId
        ) {
          // NEW: For TherapyType resource, use name if found
          const therapyTypeName = therapyTypeNamesById[log.resourceId?.toString()];
          newLog.resourceId = therapyTypeName ? therapyTypeName : log.resourceId?.toString();
        }
        else if (
          log.resource &&
          (log.resource === "Admin" || log.resource === "admin") &&
          log.resourceId
        ) {
          // For admin resource, use admin name if found, else fallback to id
          const adminName = adminNamesByIdForResource[log.resourceId?.toString()];
          newLog.resourceId = adminName ? adminName : log.resourceId?.toString();
        }
        else if (log.resourceId) {
          newLog.resourceId = log.resourceId?.toString();
        }

        // Always ensure _id as string as well (for frontend consistency)
        if (newLog._id) {
          newLog._id = newLog._id.toString();
        }

        return newLog;
      });

      const total = await AuditLog.countDocuments(filter);
      return { logs, total };
    } catch (err) {
      console.error("Failed to fetch audit logs:", err.message);
      return { logs: [], total: 0 };
    }
  }
}

export default new AuditLogService();
