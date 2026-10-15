/**
 * 掃描 USER_SHOW_TOPMENU.aspx 完整內容
 * 執行方式：node src/test-topmenu.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

async function run() {
  validate();
  console.log('🧪 掃描 TOPMENU 框架...\n');

  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);

    const frame = page.frames().find(f => f.url().includes('USER_LIST_WORK.aspx')) || page;
    const signIcon = await frame.$('img[src*="GDOCSIGN_1"]');
    if (!signIcon) throw new Error('找不到 GDOCSIGN_1.gif 圖示');

    console.log('🖱️  點擊圖示開啟彈出視窗...');
    const [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 10000 }),
      signIcon.click(),
    ]);

    await popup.waitForLoadState('load');
    await popup.waitForTimeout(3000);

    const popupFrames = popup.frames();
    console.log(`\n框架列表：`);
    popupFrames.forEach((f, i) => console.log(`  [${i}] ${f.url()}`));

    // 取得每個框架的完整 HTML
    for (const f of popupFrames) {
      const url = f.url();
      if (!url || url === 'about:blank') continue;

      const shortUrl = url.split('/').pop().split('?')[0];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`框架：${shortUrl}`);
      console.log('='.repeat(60));

      try {
        const info = await f.evaluate(() => {
          return {
            bodyText: document.body.innerText,
            innerHTML: document.body.innerHTML,
            allButtons: Array.from(document.querySelectorAll('input,button,a,img')).map(el => ({
              tag: el.tagName,
              type: el.type || '',
              id: el.id || '',
              name: el.name || '',
              value: el.value || '',
              text: el.innerText || el.title || el.alt || '',
              src: el.src || '',
              href: el.href || '',
              onclick: el.getAttribute('onclick') || '',
            })).filter(el => el.value || el.text || el.src || el.href),
            forms: Array.from(document.querySelectorAll('form')).map(f => ({
              id: f.id,
              action: f.action,
              method: f.method,
              inputs: Array.from(f.querySelectorAll('input,textarea,select')).map(el => ({
                tag: el.tagName,
                type: el.type || '',
                id: el.id || '',
                name: el.name || '',
                value: el.value || '',
              })),
            })),
          };
        });

        console.log(`\n[頁面文字]`);
        console.log(info.bodyText || '(空白)');

        console.log(`\n[所有可互動元素]`);
        info.allButtons.forEach(el => {
          console.log(`  ${el.tag} type=${el.type} id=${el.id} name=${el.name} value="${el.value}" text="${el.text.trim().substring(0, 50)}" onclick="${el.onclick.substring(0, 100)}"`);
        });

        console.log(`\n[表單]`);
        info.forms.forEach(form => {
          console.log(`  Form id=${form.id} action=${form.action}`);
          form.inputs.forEach(inp => console.log(`    ${inp.tag} type=${inp.type} id=${inp.id} name=${inp.name} value="${inp.value}"`));
        });

        // 如果是 TOPMENU，也印出 innerHTML
        if (shortUrl.includes('TOPMENU')) {
          console.log(`\n[完整 HTML]`);
          console.log(info.innerHTML.substring(0, 5000));
        }
      } catch (e) {
        console.log(`讀取失敗：${e.message}`);
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
