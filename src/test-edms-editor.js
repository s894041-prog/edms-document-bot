/**
 * 點「簽」後讀取 FKEditor iframe 內容，找到便簽編輯器
 * 執行方式：node src/test-edms-editor.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';
const SIGN_BTN_ID = 'ctl00_MainContent_DocShortCutButtonsControl1_RadButton_Secondary1';

async function run() {
  validate();
  console.log('🧪 EDMS FKEditor iframe 讀取...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);

    const allFrames = page.frames();
    const mainFrame = allFrames.find(f => f.name() === 'main');
    if (!mainFrame) throw new Error('找不到 main frame');

    // 點擊 ibtnSIGN
    const signBtn = await mainFrame.$('input[id*="ibtnSIGN"]');
    if (!signBtn) throw new Error('找不到 ibtnSIGN');

    // 先檢查是否已有 EDMS 頁面
    let edmsPage = ctx.pages().find(p => p.url().includes('edmsedu.taichung.gov.tw'));

    if (!edmsPage) {
      console.log('等待 EDMS 新視窗...');
      const pagePromise = ctx.waitForEvent('page', { timeout: 20000 });
      await signBtn.click();
      edmsPage = await pagePromise;
    } else {
      console.log('使用現有 EDMS 視窗，重新點擊...');
      await signBtn.click();
      await page.waitForTimeout(3000);
      // 重新找
      edmsPage = ctx.pages().find(p => p.url().includes('edmsedu.taichung.gov.tw')) || edmsPage;
    }

    console.log('✅ EDMS 視窗已取得');
    await edmsPage.bringToFront();
    await edmsPage.waitForLoadState('load');
    await edmsPage.waitForTimeout(5000);
    console.log(`EDMS URL：${edmsPage.url()}`);

    // 讀取「簽」按鈕的 JS
    const btnJs = await edmsPage.evaluate((id) => {
      const btn = document.getElementById(id);
      if (!btn) return '找不到按鈕';
      // 找按鈕的事件
      const onclick = btn.getAttribute('onclick') || '';
      // 找 Telerik RadButton client-side function
      return {
        id: btn.id,
        class: btn.className,
        onclick,
        dataAttr: btn.getAttribute('data-role') || '',
        outerHTML: btn.outerHTML.substring(0, 500),
      };
    }, SIGN_BTN_ID);
    console.log('\n[簽按鈕資訊]', JSON.stringify(btnJs, null, 2));

    // 記錄點擊前的 iframe src
    const beforeIframeSrc = await edmsPage.evaluate(() => {
      const f = document.getElementById('MainContent_EDOC_Area');
      return f ? f.src : '找不到';
    });
    console.log(`\n點擊前 iframe src：${beforeIframeSrc}`);

    // 點擊「簽」按鈕
    console.log('\n🖱️  點擊「簽」按鈕...');
    const signBtnEl = await edmsPage.$(`#${SIGN_BTN_ID}`);
    await signBtnEl.click();

    // 等待 iframe 變化
    console.log('等待 iframe 載入...');
    await edmsPage.waitForTimeout(6000);

    // 讀取點擊後的 iframe src
    const afterIframeSrc = await edmsPage.evaluate(() => {
      const f = document.getElementById('MainContent_EDOC_Area');
      return f ? f.src : '找不到';
    });
    console.log(`點擊後 iframe src：${afterIframeSrc}`);

    // 讀取所有框架
    const edmsFrames = edmsPage.frames();
    console.log(`\n框架列表（共 ${edmsFrames.length}）：`);
    edmsFrames.forEach((f, i) => console.log(`  [${i}] name="${f.name()}" url="${f.url().substring(0, 120)}"`));

    // 掃描每個框架
    for (const f of edmsFrames) {
      const fUrl = f.url();
      if (!fUrl || fUrl === 'about:blank') continue;

      const shortUrl = fUrl.split('/').pop().split('?')[0];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`框架：${shortUrl} (${fUrl.substring(0, 100)})`);

      try {
        const info = await f.evaluate(() => ({
          bodyText: document.body.innerText.substring(0, 2000),
          innerHTML: document.body.innerHTML.substring(0, 6000),
          textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
            id: el.id, name: el.name, value: el.value.substring(0, 200), className: el.className,
          })),
          editables: Array.from(document.querySelectorAll('[contenteditable]')).map(el => ({
            tag: el.tagName, id: el.id, contenteditable: el.getAttribute('contenteditable'),
            text: el.innerText.substring(0, 200), className: el.className.substring(0, 60),
          })),
          buttons: Array.from(document.querySelectorAll('input[type="submit"],input[type="button"],button'))
            .map(el => ({ type: el.type, id: el.id, value: el.value, text: el.innerText.trim() }))
            .filter(b => b.value || b.text),
          subFrames: Array.from(document.querySelectorAll('iframe')).map(f => ({
            id: f.id, src: f.src, name: f.name,
          })),
        }));

        if (info.textareas.length > 0 || info.editables.filter(e => e.contenteditable === 'true').length > 0) {
          console.log('✅ 找到輸入區域！');
          console.log('\n[Textarea]', JSON.stringify(info.textareas, null, 2));
          console.log('\n[Contenteditable]', JSON.stringify(info.editables.filter(e => e.contenteditable === 'true'), null, 2));
        }

        if (info.subFrames.length > 0) {
          console.log('\n[子 iFrame]', JSON.stringify(info.subFrames, null, 2));
        }

        console.log('\n[頁面文字]');
        console.log(info.bodyText || '(空白)');

        if (shortUrl.includes('FKEditor') || shortUrl.includes('Editor') || shortUrl.includes('di.aspx')) {
          console.log('\n[HTML]');
          console.log(info.innerHTML);
        }

        if (info.buttons.length > 0) {
          console.log('\n[按鈕]');
          info.buttons.forEach(b => console.log(`  type=${b.type} id="${b.id}" value="${b.value}" text="${b.text}"`));
        }
      } catch (e) {
        console.log(`讀取失敗：${e.message}`);
      }
    }

    // 嘗試直接導航到 FKEditor 看是否有編輯器
    const fkEditorUrl = await edmsPage.evaluate(() => {
      const f = document.getElementById('MainContent_EDOC_Area');
      return f ? f.src : '';
    });

    if (fkEditorUrl && !fkEditorUrl.includes('about:blank')) {
      console.log(`\n\n直接訪問 FKEditor：${fkEditorUrl}`);
      const fkPage = await ctx.newPage();
      await fkPage.goto(fkEditorUrl, { waitUntil: 'load', timeout: 15000 });
      await fkPage.waitForTimeout(2000);

      const fkInfo = await fkPage.evaluate(() => ({
        bodyText: document.body.innerText.substring(0, 2000),
        innerHTML: document.body.innerHTML.substring(0, 8000),
        editables: Array.from(document.querySelectorAll('[contenteditable="true"]')).map(el => ({
          tag: el.tagName, id: el.id, text: el.innerText.substring(0, 200),
        })),
        textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
          id: el.id, name: el.name, value: el.value.substring(0, 200),
        })),
      }));

      console.log('[直接訪問 FKEditor 文字]', fkInfo.bodyText.substring(0, 2000));
      if (fkInfo.editables.length > 0) {
        console.log('[Contenteditable]', JSON.stringify(fkInfo.editables, null, 2));
      }
      if (fkInfo.textareas.length > 0) {
        console.log('[Textarea]', JSON.stringify(fkInfo.textareas, null, 2));
      }
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
