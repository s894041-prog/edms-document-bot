/**
 * 便簽自動化工作流
 * 開啟 GDMS → 使用者手動操作到便簽編輯器 → 自動生成 → Telegram確認 → 自動填入 → 保存
 */

const browser = require('./browser');
const telegram = require('./telegram');
const gemini = require('./gemini');

const GDMS_URL = 'https://odisedu.taichung.gov.tw/gdms_login.aspx';

/**
 * 從便簽編輯器讀取目前公文的文號（作為唯一識別碼）
 */
async function getCurrentDocId(page) {
  return await page.evaluate(() => {
    const text = document.body?.innerText || '';
    // 文號格式：通常是數字組合，如 1150001397、114XXX 等
    const match = text.match(/文號[：:\s]*([A-Za-z0-9（）\-]{5,20})/);
    if (match) return match[1].trim();
    // 備用：從 URL 取 query string
    return location.search || location.href;
  }).catch(() => '');
}

/**
 * 等待「新的」便簽編輯器開啟（用文號識別，避免重複）
 * @param {Set} processedDocIds - 已處理過的文號集合
 */
async function waitForBianQianEditor(ctx, maxWaitSeconds = 600, processedDocIds = new Set()) {
  console.log(`⏳ 等待便簽編輯器開啟（${maxWaitSeconds} 秒）...`);
  const deadline = Date.now() + maxWaitSeconds * 1000;

  while (Date.now() < deadline) {
    const pages = ctx.pages();

    for (const page of pages) {
      try {
        const url = page.url();
        if (!url.includes('DocEditorHome')) continue;

        // 確認有 contenteditable 欄位
        const editables = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('[contenteditable="true"]'));
          return els.map(el => el.id).filter(Boolean);
        }).catch(() => []);

        if (editables.length === 0) continue;

        // 讀取文號作為唯一識別碼
        const docId = await getCurrentDocId(page);
        const key = docId || url;

        if (processedDocIds.has(key)) continue; // 同一份公文跳過

        console.log(`✅ 找到新的便簽編輯器！文號：${docId}`);
        console.log(`   contenteditable 欄位：${editables.join(', ')}`);
        return page;
      } catch (e) {
        // 略過不可讀的 page
      }
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  throw new Error('逾時：未偵測到便簽編輯器開啟');
}

/**
 * 只從便簽編輯器本身提取公文資料
 * 重點：讀便簽頁面的顯示區（非 contenteditable）和所有 iframe
 */
async function extractDocumentDetails(ctx, edmsPage) {
  console.log('📖 從便簽編輯器頁面提取公文資料...');

  // 從主頁面讀取
  const fromEditor = await edmsPage.evaluate(() => {
    const bodyText = document.body?.innerText || '';

    // 隱藏欄位（常有文件 ID）
    const hiddenInputs = {};
    document.querySelectorAll('input[type="hidden"]').forEach(el => {
      const k = el.name || el.id;
      if (k && el.value) hiddenInputs[k] = el.value;
    });

    // iframe 內容（EDMS 常用 iframe 顯示公文）
    const iframeTexts = [];
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iDoc && iDoc.body) {
          iframeTexts.push(iDoc.body.innerText || '');
        }
      } catch(e) {} // cross-origin 忽略
    });

    return {
      bodyText: bodyText.substring(0, 8000),
      hiddenInputs,
      iframeTexts,
      title: document.title,
    };
  }).catch(e => {
    console.warn('⚠️ 提取出錯：', e.message);
    return { bodyText: '', hiddenInputs: {}, iframeTexts: [], title: '' };
  });

  console.log(`🔍 主頁面文字：${fromEditor.bodyText.length} 字元`);
  console.log(`🔍 iframe 數：${fromEditor.iframeTexts.length}`);

  // 合併：主頁面 + 所有 iframe 文字
  const allText = [
    fromEditor.title,
    fromEditor.bodyText,
    ...fromEditor.iframeTexts,
  ].join('\n');

  // 從合併文字中解析公文資料
  const structured = parseDocFromText(allText);

  console.log('📌 提取的公文資料：', structured);
  return { ...structured, rawText: allText };
}

/**
 * 從頁面文字中解析公文主旨、文號、受文者、說明
 */
function parseDocFromText(text) {
  const result = { subject: '', docNo: '', from: '', content: '' };

  // 找文號（格式如：1150001397、114XXX 等）
  const docNoMatch = text.match(/文號[：:\s]*([A-Za-z0-9]{5,20})/);
  if (docNoMatch) result.docNo = docNoMatch[1];

  // 找主旨（「主旨：」後的完整一段，可跨行）
  const subjectMatch = text.match(/主旨[：:]\s*([\s\S]{5,300}?)(?=\n說明|\n辦法|\n附件|\n$|$)/);
  if (subjectMatch) {
    result.subject = subjectMatch[1]
      .replace(/\s+/g, ' ')    // 壓縮空白
      .trim()
      .substring(0, 150);
  }

  // 找說明（「說明：」後的內容）
  const contentMatch = text.match(/說明[：:]\s*([\s\S]{5,500}?)(?=\n辦法|\n附件|\n$|$)/);
  if (contentMatch) {
    result.content = contentMatch[1]
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 500);
  }

  // 找受文者 / 發文機關
  const fromMatch = text.match(/(?:受文者|來文機關|發文機關)[：:\s]*(.{3,40})/);
  if (fromMatch) result.from = fromMatch[1].trim().substring(0, 50);

  return result;
}

/**
 * 若無法自動取得公文資料，透過 Telegram 詢問使用者
 */
async function askUserForDocInfo() {
  await telegram.send(`⚠️ <b>無法自動提取公文主旨</b>

請直接在 Telegram 輸入這份公文的主旨，或輸入簡短的說明讓我生成便簽。

例如：
<i>函請辦理112年度年終考核相關事宜</i>

（若要跳過，請回覆「skip」）`);

  const reply = await telegram.waitReply(120);
  if (!reply || reply.toLowerCase() === 'skip') return null;
  return reply.trim();
}

/**
 * 生成便簽建議稿
 */
async function generateBianQianDraft(doc) {
  console.log('🤖 使用 Gemini 生成便簽建議稿...');
  const draft = await gemini.generateBianQian({
    subject: doc.subject || '（主旨未取得，請根據上下文生成）',
    content: doc.content || doc.rawText?.substring(0, 1000) || '（無額外內容）',
    docNo: doc.docNo || '（文號未取得）',
    from: doc.from || '（發文單位未取得）',
  });
  return draft;
}

/**
 * 發送便簽建議稿到 Telegram 並等待使用者確認
 */
async function sendForApproval(doc, draft) {
  console.log('📬 發送便簽建議稿到 Telegram...');

  // ⭐ 先清空舊訊息，避免讀到上一份公文的舊回覆
  await telegram.flushOldMessages();

  const subjectDisplay = doc.subject || doc.userInputSubject || '（未取得）';

  const msg = `📝 <b>便簽自動建議稿</b>

📄 <b>公文主旨：</b>
${telegram.escapeHtml(subjectDisplay)}

🤖 <b>AI 建議稿：</b>
<pre>${telegram.escapeHtml(draft.substring(0, 2000))}${draft.length > 2000 ? '\n...(已截短)' : ''}</pre>

請回覆：
<b>1</b> = ✅ 同意，直接填入
<b>2</b> = ✏️ 我要修改（回覆後請說明修改意見）
<b>3</b> = 🙋 我自己處理`;

  await telegram.sendLong(msg);
  const reply = await telegram.waitReply(300);
  return reply?.trim() || null;
}

/**
 * 用 Playwright 鍵盤方式填入 contenteditable 欄位（最可靠）
 */
async function typeIntoField(edmsPage, id, content) {
  if (!content || content.trim().length === 0) return false;

  const el = await edmsPage.$(`#${id}`);
  if (!el) return false;

  const isEditable = await el.evaluate(el => el.contentEditable === 'true').catch(() => false);
  if (!isEditable) return false;

  try {
    await el.click();
    await edmsPage.waitForTimeout(300);

    // 全選清空現有內容
    await edmsPage.keyboard.press('Control+a');
    await edmsPage.waitForTimeout(100);

    // 逐行輸入（避免特殊字元問題）
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await edmsPage.keyboard.press('Enter');
      await edmsPage.keyboard.type(lines[i], { delay: 20 });
    }

    console.log(`  ✅ 填入 #${id}：${content.substring(0, 40)}...`);
    return true;
  } catch (e) {
    console.warn(`  ⚠️ 填入 #${id} 失敗：${e.message}`);
    return false;
  }
}

/**
 * 填入便簽編輯器的內容
 */
async function fillBianQianEditor(edmsPage, draft) {
  console.log('✏️ 填入便簽內容...');
  const mapping = parseDraftToFields(draft);

  console.log(`📦 擬辦內容：${(mapping['擬辦'] || '').substring(0, 80)}`);
  if (!mapping['擬辦']) {
    console.warn('⚠️ 擬辦解析為空，改用整份草稿');
  }

  const results = { filled: [], failed: [] };

  // 只填入「不分段有項次」（擬辦）欄位，主旨/說明不需要
  const content = mapping['擬辦'] || mapping['說明'] || mapping['主旨'] || draft;
  const filled = await typeIntoField(edmsPage, '不分段有項次', content)
    || await typeIntoField(edmsPage, '擬辦', content);

  if (filled) {
    results.filled.push('不分段有項次');
  } else {
    results.failed.push('不分段有項次');
  }

  console.log('✅ 填入結果：', results);

  if (results.failed.length > 0) {
    const editables = await edmsPage.evaluate(() =>
      Array.from(document.querySelectorAll('[contenteditable="true"]'))
        .map(el => el.id).filter(Boolean)
    );
    console.warn(`⚠️ 未填入欄位：${results.failed.join(', ')}`);
    console.warn(`📋 頁面可用 contenteditable：${editables.join(', ')}`);
  }

  return results;
}

/**
 * 將 Gemini 生成的建議稿解析為各欄位
 * 能處理帶 markdown（**、++、## 等）的格式
 */
function parseDraftToFields(draft) {
  const mapping = { '主旨': '', '說明': '', '擬辦': '' };

  // 先清除常見 markdown 符號（** __ ++ ## 等）
  const cleaned = draft
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/\+\+/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^[-*]\s+/gm, '')  // 列表符號
    .trim();

  const lines = cleaned.split('\n');
  let currentField = null;
  let currentContent = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentField) currentContent.push('');
      continue;
    }

    // 用 regex 匹配標題（允許前後有空白或標點）
    if (/^主旨[：:]/.test(trimmed)) {
      if (currentField) mapping[currentField] = currentContent.join('\n').trim();
      currentField = '主旨';
      currentContent = [trimmed.replace(/^主旨[：:]\s*/, '').trim()];
    } else if (/^說明[：:]/.test(trimmed)) {
      if (currentField) mapping[currentField] = currentContent.join('\n').trim();
      currentField = '說明';
      const rest = trimmed.replace(/^說明[：:]\s*/, '').trim();
      currentContent = rest ? [rest] : [];
    } else if (/^(辦法|擬辦)[：:]/.test(trimmed)) {
      if (currentField) mapping[currentField] = currentContent.join('\n').trim();
      currentField = '擬辦';
      const rest = trimmed.replace(/^(辦法|擬辦)[：:]\s*/, '').trim();
      currentContent = rest ? [rest] : [];
    } else if (/^(注意事項|備註|受文者)[：:]/.test(trimmed)) {
      // 受文者不是 contenteditable 欄位，跳過
      if (trimmed.startsWith('注意事項') || trimmed.startsWith('備註')) {
        if (currentField) mapping[currentField] = currentContent.join('\n').trim();
        break;
      }
      // 受文者：繼續，不做任何事
    } else if (currentField) {
      currentContent.push(trimmed);
    }
  }

  if (currentField) mapping[currentField] = currentContent.join('\n').trim();

  return mapping;
}

/**
 * 點擊保存按鈕
 */
async function clickSaveButton(edmsPage) {
  console.log('💾 尋找並點擊保存按鈕...');

  const selectors = [
    '[title="儲存"]',
    '[title*="儲存"]',
    'span[title="儲存"]',
    'button:has-text("儲存")',
    'span:has-text("儲存")',
  ];

  let saveBtn = null;
  for (const selector of selectors) {
    try {
      saveBtn = await edmsPage.$(selector);
      if (saveBtn && await saveBtn.isVisible()) {
        console.log(`✅ 找到保存按鈕：${selector}`);
        break;
      }
    } catch (e) {
      // 繼續
    }
  }

  if (saveBtn) {
    await saveBtn.click();
    await edmsPage.waitForTimeout(3000);
    console.log('✅ 保存完成');
    return true;
  }

  console.warn('⚠️ 找不到保存按鈕，可能需要手動保存');
  return false;
}

/**
 * 處理單份便簽（從偵測編輯器到填入保存）
 * @param {Set} processedUrls - 已處理過的 URL，避免重複觸發
 */
async function processOneBianQian(ctx, processedDocIds) {
  // 1️⃣ 等待使用者開啟便簽編輯器（跳過已處理過的文號）
  const edmsPage = await waitForBianQianEditor(ctx, 600, processedDocIds);

  // 讀取文號並標記為已處理（不論成功失敗，避免重複觸發）
  const docId = await getCurrentDocId(edmsPage);
  const key = docId || edmsPage.url();
  processedDocIds.add(key);
  console.log(`📌 已標記文號：${key}`);

  // 2️⃣ 從便簽編輯器頁面提取公文資料
  const doc = await extractDocumentDetails(ctx, edmsPage);

  // 3️⃣ 若沒有主旨，透過 Telegram 詢問
  if (!doc.subject) {
    console.log('⚠️ 未找到公文主旨，透過 Telegram 詢問...');
    const userSubject = await askUserForDocInfo();
    if (userSubject) {
      doc.subject = userSubject;
      doc.userInputSubject = userSubject;
    } else {
      doc.subject = '（請根據上下文生成便簽）';
    }
  }

  // 4️⃣ 生成便簽建議稿
  let draft = await generateBianQianDraft(doc);

  // 5️⃣ 發送到 Telegram 並等待確認（支持修改循環）
  let userChoice = null;
  let attempts = 0;

  while (attempts < 5) {
    userChoice = await sendForApproval(doc, draft);

    if (!userChoice) {
      console.log('⏰ 逾時未收到回覆');
      attempts++;
      continue;
    }

    if (userChoice === '1') {
      console.log('✅ 使用者同意，開始自動填入...');
      break;
    } else if (userChoice === '2') {
      await telegram.send('✏️ 請說明你的修改意見：');
      const feedback = await telegram.waitReply(180);
      if (feedback) {
        console.log(`📝 修改意見：${feedback}`);
        await telegram.send('⏳ 正在根據你的意見重新生成...');
        doc.content = (doc.content || '') + '\n修改要求：' + feedback;
        draft = await generateBianQianDraft(doc);
        userChoice = null;
      }
      attempts++;
    } else if (userChoice === '3') {
      console.log('🙋 使用者選擇自己處理');
      await telegram.send('收到！這份便簽由你自行處理。\n\n⏳ 繼續等待下一份公文...');
      return false; // 回傳 false 表示跳過（繼續循環）
    } else {
      await telegram.send('請回覆 <b>1</b>（同意）、<b>2</b>（修改）或 <b>3</b>（自己處理）');
      attempts++;
    }
  }

  if (userChoice !== '1') {
    await telegram.send('⚠️ 未收到確認，跳過此份公文。\n\n⏳ 繼續等待下一份...');
    return false;
  }

  // 6️⃣ 自動填入
  await fillBianQianEditor(edmsPage, draft);
  await edmsPage.waitForTimeout(1000);

  // 7️⃣ 自動保存
  const saved = await clickSaveButton(edmsPage);
  if (saved) {
    await telegram.send('✅ <b>便簽已自動填入並保存完成！</b>\n\n⏳ 繼續等待下一份公文...');
  } else {
    await telegram.send('⚠️ 填入完成，但找不到保存按鈕，請手動點擊儲存。\n\n⏳ 繼續等待下一份公文...');
  }

  return true; // 回傳 true 表示處理成功
}

/**
 * 主工作流函數（持續循環，不會自動關閉）
 */
async function run() {
  let ctx = null;

  try {
    // 清除 Telegram webhook（避免 409 衝突）
    await telegram.deleteWebhook();

    // 啟動瀏覽器並開啟 GDMS 登入頁面
    const page = await browser.launch();
    ctx = browser.getContext();
    console.log('✅ 瀏覽器已啟動');

    console.log(`🌐 導航到 GDMS：${GDMS_URL}`);
    await page.goto(GDMS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
      console.warn(`⚠️ 導航警告（繼續）：${e.message}`);
    });
    console.log('✅ GDMS 頁面已開啟');

    await telegram.send('🤖 <b>便簽自動化系統已啟動！</b>\n\n請登入 GDMS，開啟任何公文的便簽編輯器，系統會自動偵測並生成建議稿。\n\n（系統會持續待機，可處理多份公文）');

    let docCount = 0;
    const processedDocIds = new Set(); // 追蹤已處理過的文號（避免同一份重複觸發）

    // 🔁 持續循環，不自動關閉
    while (true) {
      console.log('\n─────────────────────────────────');
      console.log(`⏳ 等待第 ${docCount + 1} 份公文的便簽編輯器...`);
      console.log(`   已處理過的文號數：${processedDocIds.size}`);
      console.log('─────────────────────────────────');

      try {
        const success = await processOneBianQian(ctx, processedDocIds);
        if (success) {
          docCount++;
          console.log(`✅ 第 ${docCount} 份便簽處理完成`);
        }

        // 短暫等待後繼續
        await new Promise(r => setTimeout(r, 2000));

      } catch (err) {
        // 單份公文出錯，不要讓整個循環停止
        if (err.message.includes('逾時')) {
          // 等待逾時（10分鐘無動作），繼續下一輪
          console.log('⏰ 等待逾時，繼續監視...');
          await telegram.send('⏰ 等待逾時，繼續待機中...').catch(() => {});
        } else {
          console.error(`❌ 處理便簽出錯：${err.message}`);
          await telegram.notifyError(`處理便簽時出錯：${err.message}`).catch(() => {});
          // 等待 5 秒後繼續
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }

  } catch (err) {
    console.error('❌ 嚴重錯誤（系統停止）：', err.message);
    await telegram.notifyError(`系統停止：${err.message}`).catch(() => {});
    await browser.close();
    throw err;
  }
}

module.exports = { run, waitForBianQianEditor, extractDocumentDetails, generateBianQianDraft };

if (require.main === module) {
  run().catch(err => {
    console.error('💥 工作流失敗：', err.message);
    process.exit(1);
  });
}
