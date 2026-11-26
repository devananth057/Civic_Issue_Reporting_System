const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  requestPasswordChangeOTP,
  verifyPasswordOTP
} = require('../controllers/settings');

router.post('/change-password/request-otp', auth, requestPasswordChangeOTP);
router.post('/change-password/verify-otp', auth, verifyPasswordOTP);

module.exports = router;
