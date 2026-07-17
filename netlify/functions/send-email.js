/**
 * arcCRM — Send email via Office 365 SMTP
 * Called internally by sign.js after a quote is signed
 *
 * Env vars required:
 *   SMTP_USER     — golfsignsproduction@gmail.com
 *   SMTP_PASS     — Gmail App Password (16-char, from Google Account → Security → App Passwords)
 *   SMTP_FROM     — display name + email (e.g. "arcCRM <golfsignsproduction@gmail.com>")
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(status, body) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// Send email via Office 365 SMTP using nodemailer
async function sendEmail({ to, subject, html, text }) {
  const nodemailer = require("nodemailer");

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    text,
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { error: "POST only" });

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return respond(500, { error: "Missing SMTP_USER or SMTP_PASS env vars" });
  }

  let payload;
  try { payload = JSON.parse(event.body); } catch { return respond(400, { error: "Invalid JSON" }); }

  const { to, subject, html, text } = payload;
  if (!to || !subject) return respond(400, { error: "Missing to or subject" });

  try {
    await sendEmail({ to, subject, html, text });
    return respond(200, { success: true });
  } catch (err) {
    console.error("Email send failed:", err.message);
    return respond(500, { error: err.message });
  }
};

exports.sendEmail = sendEmail;
