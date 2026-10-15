const { GoogleGenerativeAI } = require('@google/generative-ai');
const { config } = require('../config');

let genAI = null;
let model = null;

function init() {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    model = genAI.getGenerativeModel({ model: config.gemini.model });
  }
}

/**
 * 根據公文主旨和內容產生便簽建議稿
 * @param {Object} doc - 公文資料 {subject, content, docNo, from}
 * @returns {string} 便簽建議稿
 */
async function generateBianQian(doc) {
  init();

  const prompt = `你是一位台灣國小行政人員（教學組長），請根據以下公文資料，產生一份簡潔的便簽建議稿。

公文資料：
- 文號：${doc.docNo || '（無）'}
- 發文單位：${doc.from || '（無）'}
- 主旨：${doc.subject || '（無）'}
- 內容摘要：${doc.content ? doc.content.substring(0, 500) : '（無）'}

【重要格式規定】
1. 請嚴格按照以下格式輸出，每個標題必須完全照抄（含冒號），不可加粗、不可加任何 markdown 符號（不可用 **、__、++、##、- 等）
2. 直接輸出純文字，不要有任何說明或前言

受文者：校長

主旨：[一句話說明本公文事項及建議處理方式，結尾加「請核示。」]

說明：
一、[說明公文來源及主要內容]
二、[說明相關規定或背景]

辦法：
一、[具體建議行動]
二、[如需其他步驟，列出]`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log('✅ Gemini 便簽建議稿產生完成');
    return text;
  } catch (err) {
    console.error('❌ Gemini API 錯誤：', err.message);
    throw new Error(`Gemini 產生失敗：${err.message}`);
  }
}

/**
 * 根據使用者修改意見，重新產生便簽
 * @param {Object} doc - 公文資料
 * @param {string} originalBianQian - 原始便簽
 * @param {string} userFeedback - 使用者修改意見
 * @returns {string} 修改後的便簽
 */
async function reviseBianQian(doc, originalBianQian, userFeedback) {
  init();

  const prompt = `請根據使用者的修改意見，修改以下便簽建議稿。

原始公文主旨：${doc.subject}

原始便簽：
${originalBianQian}

使用者修改意見：${userFeedback}

請直接輸出修改後的完整便簽內容，格式不變：`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    console.log('✅ Gemini 便簽修改完成');
    return text;
  } catch (err) {
    console.error('❌ Gemini API 錯誤：', err.message);
    throw new Error(`Gemini 修改失敗：${err.message}`);
  }
}

module.exports = { generateBianQian, reviseBianQian };
