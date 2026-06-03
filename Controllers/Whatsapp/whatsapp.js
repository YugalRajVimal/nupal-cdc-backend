// import axios from "axios";

// const AISENSY_API_KEY = process.env.API_CAMPAIGN_KEY || "";

// class WhatsappController {

//   /**
//    * Send a custom message using a specific template with name and message.
//    * Sends using the AiSensy campaign API and expects a template with two placeholder params: [name, message]
//    * @param {Object} options
//    * @param {string} options.destination - WhatsApp number e.g. '919999999999'
//    * @param {string} options.name - Name to include in the template (1st param)
//    * @param {string} options.message - Custom message text (2nd param)
//    * @returns {Promise<Object>} - Resolves with response data or throws error
//    */
//   async sendCustomMessage({ destination, name, message }) {
//     const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//     const payload = {
//       apiKey: AISENSY_API_KEY,
//       campaignName: "Custom_Message_Template",
//       destination: destination || "",
//       userName: name || "",
//       source: "organic",
//       templateParams: [
//         name || "",
//         message || ""
//       ]
//     };

//     try {
//       const response = await axios.post(url, payload, {
//         headers: {
//           "Content-Type": "application/json",
//         },
//       });
//       return response.data;
//     } catch (error) {
//       throw error.response ? error.response.data : error;
//     }
//   }

  
//   /**
//    * Send OTP verification message via AiSensy campaign API.
//    * @param {Object} options - Options for sending OTP.
//    * @param {string} options.destination - WhatsApp number (with country code, e.g., '919999999999').
//    * @param {string} options.userName - Target user's name.
//    * @param {string} options.otp - The OTP code to send.
//    * @returns {Promise<Object>} - Resolves with response data or throws error.
//    */
//   async sendOtpVerification({ destination, userName, otp }) {
//     const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//     const payload = {
//       apiKey: AISENSY_API_KEY,
//       campaignName: "OTP_Verification",
//       destination: destination || "",
//       userName: userName || "",
//       source: "organic",
//       templateParams: [
//         otp || "000000"
//       ],
//       buttons: [
//         {
//           type: "button",
//           sub_type: "url",
//           index: "0",
//           parameters: [
//             {
//               type: "text",
//               text: otp || "000000"
//             }
//           ]
//         }
//       ]
//     };

//     try {
//       const response = await axios.post(url, payload, {
//         headers: {
//           'Content-Type': 'application/json'
//         }
//       });
//       return response.data;
//     } catch (error) {
//       // Customize this error handling as needed
//       throw error.response ? error.response.data : error;
//     }
//   }

//   async superAdminForgetPasswordOtpVerification({ destination, userName, otp }) {
//     const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//     const payload = {
//       apiKey: AISENSY_API_KEY,
//       campaignName: "OTP_Verification",
//       destination: destination || "",
//       userName: userName || "",
//       source: "organic",
//       templateParams: [
//         otp || "000000"
//       ],
//       buttons: [
//         {
//           type: "button",
//           sub_type: "url",
//           index: "0",
//           parameters: [
//             {
//               type: "text",
//               text: otp || "000000"
//             }
//           ]
//         }
//       ]
//     };

//     try {
//       const response = await axios.post(url, payload, {
//         headers: {
//           'Content-Type': 'application/json'
//         }
//       });
//       return response.data;
//     } catch (error) {
//       // Customize this error handling as needed
//       throw error.response ? error.response.data : error;
//     }
//   }

//   async sendSuperAdminLoginSuccess({ destination, userName, userNameParam, dateTime, device, location }) {
//     const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//     const payload = {
//       apiKey: AISENSY_API_KEY, // Should be set in your environment and required at top
//       campaignName: "superadmin_logged_in_successfully",
//       destination: destination || "",
//       userName: userName || "",
//       templateParams: [
//         userNameParam || "User Name",
//         dateTime || "date and time",
//         device || "device",
//         location || "location"
//       ]
//     };

//     try {
//       const response = await axios.post(url, payload, {
//         headers: {
//           'Content-Type': 'application/json'
//         }
//       });
//       return response.data;
//     } catch (error) {
//       throw error.response ? error.response.data : error;
//     }
//   }

//   async sendSuperAdminPasswordResetSuccess({ destination, userName, userNameParam, dateTime, device, location }) {
//     const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//     const payload = {
//       apiKey: AISENSY_API_KEY, // Should be set in your environment and required at top
//       campaignName: "superadmin_password_reset_successfully",
//       destination: destination || "",
//       userName: userName || "",
//       templateParams: [
//         userNameParam || "User Name",
//         dateTime || "date and time",
//         device || "device",
//         location || "location"
//       ]
//     };

//     try {
//       const response = await axios.post(url, payload, {
//         headers: {
//           'Content-Type': 'application/json'
//         }
//       });
//       return response.data;
//     } catch (error) {
//       throw error.response ? error.response.data : error;
//     }
//   }


//   /**
//    * Send Booking Creation Completed message via AiSensy campaign API.
//    * @param {Object} options - Options for sending the booking confirmation.
//    * @param {string} options.destination - WhatsApp number (with country code, e.g., '919999999999').
//    * @param {string} options.userName - Name of the user (goes into {{1}}).
//    * @param {string} options.appointmentId - Appointment ID ({{2}}).
//    * @param {string} options.patientName - Children Name ({{3}}).
//    * @param {string} options.therapist - Therapist Name ({{4}}).
//    * @param {string|number} options.totalSessions - Total Sessions ({{5}}).
//    * @param {string} options.paymentId - Payment ID ({{6}}).
//    * @returns {Promise<Object>} - Resolves with response data or throws error.
//    */
//   async sendBookingCreationCompleted({
//     destination,
//     userName,
//     appointmentId,
//     patientName,
//     therapist,
//     totalSessions,
//     paymentId
//   }) {
//     const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//     const payload = {
//       apiKey: AISENSY_API_KEY,
//       campaignName: "Booking Creation Completed",
//       destination: destination || "",
//       userName: userName || "",
//       templateParams: [
//         userName || "",
//         appointmentId || "",
//         patientName || "",
//         therapist || "",
//         totalSessions != null && totalSessions !== undefined ? String(totalSessions) : "",
//         paymentId || ""
//       ]
//     };

//     // Console.log checks
//     console.log("sendBookingCreationCompleted: called with params:", {
//       destination,
//       userName,
//       appointmentId,
//       patientName,
//       therapist,
//       totalSessions,
//       paymentId
//     });
//     console.log("sendBookingCreationCompleted: payload being sent:", payload);
    
//     try {
//       const response = await axios.post(url, payload, {
//         headers: {
//           "Content-Type": "application/json",
//         },
//       });
//       console.log("sendBookingCreationCompleted: API response:", response.data);
//       return response.data;
//     } catch (error) {
//       console.error("sendBookingCreationCompleted: API error:", error.response ? error.response.data : error);
//       throw error.response ? error.response.data : error;
//     }
//   }

// /**
//  * Sends a WhatsApp message when children registration (Children profile) is successful.
//  *
//  * Template:
//  *  - campaignName: "Children Registration Successfull"
//  *  - Params order:
//  *      {{1}}: userName (for greeting)
//  *      {{2}}: patientName
//  *      {{3}}: patientId
//  *      {{4}}: registeredMobile
//  *      {{5}}: createdOn
//  *
//  * @param {Object} params
//  * @param {string} params.destination - WhatsApp phone number (with country code)
//  * @param {string} params.userName - User's name (for greeting)
//  * @param {string} params.patientName - The name of the Children (child)
//  * @param {string} params.patientId - Patient/child unique ID
//  * @param {string} params.registeredMobile - Mobile number registered for the patient
//  * @param {string} params.createdOn - Date of registration/creation (string)
//  */
// async sendChildrenRegistrationSuccessfull({
//   destination,
//   userName,
//   patientName,
//   patientId,
//   registeredMobile,
//   createdOn
// }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Children Registration Successfull",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       patientName || "",
//       patientId || "",
//       registeredMobile || "",
//       createdOn || ""
//     ]
//   };

//   // Console.log checks
//   console.log("sendChildrenRegistrationSuccessfull: called with params:", {
//     destination,
//     userName,
//     patientName,
//     patientId,
//     registeredMobile,
//     createdOn
//   });
//   console.log("sendChildrenRegistrationSuccessfull: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendChildrenRegistrationSuccessfull: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendChildrenRegistrationSuccessfull: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }



// async sendBookingEditSuccess({
//   destination,
//   userName,
//   appointmentId,
//   patientName,
//   therapistName,
//   totalSessions,
//   status
// }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Booking Edited Successfully",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       appointmentId || "",
//       patientName || "",
//       therapistName || "",
//       String(totalSessions ?? ""),
//       status || ""
//     ]
//   };

//   // Logging for debugging
//   console.log("sendBookingEditSuccess: called with params:", {
//     destination,
//     userName,
//     appointmentId,
//     patientName,
//     therapistName,
//     totalSessions,
//     status
//   });
//   console.log("sendBookingEditSuccess: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendBookingEditSuccess: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendBookingEditSuccess: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }

// /**
//  * Send a WhatsApp notification when a session is marked as completed.
//  * 
//  * @param {Object} params
//  * @param {string} params.destination - Phone number to send WhatsApp message.
//  * @param {string} params.userName - Name of the user (patient) ({{1}}).
//  * @param {string} params.appointmentId - Appointment ID ({{2}}).
//  * @param {string} params.sessionId - Session ID ({{3}}).
//  * @param {string} params.completedAt - Datetime when the session was completed ({{4}}).
//  */
// async sendSessionCompleted({ destination, userName, appointmentId, sessionId, completedAt }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Mark Session Completed",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       appointmentId || "",
//       sessionId || "",
//       completedAt || "",
//     ]
//   };

//   // Debug logging
//   console.log("sendSessionCompleted: called with params:", {
//     destination,
//     userName,
//     appointmentId,
//     sessionId,
//     completedAt
//   });
//   console.log("sendSessionCompleted: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendSessionCompleted: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendSessionCompleted: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }

// /**
//  * Send a WhatsApp notification when a payment is collected successfully.
//  * 
//  * @param {Object} params
//  * @param {string} params.destination - Phone number to send WhatsApp message.
//  * @param {string} params.userName - Name of the user (patient) ({{1}}).
//  * @param {string} params.appointmentId - Appointment ID ({{2}}).
//  * @param {string|number} params.amount - Amount received ({{3}}).
//  * @param {string} params.paymentStatus - Payment status ({{4}}).
//  */
// async sendPaymentCollectedSuccessfully({ destination, userName, appointmentId, amount, paymentStatus }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Payment Collected Successfully",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       appointmentId || "",
//       amount || "",
//       paymentStatus || "",
//     ]
//   };

//   // Debug logging
//   console.log("sendPaymentCollectedSuccessfully: called with params:", {
//     destination,
//     userName,
//     appointmentId,
//     amount,
//     paymentStatus
//   });
//   console.log("sendPaymentCollectedSuccessfully: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendPaymentCollectedSuccessfully: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendPaymentCollectedSuccessfully: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }


// /**
//  * Send a WhatsApp notification when a therapist raises a support ticket.
//  * 
//  * @param {Object} params
//  * @param {string} params.destination - Phone number to send WhatsApp message.
//  * @param {string} params.therapistName - Therapist's name ({{1}})
//  * @param {string} params.subject - Ticket subject ({{2}})
//  * @param {string} params.priority - Ticket priority ({{3}})
//  * @param {string} params.ticketId - Ticket ID ({{4}})
//  * @returns {Promise<Object>} - Resolves with response data or throws error
//  */
// async sendTherapistTicketRaised({ destination, therapistName, subject, priority, ticketId }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Therapist Ticket Raised",
//     destination: destination || "",
//     userName: therapistName || "",
//     templateParams: [
//       therapistName || "",
//       subject || "",
//       priority || "",
//       ticketId || "",
//     ]
//   };

//   // Debug logging
//   console.log("sendTherapistTicketRaised: called with params:", {
//     destination,
//     therapistName,
//     subject,
//     priority,
//     ticketId
//   });
//   console.log("sendTherapistTicketRaised: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendTherapistTicketRaised: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendTherapistTicketRaised: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }


// /**
//  * Send a WhatsApp notification when a therapist's payment is initiated.
//  *
//  * Template:
//  * Hello {{1}},
//  *
//  * Your payment has been processed successfully.
//  *
//  * 💰 Payment Details:
//  * • Therapist Name: {{2}}
//  * • Amount Paid: ₹{{3}}
//  * • Payment Type: {{4}}
//  * • Period: {{5}} to {{6}}
//  *
//  * 📅 Paid On: {{7}}
//  *
//  * The transaction has been recorded in the system.
//  *
//  * Regards,
//  * Nupal CDC
//  *
//  * @param {Object} params
//  * @param {string} params.destination - Phone number to send WhatsApp message.
//  * @param {string} params.therapistName - Therapist's name ({{2}})
//  * @param {string} params.amountPaid - Amount paid (number or string) ({{3}})
//  * @param {string} params.paymentType - Payment Type (Cash, UPI, etc) ({{4}})
//  * @param {string} params.periodFrom - Period start (date string, e.g. '2024-05-01') ({{5}})
//  * @param {string} params.periodTo - Period end (date string, e.g. '2024-05-31') ({{6}})
//  * @param {string} params.paidOn - Paid on date string (e.g. '2024-06-03') ({{7}})
//  * @param {string} params.userName - Recipient's name ({{1}})
//  * @returns {Promise<Object>} - Resolves with response data or throws error
//  */
// async sendTherapistPaymentInitiated({
//   destination,
//   userName,
//   therapistName,
//   amountPaid,
//   paymentType,
//   periodFrom,
//   periodTo,
//   paidOn
// }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Therapist Payment Initiated",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       therapistName || "",
//       amountPaid != null ? String(amountPaid) : "",
//       paymentType || "",
//       periodFrom || "",
//       periodTo || "",
//       paidOn || ""
//     ]
//   };

//   // Debug logging
//   console.log("sendTherapistPaymentInitiated: called with params:", {
//     destination,
//     userName,
//     therapistName,
//     amountPaid,
//     paymentType,
//     periodFrom,
//     periodTo,
//     paidOn
//   });
//   console.log("sendTherapistPaymentInitiated: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendTherapistPaymentInitiated: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendTherapistPaymentInitiated: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }

// /**
//  * Sends WhatsApp notification: Children Profile Completed
//  * Template variables:
//  *   {{1}} - User Name
//  *   {{2}} - Child Name
//  *   {{3}} - Children ID
//  * 
//  * Example call:
//  *   await sendChildrenProfileCompleted({
//  *     destination: "+91xxxxxxxxxx",
//  *     userName: "Parent Name",
//  *     childName: "Child Name",
//  *     patientId: "P0001"
//  *   });
//  */
// async sendChildrenProfileCompleted({
//   destination,
//   userName,
//   childName,
//   patientId
// }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Children Profile Completed",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       childName || "",
//       patientId || ""
//     ]
//   };

//   // Debug logging
//   console.log("sendChildrenProfileCompleted: called with params:", {
//     destination,
//     userName,
//     childName,
//     patientId
//   });
//   console.log("sendChildrenProfileCompleted: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendChildrenProfileCompleted: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendChildrenProfileCompleted: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }

// /**
//  * Sends WhatsApp message to therapist when their profile is completed.
//  * Example call:
//  *   await sendTherapistProfileCompleted({
//  *     destination: "+91xxxxxxxxxx",
//  *     userName: "Therapist Name",
//  *     therapistId: "T0001",
//  *     specializations: "Speech Therapy, Occupational Therapy",
//  *     experience: "5"
//  *   });
//  */
// async sendTherapistProfileCompleted({
//   destination,
//   userName,
//   therapistId,
//   specializations,
//   experience
// }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Therapist Profile Completed",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       therapistId || "",
//       specializations || "",
//       experience || ""
//     ]
//   };

//   // Debug logging
//   console.log("sendTherapistProfileCompleted: called with params:", {
//     destination,
//     userName,
//     therapistId,
//     specializations,
//     experience
//   });
//   console.log("sendTherapistProfileCompleted: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendTherapistProfileCompleted: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendTherapistProfileCompleted: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }

// // INSERT_YOUR_CODE

// /**
//  * Send WhatsApp notification for Booking Request Rejected.
//  *
//  * WhatsApp Template:
//  * -- Hello {{1}},
//  *
//  * We regret to inform you that your booking request has been rejected.
//  *
//  * 📌 Booking ID: {{2}}
//  *
//  * 📅 Date: {{3}}
//  *
//  * ⏰ Time: {{4}}
//  *
//  * If you have any questions or would like to request another booking, feel free to contact us.
//  *
//  * Thank you for your understanding.
//  *
//  * Regards,
//  * Nupal CDC
//  *
//  * @param {Object} options
//  * @param {string} options.destination - WhatsApp number (e.g., '919999999999')
//  * @param {string} options.userName - User's name (to personalize greeting)
//  * @param {string} options.bookingId - The booking ID
//  * @param {string} options.date - Booking date (string, e.g. "2024-06-01")
//  * @param {string} options.time - Booking time (string, e.g. "14:30")
//  *
//  * @returns {Promise<Object>} Resolves with response data or throws error
//  */
// async sendBookingRequestRejected({
//   destination,
//   userName,
//   bookingId,
//   date,
//   time
// }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Booking Request Rejected",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       bookingId || "",
//       date || "",
//       time || ""
//     ]
//   };

//   // Debug logging
//   console.log("sendBookingRequestRejected: called with params:", {
//     destination,
//     userName,
//     bookingId,
//     date,
//     time
//   });
//   console.log("sendBookingRequestRejected: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendBookingRequestRejected: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendBookingRequestRejected: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }

// /**
//  * Send WhatsApp notification for Session Edit Request Status Update
//  *
//  * @param {Object} options - Notification options
//  * @param {string} options.destination - WhatsApp phone number (with country code)
//  * @param {string} options.userName - User name
//  * @param {string} options.status - Status ("approved", "rejected", "pending", etc.)
//  * @param {string} options.appointmentId - Appointment/Booking reference ID
//  * @param {string} options.extraMessage - Extra message to be sent (string, e.g. details/reason)
//  *
//  * @returns {Promise<Object>} Resolves with response data or throws error
//  */
// async sendSessionEditRequestStatusUpdate({
//   destination,
//   userName,
//   status,
//   appointmentId,
//   extraMessage
// }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "Session Edit Request Status Update",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       (status ? String(status).toUpperCase() : ""),
//       appointmentId || "",
//       extraMessage || ""
//     ]
//   };

//   // Debug logging
//   console.log("sendSessionEditRequestStatusUpdate: called with params:", {
//     destination,
//     userName,
//     status,
//     appointmentId,
//     extraMessage
//   });
//   console.log("sendSessionEditRequestStatusUpdate: payload being sent:", payload);

//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendSessionEditRequestStatusUpdate: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendSessionEditRequestStatusUpdate: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }

// /**
//  * Send WhatsApp message for Consultation Booking Status Update.
//  *
//  * Template:
//  *  Hello {{1}},
//  *
//  *  Your consultation booking status is now {{2}}.
//  *
//  *  📅 Booking Details:
//  *  • Date: {{3}}
//  *  • Time: {{4}}
//  *  • Consultant: {{5}}
//  *
//  *  {{6}}
//  *
//  *  Regards,
//  *  Nupal CDC
//  *
//  * @param {Object} options
//  * @param {string} options.destination - Recipient WhatsApp number (+91XXX or full int'l w/o spaces)
//  * @param {string} options.userName - Patient/User name (for {{1}})
//  * @param {string} options.status - Status (for {{2}}) e.g. "confirmed"
//  * @param {string} options.date - Booking Date (for {{3}})
//  * @param {string} options.time - Booking Time (for {{4}})
//  * @param {string} options.consultantName - Consultant's name (for {{5}})
//  * @param {string} options.extraMessage - Extra message for {{6}}
//  *
//  * @returns {Promise<Object>} Resolves with response data or throws error
//  */
// async sendConsultationBookingStatusUpdate({
//   destination,
//   userName,
//   status,
//   date,
//   time,
//   consultantName,
//   extraMessage
// }) {
//   const url = "https://backend.aisensy.com/campaign/t1/api/v2";
//   const payload = {
//     apiKey: AISENSY_API_KEY,
//     campaignName: "consultation booking status update",
//     destination: destination || "",
//     userName: userName || "",
//     templateParams: [
//       userName || "",
//       status ? String(status).toUpperCase() : "",
//       date || "",
//       time || "",
//       extraMessage || ""
//     ]
//   };


//   try {
//     const response = await axios.post(url, payload, {
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });
//     console.log("sendConsultationBookingStatusUpdate: API response:", response.data);
//     return response.data;
//   } catch (error) {
//     console.error("sendConsultationBookingStatusUpdate: API error:", error.response ? error.response.data : error);
//     throw error.response ? error.response.data : error;
//   }
// }




// }

// export default new WhatsappController();

import axios from "axios";

const AISENSY_API_KEY = process.env.API_CAMPAIGN_KEY || "";

// ─── HOLD SWITCH ──────────────────────────────────────────────────────────────
// Set to false to silently pause ALL WhatsApp messages across every method.
// Set back to true to resume instantly. No other changes needed anywhere.
const WHATSAPP_ENABLED = true;
// ─────────────────────────────────────────────────────────────────────────────

class WhatsappController {

  /**
   * Internal send wrapper — the single place that touches axios.
   * Every public method calls this instead of axios directly.
   * When WHATSAPP_ENABLED is false the call is skipped and a
   * no-op result is returned so callers never throw.
   */
  async _send(payload) {
    if (!WHATSAPP_ENABLED) {
      console.warn(`[WhatsApp HOLD] Suppressed \${payload.campaignName} → \${payload.destination}`);
      return { held: true, campaignName: payload.campaignName };
    }
    const url = 'https://backend.aisensy.com/campaign/t1/api/v2';
    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    return response.data;
  }

  /**
   * Send a custom message using a specific template with name and message.
   * Sends using the AiSensy campaign API and expects a template with two placeholder params: [name, message]
   * @param {Object} options
   * @param {string} options.destination - WhatsApp number e.g. '919999999999'
   * @param {string} options.name - Name to include in the template (1st param)
   * @param {string} options.message - Custom message text (2nd param)
   * @returns {Promise<Object>} - Resolves with response data or throws error
   */
  async sendCustomMessage({ destination, name, message }) {
    const payload = {
      apiKey: AISENSY_API_KEY,
      campaignName: "Custom_Message_Template",
      destination: destination || "",
      userName: name || "",
      source: "organic",
      templateParams: [
        name || "",
        message || ""
      ]
    };

    try {
      const result = await this._send(payload);

      return result;
    } catch (error) {

      throw error?.response?.data || error;
    }
  }

  
  /**
   * Send OTP verification message via AiSensy campaign API.
   * @param {Object} options - Options for sending OTP.
   * @param {string} options.destination - WhatsApp number (with country code, e.g., '919999999999').
   * @param {string} options.userName - Target user's name.
   * @param {string} options.otp - The OTP code to send.
   * @returns {Promise<Object>} - Resolves with response data or throws error.
   */
  async sendOtpVerification({ destination, userName, otp }) {
    const payload = {
      apiKey: AISENSY_API_KEY,
      campaignName: "OTP_Verification",
      destination: destination || "",
      userName: userName || "",
      source: "organic",
      templateParams: [
        otp || "000000"
      ],
      buttons: [
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [
            {
              type: "text",
              text: otp || "000000"
            }
          ]
        }
      ]
    };

    try {
      const result = await this._send(payload);

      return result;
    } catch (error) {

      throw error?.response?.data || error;
    }
  }

  async superAdminForgetPasswordOtpVerification({ destination, userName, otp }) {
    const payload = {
      apiKey: AISENSY_API_KEY,
      campaignName: "OTP_Verification",
      destination: destination || "",
      userName: userName || "",
      source: "organic",
      templateParams: [
        otp || "000000"
      ],
      buttons: [
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [
            {
              type: "text",
              text: otp || "000000"
            }
          ]
        }
      ]
    };

    try {
      const result = await this._send(payload);

      return result;
    } catch (error) {

      throw error?.response?.data || error;
    }
  }

  async sendSuperAdminLoginSuccess({ destination, userName, userNameParam, dateTime, device, location }) {
    const payload = {
      apiKey: AISENSY_API_KEY, // Should be set in your environment and required at top
      campaignName: "superadmin_logged_in_successfully",
      destination: destination || "",
      userName: userName || "",
      templateParams: [
        userNameParam || "User Name",
        dateTime || "date and time",
        device || "device",
        location || "location"
      ]
    };

    try {
      const result = await this._send(payload);

      return result;
    } catch (error) {

      throw error?.response?.data || error;
    }
  }

  async sendSuperAdminPasswordResetSuccess({ destination, userName, userNameParam, dateTime, device, location }) {
    const payload = {
      apiKey: AISENSY_API_KEY, // Should be set in your environment and required at top
      campaignName: "superadmin_password_reset_successfully",
      destination: destination || "",
      userName: userName || "",
      templateParams: [
        userNameParam || "User Name",
        dateTime || "date and time",
        device || "device",
        location || "location"
      ]
    };

    try {
      const result = await this._send(payload);

      return result;
    } catch (error) {

      throw error?.response?.data || error;
    }
  }


  /**
   * Send Booking Creation Completed message via AiSensy campaign API.
   * @param {Object} options - Options for sending the booking confirmation.
   * @param {string} options.destination - WhatsApp number (with country code, e.g., '919999999999').
   * @param {string} options.userName - Name of the user (goes into {{1}}).
   * @param {string} options.appointmentId - Appointment ID ({{2}}).
   * @param {string} options.patientName - Children Name ({{3}}).
   * @param {string} options.therapist - Therapist Name ({{4}}).
   * @param {string|number} options.totalSessions - Total Sessions ({{5}}).
   * @param {string} options.paymentId - Payment ID ({{6}}).
   * @returns {Promise<Object>} - Resolves with response data or throws error.
   */
  async sendBookingCreationCompleted({
    destination,
    userName,
    appointmentId,
    patientName,
    totalSessions,
    paymentId
  }) {
    const payload = {
      apiKey: AISENSY_API_KEY,
      campaignName: "Booking Creation Completed New",
      destination: destination || "",
      userName: userName || "",
      templateParams: [
        userName || "",
        appointmentId || "",
        patientName || "",
        totalSessions != null && totalSessions !== undefined ? String(totalSessions) : "",
        paymentId || ""
      ]
    };

    // Console.log checks
    console.log("sendBookingCreationCompleted: called with params:", {
      destination,
      userName,
      appointmentId,
      patientName,
      totalSessions,
      paymentId
    });
    console.log("sendBookingCreationCompleted: payload being sent:", payload);
    
    try {
      const result = await this._send(payload);
      console.log("sendBookingCreationCompleted: API response:", result);
      return result;
    } catch (error) {
      console.error("sendBookingCreationCompleted: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
  }

/**
 * Sends a WhatsApp message when children registration (Children profile) is successful.
 *
 * Template:
 *  - campaignName: "Children Registration Successfull"
 *  - Params order:
 *      {{1}}: userName (for greeting)
 *      {{2}}: patientName
 *      {{3}}: patientId
 *      {{4}}: registeredMobile
 *      {{5}}: createdOn
 *
 * @param {Object} params
 * @param {string} params.destination - WhatsApp phone number (with country code)
 * @param {string} params.userName - User's name (for greeting)
 * @param {string} params.patientName - The name of the Children (child)
 * @param {string} params.patientId - Patient/child unique ID
 * @param {string} params.registeredMobile - Mobile number registered for the patient
 * @param {string} params.createdOn - Date of registration/creation (string)
 */
async sendChildrenRegistrationSuccessfull({
  destination,
  userName,
  patientName,
  patientId,
  registeredMobile,
  createdOn
}) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Children Registration Successfull New",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      patientName || "",
      patientId || "",
      registeredMobile || "",
      createdOn || ""
    ]
  };

  // Console.log checks
  console.log("sendChildrenRegistrationSuccessfull: called with params:", {
    destination,
    userName,
    patientName,
    patientId,
    registeredMobile,
    createdOn
  });
  console.log("sendChildrenRegistrationSuccessfull: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendChildrenRegistrationSuccessfull: API response:", result);
      return result;
    } catch (error) {
      console.error("sendChildrenRegistrationSuccessfull: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}



async sendBookingEditSuccess({
  destination,
  userName,
  appointmentId,
  patientName,
  totalSessions,
  status
}) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Booking Edited Successfully New",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      appointmentId || "",
      patientName || "",
      String(totalSessions ?? ""),
      status || ""
    ]
  };

  // Logging for debugging
  console.log("sendBookingEditSuccess: called with params:", {
    destination,
    userName,
    appointmentId,
    patientName,
    totalSessions,
    status
  });
  console.log("sendBookingEditSuccess: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendBookingEditSuccess: API response:", result);
      return result;
    } catch (error) {
      console.error("sendBookingEditSuccess: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}

/**
 * Send a WhatsApp notification when a session is marked as completed.
 * 
 * @param {Object} params
 * @param {string} params.destination - Phone number to send WhatsApp message.
 * @param {string} params.userName - Name of the user (patient) ({{1}}).
 * @param {string} params.appointmentId - Appointment ID ({{2}}).
 * @param {string} params.sessionId - Session ID ({{3}}).
 * @param {string} params.completedAt - Datetime when the session was completed ({{4}}).
 */
async sendSessionCompleted({ destination, userName, appointmentId, sessionId, completedAt }) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Mark Session Completed New",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      appointmentId || "",
      sessionId || "",
      completedAt || "",
    ]
  };

  // Debug logging
  console.log("sendSessionCompleted: called with params:", {
    destination,
    userName,
    appointmentId,
    sessionId,
    completedAt
  });
  console.log("sendSessionCompleted: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendSessionCompleted: API response:", result);
      return result;
    } catch (error) {
      console.error("sendSessionCompleted: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}

/**
 * Send a WhatsApp notification when a payment is collected successfully.
 * 
 * @param {Object} params
 * @param {string} params.destination - Phone number to send WhatsApp message.
 * @param {string} params.userName - Name of the user (patient) ({{1}}).
 * @param {string} params.appointmentId - Appointment ID ({{2}}).
 * @param {string|number} params.amount - Amount received ({{3}}).
 * @param {string} params.paymentStatus - Payment status ({{4}}).
 */
async sendPaymentCollectedSuccessfully({ destination, userName, appointmentId, amount, paymentStatus }) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Payment Collected Successfully",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      appointmentId || "",
      amount || "",
      paymentStatus || "",
    ]
  };

  // Debug logging
  console.log("sendPaymentCollectedSuccessfully: called with params:", {
    destination,
    userName,
    appointmentId,
    amount,
    paymentStatus
  });
  console.log("sendPaymentCollectedSuccessfully: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendPaymentCollectedSuccessfully: API response:", result);
      return result;
    } catch (error) {
      console.error("sendPaymentCollectedSuccessfully: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}


/**
 * Send a WhatsApp notification when a therapist raises a support ticket.
 * 
 * @param {Object} params
 * @param {string} params.destination - Phone number to send WhatsApp message.
 * @param {string} params.therapistName - Therapist's name ({{1}})
 * @param {string} params.subject - Ticket subject ({{2}})
 * @param {string} params.priority - Ticket priority ({{3}})
 * @param {string} params.ticketId - Ticket ID ({{4}})
 * @returns {Promise<Object>} - Resolves with response data or throws error
 */
async sendTherapistTicketRaised({ destination, therapistName, subject, priority, ticketId }) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Therapist Ticket Raised",
    destination: destination || "",
    userName: therapistName || "",
    templateParams: [
      therapistName || "",
      subject || "",
      priority || "",
      ticketId || "",
    ]
  };

  // Debug logging
  console.log("sendTherapistTicketRaised: called with params:", {
    destination,
    therapistName,
    subject,
    priority,
    ticketId
  });
  console.log("sendTherapistTicketRaised: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendTherapistTicketRaised: API response:", result);
      return result;
    } catch (error) {
      console.error("sendTherapistTicketRaised: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}


/**
 * Send a WhatsApp notification when a therapist's payment is initiated.
 *
 * Template:
 * Hello {{1}},
 *
 * Your payment has been processed successfully.
 *
 * 💰 Payment Details:
 * • Therapist Name: {{2}}
 * • Amount Paid: ₹{{3}}
 * • Payment Type: {{4}}
 * • Period: {{5}} to {{6}}
 *
 * 📅 Paid On: {{7}}
 *
 * The transaction has been recorded in the system.
 *
 * Regards,
 * Nupal CDC
 *
 * @param {Object} params
 * @param {string} params.destination - Phone number to send WhatsApp message.
 * @param {string} params.therapistName - Therapist's name ({{2}})
 * @param {string} params.amountPaid - Amount paid (number or string) ({{3}})
 * @param {string} params.paymentType - Payment Type (Cash, UPI, etc) ({{4}})
 * @param {string} params.periodFrom - Period start (date string, e.g. '2024-05-01') ({{5}})
 * @param {string} params.periodTo - Period end (date string, e.g. '2024-05-31') ({{6}})
 * @param {string} params.paidOn - Paid on date string (e.g. '2024-06-03') ({{7}})
 * @param {string} params.userName - Recipient's name ({{1}})
 * @returns {Promise<Object>} - Resolves with response data or throws error
 */
async sendTherapistPaymentInitiated({
  destination,
  userName,
  therapistName,
  amountPaid,
  paymentType,
  periodFrom,
  periodTo,
  paidOn
}) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Therapist Payment Initiated",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      therapistName || "",
      amountPaid != null ? String(amountPaid) : "",
      paymentType || "",
      periodFrom || "",
      periodTo || "",
      paidOn || ""
    ]
  };

  // Debug logging
  console.log("sendTherapistPaymentInitiated: called with params:", {
    destination,
    userName,
    therapistName,
    amountPaid,
    paymentType,
    periodFrom,
    periodTo,
    paidOn
  });
  console.log("sendTherapistPaymentInitiated: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendTherapistPaymentInitiated: API response:", result);
      return result;
    } catch (error) {
      console.error("sendTherapistPaymentInitiated: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}

/**
 * Sends WhatsApp notification: Children Profile Completed
 * Template variables:
 *   {{1}} - User Name
 *   {{2}} - Child Name
 *   {{3}} - Children ID
 * 
 * Example call:
 *   await sendChildrenProfileCompleted({
 *     destination: "+91xxxxxxxxxx",
 *     userName: "Parent Name",
 *     childName: "Child Name",
 *     patientId: "P0001"
 *   });
 */
async sendChildrenProfileCompleted({
  destination,
  userName,
  childName,
  patientId
}) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Children Profile Completed New",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      childName || "",
      patientId || ""
    ]
  };

  // Debug logging
  console.log("sendChildrenProfileCompleted: called with params:", {
    destination,
    userName,
    childName,
    patientId
  });
  console.log("sendChildrenProfileCompleted: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendChildrenProfileCompleted: API response:", result);
      return result;
    } catch (error) {
      console.error("sendChildrenProfileCompleted: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}

/**
 * Sends WhatsApp message to therapist when their profile is completed.
 * Example call:
 *   await sendTherapistProfileCompleted({
 *     destination: "+91xxxxxxxxxx",
 *     userName: "Therapist Name",
 *     therapistId: "T0001",
 *     specializations: "Speech Therapy, Occupational Therapy",
 *     experience: "5"
 *   });
 */
async sendTherapistProfileCompleted({
  destination,
  userName,
  therapistId,
  specializations,
  experience
}) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Therapist Profile Completed",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      therapistId || "",
      specializations || "",
      experience || ""
    ]
  };

  // Debug logging
  console.log("sendTherapistProfileCompleted: called with params:", {
    destination,
    userName,
    therapistId,
    specializations,
    experience
  });
  console.log("sendTherapistProfileCompleted: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendTherapistProfileCompleted: API response:", result);
      return result;
    } catch (error) {
      console.error("sendTherapistProfileCompleted: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}

// INSERT_YOUR_CODE

/**
 * Send WhatsApp notification for Booking Request Rejected.
 *
 * WhatsApp Template:
 * -- Hello {{1}},
 *
 * We regret to inform you that your booking request has been rejected.
 *
 * 📌 Booking ID: {{2}}
 *
 * 📅 Date: {{3}}
 *
 * ⏰ Time: {{4}}
 *
 * If you have any questions or would like to request another booking, feel free to contact us.
 *
 * Thank you for your understanding.
 *
 * Regards,
 * Nupal CDC
 *
 * @param {Object} options
 * @param {string} options.destination - WhatsApp number (e.g., '919999999999')
 * @param {string} options.userName - User's name (to personalize greeting)
 * @param {string} options.bookingId - The booking ID
 * @param {string} options.date - Booking date (string, e.g. "2024-06-01")
 * @param {string} options.time - Booking time (string, e.g. "14:30")
 *
 * @returns {Promise<Object>} Resolves with response data or throws error
 */
async sendBookingRequestRejected({
  destination,
  userName,
  bookingId,
  date,
  time
}) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Booking Request Not Approved",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      bookingId || "",
      date || "",
      time || ""
    ]
  };

  // Debug logging
  console.log("sendBookingRequestRejected: called with params:", {
    destination,
    userName,
    bookingId,
    date,
    time
  });
  console.log("sendBookingRequestRejected: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendBookingRequestRejected: API response:", result);
      return result;
    } catch (error) {
      console.error("sendBookingRequestRejected: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}

/**
 * Send WhatsApp notification for Session Edit Request Status Update
 *
 * @param {Object} options - Notification options
 * @param {string} options.destination - WhatsApp phone number (with country code)
 * @param {string} options.userName - User name
 * @param {string} options.status - Status ("approved", "rejected", "pending", etc.)
 * @param {string} options.appointmentId - Appointment/Booking reference ID
 * @param {string} options.extraMessage - Extra message to be sent (string, e.g. details/reason)
 *
 * @returns {Promise<Object>} Resolves with response data or throws error
 */
async sendSessionEditRequestStatusUpdate({
  destination,
  userName,
  status,
  appointmentId,
  extraMessage
}) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "Session Edit Request Status Update New",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      (status ? String(status).toUpperCase() : ""),
      appointmentId || "",
      extraMessage || ""
    ]
  };

  // Debug logging
  console.log("sendSessionEditRequestStatusUpdate: called with params:", {
    destination,
    userName,
    status,
    appointmentId,
    extraMessage
  });
  console.log("sendSessionEditRequestStatusUpdate: payload being sent:", payload);

  try {
      const result = await this._send(payload);
      console.log("sendSessionEditRequestStatusUpdate: API response:", result);
      return result;
    } catch (error) {
      console.error("sendSessionEditRequestStatusUpdate: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}

/**
 * Send WhatsApp message for Consultation Booking Status Update.
 *
 * Template:
 *  Hello {{1}},
 *
 *  Your consultation booking status is now {{2}}.
 *
 *  📅 Booking Details:
 *  • Date: {{3}}
 *  • Time: {{4}}
 *  • Consultant: {{5}}
 *
 *  {{6}}
 *
 *  Regards,
 *  Nupal CDC
 *
 * @param {Object} options
 * @param {string} options.destination - Recipient WhatsApp number (+91XXX or full int'l w/o spaces)
 * @param {string} options.userName - Patient/User name (for {{1}})
 * @param {string} options.status - Status (for {{2}}) e.g. "confirmed"
 * @param {string} options.date - Booking Date (for {{3}})
 * @param {string} options.time - Booking Time (for {{4}})
 * @param {string} options.consultantName - Consultant's name (for {{5}})
 * @param {string} options.extraMessage - Extra message for {{6}}
 *
 * @returns {Promise<Object>} Resolves with response data or throws error
 */
async sendConsultationBookingStatusUpdate({
  destination,
  userName,
  status,
  date,
  time,
  consultantName,
  extraMessage
}) {
  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "consultation booking status update",
    destination: destination || "",
    userName: userName || "",
    templateParams: [
      userName || "",
      status ? String(status).toUpperCase() : "",
      date || "",
      time || "",
      extraMessage || ""
    ]
  };


  try {
      const result = await this._send(payload);
      console.log("sendConsultationBookingStatusUpdate: API response:", result);
      return result;
    } catch (error) {
      console.error("sendConsultationBookingStatusUpdate: API error:", error?.response?.data || error);
      throw error?.response?.data || error;
    }
}




}

export default new WhatsappController();