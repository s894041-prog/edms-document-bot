/**
 * EDMS 便簽自動化完整流程
 *
 * 流程：
 * 1. 登入（透過 Home_Splitter.aspx，讓 EDMS_Open_File 正常運作）
 * 2. 取得主辦公文清單
 * 3. 逐件開啟 EDMS → 讀取主旨+說明
 * 4. 呼叫 Gemini 產生便簽建議
 * 5. 透過 Telegram 通知並等待回覆
 * 6. 填入便簽並送出（或略過）
 *
 * 執行方式：node src/workflow-edms.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate, config } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');
const gemini = require('./gemini');
const telegram = require('./telegram');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';

// EDMS 關鍵選擇器
const SELECTORS = {
  signBtn: 'input[id*="ibtnSIGN"]',            // 開 EDMS 的按鈕
  edmsSignBtn: '#ctl00_MainContent_DocShortCutButtonsControl1_RadButton_Secondary1', // 綠色「簽」
  edmsSubject: '#主旨[contenteditable="true"]',
  edmsContent: '#說明[contenteditable="true"]',
  edmsYiban: '#擬辦[contenteditable="true"]',   // 擬辦欄（便簽主要填寫區）
  edmsSave: 'span[title="儲存"]',
};

/**
 * 從 Home_Splitter 取得 main frame，確保 EDMS_Open_File 可正常呼叫
 */
async function getMainFrame(page) {
  const allFrames = page.frames();
  const mainFrame = allFrames.find(f => f.name() === 'main');
  if (!mainFrame) throw new Error('找不到 main frame - 請確認從 Home_Splitter.aspx 進入');
  return mainFrame;
}

/**
 * 開啟指定公文的 EDMS 編輯視窗
 * @param {import('playwright').Page} page - 主頁面
 * @param {object} ctx - browser context
 * @param {object} doc - 公文物件（需含 signBtnSelector 或 rowIndex）
 * @param {number} rowIndex - 公文列索引（0-based，預設第0筆）
 */
async function openEdms(page, ctx, rowIndex = 0) {
  const mainFrame = await getMainFrame(page);

  // 找指定行的 ibtnSIGN
  const signBtns = await mainFrame.$$('input[id*="ibtnSIGN"]');
  if (signBtns.length === 0) throw new Error('找不到任何 ibtnSIGN 按鈕');
  if (rowIndex >= signBtns.length) throw new Error(`索引 ${rowIndex} 超出範圍（共 ${signBtns.length} 件）`);

  const signBtn = signBtns[rowIndex];

  const isEdmsPage = p => p.url().includes('edmsedu.taichung.gov.tw') || p.url().includes('DocEditorHome');

  // 先看是否已有 EDMS 頁面（不關閉，避免新頁面被系統快速關閉）
  const existingEdms = ctx.pages().find(isEdmsPage);

  if (!existingEdms) {
    // 沒有 EDMS 頁面，等待新頁面開啟
    const [np] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 20000 }),
      signBtn.click(),
    ]);
    await np.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);
  } else {
    // 已有 EDMS 頁面，點擊後等系統更新
    await signBtn.click();
    await page.waitForTimeout(5000);
  }

  // 重新掃描（不依賴事件，避免 page closed 問題）
  await page.waitForTimeout(2000);
  const edmsPage = ctx.pages().find(isEdmsPage);
  if (!edmsPage) throw new Error('找不到 EDMS 頁面（edmsedu.taichung.gov.tw）');
  await edmsPage.bringToFront();
  return edmsPage;
}

/**
 * 讀取 EDMS 中的來文內容（主旨、說明）
 */
async function readDocContent(edmsPage) {
  // 來文內容在 FKEditor iframe
  const fkFrame = edmsPage.frames().find(f => f.url().includes('Editor_LIB_Viewer_di.aspx'));
  if (!fkFrame) return { subject: '', content: '' };

  const info = await fkFrame.evaluate(() => {
    const getText = (keyword) => {
      const tables = Array.from(document.querySelectorAll('table tr'));
      for (const row of tables) {
        const cells = row.querySelectorAll('td');
        for (const cell of cells) {
          if (cell.innerText?.includes(keyword)) {
            const next = cell.nextElementSibling;
            if (next) return next.innerText.trim();
          }
        }
      }
      return '';
    };

    // 直接找文字
    const bodyText = document.body.innerText;
    const subjectMatch = bodyText.match(/主旨：\s*([^\n]+)/);
    const contentMatch = bodyText.match(/說明：([\s\S]+?)(?:正本：|副本：|$)/);

    return {
      subject: subjectMatch ? subjectMatch[1].trim() : '',
      content: contentMatch ? contentMatch[1].trim().substring(0, 500) : '',
      fullText: bodyText.substring(0, 2000),
    };
  });

  return info;
}

/**
 * 透過 RadWindow_Popup 選擇便簽模板，開啟 localhost popupForm
 * 流程：RadWindow 已自動開啟 → 點共用範本 → 點便簽新檔按鈕 → 回傳 popupForm page
 * @param {import('playwright').Page} edmsPage
 * @param {object} ctx - browser context
 * @returns {import('playwright').Page} popupForm 頁面
 */
async function openSignTemplate(edmsPage, ctx) {
  // 等 RadWindow_Popup iframe 出現（點 ibtnSIGN 後自動開啟）
  console.log('等待 RadWindow_Popup...');
  await edmsPage.waitForSelector('iframe[name="RadWindow_Popup"]', { timeout: 15000 }).catch(() => null);
  const radWindowIframe = await edmsPage.$('iframe[name="RadWindow_Popup"]');

  if (!radWindowIframe) {
    // 備用：點擊綠色「簽」按鈕
    console.log('RadWindow_Popup 未出現，嘗試點擊綠色「簽」按鈕...');
    const signBtnEl = await edmsPage.$(SELECTORS.edmsSignBtn);
    if (!signBtnEl || !(await signBtnEl.isVisible())) throw new Error('找不到「簽」按鈕且 RadWindow 未出現');
    await signBtnEl.click();
    await edmsPage.waitForTimeout(5000);
    await edmsPage.waitForSelector('iframe[name="RadWindow_Popup"]', { timeout: 10000 });
  }

  const radFrame = edmsPage.frames().find(f => f.name() === 'RadWindow_Popup');
  if (!radFrame) throw new Error('找不到 RadWindow_Popup frame');

  // 等 RadWindow iframe 內容載入（等「共用範本」tab 出現）
  console.log('等待 RadWindow 內容載入...');
  const sharedTab = await radFrame.waitForSelector('text=共用範本', { timeout: 15000 }).catch(() => null);
  if (sharedTab) {
    console.log('點「共用範本」tab...');
    await sharedTab.click();
    await edmsPage.waitForTimeout(4000); // AJAX 載入需時
  } else {
    console.log('⚠️ 找不到「共用範本」tab，嘗試直接找便簽按鈕...');
  }

  // 重新取得 radFrame（tab 切換後 frame 可能刷新）
  const radFrame2 = edmsPage.frames().find(f => f.name() === 'RadWindow_Popup') || radFrame;

  // 等待便簽按鈕出現（最多 15 秒）
  const bianQianBtn = await radFrame2.waitForSelector(
    'tr:has-text("簡便用簽") input[type="image"], tr:has-text("便簽") input[type="image"]',
    { timeout: 15000 }
  ).catch(() => null);

  if (!bianQianBtn) throw new Error('找不到便簽新檔按鈕（tr:has-text("簡便用簽") input[type="image"]）- 請確認共用範本 tab 已載入');

  console.log('✅ 找到便簽新檔按鈕，點擊...');
  const [popupPage] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 60000 }),
    bianQianBtn.click(),
  ]);

  // EDMS SPA 需要額外時間初始化 contenteditable 欄位
  await popupPage.waitForLoadState('load');
  await popupPage.waitForTimeout(5000);
  console.log(`✅ 便簽編輯器已開啟：${popupPage.url()}`);
  return popupPage;
}

/**
 * 填入便簽內容（直接操作 EDMS contenteditable 欄位）
 * popupForm 和 DocEditorHome 都是同一套欄位：#主旨、#說明、#擬辦
 * @param {import('playwright').Page} formPage
 * @param {string} content - 便簽全文（Gemini 產生的完整內容）
 * @param {string} subject - 主旨（可選，若空則從 content 解析）
 */
async function fillBianQian(formPage, content, subject = '') {
  console.log(`填入便簽，頁面：${formPage.url()}`);

  // 解析 Gemini 輸出的各段落
  const subjectMatch = content.match(/主旨[：:]\s*(.+)/);
  const explainMatch = content.match(/說明[：:]([\s\S]*?)(?=辦法[：:]|擬辦[：:]|$)/);
  const actionMatch = content.match(/(?:辦法|擬辦)[：:]([\s\S]*)/);

  const parsedSubject = subject || (subjectMatch ? subjectMatch[1].trim() : '');
  const parsedExplain = explainMatch ? explainMatch[1].trim() : '';
  const parsedAction = actionMatch ? actionMatch[1].trim() : content;

  // 填入 #主旨
  if (parsedSubject) {
    await formPage.evaluate((text) => {
      const el = document.getElementById('主旨');
      if (el && el.isContentEditable) {
        el.focus(); el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, parsedSubject);
    console.log(`✅ 主旨：${parsedSubject.substring(0, 40)}`);
    await formPage.waitForTimeout(300);
  }

  // 填入 #說明
  if (parsedExplain) {
    await formPage.evaluate((text) => {
      const el = document.getElementById('說明');
      if (el && el.isContentEditable) {
        el.focus(); el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, parsedExplain);
    console.log(`✅ 說明：${parsedExplain.substring(0, 40)}`);
    await formPage.waitForTimeout(300);
  }

  // 填入 #擬辦（最重要）
  const yibanEl = await formPage.$('#擬辦[contenteditable="true"]');
  if (!yibanEl || !(await yibanEl.isVisible())) {
    // 備用：找任何可見的 contenteditable（排除不分段有項次）
    const fallback = await formPage.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      const el = els.find(e => e.id !== '不分段有項次' && e.offsetParent !== null);
      return el ? el.id : null;
    });
    if (!fallback) throw new Error('找不到可填入的便簽欄位（#擬辦 或其他 contenteditable）');
    await formPage.evaluate((id, text) => {
      const el = document.getElementById(id);
      if (el) { el.focus(); el.innerText = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }, fallback, parsedAction);
    console.log(`✅ 擬辦（備用 #${fallback}）：${parsedAction.substring(0, 50)}`);
  } else {
    await formPage.evaluate((text) => {
      const el = document.getElementById('擬辦');
      el.focus(); el.innerText = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, parsedAction);
    console.log(`✅ 擬辦：${parsedAction.substring(0, 50)}`);
  }
  await formPage.waitForTimeout(500);
}

/**
 * 儲存便簽（點工具列「儲存」按鈕）
 * popupForm 和 DocEditorHome 都是用 span[title="儲存"]
 * @param {import('playwright').Page} formPage
 */
async function saveBianQian(formPage) {
  const saveSelectors = [
    'span[title="儲存"]',
    '[title="儲存"]',
    'span:has-text("儲存")',
    'button:has-text("儲存")',
    'a:has-text("儲存")',
    'input[type="submit"]',
  ];
  for (const sel of saveSelectors) {
    try {
      const btn = await formPage.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click();
        await formPage.waitForTimeout(3000);
        console.log(`✅ 便簽已儲存（${sel}）`);
        return true;
      }
    } catch {}
  }
  console.log('⚠️  找不到儲存按鈕');
  return false;
}


/**
 * 主工作流程
 */
async function run() {
  validate();
  console.log('🤖 EDMS 便簽自動化工作流程啟動\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    // 1. 登入
    await gdms.login(page);
    console.log('✅ 登入成功\n');

    // 2. 前往 Home_Splitter（必須！讓 EDMS_Open_File 可用）
    console.log('前往主框架...');
    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(6000); // 等框架全部載入

    // 3. 取得公文清單
    const mainFrame = await getMainFrame(page);
    // 確保 main frame 已穩定（等待 USER_LIST_WORK.aspx 載入完成）
    await mainFrame.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(2000);
    const documents = await mainFrame.$$eval('table tr', rows =>
      rows.map(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
        if (cells.length >= 13 && cells[6] && /^\d+$/.test(cells[6])) {
          return {
            docNo: cells[6], type: cells[7], org: cells[8],
            subject: cells[9], receiveDate: cells[10],
            dueDate: cells[11], status: cells[12],
          };
        }
        return null;
      }).filter(Boolean)
    );

    console.log(`📋 主辦公文：${documents.length} 件\n`);
    documents.forEach((d, i) => console.log(`  [${i}] ${d.docNo} - ${d.subject.substring(0, 40)}`));

    if (documents.length === 0) {
      console.log('沒有主辦公文，結束。');
      return;
    }

    // 4. 處理第一筆（測試模式）
    const doc = documents[0];
    console.log(`\n📄 處理第一筆：${doc.docNo}`);
    console.log(`   主旨：${doc.subject}`);
    console.log(`   來文：${doc.org}`);
    console.log(`   限辦：${doc.dueDate}`);

    // 5. 開啟 EDMS
    console.log('\n開啟 EDMS 視窗...');
    const edmsPage = await openEdms(page, ctx, 0);
    console.log(`EDMS URL：${edmsPage.url()}`);

    // 6. 讀取來文詳細內容
    console.log('\n讀取來文內容...');
    const docContent = await readDocContent(edmsPage);
    console.log(`主旨：${docContent.subject}`);
    console.log(`說明：${docContent.content.substring(0, 100)}`);

    // 7. 呼叫 Gemini 產生便簽建議
    console.log('\n呼叫 Gemini 產生便簽...');
    let aiSuggestion = '';
    try {
      aiSuggestion = await gemini.generateBianQian({
        docNo: doc.docNo,
        org: doc.org,
        subject: docContent.subject || doc.subject,
        content: docContent.content,
        dueDate: doc.dueDate,
      });
      console.log(`Gemini 建議：${aiSuggestion}`);
    } catch (err) {
      console.error('Gemini 失敗，使用預設便簽：', err.message);
      aiSuggestion = `謹查本文，已悉，請 校長 核示。`;
    }

    // 8. Telegram 通知
    const msg = `📄 公文 ${doc.docNo}\n機關：${doc.org}\n主旨：${doc.subject.substring(0, 100)}\n限辦：${doc.dueDate}\n\nAI 便簽建議：\n${aiSuggestion}\n\n請回覆：\n1 = 自動填入並儲存\n2 = 略過此件\n3 = 自訂內容`;

    console.log('\n📱 發送 Telegram 通知...');
    await telegram.sendLong(msg);

    // 9. 等待回覆（120秒）
    console.log('等待 Telegram 回覆（120秒）...');
    const reply = await telegram.waitReply(120) || '2'; // 預設略過
    console.log(`收到回覆：${reply}`);

    if (reply.trim() === '1') {
      // 自動填入便簽
      console.log('\n📝 開啟便簽模板（RadWindow → popupForm）...');
      const formPage = await openSignTemplate(edmsPage, ctx);

      console.log('填入便簽內容...');
      await fillBianQian(formPage, aiSuggestion);

      console.log('儲存便簽...');
      await saveBianQian(formPage);

      console.log('\n✅ 便簽已填入並儲存！');
      await telegram.send(`✅ 公文 ${doc.docNo} 便簽已儲存，請手動送出。`);

    } else if (reply.trim() === '3') {
      // 自訂內容
      await telegram.send('請輸入您的便簽內容：');
      const customContent = await telegram.waitReply(300) || aiSuggestion;

      console.log('\n📝 開啟便簽模板（自訂）...');
      const formPage3 = await openSignTemplate(edmsPage, ctx);

      console.log('填入自訂便簽...');
      await fillBianQian(formPage3, customContent);

      console.log('儲存便簽...');
      await saveBianQian(formPage3);

      console.log('\n✅ 自訂便簽已填入並儲存！');
      await telegram.send(`✅ 公文 ${doc.docNo} 自訂便簽已儲存，請手動送出。`);

    } else {
      console.log('\n⏭️  略過此件');
      await telegram.send(`⏭️ 已略過公文 ${doc.docNo}`);
    }

    console.log('\n✅ 工作流程完成！30 秒後關閉...');
    await new Promise(r => setTimeout(r, 30000));

  } catch (err) {
    console.error('\n❌ 失敗：', err.message);
    console.error(err.stack);
    try {
      await telegram.send(`❌ 系統錯誤：${err.message}`);
    } catch {}
  } finally {
    await browser.close();
  }
}

module.exports = { openEdms, readDocContent, openSignTemplate, fillBianQian, saveBianQian };

// 直接執行
if (require.main === module) {
  run();
}
