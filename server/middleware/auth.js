const jwt = require('jsonwebtoken');
require('dotenv').config();

module.exports = function (req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token provided' });
  const token = auth.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secretkey');
    req.user = payload; // {id, role, ward, department_id, is_verified}
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
