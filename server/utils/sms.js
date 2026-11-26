const axios = require('axios');

async function sendOTP(phone, otp) {
  return axios.post(
    'https://www.fast2sms.com/dev/bulkV2',
    {
      route: 'otp',
      variables_values: otp,
      numbers: phone
    },
    {
      headers: {
        authorization: process.env.FAST2SMS_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );
}

module.exports = { sendOTP };
