import axios from "axios";

const AISENSY_API_KEY = process.env.API_CAMPAIGN_KEY || "";

class WhatsappController {
  /**
   * Send OTP verification message via AiSensy campaign API.
   * @param {Object} options - Options for sending OTP.
   * @param {string} options.destination - WhatsApp number (with country code, e.g., '919999999999').
   * @param {string} options.userName - Target user's name.
   * @param {string} options.otp - The OTP code to send.
   * @returns {Promise<Object>} - Resolves with response data or throws error.
   */
  async sendOtpVerification({ destination, userName, otp }) {
    const url = "https://backend.aisensy.com/campaign/t1/api/v2";
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
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      // Customize this error handling as needed
      throw error.response ? error.response.data : error;
    }
  }

  async superAdminForgetPasswordOtpVerification({ destination, userName, otp }) {
    const url = "https://backend.aisensy.com/campaign/t1/api/v2";
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
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      // Customize this error handling as needed
      throw error.response ? error.response.data : error;
    }
  }

  async sendSuperAdminLoginSuccess({ destination, userName, userNameParam, dateTime, device, location }) {
    const url = "https://backend.aisensy.com/campaign/t1/api/v2";
    const payload = {
      apiKey: AISENSY_API_KEY, // Should be set in your environment and required at top
      campaignName: "Super Admin Logged In Successfully",
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
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      throw error.response ? error.response.data : error;
    }
  }

  async sendSuperAdminPasswordResetSuccess({ destination, userName, userNameParam, dateTime, device, location }) {
    const url = "https://backend.aisensy.com/campaign/t1/api/v2";
    const payload = {
      apiKey: AISENSY_API_KEY, // Should be set in your environment and required at top
      campaignName: "Super Admin Password Reset Successfully",
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
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      throw error.response ? error.response.data : error;
    }
  }
}

export default new WhatsappController();