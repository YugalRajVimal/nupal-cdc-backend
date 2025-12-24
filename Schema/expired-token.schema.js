import mongoose from "mongoose";

const expiredTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

const ExpiredTokenModel = mongoose.model("expiredTokens", expiredTokenSchema);
export default ExpiredTokenModel;
