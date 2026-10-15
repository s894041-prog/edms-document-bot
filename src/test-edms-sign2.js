/**
 * EDMS 綠色「簽」按鈕 - 用正確 ID 點擊，讀取便簽表單
 * 執行方式：node src/test-edms-sign2.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';
const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

// 綠色「簽」浮動按鈕 ID
const SIGN_BTN_ID = 'ctl00_MainContent_DocShortCutButtonsControl1_RadButton_Secondary1';

async function run() {
  validate();
  console.log('🧪 EDMS 綠色「簽」按鈕完整流程測試...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);

    console.log('前往 Home_Splitter.aspx...');
    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);

    const allFrames = page.frames();
    const mainFrame = allFrames.find(f => f.name() === 'main');
    if (!mainFrame) throw new Error('找不到 main frame');

    // 確保 main frame 已載入公文清單
    if (!mainFrame.url().includes('USER_LIST_WORK')) {
      console.log('等待 main frame 載入...');
      await mainFrame.waitForURL('**/USER_LIST_WORK.aspx', { timeout: 15000 }).catch(() => {});
    }
    console.log(`main frame：${mainFrame.url()}`);

    // 找第一筆公文的 ibtnSIGN
    const signBtn = await mainFrame.$('input[id*="ibtnSIGN"]');
    if (!signBtn) throw new Error('找不到 ibtnSIGN');

    console.log('🖱️  點擊 ibtnSIGN，等待 EDMS 視窗...');
    const [edmsPage] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 15000 }),
      signBtn.click(),
    ]);

    console.log('✅ EDMS 視窗已開啟');
    await edmsPage.waitForLoadState('load');
    await edmsPage.waitForTimeout(5000); // EDMS 是 SPA，多等一點

    const edmsUrl = edmsPage.url();
    console.log(`📍 EDMS URL：${edmsUrl}`);

    // 確認「簽」按鈕存在且可見
    console.log(`\n尋找綠色「簽」按鈕 (id=${SIGN_BTN_ID})...`);
    const signBtnEl = await edmsPage.$(`#${SIGN_BTN_ID}`);
    if (!signBtnEl) {
      // 嘗試備用選擇器
      const altBtn = await edmsPage.$('button:has-text("簽"):not(:has-text("簽稿")):not(:has-text("簽核")):not(:has-text("簽章"))');
      console.log(`備用選擇器：${altBtn ? '✅ 找到' : '❌ 找不到'}`);

      // 列出所有包含「簽」的按鈕
      const allSignBtns = await edmsPage.$$('button');
      console.log('\n所有按鈕：');
      for (const btn of allSignBtns) {
        const text = await btn.evaluate(el => el.innerText.trim());
        const id = await btn.evaluate(el => el.id);
        const visible = await btn.isVisible();
        if (text.includes('簽') || text === '簽') {
          console.log(`  id="${id}" text="${text}" visible=${visible}`);
        }
      }
      throw new Error('找不到「簽」按鈕');
    }

    const isVisible = await signBtnEl.isVisible();
    console.log(`按鈕可見：${isVisible}`);

    if (!isVisible) {
      // 嘗試 JavaScript 點擊
      console.log('嘗試 JavaScript 點擊...');
      await edmsPage.evaluate((id) => {
        const btn = document.getElementById(id);
        if (btn) btn.click();
      }, SIGN_BTN_ID);
    } else {
      console.log('🖱️  點擊綠色「簽」按鈕...');
      await signBtnEl.click();
    }

    await edmsPage.waitForTimeout(4000);

    // 讀取點擊後的頁面狀態
    console.log('\n[點擊「簽」後的頁面狀態]');
    const afterInfo = await edmsPage.evaluate(() => {
      const textareas = Array.from(document.querySelectorAll('textarea')).map(el => ({
        id: el.id, name: el.name, className: el.className,
        rows: el.rows, value: el.value.substring(0, 200),
      }));

      // 找編輯器 iframe
      const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
        id: f.id, src: f.src, className: f.className,
        name: f.name || f.getAttribute('name') || '',
      }));

      // 找可編輯的 div（contenteditable）
      const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(el => ({
        tag: el.tagName, id: el.id, className: el.className.substring(0, 50),
        text: el.innerText.substring(0, 200),
      }));

      // URL 和框架
      const allFrameUrls = Array.from(document.querySelectorAll('iframe')).map(f => f.src);

      return {
        url: location.href,
        bodyText: document.body.innerText.substring(0, 3000),
        textareas, iframes, editables, allFrameUrls,
        innerHTML: document.body.innerHTML.substring(0, 5000),
      };
    });

    console.log(`URL：${afterInfo.url}`);
    console.log(`\n[頁面文字 (前1500)]`);
    console.log(afterInfo.bodyText.substring(0, 1500));

    console.log('\n[Textarea]');
    console.log(JSON.stringify(afterInfo.textareas, null, 2));

    console.log('\n[iFrames]');
    afterInfo.iframes.forEach(f => console.log(`  id="${f.id}" name="${f.name}" src="${f.src.substring(0, 100)}"`));

    console.log('\n[Contenteditable]');
    afterInfo.editables.forEach(e => console.log(`  ${e.tag} id="${e.id}" class="${e.className}" text="${e.text.substring(0, 100)}"`));

    // 讀取所有子框架
    const edmsFrames = edmsPage.frames();
    console.log(`\n[EDMS 框架列表 - 共 ${edmsFrames.length}]`);
    edmsFrames.forEach((f, i) => console.log(`  [${i}] name="${f.name()}" url="${f.url().substring(0, 100)}"`));

    // 特別掃描包含文字輸入的框架
    for (const f of edmsFrames) {
      const fUrl = f.url();
      if (!fUrl || fUrl === 'about:blank') continue;

      try {
        const fInfo = await f.evaluate(() => ({
          textareas: Array.from(document.querySelectorAll('textarea')).length,
          editables: Array.from(document.querySelectorAll('[contenteditable="true"]')).length,
          bodyText: document.body.innerText.substring(0, 500),
        }));

        if (fInfo.textareas > 0 || fInfo.editables > 0) {
          console.log(`\n✅ 框架有輸入區：${fUrl.split('/').pop().split('?')[0]}`);
          console.log(`   textarea=${fInfo.textareas} editable=${fInfo.editables}`);
          console.log(`   文字：${fInfo.bodyText}`);
        }
      } catch {}
    }

    console.log('\n\n✅ 完成！60 秒後關閉（您可以截圖觀察）...');
    await new Promise(r => setTimeout(r, 60000));

  } catch (err) {
    console.error('\n❌ 失敗：', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}

run();
