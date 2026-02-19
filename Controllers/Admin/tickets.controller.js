
import TicketModel from "../../Schema/ticket.schema.js";

class TicketsAdminController {
  // Admin: Get all tickets with optional filters, pagination and sorting
  async getTickets(req, res) {
    try {
      const { status, priority, raisedByRole, page = 1, limit = 20, sort = "-createdAt" } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (priority) filter.priority = priority;
      if (raisedByRole) filter.raisedByRole = raisedByRole;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Step 1: Get tickets with raisedById, role, but DO NOT populate yet
      const tickets = await TicketModel.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(); // use lean for plain JS objects

      // Step 2: Collect unique user IDs by role for efficient batch fetch
      const parentIds = [];
      const therapistIds = [];
      for (const t of tickets) {
        if (t.raisedByRole === "parent" && t.raisedById) {
          parentIds.push(t.raisedById.toString());
        } else if (t.raisedByRole === "therapist" && t.raisedById) {
          therapistIds.push(t.raisedById.toString());
        }
      }

      // Step 3: Fetch User base info for all IDs (to get name/email)
      // and patient/therapist profile info (to get patientId/therapistId and profileIds)
      // Only fetch needed fields for perf

      // Dynamic imports to prevent circular import issues
      const { User, PatientProfile, TherapistProfile, ChildProfile } = await import("../../Schema/user.schema.js");

      // Fetch base user info
      const userIds = [...new Set([...parentIds, ...therapistIds])];
      const userDocs = await User.find({ _id: { $in: userIds } }).select("_id name email").lean();

      // Map: id string -> { _id, name, email }
      const userMap = {};
      userDocs.forEach(u => {
        userMap[u._id.toString()] = { id: u._id.toString(), name: u.name, email: u.email };
      });

      // Fetch patient/therapist profile info and child profiles
      let patientProfileMap = {};
      let therapistProfileMap = {};
      let therapistProfileIdMap = {};
      let childrenProfileIdsMap = {};

      // PatientProfile: for parent users
      if (parentIds.length > 0) {
        const patientProfiles = await PatientProfile.find({ userId: { $in: parentIds } })
          .select("_id userId patientId")
          .lean();
        patientProfileMap = Object.fromEntries(
          patientProfiles.map(pp => [pp.userId.toString(), pp.patientId])
        );
        // Map for childrenProfileId: for completeness, also send the PatientProfile _id as well
        childrenProfileIdsMap = Object.fromEntries(
          patientProfiles.map(pp => [pp.userId.toString(), pp._id.toString()])
        );
      }

      // TherapistProfile: for therapist users
      if (therapistIds.length > 0) {
        const therapistProfiles = await TherapistProfile.find({ userId: { $in: therapistIds } })
          .select("_id userId therapistId")
          .lean();
        therapistProfileMap = Object.fromEntries(
          therapistProfiles.map(tp => [tp.userId.toString(), tp.therapistId])
        );
        therapistProfileIdMap = Object.fromEntries(
          therapistProfiles.map(tp => [tp.userId.toString(), tp._id.toString()])
        );
      }

      // For "parent" role, find ALL children (PatientProfile) of the parent user (userId): if schema supports this relationship.
      const childrenForParentMap = {};
      if (parentIds.length > 0) {
        // If PatientProfile has a "parentId" field, you should use that; but here, using userId as parent's userId
        // A parent may have multiple children, so collect all patientIds for each userId
        const allProfiles = await PatientProfile.find({ userId: { $in: parentIds } })
          .select("userId patientId _id")
          .lean();
        // Map: userId => array of patientId's + also array of PatientProfile _ids (childrenProfileIds)
        const childrenIdMap = {};
        const childrenProfileIdsArrMap = {};
        allProfiles.forEach(pp => {
          const uid = pp.userId.toString();
          if (!childrenIdMap[uid]) childrenIdMap[uid] = [];
          if (!childrenProfileIdsArrMap[uid]) childrenProfileIdsArrMap[uid] = [];
          if (pp.patientId) childrenIdMap[uid].push(pp.patientId);
          if (pp._id) childrenProfileIdsArrMap[uid].push(pp._id.toString());
        });
        Object.assign(childrenForParentMap, childrenIdMap);
        // Overwrite childrenProfileIdsMap to be array, not just one
        childrenProfileIdsMap = childrenProfileIdsArrMap;
      }

      // Step 4: Map populated data to include a 'raisedBy' field with id, name, email, and ids/arrays as requested
      const ticketsWithRaisedBy = tickets.map(ticket => {
        let raisedBy = null;
        const userIdStr = ticket.raisedById?.toString();
        if (userIdStr && userMap[userIdStr]) {
          raisedBy = {
            ...userMap[userIdStr],
          };
          if (ticket.raisedByRole === "parent") {
            // The legacy: send patientId (first, main)
            raisedBy.patientId = patientProfileMap[userIdStr] || null;
            // childrenProfileIds: all profile _ids (array or empty)
            raisedBy.childrenProfileIds = childrenProfileIdsMap[userIdStr] || [];
            // childrenIds (all patientId of their children, array)
            raisedBy.childrenIds = childrenForParentMap[userIdStr] || [];
          }
          if (ticket.raisedByRole === "therapist") {
            raisedBy.therapistId = therapistProfileMap[userIdStr] || null;
            raisedBy.therapistProfileId = therapistProfileIdMap[userIdStr] || null;
          }
        }
        const ticketObj = { ...ticket };
        ticketObj.raisedBy = raisedBy;
        delete ticketObj.raisedById; // Clean up (FE expects .raisedBy instead)
        return ticketObj;
      });

      const totalCount = await TicketModel.countDocuments(filter);
      res.status(200).json({ tickets: ticketsWithRaisedBy, totalCount, page: parseInt(page), pageSize: tickets.length });
    } catch (err) {
      res.status(500).json({ message: "Error fetching tickets", error: err.message });
    }
  }

  // Admin: Get a single ticket by ID
  async getTicketById(req, res) {
    try {
      const { id } = req.params;
      const ticket = await TicketModel.findById(id).exec(); // removed .populate("assignedTo", "-password")
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.status(200).json(ticket);
    } catch (err) {
      res.status(500).json({ message: "Error fetching ticket", error: err.message });
    }
  }


  // Admin: Change ticket status
  async changeStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const update = { status };
      if (status === "closed") update.closedAt = new Date();
      const ticket = await TicketModel.findByIdAndUpdate(id, update, { new: true });
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.status(200).json(ticket);
    } catch (err) {
      res.status(500).json({ message: "Error updating ticket status", error: err.message });
    }
  }

  // Admin: Respond to a ticket (add a response)
  async respondToTicket(req, res) {
    try {
      const { id } = req.params;
      const { responseText } = req.body;
      const adminId = req.user?.id; // assuming admin user added to req.user by auth middleware

      // Debug: Log input values
      console.log("[respondToTicket] Ticket ID:", id);
      console.log("[respondToTicket] Response Text:", responseText);
      console.log("[respondToTicket] Admin ID:", adminId);

      if (!responseText || !adminId) {
        console.log("[respondToTicket] Missing responseText or adminId");
        return res.status(400).json({ message: "Response text and authenticated admin required." });
      }
      const update = {
        $push: {
          responses: {
            respondedBy: adminId,
            responseText,
            respondedAt: new Date(),
          },
        },
      };

      // Debug: Log update operation
      console.log("[respondToTicket] Update Operation:", update);

      const ticket = await TicketModel.findByIdAndUpdate(id, update, { new: true });

      // Debug: Log ticket after update
      console.log("[respondToTicket] Updated Ticket:", ticket);

      if (!ticket) {
        console.log("[respondToTicket] Ticket not found for ID:", id);
        return res.status(404).json({ message: "Ticket not found" });
      }
      res.status(200).json(ticket);
    } catch (err) {
      console.log("[respondToTicket] Error:", err);
      res.status(500).json({ message: "Error responding to ticket", error: err.message });
    }
  }
}

export default TicketsAdminController;
