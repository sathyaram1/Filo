// #1106, giro 1: banner che diventano rifiutabili a caccia chiusa senza un elemento nuovo che porti il «Rifiuta».
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

const stato = (app, page) => nelMondoDiFilo(app, page, () => globalThis.SN_COOKIES_CS._state());

async function cacciaChiusa(app, page) {
  await expect.poll(async () => (await stato(app, page)).hunting, { timeout: 40_000, intervals: [1_000] }).toBe(false);
}

test('r1 etichetta del rifiuto scritta dopo: il banner si rifiuta lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<title>ETICHETTA_TARDI</title>${VIVO}`);
  await cacciaChiusa(app, page);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `<div id="tardi" class="zz-consent-box" style="position:fixed;top:0;left:0;right:0;height:90px;background:#fff;z-index:10">
      <p>Usiamo i cookie.</p><button id="acc" onclick="this.parentNode.remove()"></button><button id="rif" onclick="window.__rifiuti=(window.__rifiuti||0)+1;this.parentNode.remove()"></button></div>`);
    setTimeout(() => { document.getElementById('acc').textContent = 'Accetta'; document.getElementById('rif').textContent = 'Rifiuta'; }, 300);
  });
  await page.waitForFunction(() => !document.getElementById('tardi'), null, { timeout: 8_000 });
  expect(await page.evaluate(() => window.__rifiuti)).toBe(1);
});

test('r1 banner nascosto nel codice della pagina e mostrato a caccia chiusa: si rifiuta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<title>NASCOSTO_DALLINIZIO</title>
    <div id="dopo" class="zz-consent-box" style="display:none;position:fixed;top:0;left:0;right:0;height:90px;background:#fff;z-index:10">
      <p>Usiamo i cookie.</p><button onclick="this.parentNode.remove()">Accetta</button>
      <button onclick="window.__rifiuti=(window.__rifiuti||0)+1;this.parentNode.remove()">Rifiuta</button></div>${VIVO}`);
  await cacciaChiusa(app, page);
  await page.evaluate(() => { document.getElementById('dopo').style.display = 'block'; });
  await page.waitForFunction(() => !document.getElementById('dopo'), null, { timeout: 8_000 });
  expect(await page.evaluate(() => window.__rifiuti)).toBe(1);
});
