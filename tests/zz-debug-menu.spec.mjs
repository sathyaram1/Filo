// TEMPORANEO — diagnostica dell'apertura menu sulla pagina "testo estremo".
import { test, expect } from './fixtures/electron.mjs';

const LONG = 'The quick brown fox jumps over the lazy dog. '.repeat(240);
const mk = (long) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:16px"><div id="content">
  <div id="long">${long}</div>
  <div id="emoji">Weather today looks fine, said the crew</div>
</div></body></html>`;

async function probe(page, how) {
  if (how === 'scrollFirst') {
    await page.locator('#emoji').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }
  await page.locator('#emoji').first().click({ button: 'right', position: { x: 3, y: 3 } });
  await page.waitForTimeout(1200);
  return page.evaluate(() => ({
    icons: Array.from(document.querySelectorAll('[data-sn-icon-id]')).map((e) => e.dataset.snIconId),
    scrollY: Math.round(window.scrollY),
    inner: window.innerHeight,
    emojiTop: Math.round(document.getElementById('emoji').getBoundingClientRect().top),
  }));
}

for (let i = 0; i < 4; i++) {
  test(`plain #${i}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, mk(LONG));
    const d = await probe(page, 'plain');
    console.log(`PLAIN ${i}`, JSON.stringify(d));
    expect(d.icons).toContain('translate');
  });
  test(`scrollFirst #${i}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, mk(LONG));
    const d = await probe(page, 'scrollFirst');
    console.log(`SCROLL ${i}`, JSON.stringify(d));
    expect(d.icons).toContain('translate');
  });
}
