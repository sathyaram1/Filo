import { test, expect } from './fixtures/electron.mjs';

const HUGE = 'Sentence number X of a very long single block. '.repeat(230);

const mk = (body) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">${body}</body></html>`;

async function probe(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  await page.waitForTimeout(1500);
  return page.evaluate(() => ({
    menus: document.querySelectorAll('.sn-menu, [class*="sn-menu"]').length,
    icons: document.querySelectorAll('[data-sn-icon-id]').length,
    err: window.__snErr || null,
  }));
}

test('probe: menu su pagina con blocco enorme', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mk(`<div id="huge">${HUGE}</div><div id="emoji">Breaking news tonight</div>`));
  await page.evaluate(() => { window.__snErr = null; window.addEventListener('error', (e) => { window.__snErr = String(e.message); }); });
  console.log('HUGE+emoji su #emoji:', JSON.stringify(await probe(page, '#emoji')));
});

test('probe: menu su pagina con emoji/zw/rtl', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <div id="emoji">Breaking 🚨 news 👩‍👩‍👧‍👦 from the stadium 🏟️ tonight</div>
  <div id="zw">Invisible​​characters﻿inside this line of text</div>
  <div id="rtl">مرحبا بالعالم من هذه الصفحة</div>
  <div id="spaces">     </div>
  <div id="entity">Text with &lt;script&gt;alert(1)&lt;/script&gt; written as characters</div>
</body></html>`);
  await page.evaluate(() => { window.__snErr = null; window.addEventListener('error', (e) => { window.__snErr = String(e.message); }); });
  console.log('extremes senza huge su #emoji:', JSON.stringify(await probe(page, '#emoji')));
});

test('probe: menu su pagina solo huge', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mk(`<div id="huge">${HUGE}</div>`));
  await page.evaluate(() => { window.__snErr = null; window.addEventListener('error', (e) => { window.__snErr = String(e.message); }); });
  console.log('solo huge su #huge:', JSON.stringify(await probe(page, '#huge')));
});
