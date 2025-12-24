import fs from "fs";

function deleteUploadedFile(file) {
  if (!file) return;
  fs.unlink(file.path, (err) => {
    if (err) {
      console.error(`Failed to delete file: ${file.path}`, err);
    } else {
      console.log(`Deleted file: ${file.path}`);
    }
  });
}

function deleteUploadedFiles(files) {
  if (!files) return;

  // Case 1: Multer gives single array (upload.array)
  if (Array.isArray(files)) {
    files.forEach((file) => deleteUploadedFile(file));
    return;
  }

  // Case 2: Multer gives object with multiple fields (upload.fields)
  Object.keys(files).forEach((key) => {
    files[key].forEach((file) => deleteUploadedFile(file));
  });
}

export { deleteUploadedFile, deleteUploadedFiles };
