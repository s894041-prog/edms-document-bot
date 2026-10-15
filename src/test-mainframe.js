/**
 * 找出 EDOCURL、主框架結構，並在完整框架中測試 EDMS_Open_File
 * 執行方式：node src/test-mainframe.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';
const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

async function run() {
  validate();
  console.log('🧪 主框架結構 + EDOCURL 分析...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);

    // 先去 Home 頁面看完整框架結構
    console.log('\n前往 Home 頁面...');
    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log(`目前 URL：${page.url()}`);
    const allFrames = page.frames();
    console.log(`\n[Home 框架列表 - 共 ${allFrames.length} 個]`);
    allFrames.forEach((f, i) => console.log(`  [${i}] name="${f.name()}" url="${f.url()}"`));

    // 找 "head" frame
    const headFrame = allFrames.find(f => f.name() === 'head' || f.url().includes('head') || f.url().includes('Head') || f.url().includes('MENU') || f.url().includes('Nav'));
    if (headFrame) {
      console.log(`\n✅ 找到可能的 head frame：${headFrame.url()}`);
      const headInfo = await headFrame.evaluate(() => ({
        bodyText: document.body.innerText.substring(0, 1000),
        hasEDMS: typeof EDMS_Open_File !== 'undefined',
        edmsFunc: typeof EDMS_Open_File !== 'undefined' ? EDMS_Open_File.toString() : '未定義',
      }));
      console.log(`  有 EDMS_Open_File：${headInfo.hasEDMS}`);
      console.log(`  函數：${headInfo.edmsFunc}`);
    }

    // 在 Home 頁面的每個框架尋找 EDMS_Open_File
    for (const f of allFrames) {
      const fUrl = f.url();
      if (!fUrl || fUrl === 'about:blank') continue;
      try {
        const has = await f.evaluate(() => typeof EDMS_Open_File !== 'undefined');
        if (has) {
          const func = await f.evaluate(() => EDMS_Open_File.toString());
          console.log(`\n✅ 找到 EDMS_Open_File 在框架 [${f.name()}] ${fUrl}`);
          console.log(func);
        }
      } catch {}
    }

    // 取得 Home 頁面 HTML（找 frameset）
    const homeHtml = await page.evaluate(() => document.documentElement.innerHTML.substring(0, 5000));
    console.log('\n[Home 頁面 HTML]');
    console.log(homeHtml);

    // 現在前往 USER_LIST_WORK.aspx 並找 EDOCURL
    console.log('\n\n前往 USER_LIST_WORK.aspx...');
    await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);

    const workFrame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;

    const edocInfo = await workFrame.evaluate(() => {
      const results = {};
      try {
        // 找 js_clsGDOC 實例
        if (typeof js_clsGDOC !== 'undefined') {
          const inst = js_clsGDOC;
          results.EDOCURL = inst.EDOCURL || inst.prototype?.EDOCURL;
          results.GdocDetailURL = inst.GdocDetailURL || inst.prototype?.GdocDetailURL;
          results.MERGEURL = inst.MERGEURL || inst.prototype?.MERGEURL;
        }

        // 搜尋 EDOCURL 在 script 中
        const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerHTML);
        const edocScript = scripts.find(s => s.includes('EDOCURL'));
        if (edocScript) results.edocScript = edocScript.substring(0, 2000);

        // 搜尋 window 物件中的 EDOCURL
        for (const key of Object.keys(window)) {
          try {
            const val = window[key];
            if (val && typeof val === 'object' && val.EDOCURL) {
              results[key + '_EDOCURL'] = val.EDOCURL;
            }
          } catch {}
        }

        // GDMSDOC.js 中可能定義了類別
        results.gdocKeys = typeof js_clsGDOC !== 'undefined' ?
          Object.getOwnPropertyNames(js_clsGDOC.prototype || {}).join(', ') : 'N/A';

        // 找 new js_clsGDOC() 的實例
        const allVars = {};
        for (const key of Object.keys(window)) {
          try {
            const v = window[key];
            if (v && v.EDOCURL) allVars[key] = v.EDOCURL;
          } catch {}
        }
        results.allEDOCURLs = allVars;

      } catch (e) {
        results.error = e.message;
      }
      return results;
    });

    console.log('\n[EDOCURL 搜尋結果]');
    console.log(JSON.stringify(edocInfo, null, 2));

    // 讀取 GDMSDOC.js
    console.log('\n\n前往讀取 GDMSDOC.js...');
    const gdmsDocPage = await ctx.newPage();
    await gdmsDocPage.goto('https://odisedu.taichung.gov.tw/USER/GDMSDOC.js?Ver=10808', { waitUntil: 'load', timeout: 15000 });
    const gdmsDocContent = await gdmsDocPage.evaluate(() => document.body.innerText);
    console.log('\n[GDMSDOC.js 內容]');
    console.log(gdmsDocContent.substring(0, 5000));

    // 讀取 GDOC_DETAIL.js
    console.log('\n\n前往讀取 GDOC_DETAIL.js...');
    const gdocDetailPage = await ctx.newPage();
    await gdocDetailPage.goto('https://odisedu.taichung.gov.tw/LIB/GDOC_DETAIL.js', { waitUntil: 'load', timeout: 15000 });
    const gdocDetailContent = await gdocDetailPage.evaluate(() => document.body.innerText);
    console.log('\n[GDOC_DETAIL.js 內容]');
    console.log(gdocDetailContent.substring(0, 5000));

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
