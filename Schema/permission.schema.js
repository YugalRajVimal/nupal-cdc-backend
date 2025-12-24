const PermissionSchema = new mongoose.Schema({
    key: { type: String, unique: true }, // e.g. "patients.read"
    description: String,
  });
  
 
  
  // models/RolePermission.js
  const RolePermissionSchema = new mongoose.Schema({
    role: {
      type: String,
      enum: ["parent", "therapist", "admin", "superadmin"],
    },
    permissions: [{ type: String }], // array of permission keys
  });
  

  export const Permission = mongoose.model("Permission", PermissionSchema);
  export const RolePermission = mongoose.model("RolePermission", RolePermissionSchema);