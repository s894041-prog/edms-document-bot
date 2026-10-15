/**
 * 登入測試腳本 v2 - 支援 iframe 框架結構
 * 執行方式：node src/test-login.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

async function run() {
  validate();
  console.log('🧪 開始登入測試...\n');

  let page = null;
  try {
    page = await browser.launch();

    await gdms.login(page);
    console.log('\n✅ 登入成功！\n');

    // 等頁面穩定
    await page.waitForTimeout(2000);

    // 列出所有 iframe
    const frames = page.frames();
    console.log(`🖼️  共有 ${frames.length} 個框架：`);
    frames.forEach((f, i) => console.log(`  [${i}] ${f.url()}`));

    // 在每個框架裡找連結和選單
    console.log('\n🔍 掃描各框架內的連結...');
    for (const frame of frames) {
      const url = frame.url();
      if (!url || url === 'about:blank') continue;

      try {
        const links = await frame.$$eval('a', els =>
          els
            .filter(el => el.innerText.trim().length > 0)
            .map(el => ({
              text: el.innerText.trim().substring(0, 40),
              href: el.href,
              onclick: el.getAttribute('onclick') || ''
            }))
            .filter(l => l.text)
            .slice(0, 40)
        );

        if (links.length > 0) {
          console.log(`\n  📄 框架 [${url.split('/').pop()}] 的連結：`);
          links.forEach((l, i) =>
            console.log(`    ${i + 1}. [${l.text}]  href=${l.href.substring(0, 60)}`)
          );
        }

        // 找選單文字（td/span/div 含有關鍵字）
        const menuItems = await frame.$$eval('td, span, div, li', els =>
          els
            .map(el => el.innerText.trim())
            .filter(t => t.length > 1 && t.length < 20)
            .filter(t =>
              t.includes('主辦') || t.includes('決行') || t.includes('公文') ||
              t.includes('待辦') || t.includes('收文') || t.includes('發文') ||
              t.includes('簽核') || t.includes('陳核') || t.includes('批示')
            )
        );

        if (menuItems.length > 0) {
          console.log(`\n  🗂️  框架 [${url.split('/').pop()}] 找到關鍵字：`);
          [...new Set(menuItems)].forEach(t => console.log(`    → "${t}"`));
        }

      } catch (e) {
        // 跨域 frame 無法讀取，略過
      }
    }

    console.log('\n✅ 掃描完成！請截圖給 Claude 分析選單結構。');
    console.log('   瀏覽器將在 20 秒後關閉...');
    await new Promise(r => setTimeout(r, 20000));

  } catch (err) {
    console.error('\n❌ 測試失敗：', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}

run();
