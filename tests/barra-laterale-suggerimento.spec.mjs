// #1201 — l'etichetta di un'icona della barra laterale vive quanto il puntatore sull'icona, a barra aperta:
// lasciata l'icona, chiusa la barra o tolta nell'istante in cui compariva, non resta sopra la pagina.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Il testo del suggerimento di Filo visibile adesso ('' se non ce n'è): è una finestra a sé, sopra la scheda.
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

async function barraAperta(app, openTab, testServer) {
  const page = await openTab(testServer.html('<!doctype html><title>A</title><h1>Pagina</h1>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  return barra;
}

// Un punto del pannello accanto a Indietro: è ancora barra, non è più l'icona.
const accanto = (barra) => barra.evaluate(() => {
  const b = document.querySelector('#nav .ico[data-id="back"]').getBoundingClientRect();
  return { x: Math.round(b.left - 2), y: Math.round(b.top + b.height / 2) };
});

test('lasciata l’icona per il margine del pannello, la sua etichetta se ne va; tornandoci ricompare', async ({ app, openTab, testServer }) => {
  const barra = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico[data-id="back"]');
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);

  const p = await accanto(barra);
  await barra.mouse.move(p.x, p.y);
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
  expect((await statoBarra(app)).aperta).toBe(true);

  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
});

test('premuta l’icona, la sua etichetta se ne va', async ({ app, openTab, testServer }) => {
  const barra = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico[data-id="back"]');
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  await barra.mouse.down();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
  await barra.mouse.up();
});

test('un’etichetta chiesta a barra chiusa non compare', async ({ app, openTab, testServer }) => {
  const barra = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico[data-id="back"]');
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  await comandaBarra(app, 'chiudi');
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
  await expect.poll(async () => (await statoBarra(app)).bounds.width, { timeout: 4000 }).toBeLessThan(20);
  await pausa(300);
  // Un'attesa scattata a vista già stretta (il puntatore passato su un'icona mentre il pannello scivolava via):
  // la richiesta arriva al main con la barra chiusa, e nessuno la toglierebbe più.
  await barra.evaluate((t) => window.barra.suggerimento({ testo: t, x: 64, y: 40 }), nome);
  await pausa(700);
  expect(await etichetta(app)).toBe('');
});

test('un’etichetta tolta nell’istante in cui compariva non resta appesa', async ({ app, openTab, testServer }) => {
  const barra = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico[data-id="back"]');
  const nome = await ico.getAttribute('aria-label');
  // La finestra del suggerimento già nata e pronta, come dopo il primo passaggio.
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  const p = await accanto(barra);
  await barra.mouse.move(p.x, p.y);
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
  // Il puntatore lascia l'icona proprio mentre l'etichetta si misura: le due richieste arrivano in fila.
  await barra.evaluate((t) => { window.barra.suggerimento({ testo: t, x: 64, y: 40 }); window.barra.suggerimento({ testo: '' }); }, nome);
  await pausa(700);
  expect(await etichetta(app)).toBe('');
});

// #871.4 — il primo suggerimento dopo l'avvio compare come i successivi: il fumetto è già nato, caricato e nascosto,
// prima di qualunque passaggio, e la stessa finestra serve il primo e il secondo senza ricaricarsi.
const fumetto = (app) => app.evaluate(({ BrowserWindow }) => {
  const f = BrowserWindow.getAllWindows().find((w) => !w._filoTabs && !w.isDestroyed()
    && w.webContents.getURL() === 'filo://src/renderer/fumetto.html');
  if (!f) return null;
  if (!f.__contaCarichi) {
    f.__contaCarichi = true;
    f.__carichi = 0;
    f.__comparse = 0;
    f.webContents.on('did-start-loading', () => { f.__carichi++; });
    f.on('show', () => { f.__comparse++; });
  }
  return { id: f.id, carica: f.webContents.isLoading(), visibile: f.isVisible(), carichi: f.__carichi, comparse: f.__comparse };
});

test('il primo suggerimento dopo l’avvio usa il fumetto già pronto, come i successivi', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<!doctype html><title>A</title><h1>Pagina</h1>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await expect.poll(() => fumetto(app), { timeout: 8000 }).toMatchObject({ carica: false, visibile: false, comparse: 0 });
  const prima = await fumetto(app);

  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const ico = barra.locator('#nav .ico[data-id="back"]');
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  const p = await accanto(barra);
  await barra.mouse.move(p.x, p.y);
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  // La stessa finestra, mai ricaricata, comparsa due volte.
  expect(await fumetto(app)).toMatchObject({ id: prima.id, carichi: 0, comparse: 2 });
});

// #1722 giro 1 — il fumetto nato all'avvio non si confonde col menu a comparsa: le prove dei menu cercano la finestra
// «data:text/html», e aperto il menu App deve essercene una sola, il menu.
test('aperto il menu App con il fumetto già pronto, l’unica finestra del menu è il menu', async ({ app, shell }) => {
  await expect.poll(() => fumetto(app), { timeout: 8000 }).toMatchObject({ carica: false });
  const dati = () => app.windows().filter((w) => { try { return !w.isClosed() && w.url().startsWith('data:text/html'); } catch (_) { return false; } });
  await shell.evaluate(() => document.getElementById('nav-apps').click());
  await expect.poll(async () => { const w = dati()[0]; return w ? w.locator('.item').count() : 0; }, { timeout: 5000 }).toBeGreaterThan(0);
  expect(dati()).toHaveLength(1);
});
