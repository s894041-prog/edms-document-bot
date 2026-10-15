/**
 * 點擊 ibtnSIGN 開啟 EDMS (localhost:61161)，再點綠色「簽」按鈕
 * 執行方式：node src/test-edms-sign.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';

async function run() {
  validate();
  console.log('🧪 EDMS 簽按鈕測試...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);

    // 必須在完整框架環境中，從 Home 進入
    console.log('前往 Home_Splitter.aspx...');
    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 確認 main frame 有 USER_LIST_WORK.aspx
    const allFrames = page.frames();
    console.log(`框架列表：`);
    allFrames.forEach((f, i) => console.log(`  [${i}] name="${f.name()}" url="${f.url().split('/').pop().split('?')[0]}"`));

    const mainFrame = allFrames.find(f => f.name() === 'main');
    if (!mainFrame) throw new Error('找不到 main frame');
    console.log(`✅ main frame：${mainFrame.url()}`);

    // 導航 main frame 到公文清單
    const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';
    if (!mainFrame.url().includes('USER_LIST_WORK')) {
      console.log('導航 main frame 到 USER_LIST_WORK.aspx...');
      await mainFrame.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);
    }
    console.log(`main frame URL：${mainFrame.url()}`);

    // 監聽所有新頁面
    const newPagePromise = ctx.waitForEvent('page', { timeout: 15000 });

    // 在 main frame 中找 ibtnSIGN 並點擊
    const signBtn = await mainFrame.$('input[id*="ibtnSIGN"]');
    if (!signBtn) throw new Error('找不到 ibtnSIGN');

    console.log('🖱️  點擊 ibtnSIGN...');
    await signBtn.click();

    const edmsPage = await newPagePromise;
    console.log('✅ EDMS 視窗已開啟');
    await edmsPage.waitForLoadState('load');
    await edmsPage.waitForTimeout(3000);

    const edmsUrl = edmsPage.url();
    console.log(`📍 EDMS URL：${edmsUrl}`);

    // 掃描 EDMS 頁面
    const edmsInfo = await edmsPage.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 2000),
      innerHTML: document.body.innerHTML.substring(0, 5000),
      buttons: Array.from(document.querySelectorAll('button, a, div[onclick], span[onclick]')).map(el => ({
        tag: el.tagName,
        text: (el.innerText || el.title || el.getAttribute('data-label') || '').trim().substring(0, 50),
        id: el.id || '',
        class: el.className || '',
        onclick: el.getAttribute('onclick') || '',
        href: el.href || '',
      })).filter(b => b.text || b.class),
      imgs: Array.from(document.querySelectorAll('img')).map(img => ({
        src: img.src.split('/').pop(),
        alt: img.alt,
        title: img.title,
        class: img.className,
      })),
    }));

    console.log('\n[EDMS 頁面文字]');
    console.log(edmsInfo.bodyText);

    console.log('\n[EDMS 按鈕/連結]');
    edmsInfo.buttons.forEach((b, i) => {
      console.log(`  [${i}] ${b.tag} text="${b.text}" id="${b.id}" class="${b.class.substring(0, 50)}" onclick="${b.onclick.substring(0, 80)}"`);
    });

    console.log('\n[EDMS 圖片]');
    edmsInfo.imgs.forEach(img => {
      console.log(`  src=${img.src} alt="${img.alt}" title="${img.title}" class="${img.class}"`);
    });

    console.log('\n[EDMS HTML (前5000字)]');
    console.log(edmsInfo.innerHTML);

    // 等一下再試，頁面可能還在載入
    console.log('\n等待 EDMS 完全載入...');
    await edmsPage.waitForTimeout(5000);

    // 找「簽」按鈕
    const signText = ['簽', '批核', '便簽', '批示', '意見'];
    let signBtnEl = null;
    for (const text of signText) {
      try {
        const el = await edmsPage.$(`text=${text}`);
        if (el) {
          console.log(`✅ 找到「${text}」按鈕`);
          signBtnEl = el;
          break;
        }
      } catch {}
    }

    // 也試用 class 或其他方式
    if (!signBtnEl) {
      const allBtns = await edmsPage.evaluate(() =>
        Array.from(document.querySelectorAll('*')).filter(el => {
          const text = (el.innerText || '').trim();
          return text === '簽' || text === '批' || text === '批核' || text === '便簽';
        }).map(el => ({
          tag: el.tagName,
          text: el.innerText.trim(),
          id: el.id,
          class: el.className,
          outerHTML: el.outerHTML.substring(0, 200),
        }))
      );
      console.log('\n[精確文字搜尋結果]');
      console.log(JSON.stringify(allBtns, null, 2));
    }

    if (signBtnEl) {
      console.log('\n🖱️  點擊「簽」按鈕...');
      const signFormPromise = edmsPage.waitForNavigation({ timeout: 5000 }).catch(() => null);
      const newSignPagePromise = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);

      await signBtnEl.click();
      await edmsPage.waitForTimeout(3000);

      // 掃描點擊後的頁面
      const afterInfo = await edmsPage.evaluate(() => ({
        bodyText: document.body.innerText.substring(0, 3000),
        innerHTML: document.body.innerHTML.substring(0, 8000),
        textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
          id: el.id, name: el.name, placeholder: el.placeholder, value: el.value,
        })),
        inputs: Array.from(document.querySelectorAll('input[type="text"],input[type="submit"],input[type="button"],button'))
          .map(el => ({ type: el.type, id: el.id, name: el.name, value: el.value })),
      }));

      console.log('\n[點擊「簽」後頁面]');
      console.log(afterInfo.bodyText);
      console.log('\n[Textarea]');
      console.log(JSON.stringify(afterInfo.textareas, null, 2));
      console.log('\n[Inputs]');
      console.log(JSON.stringify(afterInfo.inputs, null, 2));
      console.log('\n[HTML]');
      console.log(afterInfo.innerHTML);
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
