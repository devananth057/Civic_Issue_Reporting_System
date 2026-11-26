const nodemailer = require('nodemailer');
require('dotenv').config();

function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function emailSend(to, subject, text) {
  const transporter = getTransporter();
  if (!transporter) return;
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM || 'noreply@civicportal.in', to, subject, text });
    console.log(`[Notify] Email sent to ${to}`);
  } catch (err) { console.error('[Notify] Email send failed:', err.message); }
}

function emit(app, event, payload) {
  try {
    const io = app?.get('io') || global.io;
    if (io) io.emit(event, payload);
  } catch (e) { console.error('[Notify] Emit error:', e); }
}

async function notifyUser(app, userId, event, payload, email) {
  try {
    emit(app, event, { ...payload, targetUserId: userId });
    if (email) await emailSend(email, `Notification: ${event}`, JSON.stringify(payload, null, 2));
  } catch (err) { console.error('[Notify] notifyUser failed:', err); }
}

async function notifyEscalation(app, role, issueId, departmentName) {
  const subject = `⚠️ Escalation Alert: ${departmentName}`;
  const message = `Issue ${issueId} in ${departmentName} department escalated to ${role}`;
  emit(app, 'escalationAlert', { issueId, role, departmentName });
  if (process.env.ADMIN_ALERT_EMAILS) {
    const recipients = process.env.ADMIN_ALERT_EMAILS.split(',');
    for (const r of recipients) await emailSend(r.trim(), subject, message);
  }
}

module.exports = { emit, emailSend, notifyUser, notifyEscalation };
