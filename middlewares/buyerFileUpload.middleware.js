import multer from "multer";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, `./uploads/${file.fieldname}/`);
  },
  filename: (req, file, cb) => {
    // Generate a unique filename with the current timestamp and original file extension
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

// Set up the multer middleware
export const buyerUpload = multer({
  storage: storage,
});
