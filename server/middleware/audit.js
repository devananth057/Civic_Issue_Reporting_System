// server/middleware/audit.js
const pool = require('../db');

async function log(req, action, issueId, oldStatus, newStatus, details = null) {
  try {
    const userId = req.user ? req.user.id : null;
    await pool.query('INSERT INTO audit_logs (user_id, action, issue_id, old_status, new_status, details) VALUES (?,?,?,?,?,?)',
      [userId, action, issueId || null, oldStatus || null, newStatus || null, details]);
  } catch (e) {
    console.error('Audit log failed', e);
  }
}

module.exports = { log };
