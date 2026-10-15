/**
 * 主辦公文自動化流程
 * 執行方式：node src/workflow-main.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { config, validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');
const gemini = require('./gemini');
const telegram = require('./telegram');
const fs = require('fs');
const path = require('path');

function log(msg) {
  const ts = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(
      path.join(__dirname, '../logs/main.log'),
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
  log('=== 主辦公文流程啟動 ===');

  let page = null;

  try {
    // 1. 啟動瀏覽器並登入
    page = await browser.launch();
    await gdms.login(page);

    // 2. 取得主辦公文清單
    const docs = await gdms.getMainDocuments(page);

    if (docs.length === 0) {
      log('📭 目前沒有主辦公文');
      await telegram.notifyDone('主辦公文掃描完成，目前無待處理公文');
      return;
    }

    await telegram.send(
      `🚀 <b>主辦公文掃描完成</b>\n\n共找到 <b>${docs.length}</b> 件待處理公文，逐件通知中...`
    );

    // 3. 逐件處理
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      log(`\n--- 處理第 ${i + 1}/${docs.length} 件 ---`);
      log(`主旨：${doc.subject}`);

      try {
        // 取得公文詳細內容
        let detail = { subject: doc.subject, content: '', docNo: '', from: '' };
        if (doc.id) {
          try {
            detail = await gdms.getDocumentDetail(page, doc.id);
            if (!detail.subject) detail.subject = doc.subject;
          } catch (err) {
            log(`⚠️ 無法取得詳細內容：${err.message}，使用清單資料繼續`);
          }
        }

        // 產生 AI 便簽建議
        log('🤖 呼叫 Gemini 產生便簽...');
        let bianQian;
        try {
          bianQian = await gemini.generateBianQian(detail);
        } catch (err) {
          log(`⚠️ Gemini 失敗：${err.message}`);
          bianQian = '（AI 產生失敗，請自行撰寫便簽內容）';
        }

        // 傳送 Telegram 通知並等待回覆
        let reply = await telegram.notifyMainDoc(i + 1, docs.length, detail, bianQian);

        if (!reply) {
          log('⏰ 逾時未回覆，跳過此件');
          await telegram.send(`⏰ 第 ${i + 1} 件逾時未回覆，已跳過`);
          continue;
        }

        const choice = reply.trim();

        // ── 選項 1：同意送出 ──
        if (choice === '1') {
          log('✅ 使用者選擇：同意送出');
          try {
            await gdms.submitBianQian(page, doc.id, bianQian);
            await telegram.send(`✅ 第 ${i + 1} 件便簽已送出！\n主旨：${detail.subject}`);
            log('✅ 便簽送出成功');
          } catch (err) {
            log(`❌ 送出失敗：${err.message}`);
            await telegram.send(`❌ 第 ${i + 1} 件送出失敗：${err.message}\n請手動處理`);
          }

        // ── 選項 2：修改內容 ──
        } else if (choice === '2') {
          log('✏️ 使用者選擇：修改內容');
          await telegram.send(
            `✏️ 請說明修改意見（直接輸入文字），或傳送修改後的完整便簽內容：`
          );

          const feedback = await telegram.waitReply(300); // 5 分鐘等待修改意見

          if (!feedback) {
            log('⏰ 等待修改意見逾時，跳過');
            await telegram.send(`⏰ 等待修改意見逾時，第 ${i + 1} 件已跳過`);
            continue;
          }

          // 重新產生修改後的便簽
          let revisedBianQian;
          try {
            revisedBianQian = await gemini.reviseBianQian(detail, bianQian, feedback);
          } catch {
            revisedBianQian = feedback; // 直接使用使用者輸入
          }

          await telegram.sendLong(
            `📝 <b>修改後便簽：</b>\n<pre>${revisedBianQian.substring(0, 2000)}</pre>\n\n回覆 <b>1</b> 確認送出 / <b>3</b> 取消`
          );

          const confirmReply = await telegram.waitReply(300);

          if (confirmReply && confirmReply.trim() === '1') {
            try {
              await gdms.submitBianQian(page, doc.id, revisedBianQian);
              await telegram.send(`✅ 第 ${i + 1} 件修改後便簽已送出！`);
              log('✅ 修改後便簽送出成功');
            } catch (err) {
              log(`❌ 送出失敗：${err.message}`);
              await telegram.send(`❌ 送出失敗：${err.message}\n請手動處理`);
            }
          } else {
            await telegram.send(`🚫 第 ${i + 1} 件已取消，請手動處理`);
            log('🚫 使用者取消送出');
          }

        // ── 選項 3：自己處理 ──
        } else if (choice === '3') {
          log('🙋 使用者選擇：自己處理');
          await telegram.send(`🙋 第 ${i + 1} 件由您自行處理`);

        } else {
          log(`❓ 收到未預期的回覆：${choice}，跳過此件`);
          await telegram.send(`❓ 未認識的指令「${choice}」，第 ${i + 1} 件已跳過\n（請回覆 1/2/3）`);
        }

      } catch (docErr) {
        log(`❌ 處理第 ${i + 1} 件時發生錯誤：${docErr.message}`);
        await telegram.send(`❌ 第 ${i + 1} 件處理錯誤：${docErr.message}\n請手動處理`);
      }

      // 每件之間稍作間隔
      await sleep(1000);
    }

    log('=== 主辦公文流程完成 ===');
    await telegram.notifyDone(`主辦公文全部處理完畢（共 ${docs.length} 件）`);

  } catch (err) {
    log(`❌ 主流程錯誤：${err.message}`);
    log(err.stack);
    await telegram.notifyError(`主辦公文流程發生錯誤：\n${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
