const nodemailer = require("nodemailer");

function getAppUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
}

function createTransport() {
  if (!isSmtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendMail({ to, subject, html, text }) {
  const from = process.env.SMTP_FROM || "Sharda Setu <noreply@shardasetu.local>";
  const transport = createTransport();

  if (!transport) {
    console.log("\n[email:dev] SMTP not configured — message logged:\n");
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  ${text || html}\n`);
    return { sent: false, dev: true };
  }

  await transport.sendMail({ from, to, subject, html, text });
  return { sent: true, dev: false };
}

async function sendVerificationEmail(user, token) {
  const url = `${getAppUrl()}/verify-email.html?token=${encodeURIComponent(token)}`;
  const subject = "Verify your Sharda Setu email";
  const text = `Hi ${user.name},\n\nVerify your email: ${url}\n\nThis link expires in 24 hours.`;
  const html = `
    <p>Hi ${user.name},</p>
    <p>Welcome to Sharda Setu. Please verify your email address:</p>
    <p><a href="${url}">Verify email</a></p>
    <p>Or copy this link: ${url}</p>
    <p>This link expires in 24 hours.</p>`;
  return sendMail({ to: user.email, subject, html, text });
}

async function sendPasswordResetEmail(user, token) {
  const url = `${getAppUrl()}/reset-password.html?token=${encodeURIComponent(token)}`;
  const subject = "Reset your Sharda Setu password";
  const text = `Hi ${user.name},\n\nReset your password: ${url}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`;
  const html = `
    <p>Hi ${user.name},</p>
    <p>We received a request to reset your password.</p>
    <p><a href="${url}">Reset password</a></p>
    <p>Or copy: ${url}</p>
    <p>This link expires in 1 hour.</p>`;
  return sendMail({ to: user.email, subject, html, text });
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  getAppUrl,
  isSmtpConfigured
};
