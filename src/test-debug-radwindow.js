/**
 * Debug：看 RadWindow_Popup 的實際內容
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');
const { openEdms } = require('./workflow-edms');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';

async function run() {
  validate();
  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(6000);

    console.log('開啟 EDMS...');
    const edmsPage = await openEdms(page, ctx, 0);
    console.log(`EDMS：${edmsPage.url()}`);

    // 等 RadWindow 出現
    await edmsPage.waitForTimeout(3000);
    const iframe = await edmsPage.$('iframe[name="RadWindow_Popup"]');
    console.log(`RadWindow_Popup iframe：${iframe ? '✅ 找到' : '❌ 沒有'}`);

    if (iframe) {
      const src = await iframe.getAttribute('src');
      console.log(`iframe src：${src}`);
    }

    // 列出所有 frames
    console.log('\n所有 frames：');
    edmsPage.frames().forEach((f, i) => {
      console.log(`  [${i}] name="${f.name()}" url="${f.url()}"`);
    });

    // 找 RadWindow_Popup frame
    const radFrame = edmsPage.frames().find(f => f.name() === 'RadWindow_Popup');
    if (!radFrame) {
      console.log('\n❌ 找不到 RadWindow_Popup frame');
    } else {
      console.log('\n✅ 找到 RadWindow_Popup frame');
      // 等 frame 內容載入
      await radFrame.waitForLoadState('domcontentloaded').catch(() => {});
      await edmsPage.waitForTimeout(2000);

      const info = await radFrame.evaluate(() => ({
        url: window.location.href,
        bodyText: document.body.innerText.substring(0, 3000),
        tabTexts: Array.from(document.querySelectorAll('a,li,span,div')).filter(el =>
          el.innerText?.includes('共用') || el.innerText?.includes('範本') || el.innerText?.includes('便簽')
        ).map(el => ({ tag: el.tagName, id: el.id, class: el.className.substring(0,30), text: el.innerText?.trim().substring(0,50) })).slice(0, 20),
      }));

      console.log(`\nframe URL：${info.url}`);
      console.log(`\n[bodyText 前 2000]：\n${info.bodyText}`);
      console.log('\n[含"共用/範本/便簽"的元素]：', JSON.stringify(info.tabTexts, null, 2));
    }

    console.log('\n30 秒後關閉...');
    await new Promise(r => setTimeout(r, 30000));
  } catch (err) {
    console.error('\n❌', err.message);
  } finally {
    await browser.close();
  }
}
run();
