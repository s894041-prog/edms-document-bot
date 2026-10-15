const { chromium } = require('playwright');
const path = require('path');
const { config } = require('../config');

let browser = null;
let context = null;

/**
 * 啟動 Chrome 瀏覽器（使用指定 Profile，保留已儲存的帳密）
 */
async function launch() {
  const profilePath = path.join(config.chrome.userDataDir, config.chrome.profileDir);

  console.log(`🌐 啟動瀏覽器 Profile：${profilePath}`);

  context = await chromium.launchPersistentContext(profilePath, {
    executablePath: config.chrome.executablePath,
    headless: config.chrome.headless,
    viewport: { width: 1280, height: 900 },
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return page;
}

/**
 * 關閉瀏覽器
 */
async function close() {
  if (context) {
    await context.close();
    context = null;
    browser = null;
    console.log('🔒 瀏覽器已關閉');
  }
}

function getContext() { return context; }

module.exports = { launch, close, getContext };
