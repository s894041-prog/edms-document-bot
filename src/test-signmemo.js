/**
 * 開啟 GdocDetailWinOpen popup，點擊批核紀錄 tab，讀取 SignMemo 內容
 * 執行方式：node src/test-signmemo.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';
const BASE = 'https://odisedu.taichung.gov.tw/USER/';

async function run() {
  validate();
  console.log('🧪 SignMemo + Frameset 深入掃描...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);

    const frame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;

    // 點 GDOCSIGN_1.gif 開啟詳細視窗
    const signIcon = await frame.$('img[src*="GDOCSIGN_1"]');
    if (!signIcon) throw new Error('找不到 GDOCSIGN_1.gif');

    const [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 10000 }),
      signIcon.click(),
    ]);

    await popup.waitForLoadState('load');
    await popup.waitForTimeout(3000);

    const popupUrl = popup.url();
    console.log(`📍 Popup URL：${popupUrl}`);

    // 取得 GDOC_PK 和 GOV_FK
    const gdocPk = popupUrl.match(/GDOC_PK=([^&]+)/)?.[1] || '';
    const govFk = popupUrl.match(/GOV_FK=([^&]+)/)?.[1] || '';
    console.log(`GDOC_PK=${decodeURIComponent(gdocPk)}`);
    console.log(`GOV_FK=${decodeURIComponent(govFk)}`);

    // 取得 frameset HTML
    const framesetHtml = await popup.evaluate(() => document.documentElement.innerHTML.substring(0, 3000));
    console.log('\n[Frameset HTML]');
    console.log(framesetHtml);

    const popupFrames = popup.frames();
    console.log(`\n框架列表：`);
    popupFrames.forEach((f, i) => console.log(`  [${i}] ${f.url()}`));

    // 找 TOPMENU frame 並點擊批核紀錄 tab
    const topMenuFrame = popupFrames.find(f => f.url().includes('USER_SHOW_TOPMENU'));
    if (topMenuFrame) {
      console.log('\n🖱️  點擊「批核紀錄」tab...');

      // 找 SignMemo td
      const signMemoTd = await topMenuFrame.$('td[url*="USER_SHOW_SignMemo"]');
      if (signMemoTd) {
        await signMemoTd.click();
        await popup.waitForTimeout(3000);

        // 重新取得框架列表
        const updatedFrames = popup.frames();
        console.log('\n更新後框架列表：');
        updatedFrames.forEach((f, i) => console.log(`  [${i}] ${f.url()}`));

        const signMemoFrame = updatedFrames.find(f => f.url().includes('USER_SHOW_SignMemo'));
        if (signMemoFrame) {
          console.log('\n✅ 找到 SignMemo 框架！');
          const info = await signMemoFrame.evaluate(() => ({
            bodyText: document.body.innerText,
            innerHTML: document.body.innerHTML,
            textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
              id: el.id, name: el.name, placeholder: el.placeholder, value: el.value,
            })),
            allInputs: Array.from(document.querySelectorAll('input')).map(el => ({
              type: el.type, id: el.id, name: el.name, value: el.value.substring(0, 100),
              onclick: el.getAttribute('onclick') || '',
            })),
            buttons: Array.from(document.querySelectorAll('button')).map(el => ({
              text: el.innerText, id: el.id,
            })),
            links: Array.from(document.querySelectorAll('a')).map(a => ({
              text: a.innerText.trim(), href: a.href, onclick: a.getAttribute('onclick') || '',
            })).filter(a => a.text || a.href),
          }));

          console.log('\n[頁面文字]');
          console.log(info.bodyText.substring(0, 3000));
          console.log('\n[Textarea]');
          console.log(JSON.stringify(info.textareas, null, 2));
          console.log('\n[Non-hidden Inputs]');
          info.allInputs.filter(i => i.type !== 'hidden').forEach(i =>
            console.log(`  type=${i.type} id=${i.id} name=${i.name} value="${i.value}" onclick="${i.onclick.substring(0, 80)}"`)
          );
          console.log('\n[Buttons]');
          console.log(JSON.stringify(info.buttons, null, 2));
          console.log('\n[Links]');
          info.links.forEach(a => console.log(`  "${a.text}" href="${a.href}" onclick="${a.onclick.substring(0, 80)}"`));
          console.log('\n[完整 HTML]');
          console.log(info.innerHTML.substring(0, 10000));
        } else {
          console.log('\n⚠️  SignMemo 框架未出現，嘗試直接導航...');
        }
      }
    }

    // 直接在新頁面導航到 SignMemo URL
    const signMemoUrl = `${BASE}USER_SHOW_SignMemo.aspx?GDOC_PK=${gdocPk}&GOV_FK=${govFk}&TableTitle=%E6%89%B9%E6%A0%B8%E7%B4%80%E9%8C%84`;
    console.log(`\n直接導航到：${signMemoUrl}`);

    const directPage = await ctx.newPage();
    await directPage.goto(signMemoUrl, { waitUntil: 'load', timeout: 30000 });
    await directPage.waitForTimeout(2000);

    const directInfo = await directPage.evaluate(() => ({
      url: location.href,
      bodyText: document.body.innerText,
      innerHTML: document.body.innerHTML,
      textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({
        id: el.id, name: el.name, placeholder: el.placeholder, value: el.value,
      })),
      allInputs: Array.from(document.querySelectorAll('input')).map(el => ({
        type: el.type, id: el.id, name: el.name, value: el.value.substring(0, 100),
      })),
    }));

    console.log('\n[直接訪問 SignMemo]');
    console.log(`URL: ${directInfo.url}`);
    console.log(`文字: ${directInfo.bodyText.substring(0, 2000)}`);
    console.log(`Textarea: ${JSON.stringify(directInfo.textareas, null, 2)}`);
    console.log(`Inputs: ${JSON.stringify(directInfo.allInputs.filter(i => i.type !== 'hidden'), null, 2)}`);
    console.log('\n[HTML]');
    console.log(directInfo.innerHTML.substring(0, 8000));

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
