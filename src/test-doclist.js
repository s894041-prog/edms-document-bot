/**
 * 公文清單測試腳本
 * 登入後進入 USER_LIST_WORK.aspx，印出公文清單結構
 * 執行方式：node src/test-doclist.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const WORK_URL = 'https://odisedu.taichung.gov.tw/USER/USER_LIST_WORK.aspx';

async function run() {
  validate();
  console.log('🧪 公文清單測試...\n');

  let page = null;
  try {
    page = await browser.launch();
    await gdms.login(page);
    console.log('✅ 登入成功\n');

    // 直接導向公文清單頁
    console.log('📋 前往公文清單...');
    await page.goto(WORK_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log(`目前 URL：${page.url()}\n`);

    // 檢查是否有 iframe
    const frames = page.frames();
    console.log(`框架數量：${frames.length}`);
    frames.forEach((f, i) => console.log(`  [${i}] ${f.url()}`));

    // 找有內容的框架
    let targetFrame = page;
    for (const frame of frames) {
      const url = frame.url();
      if (url.includes('LIST') || url.includes('WORK') || url.includes('USER')) {
        targetFrame = frame;
        console.log(`\n✅ 使用框架：${url}`);
        break;
      }
    }

    await targetFrame.waitForTimeout(1000);

    // 印出表格結構
    const tableData = await targetFrame.evaluate(() => {
      const result = {
        title: document.title,
        tables: [],
        allText: document.body.innerText.substring(0, 2000),
      };

      // 抓所有表格
      document.querySelectorAll('table').forEach((table, ti) => {
        const rows = [];
        table.querySelectorAll('tr').forEach((row, ri) => {
          const cells = Array.from(row.querySelectorAll('td, th'))
            .map(cell => cell.innerText.trim().substring(0, 50));
          if (cells.some(c => c)) rows.push(cells);
        });
        if (rows.length > 0) {
          result.tables.push({ tableIndex: ti, rows: rows.slice(0, 10) });
        }
      });

      // 抓所有連結
      result.links = Array.from(document.querySelectorAll('a'))
        .filter(a => a.innerText.trim())
        .map(a => ({
          text: a.innerText.trim().substring(0, 50),
          href: a.href.substring(0, 100),
          onclick: (a.getAttribute('onclick') || '').substring(0, 80),
        }))
        .slice(0, 30);

      return result;
    });

    console.log('\n📄 頁面標題：', tableData.title);

    console.log('\n📊 表格內容：');
    tableData.tables.forEach(t => {
      console.log(`\n  表格 ${t.tableIndex}：`);
      t.rows.forEach(row => console.log('  ', row));
    });

    console.log('\n🔗 連結清單：');
    tableData.links.forEach((l, i) =>
      console.log(`  ${i + 1}. [${l.text}]\n       href: ${l.href}\n       onclick: ${l.onclick}`)
    );

    console.log('\n📝 頁面文字（前 2000 字）：');
    console.log(tableData.allText);

    console.log('\n✅ 完成！請截圖給 Claude。瀏覽器 30 秒後關閉...');
    await new Promise(r => setTimeout(r, 30000));

  } catch (err) {
    console.error('\n❌ 失敗：', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}

run();
