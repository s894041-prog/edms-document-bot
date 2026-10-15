/**
 * 決行公文掃描通知流程
 * 執行方式：node src/workflow-decision.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');
const telegram = require('./telegram');
const fs = require('fs');
const path = require('path');

function log(msg) {
  const ts = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(
      path.join(__dirname, '../logs/decision.log'),
      line + '\n',
      'utf8'
    );
  } catch {}
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  validate();
  log('=== 決行公文流程啟動 ===');

  let page = null;

  try {
    // 1. 啟動瀏覽器並登入
    page = await browser.launch();
    await gdms.login(page);

    // 2. 取得決行公文清單
    const docs = await gdms.getDecisionDocuments(page);

    if (docs.length === 0) {
      log('📭 目前沒有決行公文');
      await telegram.notifyDone('決行公文掃描完成，目前無待決行公文');
      return;
    }

    // 3. 傳送總覽通知
    await telegram.send(
      `⚖️ <b>決行公文掃描完成</b>\n\n共找到 <b>${docs.length}</b> 件待決行公文，逐件通知如下：`
    );

    await sleep(500);

    // 4. 逐件傳送通知
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      log(`通知第 ${i + 1}/${docs.length} 件：${doc.subject}`);

      try {
        await telegram.notifyDecisionDoc(i + 1, docs.length, doc);
      } catch (err) {
        log(`⚠️ 第 ${i + 1} 件通知失敗：${err.message}`);
      }

      await sleep(500); // 避免 Telegram API 限速
    }

    // 5. 傳送摘要
    const summary = docs
      .map((d, i) => `${i + 1}. ${d.subject.substring(0, 40)}${d.subject.length > 40 ? '...' : ''} ── ${d.status || '待決行'}`)
      .join('\n');

    await telegram.send(
      `📊 <b>決行公文清單摘要</b>\n\n<pre>${summary}</pre>\n\n請至公文系統進行決行處理。`
    );

    log('=== 決行公文流程完成 ===');

  } catch (err) {
    log(`❌ 主流程錯誤：${err.message}`);
    log(err.stack);
    await telegram.notifyError(`決行公文流程發生錯誤：\n${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
