import mongoose from "mongoose";

const routesSchema = new mongoose.Schema(
  {
    route: {
      type: mongoose.Schema.Types.Mixed, // can be String or Number
      required: true,
    },
  },
  { timestamps: true }
);

const RoutesModel = mongoose.model("routes", routesSchema);
export default RoutesModel;
