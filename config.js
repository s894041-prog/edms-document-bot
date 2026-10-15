require('dotenv').config();
const path = require('path');

const config = {
  telegram: {
    token: process.env.TELEGRAM_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    replyTimeout: parseInt(process.env.TELEGRAM_REPLY_TIMEOUT) || 1800,
  },

  gdms: {
    url: 'https://odisedu.taichung.gov.tw/gdms_login.aspx',
    pin: process.env.GDMS_PIN,
  },

  chrome: {
    // Windows Chrome 使用者資料路徑
    userDataDir: `C:\\Users\\${process.env.WINDOWS_USERNAME}\\AppData\\Local\\Google\\Chrome\\User Data`,
    profileDir: `Profile ${process.env.CHROME_PROFILE_NUMBER}`,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: process.env.BROWSER_HEADLESS === 'true',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.5-flash',
  },

  paths: {
    logs: path.join(__dirname, 'logs'),
    scripts: 'C:\\scripts\\document-bot',
  },
};

// 驗證必要設定
function validate() {
  const required = [
    ['TELEGRAM_TOKEN', config.telegram.token],
    ['TELEGRAM_CHAT_ID', config.telegram.chatId],
    ['GDMS_PIN', config.gdms.pin],
    ['GEMINI_API_KEY', config.gemini.apiKey],
    ['WINDOWS_USERNAME', process.env.WINDOWS_USERNAME],
    ['CHROME_PROFILE_NUMBER', process.env.CHROME_PROFILE_NUMBER],
  ];

  const missing = required
    .filter(([, val]) => !val || val === 'YOUR_GEMINI_API_KEY' || val === 'YOUR_USERNAME' || val === 'PROFILE_NUMBER')
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error('❌ 缺少必要設定，請更新 .env 檔案：');
    missing.forEach(key => console.error(`   - ${key}`));
    process.exit(1);
  }
}

module.exports = { config, validate };
