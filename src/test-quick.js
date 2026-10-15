/**
 * 快速測試：確認框架狀態，直接點 ibtnSIGN
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { validate } = require('../config');
const browser = require('./browser');
const gdms = require('./gdms');

const HOME_URL = 'https://odisedu.taichung.gov.tw/HOME/Home_Splitter.aspx';
const SIGN_BTN_ID = 'ctl00_MainContent_DocShortCutButtonsControl1_RadButton_Secondary1';

async function run() {
  validate();
  let page = null;
  try {
    page = await browser.launch();
    const ctx = browser.getContext();

    await gdms.login(page);
    console.log('前往 Home...');
    await page.goto(HOME_URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(6000); // 多等

    const frames = page.frames();
    console.log('框架：');
    frames.forEach((f, i) => console.log(`  [${i}] name="${f.name()}" url="${f.url().split('/').pop().split('?')[0]}"`));

    const mainFrame = frames.find(f => f.name() === 'main');
    if (!mainFrame) throw new Error('找不到 main frame');
    console.log(`main frame URL：${mainFrame.url()}`);

    // 等 main frame 確認有公文清單
    const signBtns = await mainFrame.$$('input[id*="ibtnSIGN"]');
    console.log(`找到 ibtnSIGN：${signBtns.length} 個`);

    if (signBtns.length === 0) throw new Error('找不到 ibtnSIGN');

    console.log('\n點擊 ibtnSIGN...');

    // 先看是否已有 EDMS 頁面（不關閉，讓 GDMS 自行更新）
    const existingEdms = ctx.pages().find(p => p.url().includes('edmsedu') || p.url().includes('DocEditorHome'));
    if (existingEdms) {
      console.log(`已有 EDMS 頁面：${existingEdms.url()}`);
      // 點擊後等系統刷新
      await signBtns[0].click();
      await page.waitForTimeout(5000);
    } else {
      // 沒有 EDMS 頁面，等待新頁面開啟
      const [np] = await Promise.all([
        ctx.waitForEvent('page', { timeout: 20000 }),
        signBtns[0].click(),
      ]);
      await np.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(5000);
    }

    // 重新找 EDMS 頁面（不依賴事件，直接掃描所有頁面）
    await page.waitForTimeout(3000);
    console.log('目前所有頁面：');
    ctx.pages().forEach((p, i) => console.log(`  [${i}] ${p.url()}`));

    const edmsPage = ctx.pages().find(p => p.url().includes('DocEditorHome') || p.url().includes('edmsedu'));
    if (!edmsPage) throw new Error('找不到 EDMS 頁面');

    await edmsPage.bringToFront();
    console.log(`EDMS URL：${edmsPage.url()}`);

    if (edmsPage.url().includes('DocEditorHome') || edmsPage.url().includes('edmsedu')) {

      // 點「簽」按鈕
      // 先檢查是否有 RadWindow_Popup (點 ibtnSIGN 後可能已開啟)
      await edmsPage.waitForTimeout(3000);
      const radWindowIframe = await edmsPage.$('iframe[name="RadWindow_Popup"]');
      if (radWindowIframe) {
        console.log('\n✅ RadWindow_Popup 已存在！讀取 iframe...');
        const radWindowSrc = await radWindowIframe.getAttribute('src');
        console.log(`iframe src：${radWindowSrc}`);

        const radFrame = edmsPage.frames().find(f => f.name() === 'RadWindow_Popup');
        if (radFrame) {
          const radInfo = await radFrame.evaluate(() => ({
            bodyText: document.body.innerText.substring(0, 3000),
            innerHTML: document.body.innerHTML.substring(0, 8000),
            textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({ id: el.id, name: el.name, value: el.value })),
            editables: Array.from(document.querySelectorAll('[contenteditable="true"]')).map(el => ({ id: el.id, text: el.innerText.substring(0, 100) })),
            buttons: Array.from(document.querySelectorAll('button,input[type="submit"],input[type="button"]')).filter(el => el.value||el.innerText).map(el => ({ type: el.type, id: el.id, value: el.value, text: el.innerText?.trim() })),
          }));
          console.log('\n[RadWindow 文字]', radInfo.bodyText.substring(0, 2000));
          console.log('\n[Textarea]', JSON.stringify(radInfo.textareas, null, 2));
          console.log('\n[Contenteditable]', JSON.stringify(radInfo.editables, null, 2));
          console.log('\n[按鈕]', JSON.stringify(radInfo.buttons, null, 2));
          console.log('\n[HTML (前5000)]', radInfo.innerHTML.substring(0, 5000));
        }
        // 找 RadWindow frame（第二次）
        const radFrame2 = edmsPage.frames().find(f => f.name() === 'RadWindow_Popup');
        if (radFrame2) {
          // 點「共用範本」tab
          const sharedTab = await radFrame2.$('text=共用範本');
          if (sharedTab) {
            console.log('點「共用範本」tab...');
            await sharedTab.click();
            await edmsPage.waitForTimeout(2000);
          }

          // 找便簽行的點擊按鈕（「新檔」欄位的 input[type=image] 或第一個 image input）
          const bianQianRowBtn = await radFrame2.evaluate(() => {
            // 找包含「便簽」的 tr，取其第一個可點擊 input
            const rows = Array.from(document.querySelectorAll('tr'));
            for (const row of rows) {
              if (row.innerText.includes('便簽') && row.innerText.includes('簡便用簽')) {
                const imgs = row.querySelectorAll('input[type="image"], img[onclick], a, button');
                const allTds = Array.from(row.querySelectorAll('td')).map(td => td.innerHTML.substring(0, 100));
                return { found: true, tds: allTds, imgCount: imgs.length };
              }
            }
            return { found: false };
          });
          console.log('便簽行資訊：', JSON.stringify(bianQianRowBtn, null, 2));

          // 點便簽行的新檔按鈕（第2個 td 通常是新檔欄）
          const bianQianNewBtn = await radFrame2.$('tr:has-text("便簽") input[type="image"], tr:has-text("簡便用簽") input[type="image"]');
          if (bianQianNewBtn) {
            console.log('✅ 找到便簽新檔按鈕，點擊...');
            const [localPage] = await Promise.all([
              ctx.waitForEvent('page', { timeout: 60000 }).catch(() => null),
              bianQianNewBtn.click(),
            ]);
            if (localPage) {
              console.log(`✅ localhost popup：${localPage.url()}`);
              await localPage.waitForLoadState('load');
              await localPage.waitForTimeout(3000);

              const popInfo = await localPage.evaluate(() => ({
                bodyText: document.body.innerText.substring(0, 3000),
                innerHTML: document.body.innerHTML.substring(0, 8000),
                textareas: Array.from(document.querySelectorAll('textarea')).map(el => ({ id: el.id, name: el.name, placeholder: el.placeholder, value: el.value.substring(0, 200) })),
                editables: Array.from(document.querySelectorAll('[contenteditable="true"]')).map(el => ({ id: el.id, text: el.innerText.substring(0, 100) })),
                buttons: Array.from(document.querySelectorAll('button,input[type="submit"]')).map(el => ({ id: el.id, value: el.value||'', text: (el.innerText||'').trim() })).filter(b => b.value||b.text),
              }));

              console.log('\n[localhost popup 文字]', popInfo.bodyText);
              console.log('\n[Textarea]', JSON.stringify(popInfo.textareas, null, 2));
              console.log('\n[Contenteditable]', JSON.stringify(popInfo.editables, null, 2));
              console.log('\n[按鈕]', JSON.stringify(popInfo.buttons, null, 2));
              console.log('\n[HTML]', popInfo.innerHTML);
            } else {
              console.log('⚠️  localhost popup 未出現');
            }
          } else {
            // 備用：直接點列選中，再按確定
            const bianQianRow = await radFrame2.$('tr:has-text("簡便用簽")');
            if (bianQianRow) {
              console.log('點擊便簽行...');
              await bianQianRow.click();
              await edmsPage.waitForTimeout(1000);
            }
          }

          // 點「確定」
          const okBtn = await radFrame2.$('#RadButtonOK');
          if (okBtn) {
            console.log('\n點「確定」...');
            const [localPage2] = await Promise.all([
              ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null),
              okBtn.click(),
            ]);
            if (localPage2) {
              console.log(`localhost popup：${localPage2.url()}`);
              await localPage2.waitForLoadState('load');
              await localPage2.waitForTimeout(3000);
              const p2Info = await localPage2.evaluate(() => document.body.innerText.substring(0, 2000));
              console.log('Popup 文字：', p2Info);
            }
            await edmsPage.waitForTimeout(5000);

            // 讀取 DocEditorHome 的 contenteditable
            const editables = await edmsPage.evaluate(() =>
              Array.from(document.querySelectorAll('[contenteditable="true"]')).map(el => ({
                id: el.id, visible: el.offsetParent !== null,
                text: el.innerText.trim().substring(0, 100),
              }))
            );
            console.log('\nContenteditable 欄位（確定後）：');
            editables.forEach(e => console.log(`  id="${e.id}" visible=${e.visible} text="${e.text}"`));

            // 填入擬辦
            const target = editables.find(e => e.visible && (e.id === '擬辦' || e.id === '說明' || e.id === '不分段有項次'));
            if (target) {
              const content = '謹查本文，已悉，請 校長 核示。';
              console.log(`\n✏️  填入 #${target.id}：「${content}」`);
              await edmsPage.evaluate((id, text) => {
                const el = document.getElementById(id);
                if (el) { el.focus(); el.innerText = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
              }, target.id, content);
              await edmsPage.waitForTimeout(500);

              // 確認填入
              const check = await edmsPage.evaluate(id => (document.getElementById(id)||{}).innerText, target.id);
              console.log(`填入確認：「${check}」`);

              // 儲存
              const saveBtn = await edmsPage.$('span[title="儲存"]');
              if (saveBtn && await saveBtn.isVisible()) {
                console.log('點「儲存」...');
                await saveBtn.click();
                await edmsPage.waitForTimeout(3000);
                console.log('✅ 儲存成功！');

                // 掃描所有可見的送出按鈕
                const sendBtns = await edmsPage.evaluate(() =>
                  Array.from(document.querySelectorAll('[title],[innerText]')).filter(el => {
                    const t = (el.innerText||el.getAttribute('title')||'').trim();
                    return ['送出','陳核','承辦','決行','簽核送'].some(k => t.includes(k)) && el.offsetParent !== null;
                  }).map(el => ({ tag: el.tagName, id: el.id, text: (el.innerText||'').trim().substring(0,30), title: el.getAttribute('title')||'' }))
                );
                console.log('\n送出按鈕：', JSON.stringify(sendBtns, null, 2));
              }
            }
          }
        }

        console.log('\n✅ 完成！60秒後關閉...');
        await new Promise(r => setTimeout(r, 60000));
        return;
      }

      const signBtnEl = await edmsPage.$(`#${SIGN_BTN_ID}`);
      console.log(`「簽」按鈕：${signBtnEl ? '✅ 找到' : '❌ 找不到'}`);

      if (signBtnEl && await signBtnEl.isVisible()) {
        console.log('點擊「簽」...');
        await signBtnEl.click();
        await edmsPage.waitForTimeout(5000);

        // 讀取 contenteditable
        const editables = await edmsPage.evaluate(() =>
          Array.from(document.querySelectorAll('[contenteditable="true"]')).map(el => ({
            id: el.id, visible: el.offsetParent !== null, text: el.innerText.trim().substring(0, 50),
          }))
        );
        console.log('Contenteditable 欄位：', JSON.stringify(editables, null, 2));

        // 填入擬辦
        const yiban = editables.find(e => e.id === '擬辦' && e.visible);
        const target = yiban || editables.find(e => e.visible);
        if (target) {
          console.log(`\n填入欄位 #${target.id}...`);
          await edmsPage.evaluate((id) => {
            const el = document.getElementById(id);
            if (el) { el.focus(); el.innerText = '謹查本文，已悉，請 校長 核示。'; el.dispatchEvent(new Event('input', { bubbles: true })); }
          }, target.id);
          await edmsPage.waitForTimeout(1000);
          const check = await edmsPage.evaluate(id => document.getElementById(id)?.innerText, target.id);
          console.log(`填入結果：「${check}」`);

          // 儲存
          const saveBtn = await edmsPage.$('span[title="儲存"]');
          if (saveBtn) {
            console.log('點儲存...');
            await saveBtn.click();
            await edmsPage.waitForTimeout(3000);
            console.log('✅ 儲存完成');
          }

          // 掃描送出按鈕
          const sendInfo = await edmsPage.evaluate(() => {
            const keywords = ['送出', '陳核', '承辦', '決行', '簽核'];
            return Array.from(document.querySelectorAll('button, a, span[onclick], div[onclick], [title]'))
              .filter(el => keywords.some(k => (el.innerText||el.getAttribute('title')||'').includes(k)))
              .map(el => ({
                tag: el.tagName, id: el.id, text: (el.innerText||'').trim().substring(0, 30),
                title: el.getAttribute('title') || '', onclick: (el.getAttribute('onclick')||'').substring(0, 60),
                visible: el.offsetParent !== null,
              })).filter(el => el.visible);
          });
          console.log('\n可見的送出相關按鈕：');
          sendInfo.forEach(b => console.log(`  ${b.tag} id="${b.id}" text="${b.text}" title="${b.title}"`));
        }
      }
    }

    console.log('\n✅ 完成！60秒後關閉...');
    await new Promise(r => setTimeout(r, 60000));
  } catch (err) {
    console.error('\n❌', err.message);
  } finally {
    await browser.close();
  }
}
run();
