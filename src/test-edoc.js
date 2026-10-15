/**
 * 點擊 Doc_1.gif (EDOCWinOpen) 開啟便簽編輯視窗
 * 執行方式：node src/test-edoc.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

async function run() {
  validate();
  console.log('🧪 點擊 Doc_1.gif (EDOCWinOpen) 測試...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);

    const frame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;

    // 點 Doc_1.gif (EDOCWinOpen)
    const docIcon = await frame.$('img[src*="Doc_1"]');
    if (!docIcon) throw new Error('找不到 Doc_1.gif 圖示');

    const docNo = await docIcon.getAttribute('alt');
    console.log(`🖱️  點擊 Doc_1.gif，文號：${docNo}`);

    const [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 10000 }),
      docIcon.click(),
    ]);

    console.log('✅ 彈出視窗已開啟');
    await popup.waitForLoadState('load');
    await popup.waitForTimeout(3000);

    const popupUrl = popup.url();
    console.log(`📍 URL：${popupUrl}`);

    const popupFrames = popup.frames();
    console.log(`\n框架數量：${popupFrames.length}`);
    popupFrames.forEach((f, i) => console.log(`  [${i}] ${f.url()}`));

    // 掃描所有框架
    for (const f of popupFrames) {
      const url = f.url();
      if (!url || url === 'about:blank') continue;

      const shortUrl = url.split('/').pop().split('?')[0];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`框架：${shortUrl}`);
      console.log('='.repeat(60));

      try {
        const info = await f.evaluate(() => ({
          bodyText: document.body.innerText,
          innerHTML: document.body.innerHTML.substring(0, 8000),
          textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
            id: el.id, name: el.name, placeholder: el.placeholder,
            rows: el.rows, cols: el.cols, value: el.value.substring(0, 200),
          })),
          inputs: Array.from(document.querySelectorAll('input')).map(el => ({
            type: el.type, id: el.id, name: el.name, value: el.value.substring(0, 100),
            onclick: el.getAttribute('onclick') || '',
          })),
          buttons: Array.from(document.querySelectorAll('button')).map(el => ({
            text: el.innerText.trim(), id: el.id, onclick: el.getAttribute('onclick') || '',
          })),
        }));

        console.log(`\n[頁面文字]`);
        console.log(info.bodyText.substring(0, 2000) || '(空白)');

        if (info.textareas.length > 0) {
          console.log(`\n✅ [Textarea]`);
          console.log(JSON.stringify(info.textareas, null, 2));
        }

        const meaningfulInputs = info.inputs.filter(i => i.type !== 'hidden' || i.value);
        if (meaningfulInputs.length > 0) {
          console.log(`\n[Inputs]`);
          meaningfulInputs.forEach(i => console.log(`  type=${i.type} id=${i.id} name=${i.name} value="${i.value.substring(0, 50)}" onclick="${i.onclick.substring(0, 80)}"`));
        }

        if (info.buttons.length > 0) {
          console.log(`\n[Buttons]`);
          info.buttons.forEach(b => console.log(`  "${b.text}" id=${b.id} onclick="${b.onclick.substring(0, 80)}"`));
        }

        // 如果有 textarea 或表單，也印 HTML
        if (info.textareas.length > 0 || url.includes('EDOC') || url.includes('Sign') || url.includes('sign')) {
          console.log(`\n[HTML]`);
          console.log(info.innerHTML);
        }
      } catch (e) {
        console.log(`讀取失敗：${e.message}`);
      }
    }

    // 等待並截圖（如果有視覺需要）
    console.log('\n\n✅ 完成！60 秒後關閉...');
    await new Promise(r => setTimeout(r, 60000));

  } catch (err) {
    console.error('\n❌ 失敗：', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}

run();
