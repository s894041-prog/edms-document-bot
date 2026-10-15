/**
 * Gemini API 測試腳本（Mac 上可直接執行）
 * 執行方式：node src/test-gemini.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY') {
  console.error('❌ 請先在 .env 填入 GEMINI_API_KEY');
  console.error('   取得方式：https://aistudio.google.com/apikey');
  process.exit(1);
}

async function run() {
  console.log('🤖 測試 Gemini API 連線...\n');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // 用一筆假公文主旨來測試便簽產生
  const testDoc = {
    docNo: '臺中市政府教育局113年教特字第1234567號',
    from: '臺中市政府教育局',
    subject: '函請各校配合辦理113學年度學生體適能施測，請依規定期限完成登錄',
    content: '依教育部規定，本學年度體適能施測應於113年10月底前完成，並登錄至體適能資訊網。',
  };

  const prompt = `你是一位台灣國小行政人員（教學組長），請根據以下公文資料，產生一份簡潔的便簽建議稿。

公文資料：
- 文號：${testDoc.docNo}
- 發文單位：${testDoc.from}
- 主旨：${testDoc.subject}
- 內容摘要：${testDoc.content}

請產生便簽建議稿，格式如下（請直接輸出便簽內容，不要加說明）：

受文者：校長

主旨：[簡潔說明本公文事項及建議處理方式]

說明：
一、[說明公文來源及主要內容]
二、[說明相關規定或背景]

辦法：
一、[具體建議行動]
二、[如需其他步驟，列出]`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    console.log('✅ Gemini API 連線成功！\n');
    console.log('━'.repeat(50));
    console.log('📄 測試便簽產生結果：\n');
    console.log(text);
    console.log('━'.repeat(50));
    console.log('\n🎉 Gemini 測試通過，可以進行下一步！');
  } catch (err) {
    console.error('❌ Gemini API 錯誤：', err.message);
    if (err.message.includes('API_KEY_INVALID')) {
      console.error('   → API Key 無效，請重新取得');
    } else if (err.message.includes('quota')) {
      console.error('   → 配額已用完，請等待或升級方案');
    }
    process.exit(1);
  }
}

run();
