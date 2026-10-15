# 🚀 便簽自動化工作流 - 快速開始

## 5 分鐘入門指南

### 步驟 1️⃣: 環境診斷（1 分鐘）

運行診斷工具檢查是否所有配置都正確：

```bash
node test-workflow-setup.js
```

**預期輸出**：所有項目都顯示 ✅

如果有 ❌，請按提示修復（通常是 npm 模組或 API key）。

---

### 步驟 2️⃣: 啟動工作流（4 分鐘）

一切就緒後，運行：

```bash
node run-bianqian-workflow.js
```

**系統將提示**：
```
⏳ 等待你手動開啟便簽編輯器 (DocEditorHome)...
```

---

### 步驟 3️⃣: 使用工作流

#### 你需要做什麼：

1. **在瀏覽器中手動開啟便簽編輯器**
   - 在 EDMS (edmsedu.taichung.gov.tw) 中正常操作
   - 點進一份公文，點「簽」按鈕，進入編輯器（DocEditorHome）
   - 系統會自動偵測到編輯器已開啟

2. **根據 Telegram 推送，回覆你的決定**
   - 收到便簽建議稿後，Telegram 會問：
     ```
     請回覆：
     1 = ✅ 同意，直接送出
     2 = ✏️ 我要修改
     3 = 🙋 我自己處理
     ```
   - 回覆對應的數字

3. **如果選擇「2」（修改）**
   - 系統會要求你說明修改意見
   - Telegram 中回覆你的修改意見
   - 系統會用 Gemini 重新生成
   - 再次推送新版本供你確認

4. **如果選擇「1」（同意）**
   - 系統會自動：
     - 填入便簽編輯器的各欄位
     - 點擊保存按鈕
     - 發送完成通知 ✅

#### 系統自動做什麼：

| 步驟 | 系統動作 | 你的動作 |
|------|------|------|
| 1 | 等待你開啟編輯器 | 手動打開 DocEditorHome |
| 2 | 自動提取公文資訊 | 無 |
| 3 | Gemini 生成建議稿 | 無 |
| 4 | Telegram 推送 | 回覆 1/2/3 |
| 5 | 根據回覆決定後續 | 如需修改，說明意見 |
| 6 | 自動填入編輯器 | 無 |
| 7 | 自動保存 | 無 |
| 8 | 推送完成通知 | 無 |

---

## 📊 工作流流程圖

```
你開啟便簽編輯器
        ↓
   [系統偵測]
        ↓
   自動提取公文資訊
        ↓
   Gemini 生成便簽
        ↓
   Telegram 推送給你
        ↓
        ┌───────┬───────┬───────┐
        ↓       ↓       ↓       ↓
      [1]     [2]     [3]  逾時無回覆
        ↓       ↓       ↓       ↓
      同意    修改    自己做   超時
        ↓       ↓       ↓       ↓
      ✅      ⌛      🙋      ❌
     自動   詢問意見   結束    結束
     填入   重新生成
     保存   再次確認

     [若選 2 進入循環]
       ↓
     詢問修改意見
       ↓
     Gemini 重新生成
       ↓
     Telegram 推送新版本
       ↓
     等待再次回覆 (1/2/3)
```

---

## 🔧 常見問題

### Q1: 系統一直說「等待便簽編輯器開啟」

**解決**：
- 確認你確實打開了 `edmsedu.taichung.gov.tw/DocEditorHome`
- 頁面需要完全加載（等 5-10 秒，看到文本編輯框）
- 檢查瀏覽器控制台 (F12) 是否有紅色錯誤

### Q2: 填入後沒有保存

**解決**：
- 系統會嘗試點擊多個保存按鈕選擇器
- 如果找不到，會在 console 顯示「找不到保存按鈕」
- 你可以手動點擊「儲存」按鈕
- 如需修復，編輯 `src/workflow-bianqian.js` 的 `clickSaveButton()` 函數

### Q3: Gemini 生成的內容不符合預期

**解決**：
- 工作流會讓你回覆「2」要求修改
- 在 Telegram 中說明修改意見
- 系統會用你的反饋重新生成
- 最多可修改 3 次

### Q4: Telegram 無法連接

**解決**：
- 確認 .env 中的 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID` 正確
- 運行 `node test-workflow-setup.js` 診斷 Telegram 連線
- 檢查網路連接

---

## 📁 重要檔案說明

```
document-bot/
├── run-bianqian-workflow.js      ← 啟動工作流的主腳本
├── test-workflow-setup.js         ← 環境診斷工具
├── QUICKSTART.md                  ← 這份文件
├── WORKFLOW_BIANQIAN.md           ← 詳細的技術文檔
├── IMPLEMENTATION_SUMMARY.md      ← 架構說明和對比
└── src/
    ├── workflow-bianqian.js       ← 核心工作流（自動生成、填入、保存）
    ├── browser.js                 ← Playwright 瀏覽器控制
    ├── telegram.js                ← Telegram 機器人 API
    ├── gemini.js                  ← Gemini AI 便簽生成
    └── gdms.js                    ← GDMS 登入相關
```

---

## 💡 使用技巧

### 批量處理多份公文

1. 打開第一份公文的便簽編輯器
2. 運行 `node run-bianqian-workflow.js`
3. 第一份完成後，重複步驟 1-2

（未來版本會支持自動批量處理）

### 保存建議稿草稿

每次生成的便簽建議都會：
- 推送到 Telegram（保留在聊天記錄）
- 在 console 中輸出（可複製）

### 自訂便簽模板

如需調整 Gemini 生成的格式，編輯 `src/gemini.js` 中的 `prompt` 變數。

---

## 📞 支援和除錯

### 啟用詳細日誌

編輯 `.env`，添加：
```env
DEBUG=*
```

再次運行工作流，會顯示更詳細的調試信息。

### 檢查瀏覽器控制台

在工作流運行期間，打開瀏覽器 (F12)，查看控制台是否有錯誤。

### 檢查 Telegram 消息

所有系統消息都會在 Telegram 中記錄，便於追蹤工作流進度。

---

## ✅ 檢查清單

在運行工作流前，確保：

- [ ] 運行 `node test-workflow-setup.js` 並全部通過
- [ ] .env 配置了所有必需的 API key
- [ ] Chrome Profile 6 存在並包含已保存的帳密
- [ ] Telegram bot 已啟動並可接收消息
- [ ] Gemini API 配額未用盡

---

## 🎯 下一步

**現在就開始吧！**

```bash
# 1. 檢查環境
node test-workflow-setup.js

# 2. 如果全部通過，啟動工作流
node run-bianqian-workflow.js

# 3. 在瀏覽器中手動開啟便簽編輯器

# 4. 在 Telegram 中回應提示
```

---

## 📚 進階閱讀

- 技術細節：見 `WORKFLOW_BIANQIAN.md`
- 架構對比：見 `IMPLEMENTATION_SUMMARY.md`

---

**祝你使用愉快！** 🎉

如有問題或建議，歡迎反饋。
