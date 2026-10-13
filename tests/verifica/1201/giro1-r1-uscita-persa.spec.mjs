// #1201 giro 1 — porta r1: l'etichetta segue il puntatore anche quando l'uscita dalla barra si perde, a barra aperta da tastiera delle icone della barra laterale.
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

test('r1 aperta da tastiera, il puntatore va sulla pagina senza uscita: l\'etichetta se ne va', async ({ app, openTab, testServer }) => {
  const { barra } = await barraAperta(app, openTab, testServer, 'tasto');
  const ico = barra.locator('#nav .ico').first();
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  for (let i = 0; i < 5; i++) { await muoviSullaPagina(app, 400 + i * 10, 300); await pausa(60); }
  // La barra aperta da tastiera resta aperta (voluto): il puntatore però è sulla pagina, e l'etichetta deve andarsene.
  await expect.poll(() => etichetta(app), { timeout: 3000 }).toBe('');
  expect((await statoBarra(app)).aperta).toBe(true);
});
