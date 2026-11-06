// Verifica #1770 giro 1, rilievo 2: a caccia chiusa la scritta di un pulsante-campo arriva dopo, come valore.

import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const LINK = (n) => Array.from({ length: n }, (_, i) => `<a href="#p${i}">post ${i}</a>`).join(' ');
const VIVO = `<div id="feed"></div><script>
  let i = 0;
  setInterval(() => {
    const d = document.createElement('div');
    d.innerHTML = '<a href="#r' + (++i) + '">risposta ' + i + '</a> <button>Mi piace</button>';
    document.getElementById('feed').appendChild(d);
  }, 50);
</script>`;

test('r2 a caccia chiusa, pulsanti-campo vuoti che ricevono dopo «Rifiuta» come valore: rifiutato', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<title>VIVA_VALORE</title>${LINK(300)}${VIVO}`);
  await expect.poll(async () => (await nelMondoDiFilo(app, page, () => globalThis.SN_COOKIES_CS._state())).hunting, { timeout: 35_000, intervals: [1_000] }).toBe(false);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `<div id="campi" class="cookie-consent" style="position:fixed;top:0;left:0;right:0;height:90px;background:#fff;z-index:10">
      <p>Usiamo i cookie.</p><input type="button" id="acc" style="width:120px;height:30px" onclick="window.__accettati=1;this.parentNode.remove()">
      <input type="button" id="rif" style="width:120px;height:30px" onclick="window.__rifiuti=(window.__rifiuti||0)+1;this.parentNode.remove()"></div>`);
    setTimeout(() => {
      document.getElementById('acc').setAttribute('value', 'Accetta');
      document.getElementById('rif').setAttribute('value', 'Rifiuta');
    }, 300);
  });
  await page.waitForFunction(() => !document.getElementById('campi'), null, { timeout: 8_000 });
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([1, undefined]);
});
