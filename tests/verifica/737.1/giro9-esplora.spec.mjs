// #737.1 giro 9: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;

test('e1 avviso scaduto: il secondo blocco sulla stessa pagina si vede ancora', async ({ openTab, testServer, avvisi }) => {
  const dest = testServer.html('<title>PAGA</title>');
  await openTab(testServer.html(`<title>Negozio</title><p>articolo</p><script>var D=${JSON.stringify(dest)};
    setTimeout(function(){window.open(D)},600);setTimeout(function(){window.open(D)},14000);</script>`));
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' });
  await expect(carta).toBeVisible({ timeout: 8000 });
  await expect(carta).toHaveCount(0, { timeout: 12000 });
  await new Promise((r) => setTimeout(r, 4500));
  await expect(vista.locator('.shell-notif.show', { hasText: 'Bloccato popup' }), 'il secondo blocco ha un avviso').toHaveCount(1);
});

const RIQUADRI = {
  'data:': (dest) => `<iframe id="f" width="400" height="200" src="data:text/html,${encodeURIComponent(`<a id=b target=_blank style="display:block;width:200px;height:60px" href="${dest}">apri</a>`)}"></iframe>`,
  'sandbox opaco': (dest, srv) => `<iframe id="f" width="400" height="200" sandbox="allow-scripts allow-popups" src="${srv.html(`<a id=b target=_blank style="display:block;width:200px;height:60px" href="${dest}">apri</a>`)}"></iframe>`,
};
for (const [nome, html] of Object.entries(RIQUADRI)) {
  test(`e2 il collegamento in un riquadro ${nome} apre la sua scheda al clic`, async ({ app, openTab, testServer }) => {
    const dest = testServer.html('<title>DEST</title>');
    const page = await openTab(testServer.html(html(dest, testServer)));
    await page.waitForTimeout(5600);
    const f = page.frames().find((x) => x !== page.mainFrame());
    await f.click('#b');
    await expect.poll(() => aperteSu(app, dest), { timeout: 6000 }).toBe(1);
  });
}

test('e3 Invio su un collegamento con target _blank apre la scheda', async ({ app, openTab, testServer }) => {
  const dest = testServer.html('<title>DEST</title>');
  const page = await openTab(testServer.html(`<a id="l" target="_blank" href="${dest}">apri</a>`));
  await page.waitForTimeout(5600);
  await page.focus('#l');
  await page.waitForTimeout(5600);
  await page.keyboard.press('Enter');
  await expect.poll(() => aperteSu(app, dest), { timeout: 6000 }).toBe(1);
});

test('e4 il tasto f va a schermo intero, da sola la pagina no', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html(`<div id="v" style="width:300px;height:200px;background:#333"></div><script>window.__fs=[];
    setTimeout(function(){document.getElementById('v').requestFullscreen().then(function(){__fs.push('si');document.exitFullscreen()},function(){__fs.push('no')})},1500);
    document.addEventListener('keydown',function(e){if(e.key==='f')document.getElementById('v').requestFullscreen().then(function(){__fs.push('si')},function(){__fs.push('no')})});</script>`));
  await page.waitForTimeout(6500);
  expect(await page.evaluate(() => window.__fs.slice())).toEqual(['no']);
  await page.waitForTimeout(5600);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => window.__fs.slice()), { timeout: 5000 }).toEqual(['no', 'si']);
});
