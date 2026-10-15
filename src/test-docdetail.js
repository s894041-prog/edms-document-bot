/**
 * 公文詳細頁面測試 v4 - 處理彈出視窗
 * 點「GDOCSIGN_1.gif」(公文簽稿資訊) 並跟蹤進入彈出視窗
 * 執行方式：node src/test-docdetail.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

async function run() {
  validate();
  console.log('🧪 公文詳細頁面測試（彈出視窗版）...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    console.log('✅ 登入成功\n');

    await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);

    const frame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;

    // 找第一筆的 GDOCSIGN_1.gif 圖示（公文簽稿資訊，會開 popup）
    const signIcon = await frame.$('img[src*="GDOCSIGN_1"]');
    if (!signIcon) throw new Error('找不到 GDOCSIGN_1.gif 圖示');

    const docNo = await signIcon.getAttribute('alt');
    console.log(`🖱️  點擊「公文簽稿資訊」圖示，文號：${docNo}`);

    // 等待彈出視窗
    const [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 10000 }),
      signIcon.click(),
    ]);

    console.log('✅ 彈出視窗已開啟');
    await popup.waitForLoadState('load');
    await popup.waitForTimeout(2000);

    const popupUrl = popup.url();
    console.log(`📍 彈出視窗 URL：${popupUrl}`);

    // 列出彈出視窗的框架
    const popupFrames = popup.frames();
    console.log(`\n🖼️  彈出視窗框架數量：${popupFrames.length}`);
    popupFrames.forEach((f, i) => console.log(`  [${i}] ${f.url()}`));

    // 掃描各框架的 textarea 和按鈕
    for (const f of popupFrames) {
      const url = f.url();
      if (!url || url === 'about:blank') continue;

      try {
        const info = await f.evaluate(() => ({
          url: location.href,
          title: document.title,
          textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
            id: el.id, name: el.name, placeholder: el.placeholder,
            value: el.value.substring(0, 200),
          })),
          buttons: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button,input[type="image"]'))
            .map(el => ({ text: (el.value || el.innerText || el.title || '').trim(), id: el.id, src: el.src || '', name: el.name }))
            .filter(b => b.text || b.src),
          keywords: (() => {
            const body = document.body.innerText;
            return ['便簽', '批示', '意見', '陳核', '送出', '確認', '主旨', '說明', '辦法', '處理'].filter(k => body.includes(k));
          })(),
          bodyText: document.body.innerText.substring(0, 3000),
        }));

        const shortUrl = url.split('/').pop().split('?')[0];
        if (info.keywords.length > 0 || info.textareas.length > 0) {
          console.log(`\n✅ 框架 [${shortUrl}]`);
          console.log(`   關鍵字：${info.keywords.join(', ')}`);
          console.log(`   Textarea：${JSON.stringify(info.textareas, null, 2)}`);
          console.log(`   按鈕：`);
          info.buttons.forEach(b => console.log(`     - "${b.text}" id=${b.id} name=${b.name} src=${b.src.split('/').pop()}`));
          console.log(`\n   頁面文字：\n${info.bodyText}`);
        } else {
          console.log(`\n   框架 [${shortUrl}] - 無關鍵字`);
        }
      } catch (e) {
        console.log(`   框架讀取失敗：${e.message}`);
      }
    }

    console.log('\n✅ 完成！瀏覽器 60 秒後關閉...');
    await new Promise(r => setTimeout(r, 60000));

  } catch (err) {
    console.error('\n❌ 失敗：', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}

run();
