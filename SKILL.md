# 🤖 公文便簽自動化 — Skill 說明

## 這個 Skill 做什麼？

當你在 EDMS 開啟便簽編輯器時，系統會自動：
1. 讀取公文內容（主旨、文號、發文單位）
2. 用 Gemini AI 生成便簽建議稿
3. 透過 Telegram 推送給你確認
4. 你回覆同意後，自動填入並保存

---

## 安裝

### 1. 下載

```cmd
git clone https://github.com/s894041-prog/edms-document-bot.git
cd document-bot
```

### 2. 安裝套件

```cmd
npm install
npx playwright install chromium
```

### 3. 建立 `.env`

在專案資料夾建立 `.env` 檔案：

```env
TELEGRAM_TOKEN=你的TelegramBotToken
TELEGRAM_CHAT_ID=你的ChatID
GEMINI_API_KEY=你的GeminiAPIKey
GDMS_PIN=你的PIN碼
WINDOWS_USERNAME=你的Windows帳號名稱
CHROME_PROFILE_NUMBER=你的Chrome設定檔編號
```

---

## 如何取得設定值

| 設定值 | 取得方式 |
|--------|----------|
| `TELEGRAM_TOKEN` | Telegram 搜尋 @BotFather → `/newbot` |
| `TELEGRAM_CHAT_ID` | Telegram 搜尋 @userinfobot，傳訊息給它 |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com/) → Get API Key |
| `GDMS_PIN` | 你登入 EDMS 用的 PIN 碼 |
| `WINDOWS_USERNAME` | 命令提示字元輸入 `echo %USERNAME%` |
| `CHROME_PROFILE_NUMBER` | Chrome 網址列輸入 `chrome://version/`，看「個人資料路徑」最後的數字 |

---

## 啟動

### 便簽自動化

```cmd
node run-bianqian-workflow.js
```

啟動後：
- 手動登入 EDMS，開啟任一公文的便簽編輯器
- 等待 Telegram 推送建議稿
- 回覆 `1` 同意 / `2` 修改 / `3` 自己處理

---

### 決行公文歸檔

```cmd
node run-juexing-workflow.js
```

啟動後：
- 手動登入 GDMS，點開任一決行公文
- 等待 Telegram 推送
- 回覆 `1` 自動歸檔 / `2` 自己處理

---

## Telegram 指令對照

| 回覆 | 動作 |
|------|------|
| `1` | ✅ 同意，自動填入並保存 |
| `2` | ✏️ 修改（說明意見後重新生成） |
| `3` | 🙋 自己處理，繼續待機 |

---

## 費用

| 服務 | 費用 |
|------|------|
| Telegram Bot | 免費 |
| Gemini AI | 免費（每天 500 次，日常使用完全夠） |
| Playwright | 免費 |

---

## 注意事項

- 僅適用於**台中市 EDMS 系統**（edmsedu.taichung.gov.tw）
- `.env` 包含私人金鑰，**不要分享給任何人**
- 系統持續待機，可連續處理多份公文
