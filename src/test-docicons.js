/**
 * 掃描公文清單第一筆的所有圖示與連結
 * 並檢查 USER_SHOW_SignMemo.aspx 內容
 * 執行方式：node src/test-docicons.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

async function run() {
  validate();
  console.log('🧪 掃描公文清單圖示 + SignMemo 框架...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);

    const frame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;

    // 掃描第一筆公文行的所有元素
    const firstRowInfo = await frame.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr'));
      // 找第一個有公文號的行
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
        if (cells.length >= 13 && cells[6] && /^\d+$/.test(cells[6])) {
          return {
            docNo: cells[6],
            rowHTML: row.innerHTML,
            imgs: Array.from(row.querySelectorAll('img')).map(img => ({
              src: img.src,
              alt: img.alt,
              title: img.title,
              onclick: img.getAttribute('onclick') || '',
              parentOnclick: img.parentElement?.getAttribute('onclick') || '',
              parentHref: img.parentElement?.href || '',
              parentTag: img.parentElement?.tagName || '',
            })),
            links: Array.from(row.querySelectorAll('a')).map(a => ({
              href: a.href,
              text: a.innerText.trim(),
              onclick: a.getAttribute('onclick') || '',
              title: a.title || '',
            })),
          };
        }
      }
      return null;
    });

    if (!firstRowInfo) throw new Error('找不到公文行');

    console.log(`📄 第一筆公文號：${firstRowInfo.docNo}`);
    console.log(`\n[圖示列表]`);
    firstRowInfo.imgs.forEach((img, i) => {
      const srcName = img.src.split('/').pop();
      console.log(`  [${i}] src=${srcName} alt="${img.alt}" title="${img.title}"`);
      console.log(`       onclick="${img.onclick}" parentOnclick="${img.parentOnclick}" parentTag=${img.parentTag}`);
    });

    console.log(`\n[連結列表]`);
    firstRowInfo.links.forEach((a, i) => {
      console.log(`  [${i}] href="${a.href.substring(0, 100)}" text="${a.text}" onclick="${a.onclick}"`);
    });

    console.log(`\n[第一行 HTML]`);
    console.log(firstRowInfo.rowHTML.substring(0, 3000));

    // 現在開啟彈出視窗並切換到 SignMemo tab
    const signIcon = await frame.$('img[src*="GDOCSIGN_1"]');
    if (!signIcon) throw new Error('找不到 GDOCSIGN_1.gif');

    console.log('\n\n🖱️  開啟彈出視窗...');
    const [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 10000 }),
      signIcon.click(),
    ]);

    await popup.waitForLoadState('load');
    await popup.waitForTimeout(3000);

    // 找到 GDOCDetailMain frame (框架[2])
    const popupFrames = popup.frames();
    console.log('\n框架列表：');
    popupFrames.forEach((f, i) => console.log(`  [${i}] ${f.url()}`));

    // 取得 GDOC_PK 和 GOV_FK 從彈出視窗 URL
    const popupUrl = popup.url();
    const gdocPk = popupUrl.match(/GDOC_PK=([^&]+)/)?.[1] || '';
    const govFk = popupUrl.match(/GOV_FK=([^&]+)/)?.[1] || '';
    console.log(`\nGDOC_PK=${gdocPk}`);
    console.log(`GOV_FK=${govFk}`);

    // 直接導航到 SignMemo tab
    const mainFrame = popupFrames.find(f => f.url().includes('USER_SHOW_GDOC.aspx'));
    if (mainFrame) {
      const signMemoUrl = `https://odisedu.taichung.gov.tw/USER/USER_SHOW_SignMemo.aspx?GDOC_PK=${gdocPk}&GOV_FK=${govFk}&TableTitle=%E6%89%B9%E6%A0%B8%E7%B4%80%E9%8C%84`;
      console.log(`\n導航到 SignMemo：${signMemoUrl}`);
      await mainFrame.goto(signMemoUrl, { waitUntil: 'load', timeout: 15000 });
      await popup.waitForTimeout(2000);

      const signMemoInfo = await mainFrame.evaluate(() => ({
        bodyText: document.body.innerText,
        innerHTML: document.body.innerHTML.substring(0, 5000),
        textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
          id: el.id, name: el.name, placeholder: el.placeholder, value: el.value,
        })),
        buttons: Array.from(document.querySelectorAll('input,button')).map(el => ({
          type: el.type, id: el.id, name: el.name, value: el.value,
        })).filter(b => b.value || b.type !== 'hidden'),
      }));

      console.log(`\n[SignMemo 頁面文字]`);
      console.log(signMemoInfo.bodyText.substring(0, 3000));
      console.log(`\n[SignMemo Textarea]`);
      console.log(JSON.stringify(signMemoInfo.textareas, null, 2));
      console.log(`\n[SignMemo 按鈕]`);
      console.log(JSON.stringify(signMemoInfo.buttons, null, 2));
      console.log(`\n[SignMemo HTML]`);
      console.log(signMemoInfo.innerHTML);
    }

    // 嘗試點擊 TOPMENU 的 SignMemo td
    const topMenuFrame = popupFrames.find(f => f.url().includes('USER_SHOW_TOPMENU.aspx'));
    if (topMenuFrame) {
      console.log('\n\n嘗試點擊 TOPMENU 的批核紀錄 tab...');
      const tds = await topMenuFrame.$$('td[onclick]');
      console.log(`找到 ${tds.length} 個可點擊 td`);
      for (const td of tds) {
        const url = await td.getAttribute('url');
        const onclick = await td.getAttribute('onclick');
        console.log(`  url="${url}" onclick="${onclick}"`);
      }
    }

    console.log('\n\n✅ 完成！30 秒後關閉...');
    await new Promise(r => setTimeout(r, 30000));

  } catch (err) {
    console.error('\n❌ 失敗：', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}

run();
