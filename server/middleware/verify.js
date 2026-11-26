// server/middleware/verify.js
// ensures citizen is verified before reporting
module.exports = function (req, res, next) {
  if (req.user && req.user.role === 'citizen' && !req.user.is_verified) {
    return res.status(403).json({ error: 'Account not verified. Please wait for approval.' });
  }
  next();
};
