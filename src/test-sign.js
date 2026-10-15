/**
 * 點擊 Edit_New.gif (ibtnSIGN / EDMS_Open_File) 開啟簽辦視窗
 * 執行方式：node src/test-sign.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

async function run() {
  validate();
  console.log('🧪 點擊 Edit_New.gif (ibtnSIGN) 測試...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);

    const frame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;

    // 先印出第一行所有 input[type=image] 的完整資訊
    const imgInputs = await frame.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr'));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
        if (cells.length >= 13 && cells[6] && /^\d+$/.test(cells[6])) {
          return Array.from(row.querySelectorAll('input[type="image"], img')).map(el => ({
            tag: el.tagName,
            src: (el.src || el.getAttribute('src') || '').split('/').pop(),
            id: el.id || '',
            name: el.name || '',
            onclick: el.getAttribute('onclick') || '',
          }));
        }
      }
      return [];
    });

    console.log('[第一行所有 img/input[image]]');
    imgInputs.forEach((el, i) => {
      console.log(`  [${i}] ${el.tag} src=${el.src} id=${el.id} name=${el.name}`);
      console.log(`       onclick="${el.onclick.substring(0, 150)}"`);
    });

    // 找 ibtnSIGN (Edit_New.gif)
    const signBtn = await frame.$('input[id*="ibtnSIGN"]');
    if (!signBtn) {
      console.log('\n❌ 找不到 ibtnSIGN，嘗試 Edit_New.gif...');
      const editImg = await frame.$('img[src*="Edit_New"]');
      if (!editImg) throw new Error('也找不到 Edit_New.gif');
    }

    console.log('\n🖱️  點擊 ibtnSIGN...');

    // 監聽新頁面和 dialog
    const pagePromise = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);

    // 先偵聽 dialog
    page.on('dialog', async dialog => {
      console.log(`📢 Dialog: type=${dialog.type()} msg="${dialog.message()}"`);
      await dialog.dismiss();
    });

    await signBtn.click();
    await page.waitForTimeout(3000);

    const newPage = await pagePromise;

    if (newPage) {
      console.log('✅ 新視窗已開啟');
      await newPage.waitForLoadState('load');
      await newPage.waitForTimeout(2000);
      const url = newPage.url();
      console.log(`📍 URL：${url}`);

      const newFrames = newPage.frames();
      console.log(`\n框架數量：${newFrames.length}`);
      newFrames.forEach((f, i) => console.log(`  [${i}] ${f.url()}`));

      for (const f of newFrames) {
        const fUrl = f.url();
        if (!fUrl || fUrl === 'about:blank') continue;

        const shortUrl = fUrl.split('/').pop().split('?')[0];
        console.log(`\n${'='.repeat(60)}`);
        console.log(`框架：${shortUrl}`);

        try {
          const info = await f.evaluate(() => ({
            bodyText: document.body.innerText,
            innerHTML: document.body.innerHTML.substring(0, 8000),
            textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
              id: el.id, name: el.name, rows: el.rows, value: el.value.substring(0, 200),
            })),
            buttons: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button'))
              .map(el => ({ type: el.type, id: el.id, name: el.name, value: el.value, text: el.innerText })),
          }));

          console.log(`\n[文字]\n${info.bodyText.substring(0, 2000)}`);
          if (info.textareas.length > 0) {
            console.log(`\n✅ [Textarea]`);
            console.log(JSON.stringify(info.textareas, null, 2));
          }
          if (info.buttons.length > 0) {
            console.log(`\n[按鈕]`);
            info.buttons.forEach(b => console.log(`  "${b.value || b.text}" id=${b.id}`));
          }
          if (info.textareas.length > 0) {
            console.log(`\n[HTML]`);
            console.log(info.innerHTML);
          }
        } catch (e) {
          console.log(`讀取失敗：${e.message}`);
        }
      }
    } else {
      console.log('⚠️  沒有新視窗開啟，檢查目前頁面...');
      const currentUrl = page.url();
      console.log(`目前 URL：${currentUrl}`);

      // 看看頁面是否有變化
      const pageText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
      console.log(`頁面文字：${pageText}`);
    }

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
