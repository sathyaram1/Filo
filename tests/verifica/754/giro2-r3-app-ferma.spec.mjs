// #754 giro 2, rilievo 3: un sito fatto per non scorrere (un'applicazione che scorre dentro un suo riquadro) deve restare
// fermo anche dopo che Filo ne ha nascosto il banner dei cookie: lo sblocco vale per il blocco messo dal banner, non per il disegno del sito.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('applicazione col corpo fermo per disegno: nascosto il banner, la rotella non porta via l\'applicazione', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, `<!doctype html><title>APP</title>
    <style>html,body{margin:0;height:100%;overflow:hidden} .shell{display:flex;height:100%} nav{width:200px;background:#eee}
      main{flex:1;overflow:auto} .tall{height:3000px} .drawer{position:absolute;top:100%;left:0;width:300px;height:600px;background:#ccc}</style>
    <div class="shell"><nav>menu dell'applicazione</nav><main><div class="tall">contenuto</div></main></div>
    <div class="drawer">pannello a scomparsa</div>
    <div id="cookie-notice" style="position:fixed;bottom:0;left:0;right:0;height:80px;background:#fff">Usiamo i cookie. <button>OK</button></div>`);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await sleep(4500);
  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, 500);
  await sleep(600);
  expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(0);
});
