// import BookingRequests from '../../Schema/booking-request.schema.js';
// import Booking from '../../Schema/booking.schema.js';
// import ConsultationBooking from '../../Schema/consultation-booking.schema.js';
// import counterSchema from '../../Schema/counter.schema.js';
// import DiscountModel from '../../Schema/discount.schema.js';
// import Package from '../../Schema/packages.schema.js';
// import SessionEditRequest from '../../Schema/session-edit-request.schema.js';
// import { TherapyType } from '../../Schema/therapy-type.schema.js';
// import TicketModel from '../../Schema/ticket.schema.js';
// import { PatientProfile, TherapistProfile, User } from '../../Schema/user.schema.js';
// import AuditLogService from "../AuditLogs/audit-logs.controller.js";
// import WhatsappController from "../Whatsapp/whatsapp.js";

// class ParentController {

//   async parentSignUpSendOTP(req, res) {
//     const session = await User.startSession();
//     session.startTransaction();
//     try {
//       const { email, name } = req.body;

//       if (!email || typeof email !== "string") {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({ success: false, message: "Valid email is required." });
//       }

//       if (!name || typeof name !== "string") {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({ success: false, message: "Name is required." });
//       }

//       const userExists = await User.findOne({ email, role: "patient" }).session(session);
//       if (userExists) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(409).json({ success: false, message: "A parent with this email already exists." });
//       }

//       const otp = Math.floor(100000 + Math.random() * 900000).toString();
//       const expiresInMs = 1000 * 300;

//       const newUser = new User({
//         email,
//         name,
//         role: "patient",
//         authProvider: "otp",
//         signUpOTP: otp,
//         signUpOTPExpiresAt: new Date(Date.now() + expiresInMs),
//         signUpOTPSentAt: new Date(),
//         signUpOTPAttempts: 0,
//         signUpOTPLastUsedAt: null,
//         status: "active",
//         isDisabled: false,
//         manualSignUp: true
//       });
//       await newUser.save({ session });

//       let sendEmailError = null;
//       let sendEmailPromise = null;
//       let whatsappStatus = null;

//       try {
//         const sendMail = (await import('../../config/nodeMailer.config.js')).default;
//         sendEmailPromise = sendMail(email, "Your OTP Code", `Your OTP is: ${otp}`)
//           .catch((err) => { sendEmailError = err; });
//       } catch (err) {
//         sendEmailError = err;
//       }

//       try {
//         whatsappStatus = '[Skipped WhatsApp OTP - only send if phone is available]';
//       } catch (waErr) {
//         whatsappStatus = waErr?.message || "Failed to send OTP on WhatsApp";
//         console.error("ParentSignUp OTP WhatsApp error:", waErr);
//       }

//       if (sendEmailPromise) await sendEmailPromise;

//       if (sendEmailError) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(500).json({
//           success: false,
//           message: "Failed to send OTP to email address.",
//           emailError: sendEmailError?.message || sendEmailError
//         });
//       }

//       try {
//         await AuditLogService.addLog({
//           action: 'PARENT_SIGNUP_OTP_SENT',
//           user: newUser._id,
//           role: 'parent',
//           resource: 'Parent',
//           resourceId: newUser._id,
//           details: {
//             email,
//             name,
//             message: `Parent signup OTP sent to ${email}`,
//             completeProfileOrigin: 'self-service',
//             whatsappStatus
//           },
//           ipAddress: req.ip,
//           userAgent: req.headers['user-agent']
//         });
//       } catch (logErr) {
//         console.error('Failed to write audit log (PARENT_SIGNUP_OTP_SENT) in parentSignUpSendOTP:', logErr);
//       }

//       await session.commitTransaction();
//       session.endSession();

//       return res.json({ success: true, message: "OTP sent to email address." });
//     } catch (e) {
//       await session.abortTransaction();
//       session.endSession();
//       console.error("Error in parentSignUpSendOTP:", e);
//       return res.status(500).json({ success: false, message: "Server error." });
//     }
//   }

//   async parentSignUpVerifyOTP(req, res) {
//     try {
//       const { email, otp } = req.body;

//       if (!email || !otp) {
//         return res.status(400).json({ success: false, message: "Email and OTP are required." });
//       }

//       const signupUser = await User.findOne({ email, role: "patient" });

//       if (!signupUser || (!signupUser.signUpOTP || !signupUser.signUpOTPExpiresAt)) {
//         return res.status(400).json({ success: false, message: "No OTP request found or OTP expired." });
//       }

//       if (Date.now() > new Date(signupUser.signUpOTPExpiresAt).getTime()) {
//         signupUser.signUpOTP = null;
//         signupUser.signUpOTPExpiresAt = null;
//         signupUser.signUpOTPSentAt = null;
//         signupUser.signUpOTPAttempts = 0;
//         signupUser.signUpOTPLastUsedAt = null;
//         await signupUser.save();
//         return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
//       }

//       signupUser.signUpOTPAttempts = (signupUser.signUpOTPAttempts || 0) + 1;
//       await signupUser.save();

//       if (signupUser.signUpOTP !== otp) {
//         return res.status(401).json({ success: false, message: "Invalid OTP." });
//       }

//       signupUser.signUpOTPLastUsedAt = new Date();
//       signupUser.signUpOTP = null;
//       signupUser.signUpOTPExpiresAt = null;
//       signupUser.signUpOTPSentAt = null;
//       signupUser.signUpOTPAttempts = 0;

//       if (!signupUser.role) signupUser.role = "patient";
//       if (!signupUser.authProvider) signupUser.authProvider = "otp";
//       signupUser.status = "active";
//       signupUser.isDisabled = false;

//       await signupUser.save();

//       try {
//         await AuditLogService.addLog({
//           action: 'PARENT_SIGNUP_OTP_VERIFIED',
//           user: signupUser._id,
//           role: 'parent',
//           resource: 'Parent',
//           resourceId: signupUser._id,
//           details: {
//             email,
//             otpVerified: true,
//             message: `Parent OTP verified and account activated for ${email}`,
//             completeProfileOrigin: 'self-service'
//           },
//           ipAddress: req.ip,
//           userAgent: req.headers['user-agent']
//         });
//       } catch (logErr) {
//         console.error('Failed to write audit log (PARENT_SIGNUP_OTP_VERIFIED) in parentSignUpVerifyOTP:', logErr);
//       }

//       return res.json({ success: true, message: "Parent account created. You may now login." });
//     } catch (e) {
//       console.error("Error in parentSignUpVerifyOTP:", e);
//       return res.status(500).json({ success: false, message: "Server error." });
//     }
//   }

//   async completeParentProfile(req, res) {
//     try {
//       console.log("Step 1: Starting completeParentProfile");
//       const parentUserId = req.user?.id;
//       console.log("Step 2: parentUserId:", parentUserId);
//       if (!parentUserId) {
//         console.log("Step 2.1: No user ID found, unauthorized.");
//         return res.status(401).json({ error: "Unauthorized: No user ID found." });
//       }

//       const user = await User.findById(parentUserId);
//       console.log("Step 3: Found user:", !!user, "Role:", user?.role);
//       if (!user || user.role !== "patient") {
//         console.log("Step 3.1: No parent user found.");
//         return res.status(404).json({ error: "No parent user found." });
//       }

//       const {
//         mobile1,
//         childFullName,
//         gender,
//         childDOB,
//         fatherFullName,
//         motherFullName,
//         parentEmail,
//         mobile2,
//         address,
//         areaName,
//         pincode,
//         diagnosisInfo,
//         childReference,
//         parentOccupation,
//         motherOccupation,
//         remarks,
//         otherDocument
//       } = req.body;
//       console.log("Step 4: req.body received:", {
//         mobile1, childFullName, gender, childDOB, fatherFullName, motherFullName,
//         parentEmail, mobile2, address, areaName, pincode, diagnosisInfo, childReference,
//         parentOccupation, motherOccupation, remarks, otherDocument
//       });

//       const phone = mobile1;
//       console.log("Step 5: Phone for user will be:", phone);

//       if (phone && typeof phone === "string" && phone.trim() !== "") {
//         const existingUser = await User.findOne({
//           phone: phone.trim(),
//           _id: { $ne: parentUserId }
//         });
//         console.log("Step 5.1: existingUser for phone?", !!existingUser);
//         if (existingUser) {
//           console.log("Step 5.2: Phone number conflict with user", existingUser.email);
//           return res.status(409).json({
//             error: `This phone number is already used by another user (Email: ${existingUser.email || "[none]"})`
//           });
//         }
//         user.phone = phone.trim();
//         user.incompleteParentProfile = false;
//         console.log("Step 5.3: User phone set and marked profile as complete");
//       }
//       await user.save();
//       console.log("Step 6: User saved.");

//       let existingProfile = await PatientProfile.findOne({ userId: user._id });
//       let createdProfile = null;
//       let patientId = null;
//       console.log("Step 7: existingProfile?", !!existingProfile);

//       if (!existingProfile) {
//         if (!childFullName || typeof childFullName !== "string" || !childFullName.trim()) {
//           console.log("Step 7.1: Child full name missing on first profile creation");
//           return res.status(400).json({ error: "Child name (childFullName) is required to complete profile for the first time." });
//         }

//         let seq;
//         try {
//           const counter = await counterSchema.findOneAndUpdate(
//             { name: "patient" },
//             { $inc: { seq: 1 } },
//             { new: true, upsert: true }
//           );
//           seq = counter.seq;
//           console.log("Step 7.2: New patientId sequence number:", seq);
//         } catch (counterErr) {
//           console.log("Step 7.2: Failed to increment Children ID counter.", counterErr);
//           return res.status(500).json({ error: "Could not generate Children ID." });
//         }
//         patientId = `P${seq.toString().padStart(4, "0")}`;
//         console.log("Step 7.3: Generated patientId:", patientId);

//         createdProfile = new PatientProfile({
//           userId: user._id,
//           name: childFullName ? childFullName.trim() : "",
//           patientId,
//           gender: gender || "",
//           childDOB: childDOB || "",
//           fatherFullName: fatherFullName || "",
//           motherFullName: motherFullName || "",
//           parentEmail: parentEmail || user.email,
//           mobile1: mobile1 || "",
//           mobile2: mobile2 || "",
//           address: address || "",
//           areaName: areaName || "",
//           pincode: pincode || "",
//           diagnosisInfo: diagnosisInfo || "",
//           childReference: childReference || "",
//           parentOccupation: parentOccupation || "",
//           motherOccupation: motherOccupation || "",
//           remarks: remarks || "",
//           otherDocument: otherDocument || undefined,
//         });
//         await createdProfile.save();
//         console.log("Step 7.4: PatientProfile created:", createdProfile._id);

//         try {
//           console.log("Step 8: Sending Children Profile Completed WhatsApp notification:", {
//             destination: user.phone || user.phoneNumber || mobile1 || "",
//             userName: user.name || "",
//             childName: childFullName || "",
//             patientId: createdProfile.patientId || ""
//           });
//           await WhatsappController.sendChildrenProfileCompleted({
//             destination: user.phone || user.phoneNumber || mobile1 || "",
//             userName: user.name || "",
//             childName: childFullName || "",
//             patientId: createdProfile.patientId || ""
//           });
//           console.log("Step 8.1: WhatsApp notification sent successfully.");
//         } catch (whErr) {
//           console.error('Failed to send Children Profile Completed WhatsApp notification:', whErr);
//         }
//       } else {
//         console.log("Step 7.5: PatientProfile already exists, not creating again.");
//       }

//       try {
//         console.log("Step 9: Writing audit log for PARENT_PROFILE_COMPLETED.");
//         await AuditLogService.addLog({
//           action: 'PARENT_PROFILE_COMPLETED',
//           user: user._id,
//           role: 'parent',
//           resource: 'Parent',
//           resourceId: createdProfile?._id || existingProfile?._id,
//           details: {
//             email: user.email,
//             userId: user._id,
//             fieldsSubmitted: {
//               childFullName, gender, childDOB, fatherFullName, motherFullName, parentEmail,
//               mobile1, mobile2, address, areaName, pincode, diagnosisInfo, childReference,
//               parentOccupation, motherOccupation,
//               remarks, otherDocument
//             },
//             createdProfile: !!createdProfile,
//             completeProfileOrigin: 'self-service',
//             message: `Parent [${user.email}] completed their profile`
//           },
//           ipAddress: req.ip,
//           userAgent: req.headers['user-agent']
//         });
//         console.log("Step 9.1: Audit log written successfully.");
//       } catch (logErr) {
//         console.error('Failed to write audit log (PARENT_PROFILE_COMPLETED) in completeParentProfile:', logErr);
//       }

//       console.log("Step 10: Returning success response.");
//       return res.status(200).json({
//         success: true,
//         user: {
//           email: user.email,
//           name: user.name,
//           phone: user.phone,
//           role: user.role,
//           _id: user._id
//         },
//         patientProfile: createdProfile
//           ? {
//               _id: createdProfile._id,
//               name: createdProfile.name,
//               patientId: createdProfile.patientId,
//               gender: createdProfile.gender,
//               childDOB: createdProfile.childDOB,
//               fatherFullName: createdProfile.fatherFullName,
//               motherFullName: createdProfile.motherFullName,
//               parentEmail: createdProfile.parentEmail,
//               mobile1: createdProfile.mobile1,
//               mobile2: createdProfile.mobile2,
//               address: createdProfile.address,
//               areaName: createdProfile.areaName,
//               pincode: createdProfile.pincode,
//               diagnosisInfo: createdProfile.diagnosisInfo,
//               childReference: createdProfile.childReference,
//               parentOccupation: createdProfile.parentOccupation,
//               motherOccupation: createdProfile.motherOccupation,
//               remarks: createdProfile.remarks,
//               otherDocument: createdProfile.otherDocument,
//             }
//           : undefined
//       });
//     } catch (e) {
//       console.error("Error in completeParentProfile:", e);
//       res.status(400).json({ error: "Failed to complete parent profile", details: e.message });
//     }
//   }

//   async getDashboardDetails(req, res) {
//     try {
//       const parentId = req.user.id;
//       if (!parentId) {
//         return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
//       }

//       const user = await User.findById(parentId).lean();
//       if (!user) {
//         return res.status(404).json({ success: false, message: "Parent user not found." });
//       }

//       const children = await PatientProfile.find({ userId: user._id }).lean();
//       const childIds = children.map(child => child._id);

//       const appointments = await Booking.find({ patient: { $in: childIds } })
//         .populate({
//           path: "patient",
//           model: "PatientProfile",
//           select: "patientId name",
//           populate: {
//             path: "userId",
//             model: "User",
//             select: "name",
//           }
//         })
//         .populate({
//           path: "sessions.therapist",
//           model: "TherapistProfile",
//           select: "therapistId",
//           populate: {
//             path: "userId",
//             model: "User",
//             select: "name"
//           }
//         })
//         .lean();

//       const consultationBookings = await ConsultationBooking.find({ client: { $in: childIds } })
//         .populate({
//           path: "client",
//           model: "PatientProfile",
//           select: "patientId name",
//           populate: {
//             path: "userId",
//             model: "User",
//             select: "name",
//           }
//         })
//         .populate({
//           path: "therapy",
//           model: "TherapyType",
//           select: "name"
//         })
//         .lean();

//       const totalAppointments = appointments.length;

//       // Build unchecked sessions — response keys use "children" terminology
//       const uncheckedSessions = [];
//       appointments.forEach(booking => {
//         if (Array.isArray(booking.sessions)) {
//           for (const session of booking.sessions) {
//             if (!session.isCheckedIn) {
//               uncheckedSessions.push({
//                 childrenId: booking.patient.patientId,
//                 name: booking.patient.name,
//                 notCheckedInSession: session
//               });
//             }
//           }
//         }
//       });

//       const populatedBookings = await Booking.find({ patient: { $in: childIds } })
//         .populate({
//           path: "patient",
//           model: "PatientProfile",
//           populate: {
//             path: "userId",
//             model: "User",
//           },
//         })
//         .populate({
//           path: "payment",
//           model: "Payment"
//         })
//         .lean({ virtuals: true });

//       // Pending payments — response keys use "children" terminology
//       const pendingPayments = [];
//       for (const booking of populatedBookings) {
//         let payments = [];
//         if (Array.isArray(booking.payment)) {
//           payments = booking.payment;
//         } else if (booking.payment) {
//           payments = [booking.payment];
//         }
//         for (const pay of payments) {
//           if (!pay) continue;
//           const status = pay.status || "Unknown";
//           if (status.toLowerCase() === "pending") {
//             let childrenName = "";
//             if (
//               booking.Children &&
//               booking.patient.userId &&
//               booking.patient.userId.name
//             ) {
//               childrenName = booking.patient.name;
//             } else if (booking.Children && booking.patient.name) {
//               childrenName = booking.patient.name;
//             }
//             const childrenId = booking.patient?.patientId;
//             if (!childrenName && user && user.name) childrenName = user.name;
//             pendingPayments.push({
//               InvoiceId: pay.paymentId ? pay.paymentId.toString() : "",
//               date: pay.createdAt || pay.date || booking.createdAt,
//               childrenName: childrenName,
//               childrenId,
//               amount: pay.amount || booking.totalAmount || 0,
//               status: status
//             });
//           }
//         }
//       }

//       const dashboardData = {
//         childrenCount: children.length,
//         totalAppointments,
//         pendingPayments,
//         uncheckedSessions,
//         consultationBookings
//       };

//       res.json({ success: true, data: dashboardData });
//     } catch (err) {
//       res.status(500).json({
//         success: false,
//         error: err.message || String(err)
//       });
//     }
//   }

//   async getAllChildrens(req, res) {
//     try {
//       const parentId = req.user.id;
//       if (!parentId) {
//         return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
//       }
//       const userId = parentId;

//       const user = await User.findById(userId).lean();
//       if (!user) {
//         return res.status(404).json({ success: false, message: "User not found." });
//       }

//       let { page = 1, limit = 10, search = "" } = req.query;
//       page = Math.max(parseInt(page) || 1, 1);
//       limit = Math.max(parseInt(limit) || 10, 1);
//       search = (search || "").trim();

//       const dbQuery = { userId: user._id };
//       if (search) {
//         dbQuery.$or = [
//           { name: { $regex: search, $options: "i" } },
//           { patientId: { $regex: search, $options: "i" } },
//           { fatherFullName: { $regex: search, $options: "i" } },
//           { motherFullName: { $regex: search, $options: "i" } }
//         ];
//       }

//       const total = await PatientProfile.countDocuments(dbQuery);

//       const children = await PatientProfile.find(dbQuery)
//         .skip((page - 1) * limit)
//         .limit(limit)
//         .lean();

//       res.json({
//         success: true,
//         data: children,
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//         hasNextPage: page * limit < total,
//         hasPrevPage: page > 1
//       });
//     } catch (err) {
//       res.status(500).json({ success: false, error: err.message || String(err) });
//     }
//   }

//   async getAllAppointments(req, res) {
//     try {
//       const parentId = req.user.id;
//       if (!parentId) {
//         return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
//       }

//       const user = await User.findById(parentId).lean();
//       if (!user) {
//         return res.status(404).json({ success: false, message: "Parent user not found." });
//       }

//       const children = await PatientProfile.find({ userId: user._id }).lean();
//       if (!children || children.length === 0) {
//         return res.json({ success: true, data: [], page: 1, limit: 10, total: 0, totalPages: 1 });
//       }
//       const childIds = children.map(child => child._id);

//       let { page = 1, limit = 10, search = "" } = req.query;
//       page = Math.max(parseInt(page) || 1, 1);
//       limit = Math.max(parseInt(limit) || 10, 1);
//       search = (search || "").trim();

//       const bookingQuery = { patient: { $in: childIds } };

//       if (search) {
//         const orConditions = [
//           { requestId: { $regex: search, $options: "i" } },
//           { appointmentId: { $regex: search, $options: "i" } },
//           { status: { $regex: search, $options: "i" } },
//           { requestStatus: { $regex: search, $options: "i" } }
//         ];

//         orConditions.push(
//           { "patientProfile.name": { $regex: search, $options: "i" } },
//           { "patientProfile.patientId": { $regex: search, $options: "i" } }
//         );

//         orConditions.push(
//           { "therapyProfile.name": { $regex: search, $options: "i" } }
//         );

//         orConditions.push(
//           { "discountInfo.coupon.couponCode": { $regex: search, $options: "i" } }
//         );
//         orConditions.push(
//           { "sessions.date": { $regex: search, $options: "i" } },
//           { "sessions.slotId": { $regex: search, $options: "i" } }
//         );

//         const pipeline = [
//           { $match: bookingQuery },
//           {
//             $lookup: {
//               from: 'patientprofiles',
//               localField: 'patient',
//               foreignField: '_id',
//               as: 'patientProfile'
//             }
//           },
//           { $unwind: { path: "$patientProfile", preserveNullAndEmptyArrays: true } },
//           {
//             $lookup: {
//               from: 'therapytypes',
//               localField: 'therapy',
//               foreignField: '_id',
//               as: 'therapyProfile'
//             }
//           },
//           { $unwind: { path: "$therapyProfile", preserveNullAndEmptyArrays: true } },
//           { $match: { $or: orConditions } }
//         ];

//         const pipelineCount = [...pipeline, { $count: "total" }];
//         const pipelineData = [
//           ...pipeline,
//           { $sort: { createdAt: -1, _id: -1 } },
//           { $skip: (page - 1) * limit },
//           { $limit: limit }
//         ];

//         const countResult = await Booking.aggregate(pipelineCount);
//         const total = countResult?.[0]?.total || 0;

//         const pagedDocs = await Booking.aggregate([
//           ...pipelineData,
//           { $project: { _id: 1 } }
//         ]);
//         const pagedBookingIds = pagedDocs.map(doc => doc._id);

//         let appointments = [];
//         if (pagedBookingIds.length > 0) {
//           appointments = await Booking.find({ _id: { $in: pagedBookingIds } })
//             .populate({ path: 'package' })
//             .populate({ path: 'patient', model: 'PatientProfile' })
//             .populate({
//               path: 'therapist',
//               model: 'TherapistProfile',
//               select: "therapistId",
//               populate: {
//                 path: 'userId',
//                 model: 'User',
//                 select: 'name'
//               }
//             })
//             .populate({ path: 'therapy', model: 'TherapyType' })
//             .populate({ path: 'payment' })
//             .lean();

//           const orderMap = {};
//           pagedBookingIds.forEach((id, i) => { orderMap[String(id)] = i; });
//           appointments.sort((a, b) => (orderMap[String(a._id)] ?? 0) - (orderMap[String(b._id)] ?? 0));
//         }

//         const therapistIds = [];
//         appointments.forEach((appointment) => {
//           if (Array.isArray(appointment.sessions)) {
//             appointment.sessions.forEach((session) => {
//               if (session.therapist) therapistIds.push(session.therapist);
//             });
//           }
//         });
//         const uniqueTherapistIds = [...new Set(therapistIds.map(id => id?.toString()).filter(Boolean))];
//         const therapists = await TherapistProfile.find({ _id: { $in: uniqueTherapistIds } })
//           .populate({ path: 'userId', model: 'User', select: 'name' })
//           .select('userId name therapistId')
//           .lean();
//         const therapistMap = {};
//         therapists.forEach(t => { therapistMap[String(t._id)] = t; });

//         for (const appointment of appointments) {
//           if (Array.isArray(appointment.sessions)) {
//             appointment.sessions = appointment.sessions.map((session) => {
//               const sessionCopy = { ...session };
//               if (session.therapist && therapistMap[session.therapist?.toString()]) {
//                 sessionCopy.therapist = therapistMap[session.therapist?.toString()];
//               }
//               return sessionCopy;
//             });
//           }
//         }

//         const appointmentIds = appointments.map(a => a._id);
//         const sessionEditRequests = await SessionEditRequest.find({ appointmentId: { $in: appointmentIds } })
//           .populate({ path: 'sessions.sessionId', model: 'Session' })
//           .lean();
//         const editRequestsByAppointment = {};
//         sessionEditRequests.forEach(er => {
//           const apptId = er.appointmentId?.toString?.() || er.appointmentId;
//           if (!editRequestsByAppointment[apptId]) editRequestsByAppointment[apptId] = [];
//           editRequestsByAppointment[apptId].push(er);
//         });
//         for (const appointment of appointments) {
//           const apptId = appointment._id?.toString?.() || appointment._id;
//           appointment.editRequests = editRequestsByAppointment[apptId] || [];
//         }

//         res.json({
//           success: true,
//           data: appointments,
//           page,
//           limit,
//           total,
//           totalPages: Math.ceil(total / limit),
//           hasNextPage: page * limit < total,
//           hasPrevPage: page > 1
//         });
//         return;
//       }

//       const total = await Booking.countDocuments(bookingQuery);

//       let appointments = await Booking.find(bookingQuery)
//         .sort({ createdAt: -1, _id: -1 })
//         .skip((page - 1) * limit)
//         .limit(limit)
//         .populate({ path: 'package' })
//         .populate({ path: 'patient', model: 'PatientProfile' })
//         .populate({
//           path: 'therapist',
//           model: 'TherapistProfile',
//           select: "therapistId",
//           populate: { path: 'userId', model: 'User', select: 'name' }
//         })
//         .populate({ path: 'therapy', model: 'TherapyType' })
//         .populate({ path: 'payment' })
//         .lean();

//       const therapistIds = [];
//       appointments.forEach((appointment) => {
//         if (Array.isArray(appointment.sessions)) {
//           appointment.sessions.forEach((session) => {
//             if (session.therapist) therapistIds.push(session.therapist);
//           });
//         }
//       });
//       const uniqueTherapistIds = [...new Set(therapistIds.map(id => id?.toString()).filter(Boolean))];
//       const therapists = await TherapistProfile.find({ _id: { $in: uniqueTherapistIds } })
//         .populate({ path: 'userId', model: 'User', select: 'name' })
//         .select('userId name therapistId')
//         .lean();
//       const therapistMap = {};
//       therapists.forEach(t => { therapistMap[String(t._id)] = t; });

//       for (const appointment of appointments) {
//         if (Array.isArray(appointment.sessions)) {
//           appointment.sessions = appointment.sessions.map((session) => {
//             const sessionCopy = { ...session };
//             if (session.therapist && therapistMap[session.therapist?.toString()]) {
//               sessionCopy.therapist = therapistMap[session.therapist?.toString()];
//             }
//             return sessionCopy;
//           });
//         }
//       }

//       const appointmentIds = appointments.map(a => a._id);
//       const sessionEditRequests = await SessionEditRequest.find({ appointmentId: { $in: appointmentIds } }).lean();
//       const editRequestsByAppointment = {};
//       sessionEditRequests.forEach(er => {
//         const apptId = er.appointmentId?.toString?.() || er.appointmentId;
//         if (!editRequestsByAppointment[apptId]) editRequestsByAppointment[apptId] = [];
//         editRequestsByAppointment[apptId].push(er);
//       });
//       for (const appointment of appointments) {
//         const apptId = appointment._id?.toString?.() || appointment._id;
//         appointment.editRequests = editRequestsByAppointment[apptId] || [];
//       }

//       res.json({
//         success: true,
//         data: appointments,
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//         hasNextPage: page * limit < total,
//         hasPrevPage: page > 1
//       });

//     } catch (err) {
//       console.error("[getAllAppointments] error:", err);
//       res.status(500).json({ success: false, error: err.message || String(err) });
//     }
//   }

//   async getProfileDetails(req, res) {
//     try {
//       const parentId = req.user.id;
//       if (!parentId) {
//         return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
//       }

//       const parent = await User.findById(parentId).lean();
//       if (!parent) {
//         return res.status(404).json({ success: false, message: "Parent profile not found." });
//       }

//       const childrens = await PatientProfile.find({ userId: parentId }).lean();

//       res.json({ success: true, data: { parent, childrens } });
//     } catch (err) {
//       res.status(500).json({ success: false, error: err.message || String(err) });
//     }
//   }

//   async getRequestAppointmentHomePage(req, res) {
//     try {
//       const parentId = req.user.id;

//       let {
//         patientPage = 1,
//         patientLimit = 25,
//         patientSearch = ""
//       } = req.query;
//       patientPage = Math.max(parseInt(patientPage) || 1, 1);
//       patientLimit = Math.max(parseInt(patientLimit) || 25, 1);
//       patientSearch = (patientSearch || "").trim();

//       const patientQuery = { userId: parentId };
//       if (patientSearch) {
//         patientQuery.$or = [
//           { name: { $regex: patientSearch, $options: "i" } },
//           { patientId: { $regex: patientSearch, $options: "i" } },
//           { mobile1: { $regex: patientSearch, $options: "i" } }
//         ];
//       }

//       const totalPatients = await PatientProfile.countDocuments(patientQuery);

//       const patientProfiles = await PatientProfile.find(
//         patientQuery,
//         "name userId patientId mobile1"
//       )
//         .populate({ path: "userId", select: "name" })
//         .skip((patientPage - 1) * patientLimit)
//         .limit(patientLimit)
//         .lean();

//       const patients = (patientProfiles || []).map((profile) => ({
//         id: profile._id,
//         patientId: profile.patientId,
//         name: profile.name || "",
//         phoneNo: profile.mobile1 || "",
//       }));

//       let {
//         therapyPage = 1,
//         therapyLimit = 100,
//         therapySearch = ""
//       } = req.query;
//       therapyPage = Math.max(parseInt(therapyPage) || 1, 1);
//       therapyLimit = Math.max(parseInt(therapyLimit) || 100, 1);
//       therapySearch = (therapySearch || "").trim();

//       const therapyQuery = therapySearch
//         ? { name: { $regex: therapySearch, $options: "i" } }
//         : {};

//       const totalTherapy = await TherapyType.countDocuments(therapyQuery);
//       const therapyTypes = await TherapyType.find(therapyQuery)
//         .skip((therapyPage - 1) * therapyLimit)
//         .limit(therapyLimit)
//         .lean();

//       let {
//         packagePage = 1,
//         packageLimit = 100,
//         packageSearch = ""
//       } = req.query;
//       packagePage = Math.max(parseInt(packagePage) || 1, 1);
//       packageLimit = Math.max(parseInt(packageLimit) || 100, 1);
//       packageSearch = (packageSearch || "").trim();

//       const packageQuery = packageSearch
//         ? {
//             $or: [
//               { name: { $regex: packageSearch, $options: "i" } },
//               { packageId: { $regex: packageSearch, $options: "i" } }
//             ]
//           }
//         : {};

//       const totalPackages = await Package.countDocuments(packageQuery);
//       const packages = await Package.find(packageQuery)
//         .skip((packagePage - 1) * packageLimit)
//         .limit(packageLimit)
//         .lean();

//       let {
//         therapistPage = 1,
//         therapistLimit = 50,
//         therapistSearch = ""
//       } = req.query;
//       therapistPage = Math.max(parseInt(therapistPage) || 1, 1);
//       therapistLimit = Math.max(parseInt(therapistLimit) || 50, 1);
//       therapistSearch = (therapistSearch || "").trim();

//       const therapistLookupPipeline = [
//         {
//           $lookup: {
//             from: "users",
//             localField: "userId",
//             foreignField: "_id",
//             as: "user"
//           }
//         },
//         { $unwind: "$user" },
//         { $match: { "user.status": "active" } },
//       ];
//       if (therapistSearch) {
//         therapistLookupPipeline.push({
//           $match: {
//             $or: [
//               { "user.name": { $regex: therapistSearch, $options: "i" } },
//               { therapistId: { $regex: therapistSearch, $options: "i" } }
//             ]
//           }
//         });
//       }
//       therapistLookupPipeline.push({
//         $project: {
//           _id: 1,
//           therapistId: 1,
//           name: "$user.name",
//           holidays: 1,
//           mobile1: 1
//         }
//       });

//       const totalTherapistsAgg = [...therapistLookupPipeline, { $count: "total" }];
//       const therapistAggPaginated = [
//         ...therapistLookupPipeline,
//         { $skip: (therapistPage - 1) * therapistLimit },
//         { $limit: therapistLimit }
//       ];

//       const TherapistProfileModel = (await import("../../Schema/user.schema.js")).TherapistProfile;
//       const [totalTherapistsResult, activeTherapists] = await Promise.all([
//         TherapistProfileModel.aggregate(totalTherapistsAgg),
//         TherapistProfileModel.aggregate(therapistAggPaginated)
//       ]);
//       const totalTherapists = totalTherapistsResult && totalTherapistsResult[0]?.total ? totalTherapistsResult[0].total : 0;

//       const bookingCounts = await Booking.aggregate([
//         { $unwind: "$sessions" },
//         {
//           $group: {
//             _id: { therapist: "$therapist", date: "$sessions.date" },
//             count: { $sum: 1 }
//           }
//         }
//       ]);

//       const therapistBookingMap = {};
//       bookingCounts.forEach((row) => {
//         const therapistId = row._id.therapist?.toString?.() || "";
//         const date = row._id.date;
//         if (!therapistBookingMap[therapistId]) therapistBookingMap[therapistId] = {};
//         therapistBookingMap[therapistId][date] = row.count;
//       });

//       const therapistsWithCounts = (activeTherapists || []).map((t) => {
//         const bookingsByDate = therapistBookingMap[t._id.toString()] || {};
//         return { ...t, bookingsByDate };
//       });

//       let {
//         couponPage = 1,
//         couponLimit = 50,
//         couponSearch = ""
//       } = req.query;
//       couponPage = Math.max(parseInt(couponPage) || 1, 1);
//       couponLimit = Math.max(parseInt(couponLimit) || 50, 1);
//       couponSearch = (couponSearch || "").trim();

//       const couponQuery = {
//         discountEnabled: true,
//         ...(couponSearch && {
//           $or: [
//             { couponCode: { $regex: couponSearch, $options: "i" } },
//             { description: { $regex: couponSearch, $options: "i" } }
//           ]
//         })
//       };

//       const totalCoupons = await DiscountModel.countDocuments(couponQuery);
//       const coupons = await DiscountModel.find(couponQuery)
//         .sort({ createdAt: -1 })
//         .skip((couponPage - 1) * couponLimit)
//         .limit(couponLimit)
//         .lean();

//       return res.json({
//         success: true,
//         patients,
//         patientPage,
//         patientLimit,
//         totalPatients,
//         patientTotalPages: Math.ceil(totalPatients / patientLimit),
//         hasMorePatients: patientPage * patientLimit < totalPatients,

//         therapyTypes,
//         therapyPage,
//         therapyLimit,
//         totalTherapy,
//         therapyTotalPages: Math.ceil(totalTherapy / therapyLimit),
//         hasMoreTherapy: therapyPage * therapyLimit < totalTherapy,

//         packages,
//         packagePage,
//         packageLimit,
//         totalPackages,
//         packageTotalPages: Math.ceil(totalPackages / packageLimit),
//         hasMorePackages: packagePage * packageLimit < totalPackages,

//         therapists: activeTherapists,
//         therapistsWithCounts,
//         therapistPage,
//         therapistLimit,
//         totalTherapists,
//         therapistTotalPages: Math.ceil(totalTherapists / therapistLimit),
//         hasMoreTherapists: therapistPage * therapistLimit < totalTherapists,

//         coupons,
//         couponPage,
//         couponLimit,
//         totalCoupons,
//         couponTotalPages: Math.ceil(totalCoupons / couponLimit),
//         hasMoreCoupons: couponPage * couponLimit < totalCoupons
//       });

//     } catch (error) {
//       console.error(error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to fetch booking page details.",
//         error: error.message,
//       });
//     }
//   }

//   async createBookingRequest(req, res) {
//     const mongoose = (await import('mongoose')).default;
//     const session = await mongoose.startSession();

//     try {
//       session.startTransaction();

//       const {
//         package: packageId,
//         patient: patientId,
//         therapy: therapyId,
//         sessions
//       } = req.body;

//       console.log("[CREATE BOOKING REQUEST] Incoming body:", req.body);

//       if (
//         !packageId ||
//         !patientId ||
//         !therapyId ||
//         !Array.isArray(sessions) ||
//         !sessions.length
//       ) {
//         console.log("[CREATE BOOKING REQUEST] Missing required fields", {
//           packageId, patientId, therapyId, sessions
//         });
//         return res.status(400).json({
//           success: false,
//           message: "Missing required fields"
//         });
//       }

//       const pkg = await Package.findById(packageId).lean();
//       if (!pkg) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid package"
//         });
//       }

//       const counter = await counterSchema.findOneAndUpdate(
//         { name: "request" },
//         { $inc: { seq: 1 } },
//         { new: true, upsert: true, session }
//       );
//       const requestId = `REQ-${String(counter.seq).padStart(5, '0')}`;
//       console.log("[CREATE BOOKING REQUEST] Generated requestId:", requestId);

//       const bookingRequestPayload = {
//         requestId,
//         package: packageId,
//         patient: patientId,
//         sessions,
//         therapy: therapyId
//       };
//       Object.keys(bookingRequestPayload).forEach(
//         k => bookingRequestPayload[k] === undefined && delete bookingRequestPayload[k]
//       );

//       const bookingRequest = new BookingRequests(bookingRequestPayload);
//       await bookingRequest.save({ session });
//       console.log("[CREATE BOOKING REQUEST] BookingRequest saved. _id:", bookingRequest._id);

//       try {
//         await AuditLogService.addLog(
//           {
//             action: "CREATE_BOOKING_REQUEST",
//             user: req.user?.id,
//             role: req.user?.role === "patient" ? "parent" : req.user?.role,
//             resource: "BookingRequest",
//             resourceId: bookingRequest._id,
//             details: {
//               bookingRequest: {
//                 requestId,
//                 packageId,
//                 patientId,
//                 therapyId,
//                 sessionCount: Array.isArray(sessions) ? sessions.length : 0
//               },
//               message: `Booking request created by userId=${req.user?.id || "?"}, patientId=${patientId}, packageId=${packageId}, therapyId=${therapyId}`
//             },
//             ipAddress: req.ip,
//             userAgent: req.headers["user-agent"]
//           },
//           { session }
//         );
//       } catch (auditErr) {
//         await session.abortTransaction();
//         session.endSession();
//         console.error("[CREATE BOOKING REQUEST] Audit log failed, reverted booking request:", auditErr);
//         return res.status(500).json({
//           success: false,
//           message: "Failed to create booking request. Audit log not created, request reverted.",
//           error: auditErr.message,
//         });
//       }

//       await session.commitTransaction();
//       session.endSession();

//       const populatedRequest = await BookingRequests.findById(bookingRequest._id)
//         .populate("package")
//         .populate({
//           path: "patient",
//           model: "PatientProfile",
//           populate: { path: "userId", model: "User" }
//         })
//         .populate({ path: "therapy", model: "TherapyType" });

//       res.status(201).json({
//         success: true,
//         bookingRequest: populatedRequest
//       });
//     } catch (error) {
//       try {
//         await session.abortTransaction();
//       } catch (abortErr) {}
//       session.endSession();
//       console.error("[CREATE BOOKING REQUEST] Error encountered:", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to create booking request.",
//         error: error.message,
//       });
//     }
//   }

//   // INSERT_YOUR_CODE

//   async getAllBookingRequests(req, res) {
//     try {
//       const parentUserId = req.user?.id;

//       let page = Number(req.query.page) || 1;
//       let limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 100));
//       const skip = (page - 1) * limit;

//       const search = (req.query.search || "").trim();
//       let filter = {};

//       if (parentUserId) {
//         const user = await User.findById(parentUserId).lean();
//         if (!user) {
//           return res.status(404).json({ success: false, message: "User not found" });
//         }
//         const myPatients = await PatientProfile.find({ userId: user._id }, '_id').lean();
//         const myPatientIds = myPatients.map(p => p._id);

//         if (myPatientIds.length > 0) {
//           filter.Children = { $in: myPatientIds };
//         } else {
//           return res.json({ success: true, bookingRequests: [], total: 0, page, totalPages: 1 });
//         }
//       }

//       const aggregatePipeline = [
//         { $match: filter },
//         {
//           $lookup: {
//             from: "patientprofiles",
//             localField: "patient",
//             foreignField: "_id",
//             as: "patient",
//           }
//         },
//         { $unwind: "$patient" },
//         {
//           $lookup: {
//             from: "users",
//             localField: "patient.userId",
//             foreignField: "_id",
//             as: "patient.userObj",
//           }
//         },
//         {
//           $addFields: {
//             "patient.user": { $arrayElemAt: ["$patient.userObj", 0] }
//           }
//         },
//         {
//           $lookup: {
//             from: "therapytypes",
//             localField: "therapy",
//             foreignField: "_id",
//             as: "therapy",
//           }
//         },
//         { $unwind: { path: "$therapy", preserveNullAndEmptyArrays: true } },
//         {
//           $lookup: {
//             from: "packages",
//             localField: "package",
//             foreignField: "_id",
//             as: "package",
//           }
//         },
//         { $unwind: { path: "$package", preserveNullAndEmptyArrays: true } },
//       ];

//       if (search) {
//         const regex = new RegExp(search, "i");
//         aggregatePipeline.push({
//           $match: {
//             $or: [
//               { "patient.name": regex },
//               { "patient.patientId": regex },
//               { "patient.user.name": regex },
//               { "therapy.name": regex },
//               { "package.name": regex },
//               { "requestId": regex },
//               { "appointmentId": regex }
//             ]
//           }
//         });
//       }

//       const countPipeline = [...aggregatePipeline, { $count: "total" }];
//       const countResult = await BookingRequests.aggregate(countPipeline).allowDiskUse(true);
//       const total = countResult[0]?.total || 0;
//       const totalPages = Math.max(1, Math.ceil(total / limit));
//       if (page > totalPages) page = totalPages;
//       const newSkip = (page - 1) * limit;

//       aggregatePipeline.push({ $sort: { createdAt: -1 } });
//       aggregatePipeline.push({ $skip: newSkip });
//       aggregatePipeline.push({ $limit: limit });

//       aggregatePipeline.push({
//         $project: { "patient.userObj": 0 }
//       });

//       const requests = await BookingRequests.aggregate(aggregatePipeline).allowDiskUse(true);

//       res.json({
//         success: true,
//         bookingRequests: requests,
//         total,
//         page,
//         totalPages,
//         limit,
//         hasNextPage: page < totalPages,
//         hasPrevPage: page > 1
//       });

//     } catch (error) {
//       console.error("[GET ALL BOOKING REQUESTS] (search/pagination)", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to fetch booking requests.",
//         error: error.message
//       });
//     }
//   }

//   async getBookingRequestById(req, res) {
//     try {
//       const { id } = req.params;
//       if (!id) {
//         return res.status(400).json({ success: false, message: "Booking request ID required" });
//       }
//       const bookingRequest = await BookingRequests.findById(id)
//         .populate("package")
//         .populate({
//           path: "patient",
//           model: "PatientProfile",
//           populate: { path: "userId", model: "User" }
//         })
//         .populate({ path: "therapy", model: "Therapy" });

//       if (!bookingRequest) {
//         return res.status(404).json({ success: false, message: "Booking request not found" });
//       }

//       res.json({ success: true, bookingRequest });
//     } catch (error) {
//       console.error("[GET BOOKING REQUEST BY ID]", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to fetch booking request.",
//         error: error.message,
//       });
//     }
//   }

//   async updateBookingRequest(req, res) {
//     const mongoose = (await import('mongoose')).default;
//     const session = await mongoose.startSession();

//     try {
//       session.startTransaction();

//       const { id } = req.params;
//       if (!id) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({ success: false, message: "Booking request ID required" });
//       }

//       const updateFields = {};
//       if (req.body.package) updateFields.package = req.body.package;
//       if (req.body.patient) updateFields.Children = req.body.patient;
//       if (req.body.sessions) updateFields.sessions = req.body.sessions;
//       if (req.body.therapy) updateFields.therapy = req.body.therapy;

//       if (Object.keys(updateFields).length === 0) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({ success: false, message: "No fields provided for update" });
//       }

//       const bookingRequestBefore = await BookingRequests.findById(id).lean();

//       // INSERT_YOUR_CODE
//       if (bookingRequestBefore && bookingRequestBefore.status === 'approved') {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({
//           success: false,
//           message: "Cannot update booking request: already approved."
//         });
//       }

//       const bookingRequest = await BookingRequests.findByIdAndUpdate(
//         id,
//         { $set: updateFields },
//         { new: true, session }
//       )
//         .populate("package")
//         .populate({
//           path: "patient",
//           model: "PatientProfile",
//           populate: { path: "userId", model: "User" }
//         })
//         .populate({ path: "therapy", model: "TherapyType" });

//       if (!bookingRequest) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(404).json({ success: false, message: "Booking request not found" });
//       }

//       try {
//         await AuditLogService.addLog(
//           {
//             action: "UPDATE_BOOKING_REQUEST",
//             user: req.user?.id,
//             role: req.user?.role === "patient" ? "parent" : req.user?.role,
//             resource: "BookingRequest",
//             resourceId: bookingRequest._id,
//             details: {
//               before: bookingRequestBefore,
//               after: bookingRequest,
//               updateFields,
//               message: `Booking request updated by userId=${req.user?.id || "?"}, patientId=${updateFields.Children || (bookingRequestBefore ? bookingRequestBefore.Children : undefined)}`,
//             },
//             ipAddress: req.ip,
//             userAgent: req.headers["user-agent"]
//           },
//           { session }
//         );
//       } catch (auditErr) {
//         await session.abortTransaction();
//         session.endSession();
//         console.error("[UPDATE BOOKING REQUEST] Audit log failed, reverted update:", auditErr);
//         return res.status(500).json({
//           success: false,
//           message: "Failed to update booking request. Audit log not created, update reverted.",
//           error: auditErr.message,
//         });
//       }

//       await session.commitTransaction();
//       session.endSession();

//       res.json({ success: true, bookingRequest });
//     } catch (error) {
//       try {
//         await session.abortTransaction();
//       } catch (abortErr) {}
//       session.endSession();
//       console.error("[UPDATE BOOKING REQUEST]", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to update booking request.",
//         error: error.message
//       });
//     }
//   }

//   async deleteBookingRequest(req, res) {
//     const mongoose = (await import('mongoose')).default;
//     const session = await mongoose.startSession();
//     session.startTransaction();

//     try {
//       const { id } = req.params;
//       if (!id) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({ success: false, message: "Booking request ID required" });
//       }

//       const bookingRequest = await BookingRequests.findById(id).session(session);
//       if (!bookingRequest) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(404).json({ success: false, message: "Booking request not found" });
//       }

//       if (bookingRequest.status === "approved") {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({
//           success: false,
//           message: "Cannot delete an approved booking request."
//         });
//       }

//       try {
//         await AuditLogService.addLog(
//           {
//             action: "DELETE_BOOKING_REQUEST",
//             user: req.user?.id,
//             role: req.user?.role === "patient" ? "parent" : req.user?.role,
//             resource: "BookingRequest",
//             resourceId: bookingRequest._id,
//             details: {
//               deletedBookingRequest: bookingRequest.toObject ? bookingRequest.toObject() : bookingRequest,
//               message: `Booking request deleted by userId=${req.user?.id || "?"}, patientId=${bookingRequest.patient}, packageId=${bookingRequest.package}, therapyId=${bookingRequest.therapy}`,
//             },
//             ipAddress: req.ip,
//             userAgent: req.headers["user-agent"]
//           },
//           { session }
//         );
//       } catch (auditErr) {
//         await session.abortTransaction();
//         session.endSession();
//         console.error("[DELETE BOOKING REQUEST] Audit log failed, reverted delete:", auditErr);
//         return res.status(500).json({
//           success: false,
//           message: "Failed to delete booking request. Audit log not created, deletion reverted.",
//           error: auditErr.message
//         });
//       }

//       await BookingRequests.findByIdAndDelete(id, { session });

//       await session.commitTransaction();
//       session.endSession();

//       res.json({ success: true, message: "Booking request deleted successfully" });
//     } catch (error) {
//       await session.abortTransaction();
//       session.endSession();
//       console.error("[DELETE BOOKING REQUEST]", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to delete booking request.",
//         error: error.message
//       });
//     }
//   }

//   async generateSessionEditRequestId() {
//     const counterDoc = await counterSchema.findOneAndUpdate(
//       { name: "session-edit-request" },
//       { $inc: { seq: 1 } },
//       { new: true, upsert: true }
//     );
//     const seqNum = counterDoc.seq;
//     return `SER${seqNum.toString().padStart(5, "0")}`;
//   }

//   async createSessionEditRequest(req, res) {
//     const mongoose = (await import('mongoose')).default;
//     const session = await mongoose.startSession();
//     try {
//       session.startTransaction();
//       const { appointmentId, patientId, sessions } = req.body;

//       if (
//         !appointmentId ||
//         !patientId ||
//         !Array.isArray(sessions) ||
//         sessions.length === 0 ||
//         !sessions.every(s => s.sessionId && s.newDate && s.newSlotId)
//       ) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({
//           success: false,
//           message:
//             "Missing required fields. appointmentId, childrenId, and sessions (with sessionId, newDate, newSlotId) are required.",
//         });
//       }

//       const existingPendingRequest = await SessionEditRequest.findOne({
//         appointmentId: appointmentId,
//         status: "pending"
//       }).session(session);

//       if (existingPendingRequest) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({
//           success: false,
//           message: "A pending session edit request for this appointment already exists.",
//           request: existingPendingRequest
//         });
//       }

//       const requestId = await this.generateSessionEditRequestId();

//       const requestPayload = {
//         appointmentId,
//         patientId,
//         sessions,
//         status: "pending",
//         requestId
//       };

//       const request = await SessionEditRequest.create([requestPayload], { session });

//       // INSERT_YOUR_CODE
//       console.log("[CREATE SESSION EDIT REQUEST] request fields:", {
//         appointmentId,
//         patientId,
//         sessions,
//         status: "pending",
//         requestId,
//         requestObject: request[0],
//         user: req.user,
//         userId: req.user?.id,
//         role: req.user?.role === "patient" ? "parent" : req.user?.role,
//         action: "CREATE_SESSION_EDIT_REQUEST",
//         resource: "SessionEditRequest",
//         resourceId: request[0]?._id,
//         details: {
//           requestId,
//           appointmentId,
//           patientId,
//           sessionCount: Array.isArray(sessions) ? sessions.length : 0,
//           message: `Session edit request created by userId=${req.user?.id || "?"}, patientId=${patientId}, appointmentId=${appointmentId}.`
//         },
//         ipAddress: req.ip,
//         userAgent: req.headers["user-agent"]
//       });

//       try {
//         await AuditLogService.addLog(
//           {
//             action: "CREATE_SESSION_EDIT_REQUEST",
//             user: req.user?.id,
//             role: req.user?.role === "patient" ? "parent" : req.user?.role,
//             resource: "SessionEditRequest",
//             resourceId: request[0]._id,
//             details: {
//               requestId,
//               appointmentId,
//               patientId,
//               sessionCount: Array.isArray(sessions) ? sessions.length : 0,
//               message: `Session edit request created by userId=${req.user?.id || "?"}, patientId=${patientId}, appointmentId=${appointmentId}.`
//             },
//             ipAddress: req.ip,
//             userAgent: req.headers["user-agent"]
//           },
//           { session }
//         );
//       } catch (auditErr) {
//         await session.abortTransaction();
//         session.endSession();
//         console.error("[CREATE SESSION EDIT REQUEST] Audit log failed, reverted creation:", auditErr);
//         return res.status(500).json({
//           success: false,
//           message: "Failed to create session edit request. Audit log not created, request reverted.",
//           error: auditErr.message,
//         });
//       }

//       await session.commitTransaction();
//       session.endSession();

//       res.status(201).json({ success: true, request: request[0] });
//     } catch (error) {
//       try {
//         await session.abortTransaction();
//       } catch (abortErr) {}
//       session.endSession();
//       console.error("[CREATE SESSION EDIT REQUEST]", error);
//       res.status(500).json({ success: false, message: "Failed to create session edit request", error: error.message });
//     }
//   }

//   async updateSessionEditRequest(req, res) {
//     const mongoose = (await import('mongoose')).default;
//     const session = await mongoose.startSession();
//     try {
//       session.startTransaction();

//       const { id } = req.params;
//       if (!id) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({ success: false, message: "Request ID required" });
//       }

//       const updates = {};
//       if (req.body.sessions && Array.isArray(req.body.sessions)) {
//         updates.sessions = req.body.sessions;
//       }
//       if (req.body.status !== undefined) {
//         updates.status = req.body.status;
//       }

//       if (Object.keys(updates).length === 0) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({ success: false, message: "No valid fields provided for update" });
//       }

//       const beforeUpdate = await SessionEditRequest.findById(id).lean().session(session);

//       if (!beforeUpdate) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(404).json({ success: false, message: "Session edit request not found" });
//       }

//       const updated = await SessionEditRequest.findByIdAndUpdate(id, updates, { new: true, session });
//       if (!updated) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(404).json({ success: false, message: "Session edit request not found" });
//       }

//       try {
//         await AuditLogService.addLog(
//           {
//             action: "UPDATE_SESSION_EDIT_REQUEST",
//             user: req.user?.id,
//             role: req.user?.role === "patient" ? "parent" : req.user?.role,
//             resource: "SessionEditRequest",
//             resourceId: updated._id,
//             details: {
//               before: beforeUpdate,
//               after: updated,
//               updateFields: updates,
//               message: `Session edit request updated by userId=${req.user?.id || "?"}, appointmentId=${beforeUpdate.appointmentId}`,
//             },
//             ipAddress: req.ip,
//             userAgent: req.headers["user-agent"]
//           },
//           { session }
//         );
//       } catch (auditErr) {
//         await session.abortTransaction();
//         session.endSession();
//         console.error("[UPDATE SESSION EDIT REQUEST] Audit log failed, reverted update:", auditErr);
//         return res.status(500).json({
//           success: false,
//           message: "Failed to update session edit request. Audit log not created, update reverted.",
//           error: auditErr.message,
//         });
//       }

//       await session.commitTransaction();
//       session.endSession();

//       res.json({ success: true, request: updated });
//     } catch (error) {
//       try {
//         await session.abortTransaction();
//       } catch (abortErr) {}
//       session.endSession();
//       console.error("[UPDATE SESSION EDIT REQUEST]", error);
//       res.status(500).json({ success: false, message: "Failed to update session edit request", error: error.message });
//     }
//   }

//   async deleteSessionEditRequest(req, res) {
//     const mongoose = (await import('mongoose')).default;
//     const session = await mongoose.startSession();
//     try {
//       session.startTransaction();
//       const { id } = req.params;
//       if (!id) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({ success: false, message: "Request ID required" });
//       }

//       const toDelete = await SessionEditRequest.findById(id).session(session);
//       if (!toDelete) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(404).json({ success: false, message: "Session edit request not found" });
//       }

//       try {
//         await AuditLogService.addLog(
//           {
//             action: "DELETE_SESSION_EDIT_REQUEST",
//             user: req.user?.id,
//             role: req.user?.role === "patient" ? "parent" : req.user?.role,
//             resource: "SessionEditRequest",
//             resourceId: toDelete._id,
//             details: {
//               deleted: toDelete,
//               message: `Session edit request deleted by userId=${req.user?.id || "?"}, appointmentId=${toDelete.appointmentId}`,
//             },
//             ipAddress: req.ip,
//             userAgent: req.headers["user-agent"]
//           },
//           { session }
//         );
//       } catch (auditErr) {
//         await session.abortTransaction();
//         session.endSession();
//         console.error("[DELETE SESSION EDIT REQUEST] Audit log failed, reverted delete:", auditErr);
//         return res.status(500).json({
//           success: false,
//           message: "Failed to delete session edit request. Audit log not created, deletion reverted.",
//           error: auditErr.message
//         });
//       }

//       await SessionEditRequest.findByIdAndDelete(id, { session });

//       await session.commitTransaction();
//       session.endSession();

//       res.json({ success: true, message: "Session edit request deleted successfully" });
//     } catch (error) {
//       try {
//         await session.abortTransaction();
//       } catch (abortErr) {}
//       session.endSession();
//       console.error("[DELETE SESSION EDIT REQUEST]", error);
//       res.status(500).json({ success: false, message: "Failed to delete session edit request", error: error.message });
//     }
//   }

//   async getSessionEditRequests(req, res) {
//     try {
//       const { appointmentId, status } = req.query;
//       const query = {};
//       if (appointmentId) query.appointmentId = appointmentId;
//       if (status) query.status = status;

//       const requests = await SessionEditRequest.find(query)
//         .populate("appointmentId");

//       res.json({ success: true, requests });
//     } catch (error) {
//       console.error("[FETCH SESSION EDIT REQUESTS]", error);
//       res.status(500).json({ success: false, message: "Failed to fetch session edit requests", error: error.message });
//     }
//   }

//   async allBookings(req, res) {
//     try {
//       const bookings = await Booking.find()
//         .populate("package")
//         .populate({
//           path: "patient",
//           model: "PatientProfile",
//           populate: { path: "userId", model: "User" }
//         })
//         .populate({ path: "therapy", model: "TherapyType" })
//         .populate({
//           path: "therapist",
//           model: "TherapistProfile",
//           populate: { path: "userId", model: "User" }
//         })
//         .populate({ path: "discountInfo.coupon", model: "Discount" });
//       res.json({ success: true, bookings });
//     } catch (error) {
//       console.error(error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to fetch bookings.",
//         error: error.message,
//       });
//     }
//   }

//   async getInvoiceAndPayment(req, res) {
//     try {
//       const userId = req.user.id;

//       const search = (req.query.search || "").trim();
//       const page = Math.max(1, parseInt(req.query.page, 10) || 1);
//       const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 10, 100));

//       const user = await User.findById(userId);
//       if (!user) {
//         return res.status(404).json({
//           success: false,
//           message: "User not found.",
//         });
//       }

//       const patientProfiles = await PatientProfile.find({ userId });
//       if (!patientProfiles || patientProfiles.length === 0) {
//         return res.status(404).json({
//           success: false,
//           message: "No Children profiles found for this user.",
//         });
//       }
//       const patientProfileIds = patientProfiles.map((p) => p._id);

//       let bookingQuery = { patient: { $in: patientProfileIds } };
//       if (search.length > 0) {
//         bookingQuery = {
//           ...bookingQuery,
//           $or: [
//             { 'patientNameForSearch': { $regex: search, $options: "i" } },
//           ]
//         };
//       }

//       const totalCount = await Booking.countDocuments({ patient: { $in: patientProfileIds } });

//       const skip = (page - 1) * limit;

//       let bookings = await Booking.find({ patient: { $in: patientProfileIds } })
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(limit)
//         .populate("package")
//         .populate({
//           path: "patient",
//           model: "PatientProfile",
//           populate: { path: "userId", model: "User" },
//         })
//         .populate({ path: "therapy", model: "TherapyType" })
//         .populate({
//           path: "therapist",
//           model: "TherapistProfile",
//           populate: { path: "userId", model: "User" }
//         })
//         .populate({ path: "discountInfo.coupon", model: "Discount" })
//         .populate({ path: "payment", model: "Payment" });

//       if (search.length > 0) {
//         const searchLower = search.toLowerCase();
//         bookings = bookings.filter(b => {
//           let found = false;
//           if (b.patient?.name && b.patient.name.toLowerCase().includes(searchLower)) {
//             found = true;
//           }
//           if (!found && b.patient?.patientId && (b.patient.patientId + "").toLowerCase().includes(searchLower)) {
//             found = true;
//           }
//           if (!found && b.payment) {
//             let payments = Array.isArray(b.payment) ? b.payment : [b.payment];
//             for (let pay of payments) {
//               if (!pay) continue;
//               if (pay.paymentId && (pay.paymentId + "").toLowerCase().includes(searchLower)) {
//                 found = true;
//                 break;
//               }
//             }
//           }
//           return found;
//         });
//       }

//       // Payment details — response keys use "children" terminology
//       const paymentDetails = [];
//       for (const booking of bookings) {
//         let payments = [];
//         if (Array.isArray(booking.payment)) {
//           payments = booking.payment;
//         } else if (booking.payment) {
//           payments = [booking.payment];
//         }
//         for (const pay of payments) {
//           if (!pay) continue;
//           let invoiceId = pay.paymentId ? pay.paymentId.toString() : "";
//           let date = pay.createdAt || pay.date || booking.createdAt;
//           let childrenName = "";
//           if (
//             booking.Children &&
//             booking.patient.userId &&
//             booking.patient.userId.name
//           ) {
//             childrenName = booking.patient.name;
//           } else if (booking.Children && booking.patient.name) {
//             childrenName = booking.patient.name;
//           }
//           let childrenId = booking.Children ? booking.patient.patientId : undefined;
//           if (!childrenName && user && user.name) childrenName = user.name;

//           paymentDetails.push({
//             InvoiceId: invoiceId,
//             date: date,
//             childrenName: childrenName,
//             childrenId,
//             amount: pay.amount || booking.totalAmount || 0,
//             status: pay.status || "Unknown",
//           });
//         }
//       }

//       res.json({
//         success: true,
//         payments: paymentDetails,
//         total: search.length > 0 ? paymentDetails.length : totalCount,
//         page,
//         limit,
//       });

//     } catch (error) {
//       console.error("[GET INVOICE AND PAYMENT]", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to fetch invoice and payment details.",
//         error: error.message,
//       });
//     }
//   }

//   async raiseTicket(req, res) {
//     try {
//       const id = req.user.id;

//       // INSERT_YOUR_CODE
//       const user = await User.findById(id);

//       if (!user || user.role !== "patient") {
//         return res.status(401).json({
//           success: false,
//           message: "Unauthorized. Only parents can raise tickets.",
//         });
//       }

//       const { subject, description, priority, tags } = req.body;

//       if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
//         return res.status(400).json({
//           success: false,
//           message: "Subject is required.",
//         });
//       }
//       if (!description || typeof description !== "string" || description.trim().length === 0) {
//         return res.status(400).json({
//           success: false,
//           message: "Description is required.",
//         });
//       }

//       const raisedById = user._id || user.patientId;
//       if (!raisedById) {
//         return res.status(400).json({
//           success: false,
//           message: "Parent user ID not found in authentication. Please log in again.",
//         });
//       }

//       const ticketData = {
//         raisedByRole: "parent",
//         raisedById,
//         subject: subject.trim(),
//         description: description.trim(),
//         priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
//         tags: Array.isArray(tags)
//           ? tags.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
//           : [],
//       };

//       const ticket = new TicketModel(ticketData);
//       await ticket.save();

//       res.json({
//         success: true,
//         ticket,
//         message: "Ticket raised successfully.",
//       });
//     } catch (error) {
//       if (error.name === "ValidationError") {
//         return res.status(400).json({
//           success: false,
//           message: "Validation failed when creating ticket.",
//           error: error.message,
//         });
//       }
//       console.error("[RAISE TICKET]", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to raise ticket.",
//         error: error.message,
//       });
//     }
//   }

// // INSERT_YOUR_CODE
//   async getAllPatientTickets(req, res) {
//     try {
//       const id = req.user.id;

//       // INSERT_YOUR_CODE
//       const user = await User.findById(id);

//       if (!user || user.role !== "patient") {
//         return res.status(401).json({
//           success: false,
//           message: "Unauthorized. Parent authentication required.",
//         });
//       }

//       const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
//       const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 20;
//       const skip = (page - 1) * limit;

//       const query = {
//         raisedByRole: "parent",
//         raisedById: user._id,
//       };

//       const [tickets, total] = await Promise.all([
//         TicketModel.find(query)
//           .sort({ createdAt: -1 })
//           .skip(skip)
//           .limit(limit)
//           .lean(),
//         TicketModel.countDocuments(query),
//       ]);

//       res.json({
//         success: true,
//         tickets,
//         page,
//         limit,
//         total,
//       });

//     } catch (error) {
//       console.error("[GET ALL PARENT TICKETS]", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to fetch parent tickets.",
//         error: error.message,
//       });
//     }
//   }
// // INSERT_YOUR_CODE

//   async createConsultationBooking(req, res) {
//     try {
//       const clientId = req.user.id;
//       const {
//         patient,
//         therapyType,
//         scheduledAt,
//         time,
//         sessionType,
//         reason
//       } = req.body;

//       console.log(req.body)

//       const durationMinutes = 15;

//       if (!therapyType || !scheduledAt || !sessionType) {
//         return res.status(400).json({
//           success: false,
//           message: "therapyType, scheduledAt, and sessionType are required."
//         });
//       }

//       let seqDoc = await counterSchema.findOneAndUpdate(
//         { name: "consultationAppointmentId" },
//         { $inc: { seq: 1 } },
//         { new: true, upsert: true }
//       );
//       const year = new Date().getFullYear();
//       const seqStr = String(seqDoc.seq).padStart(5, '0');
//       const consultationAppointmentId = `C-${year}-${seqStr}`;

//       const booking = await ConsultationBooking.create({
//         consultationAppointmentId,
//         client: patient,
//         therapy: therapyType,
//         scheduledAt,
//         time: time || undefined,
//         durationMinutes: durationMinutes ? +durationMinutes : 15,
//         sessionType,
//         status: "pending",
//         remark: reason
//       });

//       return res.status(201).json({
//         success: true,
//         booking
//       });
//     } catch (error) {
//       console.error("[CREATE CONSULTATION BOOKING]", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to create consultation booking.",
//         error: error.message
//       });
//     }
//   }

//   async getConsultationBookings(req, res) {
//     try {
//       const parentId = req.user.id;
//       if (!parentId) {
//         return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
//       }

//       const children = await PatientProfile.find({ userId: parentId }).lean();
//       const childIds = children.map(child => child._id);

//       const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
//       const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 20;
//       const skip = (page - 1) * limit;

//       const query = { client: { $in: childIds } };

//       const [bookings, total] = await Promise.all([
//         ConsultationBooking.find(query)
//           .sort({ scheduledAt: -1 })
//           .skip(skip)
//           .limit(limit)
//           .populate({
//             path: "client",
//             model: "PatientProfile",
//             select: "patientId name",
//             populate: { path: "userId", model: "User", select: "name" }
//           })
//           .populate({
//             path: "consultant",
//             model: "TherapistProfile",
//             select: "therapistId",
//             populate: { path: "userId", model: "User", select: "name" }
//           })
//           .populate({ path: "therapy", model: "TherapyType", select: "name" })
//           .lean(),
//         ConsultationBooking.countDocuments(query)
//       ]);

//       res.json({
//         success: true,
//         bookings,
//         total,
//         page,
//         limit
//       });
//     } catch (error) {
//       console.error("[GET CONSULTATION BOOKINGS]", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to retrieve consultation bookings.",
//         error: error.message
//       });
//     }
//   }

//   async updateConsultationBooking(req, res) {
//     try {
//       const parentId = req.user.id;
//       const bookingId = req.params.id;
//       const { status, scheduledAt, time, reason, therapyType, sessionType } = req.body;

//       if (!bookingId) {
//         return res.status(400).json({ success: false, message: "Booking ID is required." });
//       }

//       if (status && !['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
//         return res.status(400).json({ success: false, message: "Invalid status value." });
//       }

//       const parentUser = await User.findById(parentId).lean();
//       if (!parentUser) {
//         return res.status(401).json({ success: false, message: "Unauthorized: parent not found." });
//       }
//       const children = await PatientProfile.find({ userId: parentUser._id }).lean();
//       const childIds = children.map(child => child._id);

//       const booking = await ConsultationBooking.findOne({ _id: bookingId, client: { $in: childIds } });
//       if (!booking) {
//         return res.status(404).json({
//           success: false,
//           message: "Consultation booking not found or access denied."
//         });
//       }

//       if (typeof status !== "undefined") booking.status = status;
//       if (typeof scheduledAt !== "undefined" && scheduledAt) booking.scheduledAt = scheduledAt;
//       if (typeof time !== "undefined") booking.time = time;
//       if (typeof reason !== "undefined") booking.remark = reason;
//       if (typeof therapyType !== "undefined" && therapyType) booking.therapy = therapyType;
//       if (typeof sessionType !== "undefined" && sessionType) booking.sessionType = sessionType;

//       await booking.save();

//       res.json({ success: true, booking });
//     } catch (error) {
//       console.error("[UPDATE CONSULTATION BOOKING]", error);
//       res.status(500).json({
//         success: false,
//         message: "Failed to update consultation booking.",
//         error: error?.message || error
//       });
//     }
//   }
// }

// export default ParentController;

import BookingRequests from '../../Schema/booking-request.schema.js';
import Booking from '../../Schema/booking.schema.js';
import ConsultationBooking from '../../Schema/consultation-booking.schema.js';
import counterSchema from '../../Schema/counter.schema.js';
import DiscountModel from '../../Schema/discount.schema.js';
import Finances from '../../Schema/finances.schema.js';
import Package from '../../Schema/packages.schema.js';
import SessionEditRequest from '../../Schema/session-edit-request.schema.js';
import { TherapyType } from '../../Schema/therapy-type.schema.js';
import TicketModel from '../../Schema/ticket.schema.js';
import { PatientProfile, TherapistProfile, User } from '../../Schema/user.schema.js';
import AuditLogService from "../AuditLogs/audit-logs.controller.js";
import WhatsappController from "../Whatsapp/whatsapp.js";

class ParentController {

  async parentSignUpSendOTP(req, res) {
    const session = await User.startSession();
    session.startTransaction();
    try {
      const { email, name } = req.body;

      if (!email || typeof email !== "string") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Valid email is required." });
      }

      if (!name || typeof name !== "string") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Name is required." });
      }

      const userExists = await User.findOne({ email, role: "patient" }).session(session);
      if (userExists) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ success: false, message: "A parent with this email already exists." });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresInMs = 1000 * 300;

      const newUser = new User({
        email,
        name,
        role: "patient",
        authProvider: "otp",
        signUpOTP: otp,
        signUpOTPExpiresAt: new Date(Date.now() + expiresInMs),
        signUpOTPSentAt: new Date(),
        signUpOTPAttempts: 0,
        signUpOTPLastUsedAt: null,
        status: "active",
        isDisabled: false,
        manualSignUp: true
      });
      await newUser.save({ session });

      let sendEmailError = null;
      let sendEmailPromise = null;
      let whatsappStatus = null;

      try {
        const sendMail = (await import('../../config/nodeMailer.config.js')).default;
        sendEmailPromise = sendMail(email, "Your OTP Code", `Your OTP is: ${otp}`)
          .catch((err) => { sendEmailError = err; });
      } catch (err) {
        sendEmailError = err;
      }

      try {
        whatsappStatus = '[Skipped WhatsApp OTP - only send if phone is available]';
      } catch (waErr) {
        whatsappStatus = waErr?.message || "Failed to send OTP on WhatsApp";
        console.error("ParentSignUp OTP WhatsApp error:", waErr);
      }

      if (sendEmailPromise) await sendEmailPromise;

      if (sendEmailError) {
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({
          success: false,
          message: "Failed to send OTP to email address.",
          emailError: sendEmailError?.message || sendEmailError
        });
      }

      try {
        await AuditLogService.addLog({
          action: 'PARENT_SIGNUP_OTP_SENT',
          user: newUser._id,
          role: 'parent',
          resource: 'Parent',
          resourceId: newUser._id,
          details: {
            email,
            name,
            message: `Parent signup OTP sent to ${email}`,
            completeProfileOrigin: 'self-service',
            whatsappStatus
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      } catch (logErr) {
        console.error('Failed to write audit log (PARENT_SIGNUP_OTP_SENT) in parentSignUpSendOTP:', logErr);
      }

      await session.commitTransaction();
      session.endSession();

      return res.json({ success: true, message: "OTP sent to email address." });
    } catch (e) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error in parentSignUpSendOTP:", e);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }

  async parentSignUpVerifyOTP(req, res) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({ success: false, message: "Email and OTP are required." });
      }

      const signupUser = await User.findOne({ email, role: "patient" });

      if (!signupUser || (!signupUser.signUpOTP || !signupUser.signUpOTPExpiresAt)) {
        return res.status(400).json({ success: false, message: "No OTP request found or OTP expired." });
      }

      if (Date.now() > new Date(signupUser.signUpOTPExpiresAt).getTime()) {
        signupUser.signUpOTP = null;
        signupUser.signUpOTPExpiresAt = null;
        signupUser.signUpOTPSentAt = null;
        signupUser.signUpOTPAttempts = 0;
        signupUser.signUpOTPLastUsedAt = null;
        await signupUser.save();
        return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
      }

      signupUser.signUpOTPAttempts = (signupUser.signUpOTPAttempts || 0) + 1;
      await signupUser.save();

      if (signupUser.signUpOTP !== otp) {
        return res.status(401).json({ success: false, message: "Invalid OTP." });
      }

      signupUser.signUpOTPLastUsedAt = new Date();
      signupUser.signUpOTP = null;
      signupUser.signUpOTPExpiresAt = null;
      signupUser.signUpOTPSentAt = null;
      signupUser.signUpOTPAttempts = 0;

      if (!signupUser.role) signupUser.role = "patient";
      if (!signupUser.authProvider) signupUser.authProvider = "otp";
      signupUser.status = "active";
      signupUser.isDisabled = false;

      await signupUser.save();

      try {
        await AuditLogService.addLog({
          action: 'PARENT_SIGNUP_OTP_VERIFIED',
          user: signupUser._id,
          role: 'parent',
          resource: 'Parent',
          resourceId: signupUser._id,
          details: {
            email,
            otpVerified: true,
            message: `Parent OTP verified and account activated for ${email}`,
            completeProfileOrigin: 'self-service'
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
      } catch (logErr) {
        console.error('Failed to write audit log (PARENT_SIGNUP_OTP_VERIFIED) in parentSignUpVerifyOTP:', logErr);
      }

      return res.json({ success: true, message: "Parent account created. You may now login." });
    } catch (e) {
      console.error("Error in parentSignUpVerifyOTP:", e);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  }

  async completeParentProfile(req, res) {
    try {
      console.log("Step 1: Starting completeParentProfile");
      const parentUserId = req.user?.id;
      console.log("Step 2: parentUserId:", parentUserId);
      if (!parentUserId) {
        console.log("Step 2.1: No user ID found, unauthorized.");
        return res.status(401).json({ error: "Unauthorized: No user ID found." });
      }

      const user = await User.findById(parentUserId);
      console.log("Step 3: Found user:", !!user, "Role:", user?.role);
      if (!user || user.role !== "patient") {
        console.log("Step 3.1: No parent user found.");
        return res.status(404).json({ error: "No parent user found." });
      }

      const {
        mobile1,
        childFullName,
        gender,
        childDOB,
        fatherFullName,
        motherFullName,
        parentEmail,
        mobile2,
        address,
        areaName,
        pincode,
        diagnosisInfo,
        childReference,
        parentOccupation,
        motherOccupation,
        remarks,
        otherDocument
      } = req.body;
      console.log("Step 4: req.body received:", {
        mobile1, childFullName, gender, childDOB, fatherFullName, motherFullName,
        parentEmail, mobile2, address, areaName, pincode, diagnosisInfo, childReference,
        parentOccupation, motherOccupation, remarks, otherDocument
      });

      const phone = mobile1;
      console.log("Step 5: Phone for user will be:", phone);

      if (phone && typeof phone === "string" && phone.trim() !== "") {
        const existingUser = await User.findOne({
          phone: phone.trim(),
          _id: { $ne: parentUserId }
        });
        console.log("Step 5.1: existingUser for phone?", !!existingUser);
        if (existingUser) {
          console.log("Step 5.2: Phone number conflict with user", existingUser.email);
          return res.status(409).json({
            error: `This phone number is already used by another user (Email: ${existingUser.email || "[none]"})`
          });
        }
        user.phone = phone.trim();
        user.incompleteParentProfile = false;
        console.log("Step 5.3: User phone set and marked profile as complete");
      }
      await user.save();
      console.log("Step 6: User saved.");

      let existingProfile = await PatientProfile.findOne({ userId: user._id });
      let createdProfile = null;
      let patientId = null;
      console.log("Step 7: existingProfile?", !!existingProfile);

      if (!existingProfile) {
        if (!childFullName || typeof childFullName !== "string" || !childFullName.trim()) {
          console.log("Step 7.1: Child full name missing on first profile creation");
          return res.status(400).json({ error: "Child name (childFullName) is required to complete profile for the first time." });
        }

        let seq;
        try {
          const counter = await counterSchema.findOneAndUpdate(
            { name: "patient" },
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
          );
          seq = counter.seq;
          console.log("Step 7.2: New patientId sequence number:", seq);
        } catch (counterErr) {
          console.log("Step 7.2: Failed to increment Children ID counter.", counterErr);
          return res.status(500).json({ error: "Could not generate Children ID." });
        }
        patientId = `P${seq.toString().padStart(4, "0")}`;
        console.log("Step 7.3: Generated patientId:", patientId);

        createdProfile = new PatientProfile({
          userId: user._id,
          name: childFullName ? childFullName.trim() : "",
          patientId,
          gender: gender || "",
          childDOB: childDOB || "",
          fatherFullName: fatherFullName || "",
          motherFullName: motherFullName || "",
          parentEmail: parentEmail || user.email,
          mobile1: mobile1 || "",
          mobile2: mobile2 || "",
          address: address || "",
          areaName: areaName || "",
          pincode: pincode || "",
          diagnosisInfo: diagnosisInfo || "",
          childReference: childReference || "",
          parentOccupation: parentOccupation || "",
          motherOccupation: motherOccupation || "",
          remarks: remarks || "",
          otherDocument: otherDocument || undefined,
        });
        await createdProfile.save();
        console.log("Step 7.4: PatientProfile created:", createdProfile._id);

        try {
          console.log("Step 8: Sending Children Profile Completed WhatsApp notification:", {
            destination: user.phone || user.phoneNumber || mobile1 || "",
            userName: user.name || "",
            childName: childFullName || "",
            patientId: createdProfile.patientId || ""
          });
          await WhatsappController.sendChildrenProfileCompleted({
            destination: user.phone || user.phoneNumber || mobile1 || "",
            userName: user.name || "",
            childName: childFullName || "",
            patientId: createdProfile.patientId || ""
          });
          console.log("Step 8.1: WhatsApp notification sent successfully.");
        } catch (whErr) {
          console.error('Failed to send Children Profile Completed WhatsApp notification:', whErr);
        }
      } else {
        console.log("Step 7.5: PatientProfile already exists, not creating again.");
      }

      try {
        console.log("Step 9: Writing audit log for PARENT_PROFILE_COMPLETED.");
        await AuditLogService.addLog({
          action: 'PARENT_PROFILE_COMPLETED',
          user: user._id,
          role: 'parent',
          resource: 'Parent',
          resourceId: createdProfile?._id || existingProfile?._id,
          details: {
            email: user.email,
            userId: user._id,
            fieldsSubmitted: {
              childFullName, gender, childDOB, fatherFullName, motherFullName, parentEmail,
              mobile1, mobile2, address, areaName, pincode, diagnosisInfo, childReference,
              parentOccupation, motherOccupation,
              remarks, otherDocument
            },
            createdProfile: !!createdProfile,
            completeProfileOrigin: 'self-service',
            message: `Parent [${user.email}] completed their profile`
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        });
        console.log("Step 9.1: Audit log written successfully.");
      } catch (logErr) {
        console.error('Failed to write audit log (PARENT_PROFILE_COMPLETED) in completeParentProfile:', logErr);
      }

      console.log("Step 10: Returning success response.");
      return res.status(200).json({
        success: true,
        user: {
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          _id: user._id
        },
        patientProfile: createdProfile
          ? {
              _id: createdProfile._id,
              name: createdProfile.name,
              patientId: createdProfile.patientId,
              gender: createdProfile.gender,
              childDOB: createdProfile.childDOB,
              fatherFullName: createdProfile.fatherFullName,
              motherFullName: createdProfile.motherFullName,
              parentEmail: createdProfile.parentEmail,
              mobile1: createdProfile.mobile1,
              mobile2: createdProfile.mobile2,
              address: createdProfile.address,
              areaName: createdProfile.areaName,
              pincode: createdProfile.pincode,
              diagnosisInfo: createdProfile.diagnosisInfo,
              childReference: createdProfile.childReference,
              parentOccupation: createdProfile.parentOccupation,
              motherOccupation: createdProfile.motherOccupation,
              remarks: createdProfile.remarks,
              otherDocument: createdProfile.otherDocument,
            }
          : undefined
      });
    } catch (e) {
      console.error("Error in completeParentProfile:", e);
      res.status(400).json({ error: "Failed to complete parent profile", details: e.message });
    }
  }

  async getDashboardDetails(req, res) {
    try {
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      const user = await User.findById(parentId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "Parent user not found." });
      }

      const children = await PatientProfile.find({ userId: user._id }).lean();
      const childIds = children.map(child => child._id);

      const appointments = await Booking.find({ patient: { $in: childIds } })
        .populate({
          path: "patient",
          model: "PatientProfile",
          select: "patientId name",
          populate: {
            path: "userId",
            model: "User",
            select: "name",
          }
        })
        .populate({
          path: "sessions.therapist",
          model: "TherapistProfile",
          select: "therapistId",
          populate: {
            path: "userId",
            model: "User",
            select: "name"
          }
        })
        .lean();

      const consultationBookings = await ConsultationBooking.find({ client: { $in: childIds } })
        .populate({
          path: "client",
          model: "PatientProfile",
          select: "patientId name",
          populate: {
            path: "userId",
            model: "User",
            select: "name",
          }
        })
        .populate({
          path: "therapy",
          model: "TherapyType",
          select: "name"
        })
        .lean();

      const totalAppointments = appointments.length;

      // Build unchecked sessions — response keys use "children" terminology
      const uncheckedSessions = [];
      appointments.forEach(booking => {
        if (Array.isArray(booking.sessions)) {
          for (const session of booking.sessions) {
            if (!session.isCheckedIn) {
              uncheckedSessions.push({
                childrenId: booking.patient.patientId,
                name: booking.patient.name,
                notCheckedInSession: session
              });
            }
          }
        }
      });

      const populatedBookings = await Booking.find({ patient: { $in: childIds } })
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: {
            path: "userId",
            model: "User",
          },
        })
        .populate({
          path: "payment",
          model: "Payment"
        })
        .lean({ virtuals: true });

      // Pending payments — response keys use "children" terminology
      const pendingPayments = [];
      for (const booking of populatedBookings) {
        let payments = [];
        if (Array.isArray(booking.payment)) {
          payments = booking.payment;
        } else if (booking.payment) {
          payments = [booking.payment];
        }
        for (const pay of payments) {
          if (!pay) continue;
          const status = pay.status || "Unknown";
          if (status.toLowerCase() === "pending") {
            let childrenName = "";
            if (
              booking.Children &&
              booking.patient.userId &&
              booking.patient.userId.name
            ) {
              childrenName = booking.patient.name;
            } else if (booking.Children && booking.patient.name) {
              childrenName = booking.patient.name;
            }
            const childrenId = booking.patient?.patientId;
            if (!childrenName && user && user.name) childrenName = user.name;
            pendingPayments.push({
              InvoiceId: pay.paymentId ? pay.paymentId.toString() : "",
              date: pay.createdAt || pay.date || booking.createdAt,
              childrenName: childrenName,
              childrenId,
              amount: pay.amount || booking.totalAmount || 0,
              status: status
            });
          }
        }
      }

      const dashboardData = {
        childrenCount: children.length,
        totalAppointments,
        pendingPayments,
        uncheckedSessions,
        consultationBookings
      };

      res.json({ success: true, data: dashboardData });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message || String(err)
      });
    }
  }

  async getAllChildrens(req, res) {
    try {
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }
      const userId = parentId;

      const user = await User.findById(userId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      let { page = 1, limit = 10, search = "" } = req.query;
      page = Math.max(parseInt(page) || 1, 1);
      limit = Math.max(parseInt(limit) || 10, 1);
      search = (search || "").trim();

      const dbQuery = { userId: user._id };
      if (search) {
        dbQuery.$or = [
          { name: { $regex: search, $options: "i" } },
          { patientId: { $regex: search, $options: "i" } },
          { fatherFullName: { $regex: search, $options: "i" } },
          { motherFullName: { $regex: search, $options: "i" } }
        ];
      }

      const total = await PatientProfile.countDocuments(dbQuery);

      const children = await PatientProfile.find(dbQuery)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      res.json({
        success: true,
        data: children,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  async getAllAppointments(req, res) {
    try {
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      const user = await User.findById(parentId).lean();
      if (!user) {
        return res.status(404).json({ success: false, message: "Parent user not found." });
      }

      const children = await PatientProfile.find({ userId: user._id }).lean();
      if (!children || children.length === 0) {
        return res.json({ success: true, data: [], page: 1, limit: 10, total: 0, totalPages: 1 });
      }
      const childIds = children.map(child => child._id);

      let { page = 1, limit = 10, search = "" } = req.query;
      page = Math.max(parseInt(page) || 1, 1);
      limit = Math.max(parseInt(limit) || 10, 1);
      search = (search || "").trim();

      const bookingQuery = { patient: { $in: childIds } };

      if (search) {
        const orConditions = [
          { requestId: { $regex: search, $options: "i" } },
          { appointmentId: { $regex: search, $options: "i" } },
          { status: { $regex: search, $options: "i" } },
          { requestStatus: { $regex: search, $options: "i" } }
        ];

        orConditions.push(
          { "patientProfile.name": { $regex: search, $options: "i" } },
          { "patientProfile.patientId": { $regex: search, $options: "i" } }
        );

        orConditions.push(
          { "therapyProfile.name": { $regex: search, $options: "i" } }
        );

        orConditions.push(
          { "discountInfo.coupon.couponCode": { $regex: search, $options: "i" } }
        );
        orConditions.push(
          { "sessions.date": { $regex: search, $options: "i" } },
          { "sessions.slotId": { $regex: search, $options: "i" } }
        );

        const pipeline = [
          { $match: bookingQuery },
          {
            $lookup: {
              from: 'patientprofiles',
              localField: 'patient',
              foreignField: '_id',
              as: 'patientProfile'
            }
          },
          { $unwind: { path: "$patientProfile", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'therapytypes',
              localField: 'therapy',
              foreignField: '_id',
              as: 'therapyProfile'
            }
          },
          { $unwind: { path: "$therapyProfile", preserveNullAndEmptyArrays: true } },
          { $match: { $or: orConditions } }
        ];

        const pipelineCount = [...pipeline, { $count: "total" }];
        const pipelineData = [
          ...pipeline,
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit }
        ];

        const countResult = await Booking.aggregate(pipelineCount);
        const total = countResult?.[0]?.total || 0;

        const pagedDocs = await Booking.aggregate([
          ...pipelineData,
          { $project: { _id: 1 } }
        ]);
        const pagedBookingIds = pagedDocs.map(doc => doc._id);

        let appointments = [];
        if (pagedBookingIds.length > 0) {
          appointments = await Booking.find({ _id: { $in: pagedBookingIds } })
            .populate({ path: 'package' })
            .populate({ path: 'patient', model: 'PatientProfile' })
            .populate({
              path: 'therapist',
              model: 'TherapistProfile',
              select: "therapistId",
              populate: {
                path: 'userId',
                model: 'User',
                select: 'name'
              }
            })
            .populate({ path: 'therapy', model: 'TherapyType' })
            .populate({ path: 'payment' })
            .lean();

          const orderMap = {};
          pagedBookingIds.forEach((id, i) => { orderMap[String(id)] = i; });
          appointments.sort((a, b) => (orderMap[String(a._id)] ?? 0) - (orderMap[String(b._id)] ?? 0));
        }

        const therapistIds = [];
        appointments.forEach((appointment) => {
          if (Array.isArray(appointment.sessions)) {
            appointment.sessions.forEach((session) => {
              if (session.therapist) therapistIds.push(session.therapist);
            });
          }
        });
        const uniqueTherapistIds = [...new Set(therapistIds.map(id => id?.toString()).filter(Boolean))];
        const therapists = await TherapistProfile.find({ _id: { $in: uniqueTherapistIds } })
          .populate({ path: 'userId', model: 'User', select: 'name' })
          .select('userId name therapistId')
          .lean();
        const therapistMap = {};
        therapists.forEach(t => { therapistMap[String(t._id)] = t; });

        for (const appointment of appointments) {
          if (Array.isArray(appointment.sessions)) {
            appointment.sessions = appointment.sessions.map((session) => {
              const sessionCopy = { ...session };
              if (session.therapist && therapistMap[session.therapist?.toString()]) {
                sessionCopy.therapist = therapistMap[session.therapist?.toString()];
              }
              return sessionCopy;
            });
          }
        }

        const appointmentIds = appointments.map(a => a._id);
        const sessionEditRequests = await SessionEditRequest.find({ appointmentId: { $in: appointmentIds } })
          .populate({ path: 'sessions.sessionId', model: 'Session' })
          .lean();
        const editRequestsByAppointment = {};
        sessionEditRequests.forEach(er => {
          const apptId = er.appointmentId?.toString?.() || er.appointmentId;
          if (!editRequestsByAppointment[apptId]) editRequestsByAppointment[apptId] = [];
          editRequestsByAppointment[apptId].push(er);
        });
        for (const appointment of appointments) {
          const apptId = appointment._id?.toString?.() || appointment._id;
          appointment.editRequests = editRequestsByAppointment[apptId] || [];
        }

        res.json({
          success: true,
          data: appointments,
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1
        });
        return;
      }

      const total = await Booking.countDocuments(bookingQuery);

      let appointments = await Booking.find(bookingQuery)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: 'package' })
        .populate({ path: 'patient', model: 'PatientProfile' })
        .populate({
          path: 'therapist',
          model: 'TherapistProfile',
          select: "therapistId",
          populate: { path: 'userId', model: 'User', select: 'name' }
        })
        .populate({ path: 'therapy', model: 'TherapyType' })
        .populate({ path: 'payment' })
        .lean();

      const therapistIds = [];
      appointments.forEach((appointment) => {
        if (Array.isArray(appointment.sessions)) {
          appointment.sessions.forEach((session) => {
            if (session.therapist) therapistIds.push(session.therapist);
          });
        }
      });
      const uniqueTherapistIds = [...new Set(therapistIds.map(id => id?.toString()).filter(Boolean))];
      const therapists = await TherapistProfile.find({ _id: { $in: uniqueTherapistIds } })
        .populate({ path: 'userId', model: 'User', select: 'name' })
        .select('userId name therapistId')
        .lean();
      const therapistMap = {};
      therapists.forEach(t => { therapistMap[String(t._id)] = t; });

      for (const appointment of appointments) {
        if (Array.isArray(appointment.sessions)) {
          appointment.sessions = appointment.sessions.map((session) => {
            const sessionCopy = { ...session };
            if (session.therapist && therapistMap[session.therapist?.toString()]) {
              sessionCopy.therapist = therapistMap[session.therapist?.toString()];
            }
            return sessionCopy;
          });
        }
      }

      const appointmentIds = appointments.map(a => a._id);
      const sessionEditRequests = await SessionEditRequest.find({ appointmentId: { $in: appointmentIds } }).lean();
      const editRequestsByAppointment = {};
      sessionEditRequests.forEach(er => {
        const apptId = er.appointmentId?.toString?.() || er.appointmentId;
        if (!editRequestsByAppointment[apptId]) editRequestsByAppointment[apptId] = [];
        editRequestsByAppointment[apptId].push(er);
      });
      for (const appointment of appointments) {
        const apptId = appointment._id?.toString?.() || appointment._id;
        appointment.editRequests = editRequestsByAppointment[apptId] || [];
      }

      res.json({
        success: true,
        data: appointments,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      });

    } catch (err) {
      console.error("[getAllAppointments] error:", err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  async getProfileDetails(req, res) {
    try {
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      const parent = await User.findById(parentId).lean();
      if (!parent) {
        return res.status(404).json({ success: false, message: "Parent profile not found." });
      }

      const childrens = await PatientProfile.find({ userId: parentId }).lean();

      res.json({ success: true, data: { parent, childrens } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  }

  async getRequestAppointmentHomePage(req, res) {
    try {
      const parentId = req.user.id;

      let {
        patientPage = 1,
        patientLimit = 25,
        patientSearch = ""
      } = req.query;
      patientPage = Math.max(parseInt(patientPage) || 1, 1);
      patientLimit = Math.max(parseInt(patientLimit) || 25, 1);
      patientSearch = (patientSearch || "").trim();

      const patientQuery = { userId: parentId };
      if (patientSearch) {
        patientQuery.$or = [
          { name: { $regex: patientSearch, $options: "i" } },
          { patientId: { $regex: patientSearch, $options: "i" } },
          { mobile1: { $regex: patientSearch, $options: "i" } }
        ];
      }

      const totalPatients = await PatientProfile.countDocuments(patientQuery);

      const patientProfiles = await PatientProfile.find(
        patientQuery,
        "name userId patientId mobile1"
      )
        .populate({ path: "userId", select: "name" })
        .skip((patientPage - 1) * patientLimit)
        .limit(patientLimit)
        .lean();

      const patients = (patientProfiles || []).map((profile) => ({
        id: profile._id,
        patientId: profile.patientId,
        name: profile.name || "",
        phoneNo: profile.mobile1 || "",
      }));

      let {
        therapyPage = 1,
        therapyLimit = 100,
        therapySearch = ""
      } = req.query;
      therapyPage = Math.max(parseInt(therapyPage) || 1, 1);
      therapyLimit = Math.max(parseInt(therapyLimit) || 100, 1);
      therapySearch = (therapySearch || "").trim();

      const therapyQuery = therapySearch
        ? { name: { $regex: therapySearch, $options: "i" } }
        : {};

      const totalTherapy = await TherapyType.countDocuments(therapyQuery);
      const therapyTypes = await TherapyType.find(therapyQuery)
        .skip((therapyPage - 1) * therapyLimit)
        .limit(therapyLimit)
        .lean();

      let {
        packagePage = 1,
        packageLimit = 100,
        packageSearch = ""
      } = req.query;
      packagePage = Math.max(parseInt(packagePage) || 1, 1);
      packageLimit = Math.max(parseInt(packageLimit) || 100, 1);
      packageSearch = (packageSearch || "").trim();

      const packageQuery = packageSearch
        ? {
            $or: [
              { name: { $regex: packageSearch, $options: "i" } },
              { packageId: { $regex: packageSearch, $options: "i" } }
            ]
          }
        : {};

      const totalPackages = await Package.countDocuments(packageQuery);
      const packages = await Package.find(packageQuery)
        .skip((packagePage - 1) * packageLimit)
        .limit(packageLimit)
        .lean();

      let {
        therapistPage = 1,
        therapistLimit = 50,
        therapistSearch = ""
      } = req.query;
      therapistPage = Math.max(parseInt(therapistPage) || 1, 1);
      therapistLimit = Math.max(parseInt(therapistLimit) || 50, 1);
      therapistSearch = (therapistSearch || "").trim();

      const therapistLookupPipeline = [
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user"
          }
        },
        { $unwind: "$user" },
        { $match: { "user.status": "active" } },
      ];
      if (therapistSearch) {
        therapistLookupPipeline.push({
          $match: {
            $or: [
              { "user.name": { $regex: therapistSearch, $options: "i" } },
              { therapistId: { $regex: therapistSearch, $options: "i" } }
            ]
          }
        });
      }
      therapistLookupPipeline.push({
        $project: {
          _id: 1,
          therapistId: 1,
          name: "$user.name",
          holidays: 1,
          mobile1: 1
        }
      });

      const totalTherapistsAgg = [...therapistLookupPipeline, { $count: "total" }];
      const therapistAggPaginated = [
        ...therapistLookupPipeline,
        { $skip: (therapistPage - 1) * therapistLimit },
        { $limit: therapistLimit }
      ];

      const TherapistProfileModel = (await import("../../Schema/user.schema.js")).TherapistProfile;
      const [totalTherapistsResult, activeTherapists] = await Promise.all([
        TherapistProfileModel.aggregate(totalTherapistsAgg),
        TherapistProfileModel.aggregate(therapistAggPaginated)
      ]);
      const totalTherapists = totalTherapistsResult && totalTherapistsResult[0]?.total ? totalTherapistsResult[0].total : 0;

      const bookingCounts = await Booking.aggregate([
        { $unwind: "$sessions" },
        {
          $group: {
            _id: { therapist: "$therapist", date: "$sessions.date" },
            count: { $sum: 1 }
          }
        }
      ]);

      const therapistBookingMap = {};
      bookingCounts.forEach((row) => {
        const therapistId = row._id.therapist?.toString?.() || "";
        const date = row._id.date;
        if (!therapistBookingMap[therapistId]) therapistBookingMap[therapistId] = {};
        therapistBookingMap[therapistId][date] = row.count;
      });

      const therapistsWithCounts = (activeTherapists || []).map((t) => {
        const bookingsByDate = therapistBookingMap[t._id.toString()] || {};
        return { ...t, bookingsByDate };
      });

      let {
        couponPage = 1,
        couponLimit = 50,
        couponSearch = ""
      } = req.query;
      couponPage = Math.max(parseInt(couponPage) || 1, 1);
      couponLimit = Math.max(parseInt(couponLimit) || 50, 1);
      couponSearch = (couponSearch || "").trim();

      const couponQuery = {
        discountEnabled: true,
        ...(couponSearch && {
          $or: [
            { couponCode: { $regex: couponSearch, $options: "i" } },
            { description: { $regex: couponSearch, $options: "i" } }
          ]
        })
      };

      const totalCoupons = await DiscountModel.countDocuments(couponQuery);
      const coupons = await DiscountModel.find(couponQuery)
        .sort({ createdAt: -1 })
        .skip((couponPage - 1) * couponLimit)
        .limit(couponLimit)
        .lean();

      return res.json({
        success: true,
        patients,
        patientPage,
        patientLimit,
        totalPatients,
        patientTotalPages: Math.ceil(totalPatients / patientLimit),
        hasMorePatients: patientPage * patientLimit < totalPatients,

        therapyTypes,
        therapyPage,
        therapyLimit,
        totalTherapy,
        therapyTotalPages: Math.ceil(totalTherapy / therapyLimit),
        hasMoreTherapy: therapyPage * therapyLimit < totalTherapy,

        packages,
        packagePage,
        packageLimit,
        totalPackages,
        packageTotalPages: Math.ceil(totalPackages / packageLimit),
        hasMorePackages: packagePage * packageLimit < totalPackages,

        therapists: activeTherapists,
        therapistsWithCounts,
        therapistPage,
        therapistLimit,
        totalTherapists,
        therapistTotalPages: Math.ceil(totalTherapists / therapistLimit),
        hasMoreTherapists: therapistPage * therapistLimit < totalTherapists,

        coupons,
        couponPage,
        couponLimit,
        totalCoupons,
        couponTotalPages: Math.ceil(totalCoupons / couponLimit),
        hasMoreCoupons: couponPage * couponLimit < totalCoupons
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch booking page details.",
        error: error.message,
      });
    }
  }

  async createBookingRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const {
        package: packageId,
        patient: patientId,
        therapy: therapyId,
        sessions
      } = req.body;

      console.log("[CREATE BOOKING REQUEST] Incoming body:", req.body);

      if (
        !packageId ||
        !patientId ||
        !therapyId ||
        !Array.isArray(sessions) ||
        !sessions.length
      ) {
        console.log("[CREATE BOOKING REQUEST] Missing required fields", {
          packageId, patientId, therapyId, sessions
        });
        return res.status(400).json({
          success: false,
          message: "Missing required fields"
        });
      }

      const pkg = await Package.findById(packageId).lean();
      if (!pkg) {
        return res.status(400).json({
          success: false,
          message: "Invalid package"
        });
      }

      const counter = await counterSchema.findOneAndUpdate(
        { name: "request" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session }
      );
      const requestId = `REQ-${String(counter.seq).padStart(5, '0')}`;
      console.log("[CREATE BOOKING REQUEST] Generated requestId:", requestId);

      const bookingRequestPayload = {
        requestId,
        package: packageId,
        patient: patientId,
        sessions,
        therapy: therapyId
      };
      Object.keys(bookingRequestPayload).forEach(
        k => bookingRequestPayload[k] === undefined && delete bookingRequestPayload[k]
      );

      const bookingRequest = new BookingRequests(bookingRequestPayload);
      await bookingRequest.save({ session });
      console.log("[CREATE BOOKING REQUEST] BookingRequest saved. _id:", bookingRequest._id);

      try {
        await AuditLogService.addLog(
          {
            action: "CREATE_BOOKING_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "BookingRequest",
            resourceId: bookingRequest._id,
            details: {
              bookingRequest: {
                requestId,
                packageId,
                patientId,
                therapyId,
                sessionCount: Array.isArray(sessions) ? sessions.length : 0
              },
              message: `Booking request created by userId=${req.user?.id || "?"}, patientId=${patientId}, packageId=${packageId}, therapyId=${therapyId}`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("[CREATE BOOKING REQUEST] Audit log failed, reverted booking request:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to create booking request. Audit log not created, request reverted.",
          error: auditErr.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      const populatedRequest = await BookingRequests.findById(bookingRequest._id)
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({ path: "therapy", model: "TherapyType" });

      res.status(201).json({
        success: true,
        bookingRequest: populatedRequest
      });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {}
      session.endSession();
      console.error("[CREATE BOOKING REQUEST] Error encountered:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create booking request.",
        error: error.message,
      });
    }
  }

  // INSERT_YOUR_CODE

  async getAllBookingRequests(req, res) {
    try {
      const parentUserId = req.user?.id;

      let page = Number(req.query.page) || 1;
      let limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 100));
      const skip = (page - 1) * limit;

      const search = (req.query.search || "").trim();
      let filter = {};

      if (parentUserId) {
        const user = await User.findById(parentUserId).lean();
        if (!user) {
          return res.status(404).json({ success: false, message: "User not found" });
        }
        const myPatients = await PatientProfile.find({ userId: user._id }, '_id').lean();
        const myPatientIds = myPatients.map(p => p._id);

        if (myPatientIds.length > 0) {
          filter.Children = { $in: myPatientIds };
        } else {
          return res.json({ success: true, bookingRequests: [], total: 0, page, totalPages: 1 });
        }
      }

      const aggregatePipeline = [
        { $match: filter },
        {
          $lookup: {
            from: "patientprofiles",
            localField: "patient",
            foreignField: "_id",
            as: "patient",
          }
        },
        { $unwind: "$patient" },
        {
          $lookup: {
            from: "users",
            localField: "patient.userId",
            foreignField: "_id",
            as: "patient.userObj",
          }
        },
        {
          $addFields: {
            "patient.user": { $arrayElemAt: ["$patient.userObj", 0] }
          }
        },
        {
          $lookup: {
            from: "therapytypes",
            localField: "therapy",
            foreignField: "_id",
            as: "therapy",
          }
        },
        { $unwind: { path: "$therapy", preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: "packages",
            localField: "package",
            foreignField: "_id",
            as: "package",
          }
        },
        { $unwind: { path: "$package", preserveNullAndEmptyArrays: true } },
      ];

      if (search) {
        const regex = new RegExp(search, "i");
        aggregatePipeline.push({
          $match: {
            $or: [
              { "patient.name": regex },
              { "patient.patientId": regex },
              { "patient.user.name": regex },
              { "therapy.name": regex },
              { "package.name": regex },
              { "requestId": regex },
              { "appointmentId": regex }
            ]
          }
        });
      }

      const countPipeline = [...aggregatePipeline, { $count: "total" }];
      const countResult = await BookingRequests.aggregate(countPipeline).allowDiskUse(true);
      const total = countResult[0]?.total || 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      if (page > totalPages) page = totalPages;
      const newSkip = (page - 1) * limit;

      aggregatePipeline.push({ $sort: { createdAt: -1 } });
      aggregatePipeline.push({ $skip: newSkip });
      aggregatePipeline.push({ $limit: limit });

      aggregatePipeline.push({
        $project: { "patient.userObj": 0 }
      });

      const requests = await BookingRequests.aggregate(aggregatePipeline).allowDiskUse(true);

      res.json({
        success: true,
        bookingRequests: requests,
        total,
        page,
        totalPages,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      });

    } catch (error) {
      console.error("[GET ALL BOOKING REQUESTS] (search/pagination)", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch booking requests.",
        error: error.message
      });
    }
  }

  async getBookingRequestById(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, message: "Booking request ID required" });
      }
      const bookingRequest = await BookingRequests.findById(id)
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({ path: "therapy", model: "Therapy" });

      if (!bookingRequest) {
        return res.status(404).json({ success: false, message: "Booking request not found" });
      }

      res.json({ success: true, bookingRequest });
    } catch (error) {
      console.error("[GET BOOKING REQUEST BY ID]", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch booking request.",
        error: error.message,
      });
    }
  }

  async updateBookingRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const { id } = req.params;
      if (!id) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Booking request ID required" });
      }

      const updateFields = {};
      if (req.body.package) updateFields.package = req.body.package;
      if (req.body.patient) updateFields.Children = req.body.patient;
      if (req.body.sessions) updateFields.sessions = req.body.sessions;
      if (req.body.therapy) updateFields.therapy = req.body.therapy;

      if (Object.keys(updateFields).length === 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "No fields provided for update" });
      }

      const bookingRequestBefore = await BookingRequests.findById(id).lean();

      // INSERT_YOUR_CODE
      if (bookingRequestBefore && bookingRequestBefore.status === 'approved') {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Cannot update booking request: already approved."
        });
      }

      const bookingRequest = await BookingRequests.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, session }
      )
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({ path: "therapy", model: "TherapyType" });

      if (!bookingRequest) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Booking request not found" });
      }

      try {
        await AuditLogService.addLog(
          {
            action: "UPDATE_BOOKING_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "BookingRequest",
            resourceId: bookingRequest._id,
            details: {
              before: bookingRequestBefore,
              after: bookingRequest,
              updateFields,
              message: `Booking request updated by userId=${req.user?.id || "?"}, patientId=${updateFields.Children || (bookingRequestBefore ? bookingRequestBefore.Children : undefined)}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("[UPDATE BOOKING REQUEST] Audit log failed, reverted update:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to update booking request. Audit log not created, update reverted.",
          error: auditErr.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, bookingRequest });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {}
      session.endSession();
      console.error("[UPDATE BOOKING REQUEST]", error);
      res.status(500).json({
        success: false,
        message: "Failed to update booking request.",
        error: error.message
      });
    }
  }

  async deleteBookingRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { id } = req.params;
      if (!id) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Booking request ID required" });
      }

      const bookingRequest = await BookingRequests.findById(id).session(session);
      if (!bookingRequest) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Booking request not found" });
      }

      if (bookingRequest.status === "approved") {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Cannot delete an approved booking request."
        });
      }

      try {
        await AuditLogService.addLog(
          {
            action: "DELETE_BOOKING_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "BookingRequest",
            resourceId: bookingRequest._id,
            details: {
              deletedBookingRequest: bookingRequest.toObject ? bookingRequest.toObject() : bookingRequest,
              message: `Booking request deleted by userId=${req.user?.id || "?"}, patientId=${bookingRequest.patient}, packageId=${bookingRequest.package}, therapyId=${bookingRequest.therapy}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("[DELETE BOOKING REQUEST] Audit log failed, reverted delete:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to delete booking request. Audit log not created, deletion reverted.",
          error: auditErr.message
        });
      }

      await BookingRequests.findByIdAndDelete(id, { session });

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, message: "Booking request deleted successfully" });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("[DELETE BOOKING REQUEST]", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete booking request.",
        error: error.message
      });
    }
  }

  async generateSessionEditRequestId() {
    const counterDoc = await counterSchema.findOneAndUpdate(
      { name: "session-edit-request" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const seqNum = counterDoc.seq;
    return `SER${seqNum.toString().padStart(5, "0")}`;
  }

  async createSessionEditRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const { appointmentId, patientId, sessions } = req.body;

      if (
        !appointmentId ||
        !patientId ||
        !Array.isArray(sessions) ||
        sessions.length === 0 ||
        !sessions.every(s => s.sessionId && s.newDate && s.newSlotId)
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message:
            "Missing required fields. appointmentId, childrenId, and sessions (with sessionId, newDate, newSlotId) are required.",
        });
      }

      const existingPendingRequest = await SessionEditRequest.findOne({
        appointmentId: appointmentId,
        status: "pending"
      }).session(session);

      if (existingPendingRequest) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "A pending session edit request for this appointment already exists.",
          request: existingPendingRequest
        });
      }

      const requestId = await this.generateSessionEditRequestId();

      const requestPayload = {
        appointmentId,
        patientId,
        sessions,
        status: "pending",
        requestId
      };

      const request = await SessionEditRequest.create([requestPayload], { session });

      // INSERT_YOUR_CODE
      console.log("[CREATE SESSION EDIT REQUEST] request fields:", {
        appointmentId,
        patientId,
        sessions,
        status: "pending",
        requestId,
        requestObject: request[0],
        user: req.user,
        userId: req.user?.id,
        role: req.user?.role === "patient" ? "parent" : req.user?.role,
        action: "CREATE_SESSION_EDIT_REQUEST",
        resource: "SessionEditRequest",
        resourceId: request[0]?._id,
        details: {
          requestId,
          appointmentId,
          patientId,
          sessionCount: Array.isArray(sessions) ? sessions.length : 0,
          message: `Session edit request created by userId=${req.user?.id || "?"}, patientId=${patientId}, appointmentId=${appointmentId}.`
        },
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"]
      });

      try {
        await AuditLogService.addLog(
          {
            action: "CREATE_SESSION_EDIT_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "SessionEditRequest",
            resourceId: request[0]._id,
            details: {
              requestId,
              appointmentId,
              patientId,
              sessionCount: Array.isArray(sessions) ? sessions.length : 0,
              message: `Session edit request created by userId=${req.user?.id || "?"}, patientId=${patientId}, appointmentId=${appointmentId}.`
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("[CREATE SESSION EDIT REQUEST] Audit log failed, reverted creation:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to create session edit request. Audit log not created, request reverted.",
          error: auditErr.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      res.status(201).json({ success: true, request: request[0] });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {}
      session.endSession();
      console.error("[CREATE SESSION EDIT REQUEST]", error);
      res.status(500).json({ success: false, message: "Failed to create session edit request", error: error.message });
    }
  }

  async updateSessionEditRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const { id } = req.params;
      if (!id) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Request ID required" });
      }

      const updates = {};
      if (req.body.sessions && Array.isArray(req.body.sessions)) {
        updates.sessions = req.body.sessions;
      }
      if (req.body.status !== undefined) {
        updates.status = req.body.status;
      }

      if (Object.keys(updates).length === 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "No valid fields provided for update" });
      }

      const beforeUpdate = await SessionEditRequest.findById(id).lean().session(session);

      if (!beforeUpdate) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Session edit request not found" });
      }

      const updated = await SessionEditRequest.findByIdAndUpdate(id, updates, { new: true, session });
      if (!updated) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Session edit request not found" });
      }

      try {
        await AuditLogService.addLog(
          {
            action: "UPDATE_SESSION_EDIT_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "SessionEditRequest",
            resourceId: updated._id,
            details: {
              before: beforeUpdate,
              after: updated,
              updateFields: updates,
              message: `Session edit request updated by userId=${req.user?.id || "?"}, appointmentId=${beforeUpdate.appointmentId}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("[UPDATE SESSION EDIT REQUEST] Audit log failed, reverted update:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to update session edit request. Audit log not created, update reverted.",
          error: auditErr.message,
        });
      }

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, request: updated });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {}
      session.endSession();
      console.error("[UPDATE SESSION EDIT REQUEST]", error);
      res.status(500).json({ success: false, message: "Failed to update session edit request", error: error.message });
    }
  }

  async deleteSessionEditRequest(req, res) {
    const mongoose = (await import('mongoose')).default;
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const { id } = req.params;
      if (!id) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: "Request ID required" });
      }

      const toDelete = await SessionEditRequest.findById(id).session(session);
      if (!toDelete) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ success: false, message: "Session edit request not found" });
      }

      try {
        await AuditLogService.addLog(
          {
            action: "DELETE_SESSION_EDIT_REQUEST",
            user: req.user?.id,
            role: req.user?.role === "patient" ? "parent" : req.user?.role,
            resource: "SessionEditRequest",
            resourceId: toDelete._id,
            details: {
              deleted: toDelete,
              message: `Session edit request deleted by userId=${req.user?.id || "?"}, appointmentId=${toDelete.appointmentId}`,
            },
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
          },
          { session }
        );
      } catch (auditErr) {
        await session.abortTransaction();
        session.endSession();
        console.error("[DELETE SESSION EDIT REQUEST] Audit log failed, reverted delete:", auditErr);
        return res.status(500).json({
          success: false,
          message: "Failed to delete session edit request. Audit log not created, deletion reverted.",
          error: auditErr.message
        });
      }

      await SessionEditRequest.findByIdAndDelete(id, { session });

      await session.commitTransaction();
      session.endSession();

      res.json({ success: true, message: "Session edit request deleted successfully" });
    } catch (error) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {}
      session.endSession();
      console.error("[DELETE SESSION EDIT REQUEST]", error);
      res.status(500).json({ success: false, message: "Failed to delete session edit request", error: error.message });
    }
  }

  async getSessionEditRequests(req, res) {
    try {
      const { appointmentId, status } = req.query;
      const query = {};
      if (appointmentId) query.appointmentId = appointmentId;
      if (status) query.status = status;

      const requests = await SessionEditRequest.find(query)
        .populate("appointmentId");

      res.json({ success: true, requests });
    } catch (error) {
      console.error("[FETCH SESSION EDIT REQUESTS]", error);
      res.status(500).json({ success: false, message: "Failed to fetch session edit requests", error: error.message });
    }
  }

  async allBookings(req, res) {
    try {
      const bookings = await Booking.find()
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({ path: "therapy", model: "TherapyType" })
        .populate({
          path: "therapist",
          model: "TherapistProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({ path: "discountInfo.coupon", model: "Discount" });
      res.json({ success: true, bookings });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch bookings.",
        error: error.message,
      });
    }
  }

  // async getInvoiceAndPayment(req, res) {
  //   try {
  //     const userId = req.user.id;
  //     const search = (req.query.search || "").trim();
  //     const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  //     const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 10, 100));

  //     const user = await User.findById(userId);
  //     if (!user) {
  //       return res.status(404).json({
  //         success: false,
  //         message: "User not found.",
  //       });
  //     }

  //     const patientProfiles = await PatientProfile.find({ userId });
  //     if (!patientProfiles || patientProfiles.length === 0) {
  //       return res.status(404).json({
  //         success: false,
  //         message: "No Children profiles found for this user.",
  //       });
  //     }
  //     const patientProfileIds = patientProfiles.map((p) => p._id);

  //     let bookingQuery = { patient: { $in: patientProfileIds } };
  //     if (search.length > 0) {
  //       bookingQuery = {
  //         ...bookingQuery,
  //         $or: [
  //           { 'patientNameForSearch': { $regex: search, $options: "i" } },
  //         ]
  //       };
  //     }

  //     const totalCount = await Booking.countDocuments({ patient: { $in: patientProfileIds } });
  //     const skip = (page - 1) * limit;

  //     let bookings = await Booking.find({ patient: { $in: patientProfileIds } })
  //       .sort({ createdAt: -1 })
  //       .skip(skip)
  //       .limit(limit)
  //       .populate("package")
  //       .populate({
  //         path: "patient",
  //         model: "PatientProfile",
  //         select: "name patientId mobile gender",
  //         populate: { path: "userId", model: "User" }
  //       })
  //       .populate({ path: "therapy", model: "TherapyType" })
  //       .populate({
  //         path: "therapist",
  //         model: "TherapistProfile",
  //         populate: { path: "userId", model: "User" }
  //       })
  //       .populate({
  //         path: "discountInfo.coupon",
  //         model: "Discount",
  //         select: "discountEnabled discount couponCode validityDays createdAt"
  //       })
  //       .populate({ path: "payment", model: "Payment" })
  //       .lean();

  //     // Search filter (extra in-memory filter in addition to $or above)
  //     if (search.length > 0) {
  //       const searchLower = search.toLowerCase();
  //       bookings = bookings.filter(b => {
  //         let found = false;
  //         if (b.patient?.name && b.patient.name.toLowerCase().includes(searchLower)) found = true;
  //         if (!found && b.patient?.patientId && (b.patient.patientId + "").toLowerCase().includes(searchLower)) found = true;
  //         if (!found && b.payment) {
  //           let payments = Array.isArray(b.payment) ? b.payment : [b.payment];
  //           for (let pay of payments) {
  //             if (!pay) continue;
  //             if (pay.paymentId && (pay.paymentId + "").toLowerCase().includes(searchLower)) {
  //               found = true;
  //               break;
  //             }
  //           }
  //         }
  //         return found;
  //       });
  //     }

  //     // Payment details output following @file_context_0 format
  //     const paymentDetails = [];
  //     for (const booking of bookings) {
  //       // Get payments (array or single object)
  //       let payments = [];
  //       if (Array.isArray(booking.payment)) payments = booking.payment;
  //       else if (booking.payment) payments = [booking.payment];

  //       let invoiceOriginal = null;
  //       if (payments.length > 0 && payments[0] && typeof payments[0].totalAmount === "number") {
  //         invoiceOriginal = payments[0].totalAmount;
  //       } else if (booking.package && typeof booking.package.price === "number") {
  //         invoiceOriginal = booking.package.price;
  //       } else if (booking.totalAmount != null) {
  //         invoiceOriginal = booking.totalAmount;
  //       }

  //       // Send discount object according to the ReceptionDesk format
  //       // coupon fields: { discountEnabled, discount, couponCode, validityDays, createdAt }
  //       let discountObj = null;
  //       if (booking.discountInfo && booking.discountInfo.coupon) {
  //         const coupon = booking.discountInfo.coupon;
  //         discountObj = {
  //           _id: coupon._id,
  //           discountEnabled: coupon.discountEnabled,
  //           discount: coupon.discount,
  //           couponCode: coupon.couponCode,
  //           validityDays: coupon.validityDays,
  //           createdAt: coupon.createdAt
  //         };
  //       }

  //       // Compute total paid
  //       let totalPaid = 0;
  //       for (const pay of payments) {
  //         if (
  //           pay &&
  //           pay.amount &&
  //           ['paid', 'partiallypaid', 'success', 'Paid', 'PAID', 'Success'].includes((pay.status || "").toLowerCase())
  //         ) {
  //           totalPaid += pay.amount;
  //         }
  //       }

  //       // Determine final amount after discount (when possible)
  //       let discountAmount = 0;
  //       if (
  //         booking.discountInfo &&
  //         typeof booking.discountInfo.discountAmount === "number"
  //       ) {
  //         discountAmount = booking.discountInfo.discountAmount;
  //       }
  //       let invoiceAfterDiscount = (invoiceOriginal != null)
  //         ? Math.max(0, Math.round(invoiceOriginal - discountAmount))
  //         : null;

  //       // Due amount
  //       let dueAmount = invoiceAfterDiscount != null ? invoiceAfterDiscount - totalPaid : null;
  //       if (dueAmount != null) dueAmount = Math.max(0, Math.round(dueAmount));

  //       // For each payment, output an entry
  //       for (const pay of payments) {
  //         if (!pay) continue;
  //         let invoiceId = pay.paymentId ? pay.paymentId.toString() : "";
  //         let date = pay.createdAt || pay.date || booking.createdAt;
  //         let childrenName = booking.patient?.name || (user && user.name) || "";
  //         let childrenId = booking.patient?.patientId;
  //         paymentDetails.push({
  //           InvoiceId: invoiceId,
  //           date: date,
  //           childrenName: childrenName,
  //           childrenId,
  //           amount: pay.amount || pay.totalAmount || 0,
  //           status: pay.status || "Unknown",
  //           originalInvoiceAmount: invoiceOriginal,
  //           invoiceAmount: invoiceAfterDiscount,
  //           dueAmount: dueAmount,
  //           discount: discountObj,
  //           paymentDetail: pay
  //         });
  //       }

  //       // If booking has no payments (unpaid invoice), send one with status Unpaid
  //       if (payments.length === 0 && invoiceOriginal != null) {
  //         let childrenName = booking.patient?.name || (user && user.name) || "";
  //         let childrenId = booking.patient?.patientId;
  //         paymentDetails.push({
  //           InvoiceId: "",
  //           date: booking.createdAt,
  //           childrenName: childrenName,
  //           childrenId: childrenId,
  //           amount: 0,
  //           status: "Unpaid",
  //           originalInvoiceAmount: invoiceOriginal,
  //           invoiceAmount: invoiceAfterDiscount,
  //           dueAmount: dueAmount,
  //           discount: discountObj,
  //           code: 400
  //         });
  //       }
  //     }

  //     res.json({
  //       success: true,
  //       payments: paymentDetails,
  //       total: search.length > 0 ? paymentDetails.length : totalCount,
  //       page,
  //       limit,
  //     });

  //   } catch (error) {
  //     console.error("[GET INVOICE AND PAYMENT]", error);
  //     res.status(500).json({
  //       success: false,
  //       message: "Failed to fetch invoice and payment details.",
  //       error: error.message,
  //     });
  //   }
  // }

  async getInvoiceAndPayment(req, res) {
    try {
      const userId = req.user.id;
      const search = (req.query.search || "").trim();
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 10, 100));

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      const patientProfiles = await PatientProfile.find({ userId });
      if (!patientProfiles || patientProfiles.length === 0) {
        return res.status(404).json({ success: false, message: "No Children profiles found for this user." });
      }
      const patientProfileIds = patientProfiles.map((p) => p._id);

      const totalCount = await Booking.countDocuments({ patient: { $in: patientProfileIds } });
      const skip = (page - 1) * limit;

      let bookings = await Booking.find({ patient: { $in: patientProfileIds } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("package")
        .populate({
          path: "patient",
          model: "PatientProfile",
          select: "name patientId mobile gender",
          populate: { path: "userId", model: "User" }
        })
        .populate({ path: "therapy", model: "TherapyType" })
        .populate({
          path: "therapist",
          model: "TherapistProfile",
          populate: { path: "userId", model: "User" }
        })
        .populate({
          path: "discountInfo.coupon",
          model: "Discount",
          select: "discountEnabled discount couponCode validityDays createdAt"
        })
        .populate({ path: "payment", model: "Payment" })
        .lean();

      // In-memory search filter
      if (search.length > 0) {
        const searchLower = search.toLowerCase();
        bookings = bookings.filter(b => {
          if (b.patient?.name && b.patient.name.toLowerCase().includes(searchLower)) return true;
          if (b.patient?.patientId && (b.patient.patientId + "").toLowerCase().includes(searchLower)) return true;
          if (b.payment?.paymentId && (b.payment.paymentId + "").toLowerCase().includes(searchLower)) return true;
          return false;
        });
      }

      // ---- Fetch all Finances rows for these bookings in one query, grouped by booking ----
      const bookingIds = bookings.map(b => b._id);
      const financeRecords = bookingIds.length
        ? await Finances.find({ booking: { $in: bookingIds } })
            .sort({ date: 1 }) // chronological order of partial payments
            .lean()
        : [];

      const financesByBooking = new Map();
      for (const f of financeRecords) {
        const key = String(f.booking);
        if (!financesByBooking.has(key)) financesByBooking.set(key, []);
        financesByBooking.get(key).push(f);
      }

      const paymentDetails = [];

      for (const booking of bookings) {
        const pay = booking.payment || null;

        let invoiceOriginal = null;
        if (pay && typeof pay.totalAmount === "number") {
          invoiceOriginal = pay.totalAmount;
        } else if (typeof booking.package?.price === "number") {
          invoiceOriginal = booking.package.price;
        } else if (booking.totalAmount != null) {
          invoiceOriginal = booking.totalAmount;
        }

        let discountObj = null;
        if (booking.discountInfo?.coupon) {
          const coupon = booking.discountInfo.coupon;
          discountObj = {
            _id: coupon._id,
            discountEnabled: coupon.discountEnabled,
            discount: coupon.discount,
            couponCode: coupon.couponCode,
            validityDays: coupon.validityDays,
            createdAt: coupon.createdAt
          };
        }

        const discountAmount = typeof booking.discountInfo?.discountAmount === "number"
          ? booking.discountInfo.discountAmount
          : (pay?.discountInfo?.amount || 0);

        const invoiceAfterDiscount = invoiceOriginal != null
          ? Math.max(0, Math.round(invoiceOriginal - discountAmount))
          : null;

        const childrenName = booking.patient?.name || user?.name || "";
        const childrenId = booking.patient?.patientId;

        const finances = financesByBooking.get(String(booking._id)) || [];

        // If there are no Payment record at all -> Unpaid
        if (!pay) {
          if (invoiceOriginal != null) {
            paymentDetails.push({
              InvoiceId: "",
              date: booking.createdAt,
              childrenName,
              childrenId,
              amount: 0,
              status: "Unpaid",
              originalInvoiceAmount: invoiceOriginal,
              invoiceAmount: invoiceAfterDiscount,
              dueAmount: invoiceAfterDiscount,
              discount: discountObj,
              code: 400,
              sequence: 1, // only one, so sequence 1
              totalInstallments: 1,
            });
          }
          continue;
        }

        // If there are finances (installments), send each installment as a separate record with sequence
        if (finances.length > 0) {
          let cumulativePaid = 0;
          finances
            .filter(f => f.creditDebitStatus === 'credited')
            .forEach((finance, idx) => {
              cumulativePaid += finance.amount || 0;
              const dueAmount = invoiceAfterDiscount != null
                ? Math.max(0, Math.round(invoiceAfterDiscount - cumulativePaid))
                : null;
              paymentDetails.push({
                InvoiceId: pay.paymentId ? pay.paymentId.toString() : "",
                date: finance.date,
                childrenName,
                childrenId,
                amount: finance.amount, // Amount for this installment only
                status: pay.status || "Unknown", // if per-finance status is needed, update here
                originalInvoiceAmount: invoiceOriginal,
                invoiceAmount: invoiceAfterDiscount,
                dueAmount: dueAmount,
                discount: discountObj,
                paymentDetail: pay,
                financeDetail: finance,
                sequence: idx + 1, // Starts from 1
                totalInstallments: finances.length,
                financeId: finance._id,
              });
            });
          continue;
        }

        // If only single payment (no finances), send that payment as one record with sequence 1
        paymentDetails.push({
          InvoiceId: pay.paymentId ? pay.paymentId.toString() : "",
          date: pay.paymentTime || pay.createdAt || booking.createdAt,
          childrenName,
          childrenId,
          amount: pay.amount,
          status: pay.status || "Unknown",
          originalInvoiceAmount: invoiceOriginal,
          invoiceAmount: invoiceAfterDiscount,
          dueAmount: invoiceAfterDiscount != null 
            ? Math.max(0, Math.round(invoiceAfterDiscount - (pay.amountPaid || 0))) 
            : null,
          discount: discountObj,
          paymentDetail: pay,
          sequence: 1,
          totalInstallments: 1,
        });
      }

      res.json({
        success: true,
        payments: paymentDetails,
        total: search.length > 0 ? paymentDetails.length : totalCount,
        page,
        limit,
      });

    } catch (error) {
      console.error("[GET INVOICE AND PAYMENT]", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch invoice and payment details.",
        error: error.message,
      });
    }
  }

  async raiseTicket(req, res) {
    try {
      const id = req.user.id;

      // INSERT_YOUR_CODE
      const user = await User.findById(id);

      if (!user || user.role !== "patient") {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Only parents can raise tickets.",
        });
      }

      const { subject, description, priority, tags } = req.body;

      if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Subject is required.",
        });
      }
      if (!description || typeof description !== "string" || description.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Description is required.",
        });
      }

      const raisedById = user._id || user.patientId;
      if (!raisedById) {
        return res.status(400).json({
          success: false,
          message: "Parent user ID not found in authentication. Please log in again.",
        });
      }

      const ticketData = {
        raisedByRole: "parent",
        raisedById,
        subject: subject.trim(),
        description: description.trim(),
        priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
        tags: Array.isArray(tags)
          ? tags.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
          : [],
      };

      const ticket = new TicketModel(ticketData);
      await ticket.save();

      res.json({
        success: true,
        ticket,
        message: "Ticket raised successfully.",
      });
    } catch (error) {
      if (error.name === "ValidationError") {
        return res.status(400).json({
          success: false,
          message: "Validation failed when creating ticket.",
          error: error.message,
        });
      }
      console.error("[RAISE TICKET]", error);
      res.status(500).json({
        success: false,
        message: "Failed to raise ticket.",
        error: error.message,
      });
    }
  }

// INSERT_YOUR_CODE
  async getAllPatientTickets(req, res) {
    try {
      const id = req.user.id;

      // INSERT_YOUR_CODE
      const user = await User.findById(id);

      if (!user || user.role !== "patient") {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Parent authentication required.",
        });
      }

      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 20;
      const skip = (page - 1) * limit;

      const query = {
        raisedByRole: "parent",
        raisedById: user._id,
      };

      const [tickets, total] = await Promise.all([
        TicketModel.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        TicketModel.countDocuments(query),
      ]);

      res.json({
        success: true,
        tickets,
        page,
        limit,
        total,
      });

    } catch (error) {
      console.error("[GET ALL PARENT TICKETS]", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch parent tickets.",
        error: error.message,
      });
    }
  }
// INSERT_YOUR_CODE

  async createConsultationBooking(req, res) {
    try {
      const clientId = req.user.id;
      const {
        patient,
        therapyType,
        scheduledAt,
        time,
        sessionType,
        reason
      } = req.body;

      console.log(req.body)

      const durationMinutes = 15;

      if (!therapyType || !scheduledAt || !sessionType) {
        return res.status(400).json({
          success: false,
          message: "therapyType, scheduledAt, and sessionType are required."
        });
      }

      let seqDoc = await counterSchema.findOneAndUpdate(
        { name: "consultationAppointmentId" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      const year = new Date().getFullYear();
      const seqStr = String(seqDoc.seq).padStart(5, '0');
      const consultationAppointmentId = `C-${year}-${seqStr}`;

      const booking = await ConsultationBooking.create({
        consultationAppointmentId,
        client: patient,
        therapy: therapyType,
        scheduledAt,
        time: time || undefined,
        durationMinutes: durationMinutes ? +durationMinutes : 15,
        sessionType,
        status: "pending",
        remark: reason
      });

      return res.status(201).json({
        success: true,
        booking
      });
    } catch (error) {
      console.error("[CREATE CONSULTATION BOOKING]", error);
      res.status(500).json({
        success: false,
        message: "Failed to create consultation booking.",
        error: error.message
      });
    }
  }

  async getConsultationBookings(req, res) {
    try {
      const parentId = req.user.id;
      if (!parentId) {
        return res.status(401).json({ success: false, message: "Unauthorized: Parent not found from token." });
      }

      const children = await PatientProfile.find({ userId: parentId }).lean();
      const childIds = children.map(child => child._id);

      const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
      const limit = parseInt(req.query.limit) > 0 ? parseInt(req.query.limit) : 20;
      const skip = (page - 1) * limit;

      const query = { client: { $in: childIds } };

      const [bookings, total] = await Promise.all([
        ConsultationBooking.find(query)
          .sort({ scheduledAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate({
            path: "client",
            model: "PatientProfile",
            select: "patientId name",
            populate: { path: "userId", model: "User", select: "name" }
          })
          .populate({
            path: "consultant",
            model: "TherapistProfile",
            select: "therapistId",
            populate: { path: "userId", model: "User", select: "name" }
          })
          .populate({ path: "therapy", model: "TherapyType", select: "name" })
          .lean(),
        ConsultationBooking.countDocuments(query)
      ]);

      res.json({
        success: true,
        bookings,
        total,
        page,
        limit
      });
    } catch (error) {
      console.error("[GET CONSULTATION BOOKINGS]", error);
      res.status(500).json({
        success: false,
        message: "Failed to retrieve consultation bookings.",
        error: error.message
      });
    }
  }

  /**
   * GET /api/parent/slot-availability?year=2025&month=5
   *
   * Returns slot-level availability for every day in the requested month,
   * aggregated across ALL active therapists — no therapist names or IDs are
   * exposed to the patient panel.
   *
   * Availability rules (mirrors the admin-panel frontend logic exactly):
   *   • Each active therapist contributes 10 normal + 5 limited slots per day.
   *   • A full-day holiday removes that therapist's entire contribution for that day.
   *   • A partial holiday (isFullDay=false) removes specific slots from that
   *     therapist's pool for that day.
   *   • A slot is "booked" when it appears in sessions.slotId for that therapist
   *     on that date in the Booking collection.
   *
   * Response shape:
   * {
   *   success: true,
   *   year: 2025,
   *   month: 5,          // 1-based
   *   days: {
   *     "2025-05-01": {
   *       slots: {
   *         "0830-0915": { label: "08:30 to 09:15", limited: true,  totalCapacity: 4, booked: 2, available: 2 },
   *         "1000-1045": { label: "10:00 to 10:45", limited: false, totalCapacity: 7, booked: 5, available: 2 },
   *         ...
   *       },
   *       summary: {
   *         totalNormalCapacity: 70, normalBooked: 50, normalAvailable: 20,
   *         totalLimitedCapacity: 20, limitedBooked: 10, limitedAvailable: 10,
   *       }
   *     },
   *     ...
   *   }
   * }
   */
  async getMonthlySlotAvailability(req, res) {
    console.log("hit");
    try {
      // ── 1. Parse & validate query params ─────────────────────────────────────
      const now = new Date();
      const year  = parseInt(req.query.year,  10) || now.getFullYear();
      const month = parseInt(req.query.month, 10) || (now.getMonth() + 1); // 1-based

      if (month < 1 || month > 12) {
        return res.status(400).json({ success: false, message: "month must be between 1 and 12." });
      }

      // ── 2. Slot master list (mirrors SESSION_TIME_OPTIONS in types.ts) ───────
      const SESSION_TIME_OPTIONS = [
        { id: '1000-1045', label: '10:00 to 10:45', limited: false },
        { id: '1045-1130', label: '10:45 to 11:30', limited: false },
        { id: '1130-1215', label: '11:30 to 12:15', limited: false },
        { id: '1215-1300', label: '12:15 to 13:00', limited: false },
        { id: '1300-1345', label: '13:00 to 13:45', limited: false },
        { id: '1415-1500', label: '14:15 to 15:00', limited: false },
        { id: '1500-1545', label: '15:00 to 15:45', limited: false },
        { id: '1545-1630', label: '15:45 to 16:30', limited: false },
        { id: '1630-1715', label: '16:30 to 17:15', limited: false },
        { id: '1715-1800', label: '17:15 to 18:00', limited: false },
        { id: '0830-0915', label: '08:30 to 09:15', limited: true  },
        { id: '0915-1000', label: '09:15 to 10:00', limited: true  },
        { id: '1800-1845', label: '18:00 to 18:45', limited: true  },
        { id: '1845-1930', label: '18:45 to 19:30', limited: true  },
        { id: '1930-2015', label: '19:30 to 20:15', limited: true  },
      ];
      const NORMAL_SLOTS_PER_THERAPIST  = 10;
      const LIMITED_SLOTS_PER_THERAPIST = 5;

      // Build a quick lookup: slotId → slot meta
      const slotMeta = {};
      for (const s of SESSION_TIME_OPTIONS) slotMeta[s.id] = s;

      // ── 3. Build all date strings for the requested month (YYYY-MM-DD) ───────
      const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
      const daysInMonth = new Date(year, month, 0).getDate(); // month is 1-based here
      const allDates = [];
      for (let d = 1; d <= daysInMonth; d++) {
        allDates.push(`${year}-${pad2(month)}-${pad2(d)}`);
      }

      // ── 4. Fetch all active therapists (with their holidays) ─────────────────
      const activeTherapists = await TherapistProfile.aggregate([
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $match: {
            "user.status": "active",
            "user.isDisabled": { $ne: true },
          },
        },
        {
          $project: {
            _id: 1,
            holidays: 1,   // needed for holiday exclusion
            // no name, no therapistId — patient panel must not see these
          },
        },
      ]);

      if (activeTherapists.length === 0) {
        // Return all-zero availability — no therapists means no slots
        const days = {};
        for (const dateStr of allDates) {
          const slots = {};
          for (const s of SESSION_TIME_OPTIONS) {
            slots[s.id] = { label: s.label, limited: s.limited, totalCapacity: 0, booked: 0, available: 0 };
          }
          days[dateStr] = {
            slots,
            summary: { totalNormalCapacity: 0, normalBooked: 0, normalAvailable: 0,
                        totalLimitedCapacity: 0, limitedBooked: 0, limitedAvailable: 0 },
          };
        }
        return res.json({ success: true, year, month, days });
      }

      // ── 5. Fetch all bookings for this month in one query ────────────────────
      // We only need sessions inside the month window — unwind + match is efficient.
      const monthStart = `${year}-${pad2(month)}-01`;
      const monthEnd   = `${year}-${pad2(month)}-${pad2(daysInMonth)}`;

      const bookedSessionRows = await Booking.aggregate([
        { $unwind: "$sessions" },
        {
          $match: {
            "sessions.date": { $gte: monthStart, $lte: monthEnd },
          },
        },
        {
          $project: {
            _id: 0,
            date:       "$sessions.date",
            slotId:     "$sessions.slotId",
            therapist:  "$sessions.therapist",  // ObjectId
          },
        },
      ]);

      // Build: bookedSlotsByTherapistDate[therapistId][date] = Set<slotId>
      // Using Sets prevents double-counting if the same slot somehow appears twice.
      const bookedSlotsByTherapistDate = {};
      for (const row of bookedSessionRows) {
        const tId = row.therapist?.toString();
        if (!tId || !row.date || !row.slotId) continue;
        if (!bookedSlotsByTherapistDate[tId]) bookedSlotsByTherapistDate[tId] = {};
        if (!bookedSlotsByTherapistDate[tId][row.date]) bookedSlotsByTherapistDate[tId][row.date] = new Set();
        bookedSlotsByTherapistDate[tId][row.date].add(row.slotId);
      }

      // ── 6. Compute availability per day, per slot ─────────────────────────────
      const days = {};

      for (const dateStr of allDates) {
        // Per-slot accumulators across all therapists for this day
        // slotCapacity[slotId] = number of therapists who can take that slot
        // slotBooked[slotId]   = number of therapists who already have it booked
        const slotCapacity = {};  // total capacity contributed by active therapists
        const slotBooked   = {};  // booked count across all therapists
        for (const s of SESSION_TIME_OPTIONS) {
          slotCapacity[s.id] = 0;
          slotBooked[s.id]   = 0;
        }

        for (const therapist of activeTherapists) {
          const tId = therapist._id.toString();

          // ── 6a. Full-day holiday → therapist contributes nothing today ────
          const isFullDayHoliday = (therapist.holidays || []).some(
            (h) => h.date === dateStr && (h.isFullDay === true || h.isFullDay === undefined)
          );
          if (isFullDayHoliday) continue;

          // ── 6b. Partial holidays → collect blocked slotIds for this therapist ─
          const blockedSlotIds = new Set();
          for (const h of therapist.holidays || []) {
            if (h.date === dateStr && h.isFullDay === false && Array.isArray(h.slots)) {
              for (const sl of h.slots) {
                if (sl.slotId) blockedSlotIds.add(sl.slotId);
              }
            }
          }

          // ── 6c. Remaining capacity for this therapist after partial holidays ─
          // A partial holiday reduces the therapist's normal/limited pool exactly
          // like the admin frontend does (mirrors lines 163-169 of AppointmentBookingSystemMain.tsx).
          let normalLeft  = NORMAL_SLOTS_PER_THERAPIST;
          let limitedLeft = LIMITED_SLOTS_PER_THERAPIST;
          for (const blockedId of blockedSlotIds) {
            const meta = slotMeta[blockedId];
            if (!meta) continue;
            if (meta.limited) limitedLeft = Math.max(0, limitedLeft - 1);
            else              normalLeft  = Math.max(0, normalLeft  - 1);
          }

          // ── 6d. Booked slots for this therapist on this date ──────────────
          const bookedSet = bookedSlotsByTherapistDate[tId]?.[dateStr] || new Set();

          // ── 6e. For each slot: decide if this therapist adds 1 capacity ───
          // A therapist "offers" a slot if:
          //   • it is not blocked by a partial holiday, AND
          //   • the category (normal/limited) still has room after holiday reductions
          // A therapist has the slot "booked" if it appears in bookedSet.
          for (const slot of SESSION_TIME_OPTIONS) {
            // Slot blocked by partial holiday → skip entirely (no capacity, no booking counted)
            if (blockedSlotIds.has(slot.id)) continue;

            // Category exhausted by holidays → this therapist can't offer this slot
            if ( slot.limited && limitedLeft  <= 0) continue;
            if (!slot.limited && normalLeft   <= 0) continue;

            // Therapist can offer this slot → add 1 to capacity
            slotCapacity[slot.id] += 1;

            // Is this specific slot already taken by this therapist?
            if (bookedSet.has(slot.id)) {
              slotBooked[slot.id] += 1;
            }
          }
        }

        // ── 6f. Build the per-slot response object & day summary ─────────────
        const slots = {};
        let totalNormalCapacity = 0, normalBooked = 0;
        let totalLimitedCapacity = 0, limitedBooked = 0;

        for (const s of SESSION_TIME_OPTIONS) {
          const capacity  = slotCapacity[s.id];
          const booked    = slotBooked[s.id];
          const available = Math.max(0, capacity - booked);

          slots[s.id] = {
            label:         s.label,
            limited:       s.limited,
            totalCapacity: capacity,
            booked,
            available,
          };

          if (s.limited) {
            totalLimitedCapacity += capacity;
            limitedBooked        += booked;
          } else {
            totalNormalCapacity  += capacity;
            normalBooked         += booked;
          }
        }

        days[dateStr] = {
          slots,
          summary: {
            totalNormalCapacity,
            normalBooked,
            normalAvailable:   Math.max(0, totalNormalCapacity  - normalBooked),
            totalLimitedCapacity,
            limitedBooked,
            limitedAvailable:  Math.max(0, totalLimitedCapacity - limitedBooked),
          },
        };
      }



      return res.json({ success: true, year, month, days });

    } catch (error) {
      console.error("[GET_MONTHLY_SLOT_AVAILABILITY]", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch slot availability.",
        error: error.message,
      });
    }
  }

  async updateConsultationBooking(req, res) {
    try {
      const parentId = req.user.id;
      const bookingId = req.params.id;
      const { status, scheduledAt, time, reason, therapyType, sessionType } = req.body;

      if (!bookingId) {
        return res.status(400).json({ success: false, message: "Booking ID is required." });
      }

      if (status && !['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status value." });
      }

      const parentUser = await User.findById(parentId).lean();
      if (!parentUser) {
        return res.status(401).json({ success: false, message: "Unauthorized: parent not found." });
      }
      const children = await PatientProfile.find({ userId: parentUser._id }).lean();
      const childIds = children.map(child => child._id);

      const booking = await ConsultationBooking.findOne({ _id: bookingId, client: { $in: childIds } });
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Consultation booking not found or access denied."
        });
      }

      if (typeof status !== "undefined") booking.status = status;
      if (typeof scheduledAt !== "undefined" && scheduledAt) booking.scheduledAt = scheduledAt;
      if (typeof time !== "undefined") booking.time = time;
      if (typeof reason !== "undefined") booking.remark = reason;
      if (typeof therapyType !== "undefined" && therapyType) booking.therapy = therapyType;
      if (typeof sessionType !== "undefined" && sessionType) booking.sessionType = sessionType;

      await booking.save();

      res.json({ success: true, booking });
    } catch (error) {
      console.error("[UPDATE CONSULTATION BOOKING]", error);
      res.status(500).json({
        success: false,
        message: "Failed to update consultation booking.",
        error: error?.message || error
      });
    }
  }
}

export default ParentController;