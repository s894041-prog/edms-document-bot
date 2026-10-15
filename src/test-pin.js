/**
 * 快速測試 PIN 是否正確
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const profilePath = path.join(
    'C:/Users/YOUR_USERNAME/AppData/Local/Google/Chrome/User Data', 'Profile 6'
  );
  const ctx = await chromium.launchPersistentContext(profilePath, {
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  // 攔截所有 dialogs
  page.on('dialog', async d => {
    console.log('[dialog]', d.type(), ':', d.message().substring(0, 100));
    await d.accept();
  });

  await page.goto('https://odisedu.taichung.gov.tw/gdms_login.aspx', {
    waitUntil: 'load', timeout: 30000,
  });
  await page.waitForTimeout(2000);

  // 列出 inputs
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(e => ({
      id: e.id, name: e.name, type: e.type, placeholder: e.placeholder,
    }))
  );
  console.log('login page inputs:', JSON.stringify(inputs, null, 2));
  console.log('current URL:', page.url());

  // 填 PIN
  const pinInput = await page.$('input[name*="pin" i]');
  if (pinInput) {
    await pinInput.click({ clickCount: 3 });
    await pinInput.fill(process.env.GDMS_PIN);
    console.log('PIN filled:', process.env.GDMS_PIN);
  }

  // 點登入
  const loginBtn = await page.$('input[type="submit"]');
  if (loginBtn) {
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => {}),
      loginBtn.click(),
    ]);
  }

  await page.waitForTimeout(3000);
  console.log('After login URL:', page.url());

  // 等 20 秒讓你看畫面
  await new Promise(r => setTimeout(r, 20000));
  await ctx.close();
})().catch(e => console.error(e.message));
