// server/controllers/auth.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const auth = require('../middleware/auth');
require('dotenv').config();

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || 'secretkey', { expiresIn: '7d' });
}

router.post('/signup', async (req, res) => {
  try {
    const { name, phone, password, ward, role, department_id } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: 'Missing fields' });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, phone, password_hash, role, ward, department_id, is_verified) VALUES (?,?,?,?,?,?,?)',
      [name, phone, hash, role || 'citizen', ward || null, department_id || null, role === 'citizen' ? 0 : 1]
    );
    const id = result.insertId;
    const token = signToken({ id, phone, role: role || 'citizen', ward: ward || null, department_id: department_id || null, is_verified: role === 'citizen' ? 0 : 1 });
    res.json({ success: true, token, user: { id, name, phone, role: role || 'citizen', ward, department_id, is_verified: role === 'citizen' ? 0 : 1 } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Phone already registered' });
    console.error(err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Missing fields' });
    const [rows] = await pool.query('SELECT * FROM users WHERE phone = ?', [phone]);
    if (!rows.length) return res.status(400).json({ error: 'Invalid phone or password' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Invalid phone or password' });
    const token = signToken({ id: user.id, phone: user.phone, role: user.role, ward: user.ward, department_id: user.department_id, is_verified: user.is_verified });
    res.json({ success: true, token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role, ward: user.ward, department_id: user.department_id, is_verified: user.is_verified } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* =========================================================
   SEND OTP FOR PASSWORD CHANGE
========================================================= */
router.post('/send-change-otp', auth, async (req, res) => {
  try {
    const { oldPassword } = req.body;

    if (!oldPassword)
      return res.status(400).json({ error: 'Old password required' });

    // 1️⃣ Get user
    const [[user]] = await pool.query(
      'SELECT id, password_hash, phone FROM users WHERE id=?',
      [req.user.id]
    );

    if (!user)
      return res.status(404).json({ error: 'User not found' });

    // 2️⃣ Verify old password
    const ok = await bcrypt.compare(oldPassword, user.password_hash);
    if (!ok)
      return res.status(401).json({ error: 'Old password incorrect' });

    // 3️⃣ Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    await pool.query(
      'UPDATE users SET change_otp=?, change_otp_expiry=? WHERE id=?',
      [otp, expiry, user.id]
    );

    // 4️⃣ Send SMS via FAST2SMS
    await axios.post(
      'https://www.fast2sms.com/dev/bulkV2',
      {
        route: 'otp',
        variables_values: otp,
        numbers: user.phone
      },
      {
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    console.error('[SEND CHANGE OTP]', err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

/* =========================================================
   VERIFY OTP & CHANGE PASSWORD
========================================================= */
router.post('/verify-change-otp', auth, async (req, res) => {
  try {
    const { otp, newPassword } = req.body;

    if (!otp || !newPassword)
      return res.status(400).json({ error: 'OTP and new password required' });

    const [[user]] = await pool.query(
      `SELECT id, change_otp, change_otp_expiry
       FROM users WHERE id=?`,
      [req.user.id]
    );

    if (!user || !user.change_otp)
      return res.status(400).json({ error: 'OTP not requested' });

    if (user.change_otp !== otp)
      return res.status(400).json({ error: 'Invalid OTP' });

    if (new Date(user.change_otp_expiry) < new Date())
      return res.status(400).json({ error: 'OTP expired' });

    // 5️⃣ Hash new password
    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users
       SET password_hash=?, change_otp=NULL, change_otp_expiry=NULL
       WHERE id=?`,
      [hashed, user.id]
    );

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('[VERIFY CHANGE OTP]', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});


module.exports = router;
