/**
 * auto-setup.js
 * ═══════════════════════════════════════════
 * 1. 自動登入 PIN 碼 + 按登入
 * 2. 代理人通知 → 自動按確定
 * 3. 自動開啟主辦公文（第一筆）
 * 4. 選便簽模板（點 ➕ 新檔）
 * 5. 選檔號/保存年限（前五個取第一個）
 * 6. 選第一層決行
 * ═══════════════════════════════════════════
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';

// ──────────────────────────────────────────────
// 工具：等秒數
// ──────────────────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms));

// 步驟 1 直接用 gdms.login()（已測試穩定）

// ──────────────────────────────────────────────
// 步驟 2：代理人通知 → 按確定
// 重點：在 overlay_frame (MSGPAGE.aspx) 裡，
//       用 Playwright frame.click() 直接點
// ──────────────────────────────────────────────
async function dismissProxyDialog(page, ctx) {
  await page.waitForTimeout(1500);

  for (const p of ctx.pages()) {
    for (const frame of p.frames()) {
      try {
        const bodyText = await frame.evaluate(() =>
          document.body ? document.body.innerText : ''
        ).catch(() => '');
        if (!bodyText.includes('代理')) continue;

        console.log(`  ✅ 在 frame [${frame.name()}] 找到代理人通知`);

        // 直接用 Playwright frame.click()（比 evaluate 更可靠）
        const selectors = [
          'input[type="button"]',
          'input[type="submit"]',
          'button',
          'a',
        ];
        for (const sel of selectors) {
          try {
            const el = await frame.$(sel);
            if (el) {
              await el.click({ timeout: 3000 });
              console.log(`  ✅ 已點確定（${sel}）`);
              await page.waitForTimeout(800);
              return true;
            }
          } catch {}
        }
        console.log('  ⚠️ 找到通知但找不到按鈕，嘗試 evaluate...');
        await frame.evaluate(() => {
          document.querySelectorAll('input,button,a').forEach(el => {
            const t = (el.value || el.innerText || '').trim();
            if (/確/.test(t)) el.click();
          });
        });
        await page.waitForTimeout(800);
        return true;
      } catch {}
    }
  }
  console.log('  ℹ️ 無代理人通知');
  return false;
}

// ──────────────────────────────────────────────
// 步驟 3：等 main frame 載入 USER_LIST_WORK
// ──────────────────────────────────────────────
async function waitForMainFrame(page, ctx) {
  console.log('  等待主辦公文清單...');
  for (let i = 0; i < 20; i++) {
    // 隨時檢查代理人通知
    await dismissProxyDialog(page, ctx);

    const mainFrame = page.frames().find(f => f.name() === 'main');
    const url = mainFrame ? mainFrame.url() : '';
    if (url.includes('USER_LIST_WORK.aspx')) {
      console.log(`✅ main frame 已載入`);
      return mainFrame;
    }
    console.log(`  [${i + 1}/20] main：${url.split('/').pop().split('?')[0] || 'loading...'}`);
    await page.waitForTimeout(2000);
  }
  throw new Error('main frame 未能載入 USER_LIST_WORK.aspx');
}

// ──────────────────────────────────────────────
// 步驟 4：RadWindow → 點便簽 ➕ 新檔按鈕
//          → 步驟 5：選檔號 → 確定
// ──────────────────────────────────────────────
async function selectBianQianAndFileNo(edmsPage, ctx) {
  console.log('\n📋 等待 RadWindow_Popup...');

  // 等 RadWindow 出現（最多 40 秒）
  let radFrame = null;
  for (let i = 0; i < 13; i++) {
    radFrame = edmsPage.frames().find(f => f.name() === 'RadWindow_Popup');
    if (radFrame) break;
    console.log(`  [${i + 1}/13] 等待中...`);
    await edmsPage.waitForTimeout(3000);
  }
  if (!radFrame) throw new Error('找不到 RadWindow_Popup');
  console.log('✅ 找到 RadWindow_Popup');

  // 等 frame 顯示「便簽」內容（最多 20 秒）
  for (let i = 0; i < 10; i++) {
    const txt = await radFrame.evaluate(() =>
      document.body ? document.body.innerText : ''
    ).catch(() => '');
    if (txt.includes('便簽') || txt.includes('範本')) {
      console.log('  ✅ 範本清單已載入');
      break;
    }
    await edmsPage.waitForTimeout(2000);
  }

  // ── A. 找便簽行並點 td[1]（新檔欄 ➕）──
  console.log('\n📌 步驟4：點便簽 ➕ 新檔...');
  const clickResult = await radFrame.evaluate(() => {
    // 策略：先找所有 innerText === '便簽' 的 TD，再用 closest('tr') 上溯
    const allTds = Array.from(document.querySelectorAll('td'));
    const bianQianNameTd = allTds.find(td => td.innerText.trim() === '便簽');

    if (!bianQianNameTd) {
      // 傾印所有 td 文字幫助診斷
      return {
        ok: false,
        allTdTexts: allTds.map(td => td.innerText.trim().substring(0, 40)).filter(Boolean).slice(0, 30),
      };
    }

    const parentTr = bianQianNameTd.closest('tr');
    if (!parentTr) return { ok: false, error: 'no parent tr' };

    // 取 TR 的直接子 TDs
    const sibs = Array.from(parentTr.querySelectorAll(':scope > td'));
    const tdInfo = sibs.map((td, i) => ({
      i,
      text: td.innerText.trim().substring(0, 30),
      html: td.innerHTML.substring(0, 150),
    }));

    // 序號(0), 新檔(1), 範本名稱(2), 電子交換(3), 範本說明(4), odt(5)
    const newFileTd = sibs[1];
    if (!newFileTd) return { ok: false, tdInfo, error: 'no sibs[1]' };

    const btn = newFileTd.querySelector('a, img, input, button, span[onclick], div[onclick]');
    if (btn) {
      btn.click();
      return {
        ok: true,
        method: `sibs[1] > ${btn.tagName}`,
        btnHtml: btn.outerHTML.substring(0, 200),
        tdInfo,
      };
    }
    newFileTd.click();
    return { ok: true, method: 'sibs[1].click()', tdInfo };
  });

  console.log('  便簽行 tds：');
  (clickResult.tdInfo || []).forEach(t =>
    console.log(`    td[${t.i}] "${t.text}" | html: ${t.html.substring(0, 80)}`)
  );
  if (!clickResult.ok) {
    console.log('  所有 rows：', (clickResult.allRows || []).join('\n    '));
    throw new Error('找不到便簽行或新檔按鈕');
  }
  console.log(`  ✅ 點擊方式：${clickResult.method}`);

  // ── B. 等 RadWindow 轉換為檔號選擇表單 ──
  await edmsPage.waitForTimeout(3000);

  // 重新取得 frame
  const radFrame2 = edmsPage.frames().find(f => f.name() === 'RadWindow_Popup') || radFrame;

  // 確認目前 RadWindow 內容（應該出現 年度/分類號 等欄位）
  const curText = await radFrame2.evaluate(() => document.body.innerText.substring(0, 200)).catch(() => '');
  console.log('\n📁 步驟5：RadWindow 現在內容：', curText.substring(0, 150));

  if (curText.includes('分類號') || curText.includes('年度') || curText.includes('保存年限')) {
    // ── C. 選第一個 分類號 資料列 ──
    console.log('  → 選第一個分類號...');
    const selectResult = await radFrame2.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      // 找含有 3+ 個 td 且第一個 td 是數字分類號的列
      const dataRows = rows.filter(r => {
        const tds = r.querySelectorAll('td');
        return tds.length >= 3 && /^\d{2,4}$/.test(tds[0].innerText.trim());
      });
      if (dataRows.length === 0) {
        // 傾印所有 rows 找線索
        return {
          ok: false,
          rows: rows.map(r => r.innerText.trim().substring(0, 60)).filter(Boolean),
        };
      }
      const firstRow = dataRows[0]; // 前五個取第一
      const tds = Array.from(firstRow.querySelectorAll('td'));
      const text = tds.map(td => td.innerText.trim()).join(' / ');
      firstRow.click();
      if (tds[0]) tds[0].click(); // 也點 td[0]
      return { ok: true, text };
    });
    console.log('  選取結果：', JSON.stringify(selectResult));
    await edmsPage.waitForTimeout(1500);

    // ── D. 點「確定」──
    console.log('  → 點確定...');
    const okClicked = await radFrame2.evaluate(() => {
      const els = Array.from(document.querySelectorAll('span, button, input, a'));
      const okEl = els.find(el =>
        (el.innerText || el.value || '').replace(/\s/g, '') === '確定' &&
        el.offsetParent !== null
      );
      if (okEl) { okEl.click(); return true; }
      return false;
    });
    console.log(`  確定：${okClicked ? '✅' : '⚠️ 找不到'}`);

  } else {
    console.log('  ⚠️ RadWindow 未顯示檔號表單，可能已直接開啟便簽編輯器');
  }

  // 等 localhost:61161 或 EDMS 更新
  const [newPg] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null),
    Promise.resolve(),
  ]);
  if (newPg) {
    console.log(`  新頁面：${newPg.url()}`);
    await newPg.waitForLoadState('load').catch(() => {});
    await newPg.waitForTimeout(3000);
  }

  await edmsPage.waitForTimeout(6000);
  console.log('✅ 便簽已建立');
}

// ──────────────────────────────────────────────
// 步驟 5b：在編輯器側欄選檔號/保存年限
// ──────────────────────────────────────────────
async function selectFileNumberInEditor(edmsPage, ctx) {
  console.log('\n📁 步驟5b：選檔號/保存年限（所有頁面）...');

  // 列出目前所有頁面
  const allPagesNow = ctx.pages();
  console.log('  目前頁面：');
  allPagesNow.forEach((p, i) => console.log(`    [${i}] ${p.url().split('?')[0]}`));

  // 在所有頁面的所有 frames 中尋找側欄「檔號」按鈕
  for (const p of allPagesNow) {
    for (const frame of p.frames()) {
      try {
        const txt = await frame.evaluate(() =>
          document.body ? document.body.innerText : ''
        ).catch(() => '');
        if (!txt.includes('檔號')) continue;

        const result = await frame.evaluate(() => {
          const els = Array.from(document.querySelectorAll('a, td, span, div, button'));
          // 跳過 LI，找 DIV/SPAN/A/TD 等互動元素
          const el =
            els.find(e => e.innerText.trim() === '檔號' && e.tagName !== 'LI') ||
            els.find(e => e.innerText.trim().includes('檔號') &&
              e.innerText.trim().length < 5 &&
              e.tagName !== 'LI');
          if (el) {
            el.click();
            return {
              tag: el.tagName,
              text: el.innerText.trim(),
              id: el.id,
              cls: el.className.substring(0, 40),
            };
          }
          return null;
        });

        if (!result) continue;
        console.log(`  ✅ 點擊檔號 [${frame.name()} of ${p.url().split('/').pop().split('?')[0]}]`, JSON.stringify(result));
        await p.waitForTimeout(4000);

        // 掃描所有頁/frame
        const appeared = await scanAllForFileNoForm(ctx, edmsPage);
        if (appeared) return true;

        // 若未出現，印診斷資訊
        console.log('  📋 點擊後所有頁面：');
        ctx.pages().forEach((pp, i) => console.log(`    [${i}] ${pp.url().split('?')[0]}`));

        // 也掃同頁 RadWindow frames
        const rads = p.frames().filter(f => f.name().includes('Rad') || f.url().includes('Popup'));
        for (const rf of rads) {
          const rtxt = await rf.evaluate(() => document.body?.innerText || '').catch(() => '');
          console.log(`    RadWindow[${rf.name()}]: ${rtxt.substring(0, 100)}`);
        }
      } catch {}
    }
  }
  console.log('  ⚠️ 找不到檔號選擇表單');
  return false;
}

async function scanAllForFileNoForm(ctx, edmsPage) {
  // 等 RadWindow_Open 或 RadWindow_Popup 有內容（最多 15 秒）
  console.log('  等待 RadWindow 內容...');
  let targetFrame = null;
  for (let i = 0; i < 8; i++) {
    // 優先找 RadWindow_Open（檔號選擇通常在此）
    for (const p of ctx.pages()) {
      for (const frame of p.frames()) {
        if (!frame.name().includes('Rad') && !frame.name().includes('Popup')) continue;
        const txt = await frame.evaluate(() =>
          document.body ? document.body.innerText : ''
        ).catch(() => '');
        if (txt.includes('分類號') || txt.includes('保存年限') || txt.includes('分類表')) {
          console.log(`  ✅ 找到檔號表單 [${frame.name()}]：${txt.substring(0, 80)}`);
          targetFrame = frame;
          break;
        }
      }
      if (targetFrame) break;
    }
    if (targetFrame) break;
    await edmsPage.waitForTimeout(2000);
    console.log(`  等待 RadWindow 載入（${i + 1}/8）...`);
  }

  if (!targetFrame) {
    // 備用：掃所有 frames
    for (const p of ctx.pages()) {
      for (const frame of p.frames()) {
        try {
          const txt = await frame.evaluate(() =>
            document.body ? document.body.innerText : ''
          ).catch(() => '');
          if (txt.includes('分類號') || txt.includes('保存年限')) {
            targetFrame = frame;
            console.log(`  📋 備用：找到表單 [${frame.name()}]`);
            break;
          }
        } catch {}
      }
      if (targetFrame) break;
    }
  }

  if (!targetFrame) return false;

  // 選第一個分類號資料列（3位數數字列）
  const selected = await targetFrame.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr'));
    const dataRows = rows.filter(r => {
      const tds = r.querySelectorAll('td');
      return tds.length >= 3 && /^\d{2,4}$/.test(tds[0].innerText.trim());
    });
    if (dataRows.length === 0) return null;
    const row = dataRows[0];
    row.click();
    Array.from(row.querySelectorAll('td'))[0]?.click();
    return row.innerText.trim().substring(0, 60);
  });
  console.log(`  ✅ 已選分類號：${selected}`);
  await edmsPage.waitForTimeout(1000);

  // 點確定
  const okClicked = await targetFrame.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    const ok = els.find(el => /^確.?定$/.test((el.innerText || el.value || '').trim()));
    if (ok) { ok.click(); return true; }
    return false;
  });
  console.log(`  確定：${okClicked ? '✅' : '⚠️ 找不到'}`);
  return true;
}

// ──────────────────────────────────────────────
// 步驟 6：在 EDMS 編輯器中選第一層決行
// ──────────────────────────────────────────────
async function selectFirstDecisionLevel(edmsPage, ctx) {
  console.log('\n🔑 步驟6：選第一層決行...');

  // 先在所有 frame 找並點「決行層級」按鈕
  let clicked = false;
  for (const frame of edmsPage.frames()) {
    try {
      const txt = await frame.evaluate(() =>
        document.body ? document.body.innerText : ''
      ).catch(() => '');
      if (!txt.includes('決行層級')) continue;

      // 精確找「決行層級」互動元素
      const result = await frame.evaluate(() => {
        const els = Array.from(document.querySelectorAll('a, td, span, div, button, li'));
        const el = els.find(e => {
          const t = e.innerText.trim();
          return t === '決行層級' && (e.tagName === 'A' || e.getAttribute('onclick') ||
            e.style.cursor === 'pointer' || e.tagName === 'BUTTON');
        });
        if (el) { el.click(); return el.tagName; }

        // 備用：找含「決行層級」最短文字的可點元素
        const short = els.filter(e => e.innerText.trim().includes('決行層級') && e.innerText.trim().length < 8);
        if (short.length > 0) { short[0].click(); return short[0].tagName + '(short)'; }
        return null;
      });

      if (result) {
        console.log(`  ✅ 點擊決行層級 [${frame.name()}] ${result}`);
        clicked = true;
        break;
      }
    } catch {}
  }

  if (!clicked) {
    console.log('  ⚠️ 找不到決行層級互動按鈕');
  }

  // 等待 popup/dialog 出現
  await edmsPage.waitForTimeout(3000);

  // 掃描所有頁/frame 找第一層決行選項
  for (const p of ctx.pages()) {
    for (const frame of p.frames()) {
      try {
        const txt = await frame.evaluate(() =>
          document.body ? document.body.innerText : ''
        ).catch(() => '');

        if (!txt.includes('第一層') && !txt.includes('決行層')) continue;
        console.log(`  📋 決行選項在 page[${p.url().split('/').pop()}] frame[${frame.name()}]`);
        console.log('  內容：', txt.substring(0, 200));

        // 選「第一層決行」
        const done = await frame.evaluate(() => {
          const all = Array.from(document.querySelectorAll('*'));
          // 找含「第一層」的互動元素
          const el = all.find(e => {
            const t = (e.innerText || e.value || '').trim();
            return t.includes('第一層') && (
              e.tagName === 'OPTION' || e.tagName === 'LI' ||
              e.type === 'radio' || e.getAttribute('onclick') || e.tagName === 'A'
            );
          });
          if (el) {
            if (el.tagName === 'OPTION') {
              el.selected = true;
              el.closest('select')?.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              el.click();
            }
            return '✅ 點擊：' + el.tagName + ' "' + (el.innerText || el.value || '').substring(0, 30) + '"';
          }
          return null;
        });
        if (done) {
          console.log('  ' + done);
          await edmsPage.waitForTimeout(1000);

          // 點確定
          await frame.evaluate(() => {
            const els = Array.from(document.querySelectorAll('*'));
            const ok = els.find(el => /^確.?定$/.test((el.innerText || el.value || '').trim()));
            if (ok) ok.click();
          });
          return true;
        }

        // 傾印選項幫助診斷
        const opts = await frame.evaluate(() =>
          Array.from(document.querySelectorAll('option, li, tr, input[type="radio"], a'))
            .filter(el => el.innerText && (el.innerText.includes('層') || el.innerText.includes('決行')))
            .slice(0, 10)
            .map(el => ({ tag: el.tagName, text: el.innerText.trim().substring(0, 50) }))
        );
        console.log('  選項：', JSON.stringify(opts));
      } catch {}
    }
  }

  console.log('  ⚠️ 未找到第一層決行選項');
  return false;
}

// ──────────────────────────────────────────────
// 主程式
// ──────────────────────────────────────────────
async function run() {
  validate();
  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    // ══ 步驟 1：登入 ══
    console.log('\n═══════════════════════════════');
    console.log('🚀 步驟1：登入 PIN');
    console.log('═══════════════════════════════');
    await gdms.login(page);

    // 登入後才設全局 dialog 處理（避免干擾 login 頁面）
    const handleDialog = async d => {
      console.log(`  [dialog] ${d.type()}: ${d.message().substring(0, 60)}`);
      await d.accept().catch(() => {});
    };
    page.on('dialog', handleDialog);
    ctx.on('page', newPage => newPage.on('dialog', handleDialog));

    // ══ 步驟 2：代理人通知（登入後立即） ══
    console.log('\n═══════════════════════════════');
    console.log('👤 步驟2：代理人通知');
    console.log('═══════════════════════════════');
    await dismissProxyDialog(page, ctx);

    // ══ 步驟 3：前往 Home → 等主辦公文 ══
    console.log('\n═══════════════════════════════');
    console.log('🏠 步驟3：主辦公文清單');
    console.log('═══════════════════════════════');
    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    const mainFrame = await waitForMainFrame(page, ctx);

    // 找 ibtnSIGN（主辦公文的「簽」按鈕）
    const signBtns = await mainFrame.$$('input[id*="ibtnSIGN"]');
    console.log(`  ibtnSIGN：${signBtns.length} 個`);
    if (signBtns.length === 0) throw new Error('找不到主辦公文');

    // ══ 步驟 4：開啟第一筆公文 → EDMS ══
    console.log('\n═══════════════════════════════');
    console.log('📄 步驟4：開啟主辦公文 EDMS');
    console.log('═══════════════════════════════');
    const existingEdms = ctx.pages().find(
      p => p.url().includes('edmsedu') || p.url().includes('DocEditorHome')
    );
    if (existingEdms) {
      console.log('  已有 EDMS 頁面，重新點選...');
      await signBtns[0].click();
      await page.waitForTimeout(5000);
    } else {
      const [np] = await Promise.all([
        ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null),
        signBtns[0].click(),
      ]);
      if (np) {
        console.log(`  新頁面：${np.url()}`);
        await np.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
      }
      await page.waitForTimeout(5000);
    }

    await page.waitForTimeout(2000);
    const edmsPage = ctx.pages().find(
      p => p.url().includes('DocEditorHome') || p.url().includes('edmsedu')
    );
    if (!edmsPage) throw new Error('找不到 EDMS 頁面');
    await edmsPage.bringToFront();
    console.log(`✅ EDMS：${edmsPage.url()}`);

    // ══ 步驟 4+5（RadWindow）：選便簽模板 ══
    await selectBianQianAndFileNo(edmsPage, ctx);

    // ══ 步驟 5b：在編輯器選檔號（若 RadWindow 未顯示） ══
    console.log('\n═══════════════════════════════');
    console.log('📁 步驟5b：編輯器選檔號');
    console.log('═══════════════════════════════');
    await selectFileNumberInEditor(edmsPage, ctx);

    // ══ 步驟 6：決行層級 ══
    console.log('\n═══════════════════════════════');
    console.log('🔑 步驟6：第一層決行');
    console.log('═══════════════════════════════');
    await selectFirstDecisionLevel(edmsPage, ctx);

    console.log('\n\n✅✅✅ 全部設定完成！✅✅✅');
    console.log('（60 秒後關閉）');
    await wait(60000);

  } catch (err) {
    console.error('\n❌ 錯誤：', err.message);
    await wait(30000);
  } finally {
    await browser.close();
  }
}

run();
