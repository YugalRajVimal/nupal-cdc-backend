import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAILER_USER,
    pass: process.env.MAILER_PASS,
  },
});

const sendMail = (email, subject, message) => {
  return new Promise((resolve, reject) => {
    const mailOptions = {
      from: process.env.MAILER_USER,
      to: email,
      subject: subject,
      text: message,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        return reject(error);
      }
      console.log("Email sent: " + info.response);
      resolve(info);
    });
  });
};

export default sendMail;
