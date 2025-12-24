import multer from "multer";
import fs from "fs";

// Configure disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = "./Uploads/"; // default fallback

    if (file.fieldname === "excelFile") {
      uploadPath = "./Uploads/ExcelFiles"; // ✅ new case for Excel uploads
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
