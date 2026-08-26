import { test, expect } from './fixtures/electron.mjs';

const HUGE = 'Sentence number X of a very long single block. '.repeat(230);

const mk = (body) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">${body}</body></html>`;

async function probe(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  await page.waitForTimeout(1500);
  return page.evaluate(() => ({
    menus: document.querySelectorAll('.sn-menu, [class*="sn-menu"]').length,
    icons: document.querySelectorAll('[data-sn-icon-id]').length,
    scrollY: Math.round(window.scrollY),
  }));
}

test('probe A: click su #huge (in cima, nessuno scroll)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mk(`<div id="huge">${HUGE}</div><div id="emoji">Breaking news tonight</div>`));
  console.log('A:', JSON.stringify(await probe(page, '#huge')));
});

test('probe B: spaziatore alto + testo sotto, click sul testo sotto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mk('<div style="height:3000px;background:#eee"></div><div id="low">Some English text far below the fold here</div>'));
  console.log('B:', JSON.stringify(await probe(page, '#low')));
});

test('probe C: come B ma scroll esplicito prima del click', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mk('<div style="height:3000px;background:#eee"></div><div id="low">Some English text far below the fold here</div>'));
  await page.evaluate(() => document.querySelector('#low').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  console.log('C:', JSON.stringify(await probe(page, '#low')));
});

test('probe D: pagina corta, click su un div normale', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mk('<div id="low">Some English text right at the top of the page</div>'));
  console.log('D:', JSON.stringify(await probe(page, '#low')));
});
