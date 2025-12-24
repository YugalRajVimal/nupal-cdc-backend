import mongoose from "mongoose";

export const connectUsingMongoose = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to DB Successfully");
  } catch (error) {
    throw new Error("Error while connecting to DB");
  }
};
