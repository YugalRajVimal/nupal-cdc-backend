import mongoose from "mongoose";

const expiredTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
    },
    tokenExpiry: {
      type: Date,
      required: false,
      default: null,
      description: "Optional expiry date/time for the token"
    },
  },
  { timestamps: true }
);

const ExpiredTokenModel = mongoose.model("expiredTokens", expiredTokenSchema);
export default ExpiredTokenModel;
