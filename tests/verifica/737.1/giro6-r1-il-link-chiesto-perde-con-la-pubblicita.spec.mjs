// #737.1 giro 6 — Su una pagina che apre una pubblicità a ogni clic, la scheda che l'utente chiede (voce «Apri in nuova
// tab» del menu di Filo, clic centrale, Ctrl+clic, link che apre una scheda) deve aprirsi lo stesso.
import { test, expect } from '../../fixtures/electron.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
});
const aperteSu = async (app, u) => (await schede(app)).filter((x) => x.replace(/\?$/, '') === u).length;
const PUBBLICITA = "document.addEventListener('mousedown',function(){window.open(AD)})";

test('«Apri in nuova tab» del menu di Filo apre il collegamento anche se la pagina apre una pubblicità a ogni clic', async ({ app, openTab, testServer }) => {
  const ad = testServer.html('<title>AD</title>');
  const dest = testServer.html('<title>DEST</title>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="${dest}">collegamento</a>
    <script>var AD=${JSON.stringify(ad)};${PUBBLICITA}</script></body>`);
  await page.locator('#l').click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await page.waitForTimeout(5600);
  await menu.locator('button', { hasText: 'Apri in nuova tab' }).first().click();
  await expect.poll(() => aperteSu(app, dest), { timeout: 6000 }).toBe(1);
});

for (const [nome, opz] of Object.entries({ 'clic centrale': { button: 'middle' }, 'Ctrl+clic': { modifiers: ['Control'] }, 'clic su un link che apre una scheda': {} })) {
  test(`${nome} apre il collegamento anche se la pagina apre una pubblicità a ogni clic`, async ({ app, openTab, testServer }) => {
    const ad = testServer.html('<title>AD</title>');
    const dest = testServer.html('<title>DEST</title>');
    const blank = nome.startsWith('clic su') ? 'target="_blank"' : '';
    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><a id="l" href="${dest}" ${blank}>collegamento</a>
      <script>var AD=${JSON.stringify(ad)};${PUBBLICITA}</script></body>`);
    await page.waitForTimeout(5600);
    await page.locator('#l').click(opz);
    await expect.poll(() => aperteSu(app, dest), { timeout: 6000 }).toBe(1);
  });
}
