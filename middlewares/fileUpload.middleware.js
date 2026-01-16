import multer from "multer";
import fs from "fs";

// Configure disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = "./Uploads/"; // default fallback

    // Special case: if used from therapist-admin.routes.js (lines 19-33)
    // We detect if request route matches exactly the therapist admin "create" route
    // POST /api/admin/therapist -- adapt if route is mounted differently
    // Most robust: If the fieldname matches any of the expected therapist file fields, route is POST and path matches therapist
    // You may adapt this logic if sub-path changes.
    const therapistFileFields = [
      "aadhaarFront",
      "aadhaarBack",
      "photo",
      "resume",
      "certificate",
    ];

    // If request has any of the therapist fields and matches upload route for Therapist
    if (
      therapistFileFields.includes(file.fieldname) &&
      req.method === "POST" &&
      req.originalUrl &&
      (
        req.originalUrl === "/api/admin/therapist" ||
        req.originalUrl.endsWith("/admin/therapist") // fallback for mounting
      )
    ) {
      uploadPath = "./Uploads/Therapist";
    } else if (file.fieldname === "excelFile") {
      uploadPath = "./Uploads/ExcelFiles";
    }

    // Ensure the folder exists
    fs.mkdirSync(uploadPath, { recursive: true });

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Make file name unique
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/\s+/g, "_"); // remove spaces
    cb(null, `${timestamp}-${cleanName}`);
  },
});

// File filter (optional but recommended)
const fileFilter = (req, file, cb) => {
  // Restrict allowed types
  if (
    file.fieldname === "excelFile" &&
    !file.originalname.match(/\.(xls|xlsx)$/)
  ) {
    return cb(new Error("Only Excel files are allowed!"), false);
  }
  cb(null, true);
};

// Multer middleware
export const upload = multer({
  storage,
  fileFilter,
});
