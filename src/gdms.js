const { config } = require('../config');

/**
 * 登入公文系統
 * Chrome Profile 已儲存帳號密碼，只需填入 PIN 碼
 */
async function login(page) {
  console.log('🔐 前往公文系統登入頁...');
  await page.goto(config.gdms.url, { waitUntil: 'networkidle' });

  // 等待頁面載入
  await page.waitForTimeout(2000);

  // ---- 選擇器調整區 ----
  // 若登入失敗，請用瀏覽器 F12 開發工具確認以下選擇器
  // PIN 碼輸入框（常見的可能名稱）
  const pinSelectors = [
    'input[name*="pin" i]',
    'input[name*="PIN"]',
    'input[id*="pin" i]',
    'input[id*="Pin"]',
    'input[placeholder*="PIN" i]',
    'input[placeholder*="動態" ]',
    'input[type="password"][name*="pin" i]',
    // ASP.NET 常見格式
    'input[id$="txtPIN"]',
    'input[id$="txtPin"]',
    'input[id$="PIN"]',
  ];

  let pinInput = null;
  for (const selector of pinSelectors) {
    try {
      pinInput = await page.$(selector);
      if (pinInput) {
        console.log(`✅ 找到 PIN 輸入框：${selector}`);
        break;
      }
    } catch {}
  }

  if (!pinInput) {
    // 如果以上都找不到，抓取所有 input 讓使用者參考
    const inputs = await page.$$eval('input', els =>
      els.map(e => ({ id: e.id, name: e.name, type: e.type, placeholder: e.placeholder }))
    );
    console.error('❌ 找不到 PIN 輸入框，頁面上的 input 元素：');
    console.error(JSON.stringify(inputs, null, 2));
    throw new Error('找不到 PIN 輸入框，請更新 src/gdms.js 中的選擇器');
  }

  // 清除並填入 PIN
  await pinInput.click({ clickCount: 3 });
  await pinInput.fill(config.gdms.pin);

  // 點擊登入按鈕（ibtn_LOGIN 是 type="image"，需優先匹配）
  const loginSelectors = [
    'input[id="ibtn_LOGIN"]',         // 確切 ID
    'input[id*="LOGIN"]',             // 含 LOGIN
    'input[type="image"][id*="btn"]', // image 類按鈕
    'input[type="submit"]',
    'button[type="submit"]',
    'input[value*="登入"]',
    'button:has-text("登入")',
    'a:has-text("登入")',
    'input[id$="btnLogin"]',
    'input[id$="btnSubmit"]',
  ];

  let loginBtn = null;
  for (const selector of loginSelectors) {
    try {
      loginBtn = await page.$(selector);
      if (loginBtn) {
        console.log(`✅ 找到登入按鈕：${selector}`);
        break;
      }
    } catch {}
  }

  if (!loginBtn) {
    throw new Error('找不到登入按鈕，請更新 src/gdms.js 中的選擇器');
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {}),
    loginBtn.click().catch(() => {}),
  ]);
  await page.waitForTimeout(3000);

  // 確認登入成功
  const currentUrl = page.url();
  if (currentUrl.includes('login') || currentUrl.includes('Login')) {
    throw new Error('登入失敗：仍在登入頁面，請檢查 PIN 碼或帳號密碼');
  }

  console.log('✅ 登入成功');
}

const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

/**
 * 取得主辦公文清單（從 USER_LIST_WORK.aspx）
 */
async function getMainDocuments(page) {
  console.log('📋 前往主辦公文清單...');
  await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 主辦公文在主框架
  const frame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;

  const documents = await frame.$$eval('table tr', rows =>
    rows
      .map(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
        // 結構：['','','','','','', docNo, type, org, subject, receiveDate, dueDate, status, '']
        if (cells.length >= 13 && cells[6] && /^\d+$/.test(cells[6])) {
          return {
            docNo: cells[6],
            type: cells[7],
            org: cells[8],
            subject: cells[9],
            receiveDate: cells[10],
            dueDate: cells[11],
            status: cells[12],
          };
        }
        return null;
      })
      .filter(Boolean)
  );

  console.log(`📄 找到 ${documents.length} 件主辦公文`);
  return documents;
}

/**
 * 取得決行公文清單（點選決行公文 tab）
 */
async function getDecisionDocumentsNew(page) {
  console.log('📋 前往決行公文清單...');
  await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);

  const frame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;

  // 點選「決行公文」tab
  try {
    const tab = await frame.$('a:has-text("決行公文"), td:has-text("決行公文"), span:has-text("決行公文")');
    if (tab) {
      await tab.click();
      await page.waitForTimeout(2000);
    }
  } catch {}

  const documents = await frame.$$eval('table tr', rows =>
    rows
      .map(row => {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
        if (cells.length >= 13 && cells[6] && /^\d+$/.test(cells[6])) {
          return {
            docNo: cells[6],
            type: cells[7],
            org: cells[8],
            subject: cells[9],
            receiveDate: cells[10],
            dueDate: cells[11],
            status: cells[12],
          };
        }
        return null;
      })
      .filter(Boolean)
  );

  console.log(`📄 找到 ${documents.length} 件決行公文`);
  return documents;
}

/**
 * 取得公文詳細內容
 */
async function getDocumentDetail(page, docId) {
  console.log(`📖 讀取公文內容：${docId}`);

  await page.goto(docId, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const detail = await page.evaluate(() => {
    // 嘗試取得公文主旨和內容
    const getText = (selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim()) return el.innerText.trim();
      }
      return '';
    };

    return {
      subject: getText([
        '[id*="subject" i]', '[id*="Subject"]',
        '[id*="主旨"]', 'td:has-text("主旨") + td',
        '.subject', '#subject',
      ]),
      content: getText([
        '[id*="content" i]', '[id*="Content"]',
        '[id*="說明"]', 'td:has-text("說明") + td',
        '.content', '#content',
        'textarea', '.doc-body',
      ]),
      docNo: getText([
        '[id*="docno" i]', '[id*="DocNo"]',
        '[id*="文號"]', 'td:has-text("文號") + td',
      ]),
      from: getText([
        '[id*="from" i]', '[id*="發文"]',
        'td:has-text("發文機關") + td',
      ]),
      // 取得頁面全文備用
      fullText: document.body.innerText.substring(0, 3000),
    };
  });

  return detail;
}

/**
 * 填寫並送出便簽
 */
async function submitBianQian(page, docId, bianQianContent) {
  console.log('📝 填寫便簽並送出...');

  // 如果不在文件頁面，先導航過去
  if (!page.url().includes(docId.split('/').pop())) {
    await page.goto(docId, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
  }

  // ---- 選擇器調整區 ----
  // 找到便簽/批示輸入區域
  const textareaSelectors = [
    'textarea[id*="opinion" i]',
    'textarea[id*="Opinion"]',
    'textarea[id*="comment" i]',
    'textarea[id*="批示"]',
    'textarea[id*="便簽"]',
    'textarea[id*="意見"]',
    'textarea',
  ];

  let textarea = null;
  for (const selector of textareaSelectors) {
    try {
      textarea = await page.$(selector);
      if (textarea) {
        console.log(`✅ 找到便簽輸入區：${selector}`);
        break;
      }
    } catch {}
  }

  if (!textarea) {
    throw new Error('找不到便簽輸入區域，請更新 src/gdms.js 中的選擇器');
  }

  await textarea.click({ clickCount: 3 });
  await textarea.fill(bianQianContent);

  // 找到送出按鈕
  const submitSelectors = [
    'input[value*="送出"]',
    'input[value*="確認"]',
    'input[value*="陳核"]',
    'button:has-text("送出")',
    'button:has-text("確認")',
    'a:has-text("送出")',
    'input[id*="btnSend"]',
    'input[id*="btnSubmit"]',
    'input[id*="btnOK"]',
  ];

  let submitBtn = null;
  for (const selector of submitSelectors) {
    try {
      submitBtn = await page.$(selector);
      if (submitBtn) {
        console.log(`✅ 找到送出按鈕：${selector}`);
        break;
      }
    } catch {}
  }

  if (!submitBtn) {
    throw new Error('找不到送出按鈕，請更新 src/gdms.js 中的選擇器');
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
    submitBtn.click(),
  ]);

  console.log('✅ 便簽已送出');
}

/**
 * 取得決行公文清單
 */
async function getDecisionDocuments(page) {
  console.log('📋 抓取決行公文清單...');

  // 導航到決行公文頁面
  const menuSelectors = [
    'a:has-text("決行")',
    'a:has-text("決行公文")',
    'li:has-text("決行") > a',
    'a[href*="決行"]',
  ];

  let menuLink = null;
  for (const selector of menuSelectors) {
    try {
      menuLink = await page.$(selector);
      if (menuLink) break;
    } catch {}
  }

  if (menuLink) {
    await menuLink.click();
    await page.waitForLoadState('networkidle');
  }

  await page.waitForTimeout(2000);

  // 抓取決行公文清單
  const documents = await page.evaluate(() => {
    const docs = [];
    const rows = document.querySelectorAll('table tr');

    rows.forEach((row, index) => {
      if (index === 0) return;

      const cells = row.querySelectorAll('td');
      if (cells.length < 2) return;

      const link = row.querySelector('a');
      const docId = link ? link.href : '';
      const subject = cells[cells.length > 2 ? 1 : 0]?.innerText?.trim() || '';
      const status = cells[cells.length - 1]?.innerText?.trim() || '';

      if (subject) {
        docs.push({ id: docId, subject, status });
      }
    });

    return docs;
  });

  console.log(`📄 找到 ${documents.length} 件決行公文`);
  return documents;
}

module.exports = {
  login,
  getMainDocuments,
  getDocumentDetail,
  submitBianQian,
  getDecisionDocuments,
};
