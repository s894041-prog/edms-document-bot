/**
 * 找出 EDMS_Open_File 的 JS 定義，並嘗試直接呼叫
 * 執行方式：node src/test-edmsjs.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

async function run() {
  validate();
  console.log('🧪 EDMS_Open_File JS 分析...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);

    const frame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;

    // 1. 找出 EDMS_Open_File 函數原始碼
    const edmsFunc = await frame.evaluate(() => {
      if (typeof EDMS_Open_File === 'function') {
        return EDMS_Open_File.toString();
      }
      // 搜尋所有 script 標籤
      const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerHTML);
      const found = scripts.find(s => s.includes('EDMS_Open_File'));
      return found ? found.substring(0, 3000) : '找不到函數';
    });

    console.log('[EDMS_Open_File 函數]');
    console.log(edmsFunc);

    // 2. 找出所有外部 JS 檔案 URL
    const jsFiles = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map(s => s.src)
    );
    console.log('\n[外部 JS 檔案]');
    jsFiles.forEach(f => console.log(`  ${f}`));

    // 3. 找 js_clsGDOC.GdocDetailWinOpen 和 js_clsGDOC.EDOCWinOpen 函數
    const gdocFuncs = await frame.evaluate(() => {
      const results = {};
      if (typeof js_clsGDOC !== 'undefined') {
        try { results.EDOCWinOpen = js_clsGDOC.EDOCWinOpen?.toString(); } catch {}
        try { results.GdocDetailWinOpen = js_clsGDOC.GdocDetailWinOpen?.toString(); } catch {}
        results.allKeys = Object.keys(js_clsGDOC.prototype || js_clsGDOC || {});
      } else {
        results.error = 'js_clsGDOC 未定義';
      }

      // 搜尋 EDOCWinOpen 定義
      const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerHTML);
      const edocScript = scripts.find(s => s.includes('EDOCWinOpen'));
      if (edocScript) results.EDOCWinOpenScript = edocScript.substring(0, 2000);

      return results;
    });

    console.log('\n[js_clsGDOC 函數]');
    console.log(JSON.stringify(gdocFuncs, null, 2));

    // 4. 監聽所有網路請求，然後點擊 ibtnSIGN
    const requests = [];
    page.on('request', req => {
      requests.push({ url: req.url(), method: req.method() });
    });

    // 監聽所有新頁面
    const newPages = [];
    ctx.on('page', p => newPages.push(p));

    // 監聽 dialog
    page.on('dialog', async d => {
      console.log(`\n📢 Dialog: "${d.message()}"`);
      await d.dismiss();
    });

    console.log('\n\n🖱️  點擊 ibtnSIGN，監聽所有請求...');
    const signBtn = await frame.$('input[id*="ibtnSIGN"]');
    if (signBtn) {
      await signBtn.click();
      await page.waitForTimeout(5000);

      // 顯示新增的請求
      console.log('\n[點擊後的網路請求]');
      requests.forEach(r => console.log(`  ${r.method} ${r.url}`));

      if (newPages.length > 0) {
        console.log(`\n✅ 新頁面數量：${newPages.length}`);
        for (const np of newPages) {
          try {
            await np.waitForLoadState('load', { timeout: 5000 });
            console.log(`  URL: ${np.url()}`);
            const text = await np.evaluate(() => document.body.innerText.substring(0, 500));
            console.log(`  文字: ${text}`);
          } catch {}
        }
      } else {
        console.log('\n⚠️  沒有新頁面');
      }
    }

    // 5. 嘗試直接執行 EDMS_Open_File 並攔截 window.open
    console.log('\n\n🔬 攔截 window.open...');
    await frame.evaluate(() => {
      window._openedUrls = [];
      const origOpen = window.open;
      window.open = function(url, name, features) {
        window._openedUrls.push({ url, name, features });
        console.log('window.open called:', url);
        return origOpen.apply(this, arguments);
      };
    });

    // 再點一次
    const signBtn2 = await frame.$('input[id*="ibtnSIGN"]');
    if (signBtn2) {
      await signBtn2.click();
      await page.waitForTimeout(3000);

      const openedUrls = await frame.evaluate(() => window._openedUrls || []);
      console.log('window.open 呼叫：', JSON.stringify(openedUrls, null, 2));
    }

    console.log('\n\n✅ 完成！30 秒後關閉...');
    await new Promise(r => setTimeout(r, 30000));

  } catch (err) {
    console.error('\n❌ 失敗：', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}

run();
