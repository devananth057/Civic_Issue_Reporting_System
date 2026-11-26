const axios = require('axios');

module.exports = async (phone, message) => {
  await axios.post(
    'https://www.fast2sms.com/dev/bulkV2',
    {
      route: 'v3',
      sender_id: 'TXTIND',
      message,
      numbers: phone
    },
    {
      headers: {
        authorization: process.env.FAST2SMS_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );
};
