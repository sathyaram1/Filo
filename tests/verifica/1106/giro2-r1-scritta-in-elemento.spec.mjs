// Verifica #1106 giro 2: a caccia chiusa, su una pagina viva, la scritta «Rifiuta» che arriva come elemento
// dentro un pulsante già in pagina (non come testo nudo) lascia il banner a schermo.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const VIVO = `<div id="feed"></div><script>
  let i = 0;
  setInterval(() => {
    const d = document.createElement('div');
    d.innerHTML = '<a href="#r' + (++i) + '">risposta ' + i + '</a>';
    document.getElementById('feed').appendChild(d);
  }, 50);
</script>`;

const BANNER = `<div id="spn" style="position:fixed;top:0;left:0;right:0;height:90px;background:#fff;z-index:10">
  <section id="privacy-consenso"><p>Usiamo i cookie per la pubblicità.</p>
  <button onclick="window.__accettati=(window.__accettati||0)+1;this.closest('#spn').remove()"></button>
  <button class="rif" onclick="window.__rifiuti=(window.__rifiuti||0)+1;this.closest('#spn').remove()"></button></section>
</div>`;

const stato = (app, page) => nelMondoDiFilo(app, page, () => globalThis.SN_COOKIES_CS._state());

test('r1 la scritta del rifiuto che arriva come elemento dentro il pulsante si rifiuta a caccia chiusa', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<title>SPAN</title><p>pagina</p>${VIVO}`);
  await expect.poll(async () => (await stato(app, page)).hunting, { timeout: 40_000, intervals: [1_000] }).toBe(false);
  await page.evaluate((html) => {
    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(() => {
      document.querySelector('#spn button').innerHTML = '<span>Accetta</span>';
      document.querySelector('#spn .rif').innerHTML = '<span>Rifiuta</span>';
    }, 300);
  }, BANNER);
  await page.waitForFunction(() => !document.getElementById('spn'), null, { timeout: 8_000 }).catch(() => {});
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([1, undefined]);
});
