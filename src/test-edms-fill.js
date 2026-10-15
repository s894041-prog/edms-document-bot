/**
 * 完整便簽填寫測試：填入擬辦內容，找送出按鈕
 * 執行方式：node src/test-edms-fill.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';
const SIGN_BTN_ID = 'ctl00_MainContent_DocShortCutButtonsControl1_RadButton_Secondary1';

async function openEdmsAndClickSign(page, ctx) {
  // 從 Home 開啟 EDMS
  const allFrames = page.frames();
  const mainFrame = allFrames.find(f => f.name() === 'main');
  if (!mainFrame) throw new Error('找不到 main frame');

  const signBtn = await mainFrame.$('input[id*="ibtnSIGN"]');
  if (!signBtn) throw new Error('找不到 ibtnSIGN');

  let edmsPage = ctx.pages().find(p => p.url().includes('edmsedu.taichung.gov.tw'));

  if (!edmsPage) {
    const [np] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 20000 }),
      signBtn.click(),
    ]);
    edmsPage = np;
    await edmsPage.waitForLoadState('load');
    await edmsPage.waitForTimeout(5000);
  } else {
    await signBtn.click();
    await page.waitForTimeout(3000);
    edmsPage = ctx.pages().find(p => p.url().includes('edmsedu.taichung.gov.tw')) || edmsPage;
    await edmsPage.bringToFront();
    await edmsPage.waitForTimeout(2000);
  }

  return edmsPage;
}

async function run() {
  validate();
  console.log('🧪 便簽填寫完整測試...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(4000);

    console.log('開啟 EDMS...');
    const edmsPage = await openEdmsAndClickSign(page, ctx);
    console.log(`EDMS URL：${edmsPage.url()}`);

    // 點擊「簽」按鈕
    const signBtnEl = await edmsPage.$(`#${SIGN_BTN_ID}`);
    if (!signBtnEl) throw new Error('找不到「簽」按鈕');
    console.log('🖱️  點擊「簽」按鈕...');
    await signBtnEl.click();
    await edmsPage.waitForTimeout(5000);

    // 確認便簽模板已載入
    const titleText = await edmsPage.evaluate(() => document.title || document.querySelector('.rdv-title')?.innerText || '');
    console.log(`頁面標題：${titleText}`);

    const editables = await edmsPage.$$('[contenteditable="true"]');
    console.log(`找到 ${editables.length} 個 contenteditable 欄位`);

    for (const el of editables) {
      const id = await el.getAttribute('id');
      const text = await el.evaluate(e => e.innerText.trim());
      console.log(`  id="${id}" text="${text.substring(0, 50)}"`);
    }

    // 找「擬辦」欄位（或「內容」）
    const targetIds = ['擬辦', '內容', '說明', '主旨'];
    let targetEl = null;
    let targetId = '';

    for (const id of targetIds) {
      const el = await edmsPage.$(`#${id}[contenteditable="true"]`);
      if (el) {
        const isVisible = await el.isVisible();
        if (isVisible) {
          targetEl = el;
          targetId = id;
          console.log(`✅ 找到可輸入欄位：id="${id}"`);
          break;
        }
      }
    }

    if (!targetEl) {
      // 取第一個可見的 contenteditable
      for (const el of editables) {
        const isVisible = await el.isVisible();
        if (isVisible) {
          targetEl = el;
          targetId = await el.getAttribute('id') || '未知';
          console.log(`使用第一個可見 contenteditable：id="${targetId}"`);
          break;
        }
      }
    }

    if (!targetEl) throw new Error('找不到可輸入欄位');

    // 填入便簽內容（測試用）- contenteditable 不支援 fill()，用 evaluate + 鍵盤
    const testContent = '謹查本文，已悉，請 校長 核示。';
    console.log(`\n✏️  填入便簽：「${testContent}」到欄位 id="${targetId}"`);
    await targetEl.click();

    // 先清空再填入
    await edmsPage.evaluate((id, content) => {
      const el = document.getElementById(id) || document.querySelector(`[id="${id}"]`);
      if (el) {
        el.focus();
        el.innerText = content;
        // 觸發 input 事件
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, targetId, testContent);

    await edmsPage.waitForTimeout(1000);

    // 確認填入
    const filledText = await targetEl.evaluate(e => e.innerText);
    console.log(`填入後欄位內容：「${filledText}」`);

    // 掃描所有可能的送出/儲存按鈕
    console.log('\n[掃描所有按鈕和連結]');
    const allActions = await edmsPage.evaluate(() => {
      const results = [];

      // 找 toolbar 按鈕
      const toolbarItems = Array.from(document.querySelectorAll('.rtbInner[title]'));
      toolbarItems.forEach(el => {
        results.push({
          type: 'toolbar',
          title: el.getAttribute('title') || '',
          text: el.innerText.trim(),
          onclick: el.getAttribute('onclick') || '',
        });
      });

      // 找所有 a 和 button 包含關鍵字的
      const keywords = ['送出', '陳核', '儲存', '簽核', '決行', '確認', '完成', 'save', 'submit', '送'];
      const allClickable = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [onclick]'));
      allClickable.forEach(el => {
        const text = (el.innerText || el.value || el.getAttribute('title') || '').trim();
        if (keywords.some(k => text.includes(k) || el.getAttribute('title')?.includes(k))) {
          results.push({
            type: el.tagName,
            text,
            id: el.id || '',
            class: el.className.substring(0, 60),
            title: el.getAttribute('title') || '',
            onclick: el.getAttribute('onclick') || '',
          });
        }
      });

      return results;
    });

    console.log('可能的操作：');
    allActions.forEach((a, i) => {
      console.log(`  [${i}] ${a.type} title="${a.title}" text="${a.text}" id="${a.id}"`);
    });

    // 找「儲存」按鈕（先試儲存，不送出）
    const saveBtn = await edmsPage.$('span[title="儲存"]');
    if (saveBtn) {
      console.log('\n🖱️  點擊「儲存」...');
      await saveBtn.click();
      await edmsPage.waitForTimeout(3000);
      console.log('✅ 儲存完成');
    }

    // 掃描送出/陳核流程
    console.log('\n[掃描「送出」/「陳核」區域]');
    const submitArea = await edmsPage.evaluate(() => {
      // 找文稿底部的流程按鈕
      const flowArea = Array.from(document.querySelectorAll('*')).filter(el => {
        const text = el.innerText?.trim() || '';
        return (text.includes('承辦單位') || text.includes('決行') || text.includes('陳核') || text.includes('送出'))
          && el.children.length < 10;
      });
      return flowArea.map(el => ({
        tag: el.tagName,
        id: el.id,
        class: el.className.substring(0, 60),
        text: el.innerText.trim().substring(0, 200),
        onclick: el.getAttribute('onclick') || '',
        html: el.outerHTML.substring(0, 300),
      })).slice(0, 20);
    });

    console.log('送出流程區域：');
    submitArea.forEach((el, i) => {
      console.log(`  [${i}] ${el.tag} id="${el.id}" text="${el.text.substring(0, 80)}" onclick="${el.onclick.substring(0, 60)}"`);
    });

    // 找「送出」/「陳核」按鈕
    console.log('\n[找送出按鈕]');
    const sendButtons = await edmsPage.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a, span[onclick], div[onclick]')).filter(el => {
        const text = (el.innerText || '').trim();
        return text === '送出' || text === '陳核' || text === '簽核送出' || text === '承辦單位' || text === '決行' || text === '儲存後送出';
      }).map(el => ({
        tag: el.tagName,
        id: el.id,
        text: el.innerText.trim(),
        class: el.className.substring(0, 60),
        onclick: el.getAttribute('onclick') || '',
        html: el.outerHTML.substring(0, 400),
      }));
    });

    console.log('送出按鈕：', JSON.stringify(sendButtons, null, 2));

    console.log('\n\n✅ 完成！120 秒後關閉（截圖觀察便簽狀態）...');
    await new Promise(r => setTimeout(r, 120000));

  } catch (err) {
    console.error('\n❌ 失敗：', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}

run();
