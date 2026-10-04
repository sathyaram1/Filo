// #737.1 — Col blocco dei popup acceso una pagina non apre schede né va a schermo pieno senza un gesto vero
// dell'utente, in qualunque forma lo chieda; il clic dell'utente (anche in un riquadro di un altro sito) sì, uno per gesto.
// Le regole: src/main/services/permessiPagine.js (gestoPerUnaFinestra, INNOCUI_COL_GESTO).

import { test, expect } from './fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x === u).length;

// Ogni evaluate di Playwright attiva la pagina come un gesto: le pagine qui chiedono da sole, coi loro timer.
const FORME = {
  'window.open senza misure': 'window.open(u)',
  'window.open con _blank': "window.open(u, '_blank')",
  'link con target _blank premuto dallo script': "var a=document.createElement('a');a.href=u;a.target='_blank';document.body.appendChild(a);a.click()",
  'modulo con target _blank inviato dallo script': "var f=document.createElement('form');f.action=u;f.method='get';f.target='_blank';document.body.appendChild(f);f.submit()",
};

for (const [forma, js] of Object.entries(FORME)) {
  test(`una pagina che apre da sola una scheda (${forma}) viene fermata, e «Apri» la apre`, async ({ app, shell, openTab, testServer, avvisi }) => {
    const bersaglio = testServer.html('<title>DA SOLA</title><p>pubblicità</p>');
    await openTab(testServer.html(`<title>Sito</title><p>articolo</p><script>var u=${JSON.stringify(bersaglio)};setTimeout(function(){${js}},600)</script>`));
    const carta = (await avvisi()).locator('.shell-notif.show', { hasText: 'Bloccato popup da 127.0.0.1' });
    await expect(carta).toBeVisible({ timeout: 8000 });
    expect(await aperteSu(app, bersaglio), 'nessuna scheda nuova senza un clic').toBe(0);

    await carta.locator('.shell-notif-action', { hasText: 'Apri' }).click();
    await expect.poll(() => aperteSu(app, bersaglio), { timeout: 8000 }).toBe(1);
  });
}

test('una pagina che si riapre da sola non riempie Filo di schede, e l\'avviso resta uno', async ({ app, shell, openTab, testServer, avvisi }) => {
  const url = testServer.html('<title>Catena</title><script>setInterval(function(){window.open(location.href)},250)</script>');
  await openTab(url);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' })).toBeVisible({ timeout: 8000 });
  await shell.waitForTimeout(2500);
  expect(await aperteSu(app, url)).toBe(1);
  await expect(vista.locator('.shell-notif', { hasText: 'Bloccato popup' })).toHaveCount(1);
});

test('il clic dell\'utente apre la scheda che chiede, una sola per clic', async ({ app, openTab, testServer }) => {
  const prima = testServer.html('<title>PRIMA</title>');
  const seconda = testServer.html('<title>SECONDA</title>');
  const collegata = testServer.html('<title>LINK</title>');
  const page = await openTab(testServer.html(`<button id="b" style="width:200px;height:60px"
    onclick="window.open(${JSON.stringify(prima).replace(/"/g, '&quot;')});window.open(${JSON.stringify(seconda).replace(/"/g, '&quot;')})">apri</button>
    <a id="l" href="${collegata}" target="_blank">link</a>`));
  await page.click('#b');
  await expect.poll(() => aperteSu(app, prima), { timeout: 8000 }).toBe(1);
  await page.waitForTimeout(800);
  expect(await aperteSu(app, seconda), 'la seconda finestra dello stesso clic non passa').toBe(0);

  await page.click('#l');
  await expect.poll(() => aperteSu(app, collegata), { timeout: 8000 }).toBe(1);
});

test('il clic dentro un riquadro di un altro sito apre la sua scheda; da solo il riquadro non apre niente', async ({ app, openTab, testServer }) => {
  const daSolo = testServer.html('<title>RIQUADRO DA SOLO</title>');
  const colClic = testServer.html('<title>RIQUADRO COL CLIC</title>');
  const dentro = testServer.html(`<button id="b" style="width:200px;height:60px"
    onclick="window.open(${JSON.stringify(colClic).replace(/"/g, '&quot;')})">apri</button>
    <script>setTimeout(function(){window.open(${JSON.stringify(daSolo)})},600)</script>`, { pubblico: true });
  const page = await openTab(testServer.html(`<title>Ospite</title><iframe src="${dentro}" width="400" height="200"></iframe>`));
  await expect.poll(() => page.frames().some((f) => f.url() === dentro), { timeout: 8000 }).toBe(true);
  await page.waitForTimeout(1500);
  expect(await aperteSu(app, daSolo)).toBe(0);

  await page.frames().find((f) => f.url() === dentro).click('#b');
  await expect.poll(() => aperteSu(app, colClic), { timeout: 8000 }).toBe(1);
});

test('col blocco spento la scheda che la pagina apre da sola passa', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.setSecurity({ ...tm.security, blockPopups: false });
  });
  const bersaglio = testServer.html('<title>PASSA</title>');
  await openTab(testServer.html(`<script>setTimeout(function(){window.open(${JSON.stringify(bersaglio)})},400)</script>`));
  await expect.poll(() => aperteSu(app, bersaglio), { timeout: 8000 }).toBe(1);
});

const SCHERMO = (dopo) => `<button id="b" style="width:200px;height:60px">schermo intero</button>
  <script>window.__fs=[];function chiedi(){document.documentElement.requestFullscreen().then(function(){window.__fs.push('si')},function(){window.__fs.push('no')})}
  document.getElementById('b').addEventListener('click',chiedi);${dopo ? `setTimeout(chiedi,${dopo})` : ''}</script>`;

test('lo schermo intero lo prende solo il clic dell\'utente, anche dentro un riquadro di un altro sito', async ({ openTab, testServer }) => {
  const dentro = testServer.html(SCHERMO(0), { pubblico: true });
  const page = await openTab(testServer.html(`${SCHERMO(600)}<iframe src="${dentro}" allow="fullscreen" width="400" height="200"></iframe>`));
  await page.waitForTimeout(1800);
  expect(await page.evaluate(() => [window.__fs, !!document.fullscreenElement])).toEqual([['no'], false]);

  await page.click('#b');
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement), { timeout: 6000 }).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement), { timeout: 6000 }).toBe(false);

  const riquadro = page.frames().find((f) => f.url() === dentro);
  await page.waitForTimeout(5500);
  await riquadro.click('#b');
  await expect.poll(() => riquadro.evaluate(() => !!document.fullscreenElement), { timeout: 6000 }).toBe(true);
});
