const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');



/* =========================================================
   HELPER: ADD USER (SUPERVISOR / FIELDWORKER)
========================================================= */
async function addUser(req, res, forcedRole = null) {
  try {
    // ✅ Only head or supervisor can add users
    if (!['head', 'supervisor'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Not allowed' });
    }

    const { name, phone, ward, department_id, password } = req.body;
    const role = forcedRole || req.body.role;

    // ✅ Basic validation
    if (!name || !phone || !role || !department_id || !password) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // ✅ Role rules
    if (req.user.role === 'head' && role !== 'supervisor') {
      return res.status(403).json({ error: 'Head can add only supervisors' });
    }

    if (req.user.role === 'supervisor' && role !== 'fieldworker') {
      return res.status(403).json({ error: 'Supervisor can add only fieldworkers' });
    }

    // ✅ Phone must be unique globally
    const [exists] = await pool.query(
      'SELECT id FROM users WHERE phone=?',
      [phone]
    );
    if (exists.length) {
      return res.status(400).json({ error: 'User with this phone already exists' });
    }

    // ✅ Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // ✅ Insert user
    await pool.query(
      `INSERT INTO users
       (name, phone, password_hash, role, ward, department_id,
        is_verified, isActive, isBusy)
       VALUES (?,?,?,?,?,?,1,1,0)`,
      [
        name.trim(),
        phone.trim(),
        password_hash,
        role,
        ward || null,
        department_id
      ]
    );

    res.json({ success: true, message: `${role} added successfully` });

  } catch (err) {
    console.error('[addUser]', err);
    res.status(500).json({ error: 'Failed to add user' });
  }
}

/* =========================================================
   ADD ROUTES
========================================================= */
router.post('/add', auth, (req, res) => addUser(req, res));
router.post('/addSupervisor', auth, (req, res) => addUser(req, res, 'supervisor'));

/* =========================================================
   DROPDOWN
   - Head: active users (busy OR free)
   - Supervisor: active AND free only
========================================================= */
router.get('/dropdown', auth, async (req, res) => {
  try {
    const { role, department_id } = req.query;
    if (!role || !department_id) {
      return res.status(400).json({ error: 'Missing role or department_id' });
    }

    let query = `
      SELECT id, name, phone, ward, isBusy
      FROM users
      WHERE role = ?
        AND department_id = ?
        AND isActive = 1
    `;

    // 🔒 Supervisor assigning fieldworkers → only FREE
    if (req.user.role === 'supervisor') {
      query += ' AND isBusy = 0';
    }

    const [users] = await pool.query(query, [role, department_id]);

    res.json({ success: true, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dropdown users' });
  }
});

/* =========================================================
   SUPERVISORS BY STATUS (HEAD DASHBOARD)
========================================================= */
router.get('/supervisorsByStatus', auth, async (req, res) => {
  try {
    const { department_id } = req.query;
    if (!department_id) {
      return res.status(400).json({ error: 'department_id required' });
    }

    const [rows] = await pool.query(
      `SELECT id, name, isActive, isBusy
       FROM users
       WHERE role='supervisor'
         AND department_id=?`,
      [department_id]
    );

    const active = [];
    const working = [];
    const inactive = [];

    rows.forEach(u => {
      if (u.isActive === 0) inactive.push(u);
      else if (u.isBusy === 1) working.push(u);
      else active.push(u);
    });

    res.json({ success: true, active, working, inactive });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load supervisors' });
  }
});
/* =========================================================
   FIELDWORKERS BY STATUS (SUPERVISOR DASHBOARD)
========================================================= */
router.get('/fieldworkersByStatus', auth, async (req, res) => {
  try {
    const { department_id } = req.query;
    if (!department_id) {
      return res.status(400).json({ error: 'department_id required' });
    }

    const [rows] = await pool.query(
      `SELECT id, name, isActive, isBusy
       FROM users
       WHERE role='fieldworker'
         AND department_id=?`,
      [department_id]
    );

    const active = [];
    const working = [];
    const inactive = [];

    rows.forEach(u => {
      if (u.isActive === 0) inactive.push(u);
      else if (u.isBusy === 1) working.push(u);
      else active.push(u);
    });

    res.json({ success: true, active, working, inactive });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load fieldworkers' });
  }
});


module.exports = router;
