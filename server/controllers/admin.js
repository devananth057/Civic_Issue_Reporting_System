// server/controllers/admin.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

router.get('/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Not allowed' });
    const [[counts]] = await pool.query('SELECT COUNT(*) AS total_issues FROM issues');
    res.json({ success: true, stats: counts });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
