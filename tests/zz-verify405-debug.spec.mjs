import { test, expect } from './fixtures/electron.mjs';

const CHILD = `<!doctype html><html><body style="margin:0;padding:20px">
  <p id="ptext">Testo dentro il riquadro incorporato.</p></body></html>`;

test('debug frames', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const parent = `<!doctype html><html><body style="margin:0;padding:30px">
    <p id="outside">fuori</p>
    <iframe id="f" src="${childUrl}" width="600" height="320"></iframe></body></html>`;
  const page = await testServer.openReady(openTab, parent);
  await page.waitForTimeout(3000);
  console.log('PAGE URL=' + page.url());
  console.log('CHILD URL=' + childUrl);
  for (const f of page.frames()) {
    console.log('FRAME url=' + f.url() + ' name=' + f.name() + ' detached=' + f.isDetached());
    try {
      const r = await f.evaluate(() => ({
        loc: location.href,
        ready: document.documentElement.dataset.filoReady,
        html: document.body ? document.body.innerHTML.slice(0, 120) : null,
        pt: !!document.querySelector('#ptext'),
      }));
      console.log('   -> ' + JSON.stringify(r));
    } catch (e) { console.log('   -> eval fail: ' + e.message); }
  }
  // conteggio iframe nel main
  console.log('IFRAME COUNT=' + await page.evaluate(() => document.querySelectorAll('iframe').length));
  console.log('IFRAME SRC=' + await page.evaluate(() => [...document.querySelectorAll('iframe')].map(i => i.src).join('|')));
});
