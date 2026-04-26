import mongoose from "mongoose";

const ticketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: false,
      unique: true,
      description: "Custom ticket identifier (e.g. for friendly display or reference)",
    },
    raisedByRole: {
      type: String,
      enum: ["parent", "therapist"],
      required: true,
      description: "Specifies if the ticket is raised by parent or therapist",
    },
    raisedById: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      description: "User ID of the parent or therapist who raised the ticket",
      refPath: "raisedByRole", // This will reference either 'parent' or 'therapist' models dynamically, if you have such models
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      description: "Short subject or title for the ticket",
    },
    description: {
      type: String,
      required: true,
      description: "Detailed description of the issue/complaint",
    },
    status: {
      type: String,
      enum: ["open", "closed", "pending", "in-progress", "resolved"],
      default: "open",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    responses: [
      {
        respondedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "admin",
          required: true,
        },
        responseText: {
          type: String,
          required: true,
        },
        respondedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    closedAt: {
      type: Date,
      default: null,
    },
    tags: [String], // Optional tags for search/filter
  },
  { timestamps: true }
);

const TicketModel = mongoose.model("ticket", ticketSchema);
export default TicketModel;
