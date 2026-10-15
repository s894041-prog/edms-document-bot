# 📄 公文便簽自動化系統

台中市國小行政人員專用 — 自動讀取公文、AI 生成便簽建議稿、Telegram 確認後自動填入。

---

## ✨ 功能介紹

- 🔍 **自動偵測**：偵測到便簽編輯器開啟時自動啟動
- 🤖 **AI 生成**：使用 Gemini AI 根據公文內容自動生成便簽建議稿
- 📱 **Telegram 確認**：透過 Telegram 推送建議稿，由你決定同意/修改/自己處理
- ✏️ **自動填入**：同意後自動填入並保存
- 🔁 **持續待機**：可連續處理多份公文，不需重新啟動

---

## 📋 系統需求

- Windows 10 / 11
- [Node.js](https://nodejs.org/) v18 以上
- Google Chrome 瀏覽器
- 台中市 EDMS 帳號（edmsedu.taichung.gov.tw）

---

## 🚀 安裝步驟

### 第一步：下載專案

```cmd
git clone https://github.com/s894041-prog/edms-document-bot.git
cd document-bot
```

### 第二步：安裝套件

```cmd
npm install
```

### 第三步：安裝 Playwright 瀏覽器

```cmd
npx playwright install chromium
```

### 第四步：建立 `.env` 設定檔

在專案資料夾內建立一個 `.env` 檔案，填入以下內容：

```env
# Telegram Bot 設定
TELEGRAM_TOKEN=你的TelegramBotToken
TELEGRAM_CHAT_ID=你的ChatID

# Gemini AI API
GEMINI_API_KEY=你的GeminiAPIKey

# EDMS 登入 PIN 碼
GDMS_PIN=你的PIN碼

# Chrome 設定
WINDOWS_USERNAME=你的Windows使用者名稱
CHROME_PROFILE_NUMBER=你的Chrome設定檔編號
```

> ⚠️ `.env` 包含你的私人金鑰，**不要分享給任何人**

---

## 🔑 如何取得各項設定

### Telegram Bot Token + Chat ID

1. 在 Telegram 搜尋 **@BotFather**
2. 傳送 `/newbot`，依指示建立 Bot
3. 建立完成後取得 `Token`
4. 搜尋 **@userinfobot**，傳送任意訊息取得你的 `Chat ID`

### Gemini API Key

1. 前往 [Google AI Studio](https://aistudio.google.com/)
2. 點選右上角「Get API key」
3. 建立新的 API Key 並複製

### Chrome 設定檔編號

1. 在 Chrome 網址列輸入 `chrome://version/`
2. 找到「個人資料路徑」，例如：`...User Data\Profile 6`
3. 數字 `6` 就是你的設定檔編號

### Windows 使用者名稱

在命令提示字元輸入：
```cmd
echo %USERNAME%
```

---

## ▶️ 啟動方式

### 工作流 1：便簽自動化

```cmd
node run-bianqian-workflow.js
```

**使用流程：**
1. 系統開啟瀏覽器，請手動登入 EDMS
2. 開啟任一公文的便簽編輯器
3. 系統自動偵測並生成建議稿
4. 在 Telegram 收到建議稿後回覆：
   - `1` ✅ 同意，自動填入並保存
   - `2` ✏️ 要求修改（說明修改意見後重新生成）
   - `3` 🙋 自己處理

---

### 工作流 2：決行公文歸檔

```cmd
node run-juexing-workflow.js
```

**使用流程：**
1. 系統開啟瀏覽器，請手動登入 GDMS
2. 點開任一決行公文
3. 系統自動讀取公文資訊並推送到 Telegram
4. 在 Telegram 回覆：
   - `1` ✅ 自動歸檔
   - `2` 🙋 自己處理

---

## 📁 專案結構

```
document-bot/
├── run-bianqian-workflow.js    ← 便簽自動化啟動器
├── run-juexing-workflow.js     ← 決行歸檔啟動器
├── config.js                   ← 設定讀取
├── package.json
├── .env                        ← 你的私人設定（不上傳 GitHub）
└── src/
    ├── workflow-bianqian.js    ← 便簽工作流核心
    ├── workflow-juexing.js     ← 決行工作流核心
    ├── browser.js              ← 瀏覽器控制
    ├── telegram.js             ← Telegram 機器人
    ├── gemini.js               ← Gemini AI 生成
    └── gdms.js                 ← GDMS 登入
```

---

## 🔧 常見問題

### Q：系統一直說「等待便簽編輯器開啟」
→ 確認你開啟的頁面網址包含 `DocEditorHome`，並等頁面完全載入（約 5-10 秒）

### Q：推送到 Telegram 沒有收到訊息
→ 確認 `.env` 中的 `TELEGRAM_TOKEN` 和 `TELEGRAM_CHAT_ID` 正確，並先對你的 Bot 傳送一則訊息啟動對話

### Q：填入後找不到保存按鈕
→ 系統會通知你，請手動點擊瀏覽器上的「儲存」按鈕

### Q：Gemini 生成的內容不滿意
→ 在 Telegram 回覆 `2`，說明修改意見，系統會重新生成（最多 5 次）

---

## ⚠️ 注意事項

- 本工具**僅適用於台中市 EDMS 系統**
- `.env` 檔案包含私人金鑰，**不要傳給任何人**
- Gemini API 有免費額度（每天 500 次），一般使用完全免費

- > 本專案由國小教務人員開發，
  > 專為台中市國小行政人員設計。

---

## 📞 問題回報

如有問題，請聯絡開發者。
