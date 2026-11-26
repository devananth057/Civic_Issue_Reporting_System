// server/controllers/feedback.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

router.post('/', auth, async (req, res) => {
  try {
    const { issueId, rating, comments } = req.body;
    if (!issueId || rating == null) return res.status(400).json({ error: 'Missing fields' });
    await pool.query('INSERT INTO feedback (issue_id, citizen_id, rating, comments) VALUES (?,?,?,?)', [issueId, req.user.id, rating, comments || null]);
    // if rating low, reopen
    if (rating <= 2) {
      await pool.query('UPDATE issues SET status = ? WHERE id = ?', ['REOPENED', issueId]);
    }
    res.json({ success: true, message: 'Feedback saved' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Feedback failed' });
  }
});

module.exports = router;
