// Verifica #1106 giro 2: a caccia chiusa, su una pagina viva, banner riconoscibili solo dal testo che diventano
// rifiutabili senza un «display» che cambia o senza un pulsante nuovo.

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

const BANNER = (id, stile, rif = 'Rifiuta') => `<div id="${id}" data-x="consenso-privacy" style="position:fixed;top:0;left:0;right:0;height:90px;background:#fff;z-index:10;${stile}">
  <section id="privacy-consenso-${id}"><p>Usiamo i cookie per la pubblicità.</p>
  <button onclick="window.__accettati=(window.__accettati||0)+1;this.closest('#${id}').remove()">Accetta</button>
  <button class="rif" onclick="window.__rifiuti=(window.__rifiuti||0)+1;this.closest('#${id}').remove()">${rif}</button></section>
</div>`;

const stato = (app, page) => nelMondoDiFilo(app, page, () => globalThis.SN_COOKIES_CS._state());

async function aCacciaChiusa(app, openTab, testServer, titolo, corpo) {
  const page = await testServer.openReady(openTab, `<title>${titolo}</title>${corpo}${VIVO}`);
  await expect.poll(async () => (await stato(app, page)).hunting, { timeout: 40_000, intervals: [1_000] }).toBe(false);
  return page;
}

test('visibility: un banner nascosto con visibility e mostrato dopo la caccia si rifiuta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await aCacciaChiusa(app, openTab, testServer, 'VIS', BANNER('vis', 'visibility:hidden'));
  await page.evaluate(() => { document.getElementById('vis').style.visibility = 'visible'; });
  await page.waitForFunction(() => !document.getElementById('vis'), null, { timeout: 8_000 }).catch(() => {});
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([1, undefined]);
});

test('opacity: un banner trasparente che entra in dissolvenza dopo la caccia si rifiuta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await aCacciaChiusa(app, openTab, testServer, 'OPA', BANNER('opa', 'opacity:0'));
  await page.evaluate(() => { document.getElementById('opa').style.opacity = '1'; });
  await page.waitForFunction(() => !document.getElementById('opa'), null, { timeout: 8_000 }).catch(() => {});
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([1, undefined]);
});

test('span: la scritta del rifiuto arriva come elemento dentro il pulsante già in pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await aCacciaChiusa(app, openTab, testServer, 'SPAN', '<p>pagina</p>');
  await page.evaluate((html) => {
    document.body.insertAdjacentHTML('beforeend', html);
    setTimeout(() => { document.querySelector('#spn .rif').innerHTML = '<span>Rifiuta</span>'; }, 300);
  }, BANNER('spn', '', ''));
  await page.waitForFunction(() => !document.getElementById('spn'), null, { timeout: 8_000 }).catch(() => {});
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([1, undefined]);
});

test('controllo: display none mostrato dopo la caccia si rifiuta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await aCacciaChiusa(app, openTab, testServer, 'DSP', BANNER('dsp', 'display:none'));
  await page.evaluate(() => { document.getElementById('dsp').style.display = 'block'; });
  await page.waitForFunction(() => !document.getElementById('dsp'), null, { timeout: 8_000 }).catch(() => {});
  expect(await page.evaluate(() => [window.__rifiuti, window.__accettati])).toEqual([1, undefined]);
});
