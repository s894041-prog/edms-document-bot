/**
 * 測試填入便簽（跳過 Telegram，直接測試 openSignTemplate + fillBianQian + saveBianQian）
 * 執行：node src/test-fill.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');
const { openEdms, openSignTemplate, fillBianQian, saveBianQian } = require('./workflow-edms');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';

const TEST_CONTENT = `謹查本文，已悉。

說明：
一、臺中市政府教育局來文，檢送114學年度國民小學英語朗讀比賽朗讀文稿修正版。
二、本次修正「The Big Lion and the Tiny Mouse」一篇，以紅字標記修正處。

辦法：
一、擬轉知相關英語教師注意修正內容並指導參賽學生。
二、請 校長 核示。`;

async function run() {
  validate();
  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    console.log('✅ 登入成功\n');

    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(6000);

    // 開啟 EDMS（第一筆公文）
    console.log('開啟 EDMS...');
    const edmsPage = await openEdms(page, ctx, 0);
    console.log(`EDMS：${edmsPage.url()}`);

    // 等一下再開便簽範本
    await edmsPage.waitForTimeout(2000);

    // 開啟便簽範本（RadWindow → 便簽 new file → popupForm）
    console.log('\n開啟便簽範本...');
    const formPage = await openSignTemplate(edmsPage, ctx);
    console.log(`便簽編輯器：${formPage.url()}`);

    // 填入便簽
    console.log('\n填入便簽...');
    await fillBianQian(formPage, TEST_CONTENT, '有關英語朗讀比賽朗讀文稿修正版，敬請核示。');

    // 儲存
    console.log('\n儲存...');
    const saved = await saveBianQian(formPage);
    console.log(saved ? '✅ 儲存成功！' : '⚠️  儲存失敗或找不到按鈕');

    console.log('\n✅ 完成！30 秒後關閉...');
    await new Promise(r => setTimeout(r, 30000));

  } catch (err) {
    console.error('\n❌', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}
run();
