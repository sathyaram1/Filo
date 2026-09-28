// Verifica #754 giro 3, rilievo 5: nascosto il banner dei cookie, lo sblocco toglie anche il velo e il blocco
// dello scorrimento di un altro riquadro del sito (scelta del paese, età, abbonamento), che resta aperto.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAESE = `<title>PAESE</title>
  <style>body{margin:0;overflow:hidden} .page{height:4000px}</style>
  <div class="page">negozio</div>
  <div class="country-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:900"></div>
  <div class="country-modal" style="position:fixed;top:30%;left:30%;width:40%;background:#fff;z-index:901;padding:20px">
    <p>Scegli il tuo paese</p><button>Italia</button><button>Svizzera</button></div>
  <div id="cookie-notice" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#fff;z-index:1001">
    <p>Usiamo i cookie.</p><button onclick="window.__accepted=true">Accetta</button></div>`;

test('il riquadro «scegli il paese» tiene il suo velo e la pagina ferma dietro', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => globalThis.__filoCookieBanners.setListForTest('###cookie-notice'));
  const page = await testServer.openReady(openTab, PAESE);
  await page.waitForFunction(() => getComputedStyle(document.getElementById('cookie-notice')).display === 'none', null, { timeout: 10_000 });
  await sleep(5000);
  const st = await page.evaluate(() => ({
    velo: getComputedStyle(document.querySelector('.country-overlay')).display,
    scorre: getComputedStyle(document.body).overflowY,
  }));
  expect(st).toEqual({ velo: 'block', scorre: 'hidden' });
});
