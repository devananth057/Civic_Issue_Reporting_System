const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

// GET audit logs
// Optional query params: issueId, userId, limit, page
router.get('/', auth, async (req, res) => {
  try {
    const { issueId, userId, page = 1, limit = 50 } = req.query;
    let query = 'SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON a.user_id=u.id WHERE 1';
    const params = [];

    if (issueId) {
      query += ' AND a.issue_id=?';
      params.push(issueId);
    }
    if (userId) {
      query += ' AND a.user_id=?';
      params.push(userId);
    }

    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));

    const [rows] = await pool.query(query, params);
    res.json({ success: true, logs: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
