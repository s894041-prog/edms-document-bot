const axios = require('axios');
const { config } = require('../config');

const BASE_URL = `https://api.telegram.org/bot${config.telegram.token}`;

let lastUpdateId = 0;

/**
 * 啟動時清除 webhook（避免 409 衝突）
 */
async function deleteWebhook() {
  try {
    await axios.post(`${BASE_URL}/deleteWebhook`, { drop_pending_updates: true });
    console.log('✅ Telegram webhook 已清除');
  } catch (e) {
    console.warn('⚠️ 清除 webhook 失敗（繼續）：', e.message);
  }
}

/**
 * 傳送訊息到 Telegram
 */
async function send(text, options = {}) {
  try {
    const response = await axios.post(`${BASE_URL}/sendMessage`, {
      chat_id: config.telegram.chatId,
      text: text,
      parse_mode: 'HTML',
      ...options,
    });
    return response.data.result;
  } catch (err) {
    console.error('❌ Telegram 傳送失敗：', err.response?.data || err.message);
    throw err;
  }
}

/**
 * 傳送長文訊息（超過 4096 字元時自動分割）
 */
async function sendLong(text) {
  const maxLen = 4000;
  if (text.length <= maxLen) {
    return send(text);
  }

  const parts = [];
  for (let i = 0; i < text.length; i += maxLen) {
    parts.push(text.substring(i, i + maxLen));
  }

  for (let i = 0; i < parts.length; i++) {
    await send(`[${i + 1}/${parts.length}]\n${parts[i]}`);
    await sleep(500);
  }
}

/**
 * 清空 Telegram 所有未讀訊息（避免讀到舊回覆）
 * 在每次新的 sendForApproval 前呼叫
 */
async function flushOldMessages() {
  console.log('🧹 清空 Telegram 舊訊息...');
  try {
    const response = await axios.get(`${BASE_URL}/getUpdates`, {
      params: { offset: lastUpdateId + 1, timeout: 0 },
      timeout: 5000,
    });
    const updates = response.data.result || [];
    if (updates.length > 0) {
      lastUpdateId = updates[updates.length - 1].update_id;
      console.log(`🧹 清空了 ${updates.length} 筆舊訊息（最新 ID：${lastUpdateId}）`);
    } else {
      console.log('🧹 沒有舊訊息需要清空');
    }
  } catch (e) {
    console.warn('⚠️ 清空訊息失敗（繼續）：', e.message);
  }
}

/**
 * 等待使用者回覆（長輪詢）
 * @param {number} timeout - 等待秒數
 * @returns {string|null} 使用者回覆的文字，逾時回傳 null
 */
async function waitReply(timeout = config.telegram.replyTimeout) {
  const deadline = Date.now() + timeout * 1000;
  console.log(`⏳ 等待 Telegram 回覆（${timeout} 秒）...`);

  while (Date.now() < deadline) {
    try {
      const response = await axios.get(`${BASE_URL}/getUpdates`, {
        params: {
          offset: lastUpdateId + 1,
          timeout: 30,
          allowed_updates: ['message'],
        },
        timeout: 35000,
      });

      const updates = response.data.result;

      for (const update of updates) {
        lastUpdateId = update.update_id;

        const msg = update.message;
        if (!msg) continue;

        // 只處理指定 Chat ID 的訊息
        if (String(msg.chat.id) !== String(config.telegram.chatId)) continue;

        const text = msg.text?.trim();
        if (text) {
          console.log(`📩 收到回覆：${text}`);
          return text;
        }
      }
    } catch (err) {
      if (err.code !== 'ECONNABORTED') {
        console.error('⚠️ 輪詢錯誤：', err.message);
      }
      await sleep(3000);
    }
  }

  console.log('⏰ 等待逾時，未收到回覆');
  return null;
}

/**
 * 傳送主辦公文通知並等待回覆
 */
async function notifyMainDoc(index, total, doc, bianQian) {
  const msg = `📌 <b>主辦公文 ${index}/${total}</b>

📄 <b>主旨：</b>
${escapeHtml(doc.subject)}

🤖 <b>AI 便簽建議稿：</b>
<pre>${escapeHtml(bianQian.substring(0, 1500))}${bianQian.length > 1500 ? '\n...(已截短)' : ''}</pre>

請回覆：
<b>1</b> = ✅ 同意，直接送出
<b>2</b> = ✏️ 我要修改（回覆後請說明修改意見）
<b>3</b> = 🙋 我自己處理`;

  await sendLong(msg);
  return waitReply();
}

/**
 * 傳送決行公文通知
 */
async function notifyDecisionDoc(index, total, doc) {
  const msg = `⚖️ <b>決行公文 ${index}/${total}</b>

📄 <b>主旨：</b>${escapeHtml(doc.subject)}
📊 <b>狀態：</b>${escapeHtml(doc.status || '待決行')}
🔗 <b>連結：</b>${doc.id || '（無連結）'}`;

  await send(msg);
}

/**
 * 傳送錯誤通知
 */
async function notifyError(message) {
  await send(`❌ <b>系統錯誤</b>\n\n${escapeHtml(message)}`).catch(() => {});
}

/**
 * 傳送完成通知
 */
async function notifyDone(message) {
  await send(`✅ <b>${escapeHtml(message)}</b>`).catch(() => {});
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  send,
  sendLong,
  waitReply,
  flushOldMessages,
  deleteWebhook,
  notifyMainDoc,
  notifyDecisionDoc,
  notifyError,
  notifyDone,
  escapeHtml,
};
