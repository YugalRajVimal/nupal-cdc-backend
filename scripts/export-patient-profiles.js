/**
 * export-patient-profiles.js
 *
 * Connects to MongoDB, pulls every PatientProfile (child) along with the
 * linked User doc (for login email / phone verification info), and writes
 * everything to an .xlsx file.
 *
 * USAGE:
 *   node export-patient-profiles.js "mongodb+srv://user:pass@cluster.mongodb.net/dbname"
 *
 *   or set MONGO_URI in a .env file / environment variable:
 *   MONGO_URI="mongodb+srv://..." node export-patient-profiles.js
 *
 * INSTALL DEPENDENCIES (run once, in the same folder as this script):
 *   npm init -y
 *   npm install mongoose exceljs dotenv
 *
 * OUTPUT:
 *   ./exports/children-parents-<timestamp>.xlsx
 */

import mongoose from "mongoose";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import "dotenv/config";

// ---------------------------------------------------------------------------
// 1. CONFIG
// ---------------------------------------------------------------------------

const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error(
    "\n❌ No MongoDB URI provided.\n" +
      "   Pass it as an argument:  node export-patient-profiles.js \"mongodb+srv://...\"\n" +
      "   or set MONGO_URI in your environment / .env file.\n"
  );
  process.exit(1);
}

const OUTPUT_DIR = path.resolve("./exports");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_FILE = path.join(OUTPUT_DIR, `children-parents-${timestamp}.xlsx`);

// ---------------------------------------------------------------------------
// 2. MINIMAL SCHEMAS (only fields we need — loose/strict:false is fine
//    for a read-only export script so it won't break if the real schema
//    gains fields over time)
// ---------------------------------------------------------------------------

const UserSchema = new mongoose.Schema({}, { strict: false, collection: "users" });
const PatientProfileSchema = new mongoose.Schema(
  {},
  { strict: false, collection: "patientprofiles" }
);

const User = mongoose.model("User", UserSchema);
const PatientProfile = mongoose.model("PatientProfile", PatientProfileSchema);

// ---------------------------------------------------------------------------
// 3. MAIN
// ---------------------------------------------------------------------------

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected.");

  console.log("Fetching patient (child) profiles...");
  const patients = await PatientProfile.find({}).lean();
  console.log(`Found ${patients.length} child profile(s).`);

  console.log("Fetching linked user accounts (for login email/phone)...");
  const userIds = patients
    .map((p) => p.userId)
    .filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }).lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  // -------------------------------------------------------------------------
  // 4. BUILD WORKBOOK
  // -------------------------------------------------------------------------

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "export-patient-profiles.js";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Children & Parents", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // Column order: parent name(s) first, then child name, then contact info,
  // then everything else.
  sheet.columns = [
    { header: "Father Full Name", key: "fatherFullName", width: 22 },
    { header: "Mother Full Name", key: "motherFullName", width: 22 },
    { header: "Child Name", key: "childName", width: 22 },
    { header: "Mobile 1", key: "mobile1", width: 16 },
    { header: "Mobile 1 Verified", key: "mobile1Verified", width: 16 },
    { header: "Mobile 2", key: "mobile2", width: 16 },
    { header: "Parent Email", key: "parentEmail", width: 26 },
    { header: "Login Email (User Account)", key: "loginEmail", width: 26 },
    { header: "Login Phone (User Account)", key: "loginPhone", width: 18 },
    { header: "Patient ID", key: "patientId", width: 16 },
    { header: "Gender", key: "gender", width: 10 },
    { header: "Child DOB", key: "childDOB", width: 14 },
    { header: "Planned Sessions/Month", key: "plannedSessionsPerMonth", width: 20 },
    { header: "Package", key: "package", width: 16 },
    { header: "Address", key: "address", width: 30 },
    { header: "Pincode", key: "pincode", width: 12 },
    { header: "Area Name", key: "areaName", width: 18 },
    { header: "Diagnosis Info", key: "diagnosisInfo", width: 30 },
    { header: "Child Reference", key: "childReference", width: 18 },
    { header: "Father Occupation", key: "parentOccupation", width: 18 },
    { header: "Mother Occupation", key: "motherOccupation", width: 18 },
    { header: "Remarks", key: "remarks", width: 30 },
    { header: "Used Coupon Codes", key: "usedCouponCodes", width: 24 },
    { header: "User Account Status", key: "userStatus", width: 16 },
    { header: "Account Verified", key: "accountVerified", width: 16 },
    { header: "User ID", key: "userId", width: 26 },
    { header: "Patient Profile ID", key: "_id", width: 26 },
  ];

  // Header styling
  sheet.getRow(1).font = { bold: true, name: "Arial" };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };

  patients.forEach((p) => {
    const user = p.userId ? userMap.get(String(p.userId)) : null;

    sheet.addRow({
      fatherFullName: p.fatherFullName || "",
      motherFullName: p.motherFullName || "",
      childName: p.name || "",
      mobile1: p.mobile1 || "",
      mobile1Verified: p.mobile1Verified ? "Yes" : "No",
      mobile2: p.mobile2 || "",
      parentEmail: p.parentEmail || "",
      loginEmail: user?.email || "",
      loginPhone: user?.phone || "",
      patientId: p.patientId || "",
      gender: p.gender || "",
      childDOB: p.childDOB || "",
      plannedSessionsPerMonth: p.plannedSessionsPerMonth || "",
      package: p.package || "",
      address: p.address || "",
      pincode: p.pincode || "",
      areaName: p.areaName || "",
      diagnosisInfo: p.diagnosisInfo || "",
      childReference: p.childReference || "",
      parentOccupation: p.parentOccupation || "",
      motherOccupation: p.motherOccupation || "",
      remarks: p.remarks || "",
      usedCouponCodes: Array.isArray(p.usedCouponCodes)
        ? p.usedCouponCodes.join(", ")
        : "",
      userStatus: user?.status || "",
      accountVerified: user?.accountVerified ? "Yes" : "No",
      userId: p.userId ? String(p.userId) : "",
      _id: String(p._id),
    });
  });

  // Apply Arial font to all data rows too
  sheet.eachRow((row) => {
    row.font = { ...(row.font || {}), name: "Arial" };
  });

  // Auto filter across the header row
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };

  // -------------------------------------------------------------------------
  // 5. SAVE
  // -------------------------------------------------------------------------

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await workbook.xlsx.writeFile(OUTPUT_FILE);

  console.log(`\n✅ Exported ${patients.length} row(s) to: ${OUTPUT_FILE}\n`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("\n❌ Export failed:", err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});