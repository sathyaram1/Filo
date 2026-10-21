// #1201 giro 1 — prove avversariali sull'etichetta delle icone della barra laterale.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const etichetta = (app) => app.evaluate(async ({ BrowserWindow }) => {
  const testi = [];
  for (const w of BrowserWindow.getAllWindows()) {
    if (w._filoTabs || w.isDestroyed() || !w.isVisible()) continue;
    try {
      const t = await w.webContents.executeJavaScript("(document.getElementById('tip') || {}).textContent || ''");
      if (t) testi.push(t);
    } catch (_) {}
  }
  return testi.join(' | ');
});

async function barraAperta(app, openTab, testServer, motivo = 'clic') {
  const page = await openTab(testServer.html('<!doctype html><title>A</title><h1>Pagina</h1>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const barra = await barraPage(app);
  await comandaBarra(app, motivo);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  return { barra, page };
}

// Un movimento del puntatore che arriva alla scheda (input vero dal main), come quando il puntatore passa sulla pagina.
const muoviSullaPagina = (app, x, y) => app.evaluate(({ BrowserWindow }, p) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  t.view.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
}, { x, y });

test('Esc da tastiera a etichetta visibile la toglie', async ({ app, openTab, testServer }) => {
  const { barra } = await barraAperta(app, openTab, testServer, 'tasto');
  const ico = barra.locator('#nav .ico').first();
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  await premi(app, 'barra', 'Escape');
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
});

test('etichetta dell\'ora: chiusa la barra se ne va', async ({ app, openTab, testServer }) => {
  const { barra } = await barraAperta(app, openTab, testServer);
  await barra.locator('#ora').hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).not.toBe('');
  await comandaBarra(app, 'chiudi');
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
});

test('passaggio rapido su tre icone e fuori dal pannello: nessuna etichetta', async ({ app, openTab, testServer }) => {
  const { barra } = await barraAperta(app, openTab, testServer);
  const icone = barra.locator('#nav .ico');
  await icone.nth(0).hover(); await pausa(80);
  await icone.nth(1).hover(); await pausa(80);
  await icone.nth(2).hover(); await pausa(80);
  await barra.mouse.move(300, 300);
  await pausa(900);
  expect(await etichetta(app)).toBe('');
});

test('aperta col clic, il puntatore va sulla pagina senza uscita: etichetta via insieme alla barra', async ({ app, openTab, testServer }) => {
  const { barra } = await barraAperta(app, openTab, testServer, 'clic');
  const ico = barra.locator('#nav .ico').first();
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  for (let i = 0; i < 5; i++) { await muoviSullaPagina(app, 400 + i * 10, 300); await pausa(60); }
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
});

test('etichetta allineata all\'icona, a destra del pannello', async ({ app, openTab, testServer }) => {
  const { barra } = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico').nth(2);
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  const misure = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tip = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && x.isVisible());
    return { cb: w.getContentBounds(), vista: w._filoTabs.barra.vista.getBounds(), tip: tip.getBounds() };
  });
  const r = await ico.boundingBox();
  const p = await barra.locator('#pannello').boundingBox();
  const centroIco = misure.cb.y + misure.vista.y + r.y + r.height / 2;
  const centroTip = misure.tip.y + misure.tip.height / 2;
  expect(Math.abs(centroIco - centroTip)).toBeLessThan(6);
  expect(misure.tip.x).toBeGreaterThanOrEqual(misure.cb.x + misure.vista.x + p.x + p.width);
});

test('trascinata un\'icona fuori dal pannello e rilasciata: nessuna etichetta resta', async ({ app, openTab, testServer }) => {
  const { barra } = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico').nth(1);
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).not.toBe('');
  const r = await ico.boundingBox();
  await barra.mouse.down();
  for (let i = 1; i <= 8; i++) { await barra.mouse.move(r.x + 20, r.y + 18 + i * 40); await pausa(50); }
  await pausa(500);
  expect(await etichetta(app)).toBe('');
  await barra.mouse.up();
  await pausa(900);
  expect(await etichetta(app)).toBe('');
});

test('tasto destro sull\'icona e menu chiuso con Esc: nessuna etichetta', async ({ app, openTab, testServer }) => {
  const { barra } = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico').first();
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).not.toBe('');
  await barra.mouse.down({ button: 'right' }); await barra.mouse.up({ button: 'right' });
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
  await pausa(900);
  expect(await etichetta(app)).toBe('');
});
