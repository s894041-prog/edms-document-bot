#!/usr/bin/env node
/**
 * 工作流環境診斷工具
 * 檢查是否所有必需的配置、模組、API 都正常
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

console.log(`
╔════════════════════════════════════════════════════════════════╗
║           🔍 便簽工作流環境診斷工具                            ║
╚════════════════════════════════════════════════════════════════╝
`);

const checks = [];

// ✅ 檢查 1: .env 配置
console.log('檢查 1️⃣ .env 配置...');
const requiredEnvVars = [
  'GEMINI_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'GDMS_PIN',
];

const envCheck = requiredEnvVars.every(key => {
  const present = !!process.env[key];
  console.log(`  ${present ? '✅' : '❌'} ${key}${present ? ` = ${process.env[key].substring(0, 10)}...` : ' (缺少)'}`);
  return present;
});
checks.push({ name: '.env 配置', pass: envCheck });

// ✅ 檢查 2: 必需的模組
console.log('\n檢查 2️⃣ NPM 模組...');
const requiredModules = [
  'playwright',
  '@google/generative-ai',
  'axios',
  'dotenv',
];

let modulesCheck = true;
for (const mod of requiredModules) {
  try {
    require.resolve(mod);
    console.log(`  ✅ ${mod}`);
  } catch (e) {
    console.log(`  ❌ ${mod} (缺少，執行 npm install)`);
    modulesCheck = false;
  }
}
checks.push({ name: 'NPM 模組', pass: modulesCheck });

// ✅ 檢查 3: 必需的檔案
console.log('\n檢查 3️⃣ 專案檔案...');
const requiredFiles = [
  'src/browser.js',
  'src/telegram.js',
  'src/gemini.js',
  'src/gdms.js',
  'src/workflow-bianqian.js',
  'config.js',
];

let filesCheck = true;
for (const file of requiredFiles) {
  const fullPath = path.join(__dirname, file);
  const exists = fs.existsSync(fullPath);
  console.log(`  ${exists ? '✅' : '❌'} ${file}`);
  if (!exists) filesCheck = false;
}
checks.push({ name: '專案檔案', pass: filesCheck });

// ✅ 檢查 4: Chrome Profile
console.log('\n檢查 4️⃣ Chrome 設定...');
try {
  const config = require('./config');
  const profilePath = path.join(config.chrome.userDataDir, config.chrome.profileDir);
  const exists = fs.existsSync(profilePath);
  console.log(`  ${exists ? '✅' : '❌'} Chrome Profile 路徑: ${profilePath}`);
  checks.push({ name: 'Chrome Profile', pass: exists });
} catch (e) {
  console.log(`  ❌ 無法讀取 config.js: ${e.message}`);
  checks.push({ name: 'Chrome Profile', pass: false });
}

// ✅ 檢查 5: API 連線 (非同步)
console.log('\n檢查 5️⃣ API 連線...');

(async () => {
  const apiChecks = [];

  // Telegram 測試
  try {
    const axios = require('axios');
    const res = await axios.get(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
      { timeout: 5000 }
    );
    if (res.data.ok) {
      console.log(`  ✅ Telegram Bot (ID: ${res.data.result.id})`);
      apiChecks.push(true);
    } else {
      console.log('  ❌ Telegram Bot Token 無效');
      apiChecks.push(false);
    }
  } catch (e) {
    console.log(`  ❌ Telegram 連線失敗: ${e.message}`);
    apiChecks.push(false);
  }

  // Gemini 測試
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    const result = await model.generateContent('test');
    console.log(`  ✅ Gemini API`);
    apiChecks.push(true);
  } catch (e) {
    console.log(`  ❌ Gemini API 失敗: ${e.message}`);
    apiChecks.push(false);
  }

  checks.push({ name: 'API 連線', pass: apiChecks.every(c => c) });

  // 總結
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                     📊 診斷結果總結                            ║
╠════════════════════════════════════════════════════════════════╣
`);

  let allPass = true;
  for (const check of checks) {
    const icon = check.pass ? '✅' : '❌';
    console.log(`║ ${icon} ${check.name.padEnd(40)} ${check.pass ? '通過' : '失敗'}`);
    if (!check.pass) allPass = false;
  }

  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  if (allPass) {
    console.log('🎉 所有檢查都通過！');
    console.log('\n✅ 準備就緒，執行工作流：');
    console.log('   node run-bianqian-workflow.js\n');
    process.exit(0);
  } else {
    console.log('❌ 有些檢查失敗，請先修復上述問題。\n');
    console.log('💡 常見修復方案：');
    console.log('   1. npm install  （安裝缺失的模組）');
    console.log('   2. 檢查 .env 檔案中的 API key 是否正確');
    console.log('   3. 確認 Chrome Profile 路徑存在');
    console.log();
    process.exit(1);
  }
})().catch(err => {
  console.error('\n💥 診斷工具發生錯誤:', err.message);
  process.exit(1);
});
