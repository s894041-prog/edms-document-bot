/**
 * 決行公文歸檔工作流（人機合作版）
 *
 * 架構與便簽工作流相同：
 *   使用者手動開啟決行公文
 *   → 系統偵測頁面（判斷有「傳送歸檔」按鈕）
 *   → 提取：公文本身 / 擬辦意見 / 校長意見
 *   → Telegram 推送
 *   → 使用者選擇 1=自動歸檔 / 2=自己處理
 *   → 循環等待下一份
 */

const browser = require('./browser');
const telegram = require('./telegram');

const GDMS_URL = 'https://odisedu.taichung.gov.tw/gdms_login.aspx';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────
// 偵測：判斷一個頁面是否為「決行公文單份」頁面
// 條件：頁面上可見「傳送歸檔」相關按鈕
// ─────────────────────────────────────────────────────────
async function isJueXingPage(page) {
  return await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a, span, button, input, img'));
    return all.some(el => {
      if (!el.offsetParent) return false; // 不可見的跳過
      const text = (el.innerText || el.title || el.alt || el.value || '').trim();
      return text.includes('傳送歸檔') || text === '歸檔';
    });
  }).catch(() => false);
}

// ─────────────────────────────────────────────────────────
// 偵測：判斷一個頁面是否為「決行公文列表」頁面
// 條件：頁面含有「承辦處理清單」且「決行公文」標籤有數字 > 0
// ─────────────────────────────────────────────────────────
async function isJueXingListPage(page) {
  return await page.evaluate(() => {
    const body = document.body?.innerText || '';
    // 必須包含「承辦處理清單」且有決行公文標籤（含數字）
    const hasTitle = body.includes('承辦處理清單');
    const hasTab = /決行公文\s*\(\s*[1-9]\d*\s*\)/.test(body);
    return hasTitle && hasTab;
  }).catch(() => false);
}

// ─────────────────────────────────────────────────────────
// 從列表頁面讀取所有決行公文的文號和主旨
// ─────────────────────────────────────────────────────────
async function scanDocListItems(page) {
  console.log('📋 掃描決行公文列表...');

  // 先嘗試展開列表（讓所有項目都出現）
  await tryExpandListPageSize(page);

  const items = await page.evaluate(() => {
    const results = [];
    const rows = Array.from(document.querySelectorAll('tr, .rgRow, .rgAltRow'));

    for (const row of rows) {
      const text = row.innerText || '';
      // 文號：10位數字
      const docNoM = text.match(/(\d{10,12})/);
      if (!docNoM) continue;
      const docNo = docNoM[1];

      // 主旨：較長文字欄
      const cells = Array.from(row.querySelectorAll('td'));
      let subject = '';
      for (const cell of cells) {
        const t = (cell.innerText || '').trim();
        if (t.length > 15 && !/^\d/.test(t) && !/^[\d\/\s]+$/.test(t)) {
          subject = t.substring(0, 100);
          break;
        }
      }

      results.push({ docNo, subject });
    }

    return results;
  });

  console.log(`📋 找到 ${items.length} 份決行公文`);
  return items;
}

// ─────────────────────────────────────────────────────────
// 取得文件唯一識別碼（用文號避免重複偵測同一份）
// ─────────────────────────────────────────────────────────
async function getDocId(page) {
  return await page.evaluate(() => {
    const text = document.body?.innerText || document.title || '';
    // 文號格式：10位數字或含字母的文件編號
    const m = text.match(/文號[：:\s]*([A-Za-z0-9]{8,20})|(\d{10,12})/);
    if (m) return (m[1] || m[2]).trim();
    return document.title || '';
  }).catch(() => '');
}


// ─────────────────────────────────────────────────────────
// 提取決行公文三大資訊
// ─────────────────────────────────────────────────────────
async function extractJueXingInfo(page) {
  console.log('📖 提取決行公文資料...');

  // ── 主頁面文字 ──
  const mainData = await page.evaluate(() => {
    const body = document.body?.innerText || '';

    // 1. 公文本身
    const subjectM = body.match(/主旨[：:]\s*([\s\S]{5,300}?)(?=\n說明|\n辦法|\n附件|\n受文|\n$|$)/);
    const subject = subjectM ? subjectM[1].replace(/\s+/g, ' ').trim().substring(0, 200) : '';

    const toM = body.match(/受文者[：:]\s*(.{3,50})/);
    const to = toM ? toM[1].trim() : '';

    const docNoM = body.match(/(?:發文字號|文號)[：:]\s*(.{5,40})/);
    const docNo = docNoM ? docNoM[1].trim() : '';

    const dateM = body.match(/發文日期[：:]\s*(.{5,25})/);
    const docDate = dateM ? dateM[1].trim() : '';

    // 2. 擬辦意見（便簽內容）
    let opinion = '';
    // 優先：contenteditable 欄位
    for (const id of ['不分段有項次', '擬辦', 'Opinion']) {
      const el = document.getElementById(id);
      if (el?.innerText?.trim()) { opinion = el.innerText.trim(); break; }
    }
    // 備用：從頁面文字
    if (!opinion) {
      const opM = body.match(/擬辦方式編輯區[^]*?\n([\s\S]{5,300}?)(?=\n{2}|$)/);
      if (opM) opinion = opM[1].trim().substring(0, 300);
    }
    // 再備用：任何 contenteditable 有內容的
    if (!opinion) {
      const allEdits = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      for (const el of allEdits) {
        const t = el.innerText?.trim() || '';
        if (t.length > 2) { opinion = t.substring(0, 300); break; }
      }
    }

    // 3. 校長意見（悉 / 可 / 照辦...）
    let principalComment = '';

    // 方式A：從正文 regex 搜尋「校長」後的短文字
    const principalPatterns = [
      /校長[^\n]{0,30}\n[^\n]{0,20}\n([悉可照辦核示閱同意如擬]{1,15})/,
      /校長[^\n\u4e00-\u9fff]{0,20}([悉可照辦核示閱同意如擬]{1,10})/,
    ];
    for (const pat of principalPatterns) {
      const m = body.match(pat);
      if (m) { principalComment = m[1].trim(); break; }
    }

    // 方式B：從 DOM 結構找（右側 sidebar 通常有 div > 姓名 + 意見）
    if (!principalComment) {
      const all = Array.from(document.querySelectorAll('div, span, td'));
      let afterPrincipal = false;
      for (const el of all) {
        const txt = (el.innerText || '').trim();
        if (txt.includes('校長') && txt.length < 20) {
          afterPrincipal = true;
          continue;
        }
        if (afterPrincipal && txt.length > 0 && txt.length <= 15
          && !txt.includes('校長') && !txt.includes('/') && !/^\d/.test(txt)) {
          principalComment = txt;
          break;
        }
      }
    }

    return { subject, to, docNo, docDate, opinion, principalComment };
  });

  // ── 從 iframe 補充主旨 ──
  if (!mainData.subject) {
    for (const frame of page.frames()) {
      try {
        const frameText = await frame.evaluate(() => document.body?.innerText || '').catch(() => '');
        const m = frameText.match(/主旨[：:]\s*([\s\S]{5,200}?)(?=\n說明|\n辦法|\n$)/);
        if (m) {
          mainData.subject = m[1].replace(/\s+/g, ' ').trim().substring(0, 200);
          // 補充受文者
          if (!mainData.to) {
            const toM = frameText.match(/受文者[：:]\s*(.{3,50})/);
            if (toM) mainData.to = toM[1].trim();
          }
          break;
        }
      } catch (e) { /* cross-origin skip */ }
    }
  }

  console.log('📌 提取結果：');
  console.log(`  主旨：${mainData.subject || '（未取得）'}`);
  console.log(`  受文者：${mainData.to || '（未取得）'}`);
  console.log(`  擬辦意見：${mainData.opinion || '（未取得）'}`);
  console.log(`  校長意見：${mainData.principalComment || '（未取得）'}`);

  return mainData;
}

// ─────────────────────────────────────────────────────────
// Telegram 推送 + 等待使用者選擇
// ─────────────────────────────────────────────────────────
async function sendToTelegram(info) {
  await telegram.flushOldMessages();

  const esc = telegram.escapeHtml;

  const msg =
`⚖️ <b>決行公文</b>

━━━━━━━━━━━━━━━━━━━━━━
📄 <b>一、公文本身</b>
受文者：${esc(info.to || '（未取得）')}
發文字號：${esc(info.docNo || '（未取得）')}
發文日期：${esc(info.docDate || '（未取得）')}
主旨：${esc(info.subject || '（未取得）')}

━━━━━━━━━━━━━━━━━━━━━━
✍️ <b>二、擬辦意見</b>
${esc(info.opinion || '（未填寫）')}

━━━━━━━━━━━━━━━━━━━━━━
🏫 <b>三、校長意見</b>
${esc(info.principalComment || '（未取得，請查看頁面）')}

━━━━━━━━━━━━━━━━━━━━━━
請選擇：
<b>1</b> = ✅ 自行歸檔（系統自動點「傳送歸檔」）
<b>2</b> = 🙋 給我處理（繼續下一份）`;

  await telegram.sendLong(msg);
  return await telegram.waitReply(300); // 等待 5 分鐘
}

// ─────────────────────────────────────────────────────────
// 等待並自動按「線上簽核傳送」對話框的確定按鈕
// ─────────────────────────────────────────────────────────
async function confirmArchiveDialog(page, maxWait = 10000) {
  console.log('🔍 等待「線上簽核傳送」對話框...');
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    // 用 Playwright 選擇器找確定按鈕（在可見的對話框內）
    const confirmed = await page.evaluate(() => {
      // 找所有可能是確定按鈕的元素
      const candidates = Array.from(
        document.querySelectorAll('button, input[type="button"], input[type="submit"], a.rwCloseButton, .rwPopup button')
      );

      for (const btn of candidates) {
        if (!btn.offsetParent) continue; // 不可見跳過
        const txt = (btn.innerText || btn.value || btn.textContent || '').trim();
        if (txt === '確定' || txt === '✓ 確定' || txt.includes('確定')) {
          // 確認這個按鈕在對話框內（排除頁面主體的按鈕）
          const inDialog = btn.closest('.RadWindow, [class*="dialog"], [class*="modal"], .rwDialog, .rwContent, .rwPopup, .ui-dialog, [role="dialog"]');
          if (inDialog || candidates.length <= 3) {
            // inDialog 或頁面上只有少數按鈕（即對話框模式）
            btn.click();
            return btn.innerText || btn.value || '確定';
          }
        }
      }
      return null;
    });

    if (confirmed) {
      console.log(`✅ 已自動按「確定」：${confirmed}`);
      await sleep(2000);
      return true;
    }

    await sleep(500);
  }

  console.warn('⚠️ 未找到確定對話框，或對話框已自動關閉');
  return false;
}

// ─────────────────────────────────────────────────────────
// 點擊「傳送歸檔」按鈕，並自動處理後續確定對話框
// ─────────────────────────────────────────────────────────
async function clickArchiveButton(page) {
  console.log('📤 點擊「傳送歸檔」...');

  let clicked = false;

  // 方式1：Playwright 選擇器
  const selectors = [
    '[title="傳送歸檔"]',
    '[title*="歸檔"]',
    'span:has-text("傳送歸檔")',
    'a:has-text("傳送歸檔")',
    'button:has-text("傳送歸檔")',
  ];

  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn && await btn.isVisible()) {
        await btn.click();
        console.log(`✅ 傳送歸檔按鈕已點擊（${sel}）`);
        clicked = true;
        break;
      }
    } catch (e) { /* 繼續嘗試下一個 */ }
  }

  // 方式2：evaluate 備用
  if (!clicked) {
    const result = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('a, span, button, input[type="button"], img'));
      for (const el of all) {
        const txt = (el.innerText || el.title || el.alt || el.value || '').trim();
        if ((txt.includes('傳送歸檔') || txt === '歸檔') && el.offsetParent !== null) {
          el.click();
          return txt;
        }
      }
      return null;
    });

    if (result) {
      console.log(`✅ 傳送歸檔已點擊（evaluate）：${result}`);
      clicked = true;
    }
  }

  if (!clicked) {
    console.warn('⚠️ 找不到「傳送歸檔」按鈕');
    return false;
  }

  // ⭐ 重要：等待並自動按「線上簽核傳送」對話框的確定
  await sleep(1000); // 等對話框出現
  await confirmArchiveDialog(page, 10000);

  return true;
}

// ─────────────────────────────────────────────────────────
// 嘗試展開列表（把每頁顯示從10改為更多）
// 解決：「最下面的滑不下去讀不到」問題
// ─────────────────────────────────────────────────────────
async function tryExpandListPageSize(page) {
  console.log('📋 嘗試展開列表（增加每頁顯示筆數）...');

  const expanded = await page.evaluate(() => {
    // 找「每頁顯示」select 元素
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => parseInt(o.value)).filter(v => !isNaN(v));
      if (options.length >= 2 && options.some(v => v >= 10 && v <= 100)) {
        // 這是分頁大小選擇器，選最大值
        const maxVal = Math.max(...options);
        if (sel.value != maxVal) {
          sel.value = maxVal;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return maxVal;
        }
        return `已是最大（${maxVal}）`;
      }
    }

    // 找「友善列印」或「顯示全部」等連結
    const allLinks = Array.from(document.querySelectorAll('a, span, button'));
    for (const el of allLinks) {
      const txt = (el.innerText || el.title || '').trim();
      if (txt.includes('全部') || txt.includes('顯示全部') || txt === '全部顯示') {
        el.click();
        return '點擊顯示全部';
      }
    }

    return null;
  });

  if (expanded) {
    console.log(`✅ 列表展開：${expanded}`);
    await sleep(2000); // 等頁面重載
  } else {
    console.log('ℹ️ 未找到分頁控制項，列表可能已顯示全部');
  }

  return expanded;
}

// ─────────────────────────────────────────────────────────
// 從列表頁點擊某文號的連結，開啟單份公文
// ─────────────────────────────────────────────────────────
async function openDocFromList(ctx, listPage, docNo) {
  const beforeUrls = ctx.pages().map(p => p.url());

  const clicked = await listPage.evaluate((no) => {
    const rows = Array.from(document.querySelectorAll('tr, .rgRow, .rgAltRow'));
    for (const row of rows) {
      if (!row.innerText?.includes(no)) continue;
      // 點擊文號連結（第一個可點擊元素）
      const link = row.querySelector('a, [onclick], img[onclick], input[type="image"]');
      if (link) { link.click(); return 'ok'; }
    }
    return null;
  }, docNo);

  if (!clicked) return null;

  // 等待新頁面或跳轉
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const newPages = ctx.pages().filter(p => !beforeUrls.includes(p.url()) && p.url() !== 'about:blank');
    if (newPages.length > 0) {
      const np = newPages[newPages.length - 1];
      await np.waitForLoadState('domcontentloaded').catch(() => {});
      return np;
    }
    // 同頁面跳轉
    try {
      const currentUrl = listPage.url();
      if (currentUrl.includes('DocEditorHome') || currentUrl.includes('DocEditor')) {
        await listPage.waitForLoadState('domcontentloaded').catch(() => {});
        return listPage;
      }
    } catch (e) { /* 頁面可能已跳轉 */ }
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 列表模式：處理整個決行公文列表
// ─────────────────────────────────────────────────────────
async function processDocumentList(ctx, listPage, processedIds) {
  const items = await scanDocListItems(listPage);
  const newItems = items.filter(item => !processedIds.has(item.docNo));

  if (newItems.length === 0) {
    console.log('📭 列表中無新的決行公文');
    return 0;
  }

  await telegram.send(`📋 偵測到 <b>${newItems.length}</b> 份待處理的決行公文，開始逐份處理...`);

  let archived = 0;

  for (let i = 0; i < newItems.length; i++) {
    const item = newItems[i];
    console.log(`\n═══ 第 ${i + 1}/${newItems.length} 份：${item.docNo} ═══`);

    processedIds.add(item.docNo); // 先標記避免重複

    // 開啟文件
    const docPage = await openDocFromList(ctx, listPage, item.docNo);
    if (!docPage) {
      console.warn(`⚠️ 無法開啟 ${item.docNo}，跳過`);
      await telegram.send(`⚠️ 無法開啟文件 <b>${telegram.escapeHtml(item.docNo)}</b>，已跳過。`);
      continue;
    }

    await sleep(1500); // 等頁面穩定

    // 提取資料
    const info = await extractJueXingInfo(docPage);

    // 發送 Telegram，等待選擇
    const reply = (await sendToTelegram(info))?.trim();

    if (reply === '1') {
      const ok = await clickArchiveButton(docPage);
      if (ok) {
        await telegram.send(`✅ <b>${telegram.escapeHtml(item.docNo)}</b> 已自動傳送歸檔！\n（${i + 1}/${newItems.length}）`);
        archived++;
      } else {
        await telegram.send(`⚠️ 找不到「傳送歸檔」按鈕，請手動操作。`);
      }
    } else if (reply === '2') {
      await telegram.send(`🙋 由你自行處理 <b>${telegram.escapeHtml(item.docNo)}</b>。`);
    } else {
      await telegram.send('⏰ 等待逾時或無效選擇，跳過此份。');
    }

    await sleep(2000);
  }

  await telegram.send(`\n✅ <b>列表處理完畢！</b>\n自動歸檔：${archived} 份 / 共 ${newItems.length} 份`);
  return archived;
}

// ─────────────────────────────────────────────────────────
// 主工作流（持續循環，不關閉瀏覽器）
// 同時支援：
//   📋 列表模式：偵測到承辦處理清單 → 自動展開並逐份處理
//   📄 單份模式：偵測到已開啟的個別決行公文 → 直接處理
// ─────────────────────────────────────────────────────────
async function run() {
  try {
    const page = await browser.launch();
    const ctx = browser.getContext();
    console.log('✅ 瀏覽器已啟動');

    // 開啟 GDMS 登入頁（與便簽工作流相同）
    await page.goto(GDMS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(e => console.warn('⚠️ 導航警告（繼續）：', e.message));
    console.log('✅ GDMS 頁面已開啟');

    await telegram.send(
`⚖️ <b>決行公文歸檔系統已啟動！</b>

系統支援兩種模式：

📋 <b>列表模式</b>（推薦）
→ 你點擊「決行公文」標籤，看到清單
→ 系統自動展開全部18份並逐份處理

📄 <b>單份模式</b>
→ 你手動開啟任一決行公文
→ 系統自動偵測並處理

每份公文 Telegram 回覆：
  <b>1</b> = ✅ 自動歸檔（含自動按確定）
  <b>2</b> = 🙋 我來處理

（系統持續待機，不會自動關閉）`
    );

    const processedIds = new Set();
    let count = 0;

    // 🔁 持續循環
    while (true) {
      console.log(`\n───── 掃描中（已處理 ${processedIds.size} 份）─────`);

      try {
        let handled = false;

        // ── 檢查所有頁面 ──
        for (const p of ctx.pages()) {
          try {
            // 優先：列表模式（承辦處理清單）
            if (await isJueXingListPage(p)) {
              console.log('📋 偵測到決行公文列表！啟動列表模式...');
              await telegram.flushOldMessages();
              const n = await processDocumentList(ctx, p, processedIds);
              count += n;
              handled = true;
              break;
            }

            // 其次：單份模式（有傳送歸檔按鈕）
            if (await isJueXingPage(p)) {
              const docId = await getDocId(p);
              const key = docId || p.url();
              if (!processedIds.has(key)) {
                console.log(`📄 偵測到單份決行公文：${docId}`);
                processedIds.add(key);
                await sleep(1500);
                const info = await extractJueXingInfo(p);
                const reply = (await sendToTelegram(info))?.trim();

                if (reply === '1') {
                  const ok = await clickArchiveButton(p);
                  await telegram.send(ok
                    ? '✅ <b>已自動傳送歸檔！</b>\n\n⏳ 繼續等待下一份...'
                    : '⚠️ 找不到「傳送歸檔」按鈕，請手動操作。\n\n⏳ 繼續等待...'
                  );
                  if (ok) count++;
                } else if (reply === '2') {
                  await telegram.send('🙋 收到！由你自行處理。\n\n⏳ 繼續等待下一份...');
                } else {
                  await telegram.send('⏰ 等待逾時，已跳過。\n\n⏳ 繼續等待...');
                }
                handled = true;
                break;
              }
            }
          } catch (e) { /* 頁面關閉，繼續下一個 */ }
        }

        await sleep(handled ? 2000 : 3000);

      } catch (err) {
        if (err.message?.includes('逾時')) {
          console.log('⏰ 等待逾時，繼續監視...');
        } else {
          console.error(`❌ 處理出錯：${err.message}`);
          await telegram.notifyError(`決行公文出錯：${err.message}`).catch(() => {});
          await sleep(5000);
        }
      }
    }

  } catch (err) {
    console.error('❌ 嚴重錯誤（系統停止）：', err.message);
    await telegram.notifyError(`決行公文系統停止：${err.message}`).catch(() => {});
    await browser.close();
    throw err;
  }
}

module.exports = { run, extractJueXingInfo, clickArchiveButton };

if (require.main === module) {
  run().catch(err => {
    console.error('💥 工作流失敗：', err.message);
    process.exit(1);
  });
}
