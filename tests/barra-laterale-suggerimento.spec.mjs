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

// Un punto del pannello accanto alla prima icona: è ancora barra, non è più l'icona.
const accanto = (barra) => barra.evaluate(() => {
  const b = document.querySelector('#nav .ico').getBoundingClientRect();
  return { x: Math.round(b.left - 2), y: Math.round(b.top + b.height / 2) };
});

test('lasciata l’icona per il margine del pannello, la sua etichetta se ne va; tornandoci ricompare', async ({ app, openTab, testServer }) => {
  const barra = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico').first();
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
  const ico = barra.locator('#nav .ico').first();
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  await barra.mouse.down();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
  await barra.mouse.up();
});

test('il puntatore che passa su un’icona mentre la barra si chiude non lascia un’etichetta sopra la pagina', async ({ app, openTab, testServer }) => {
  const barra = await barraAperta(app, openTab, testServer);
  const p = await accanto(barra);
  await barra.mouse.move(p.x, p.y);
  const c = await barra.evaluate(() => {
    const b = document.querySelector('#nav .ico').getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  });
  // Il pannello scivola via ancora visibile: il puntatore gli entra in un'icona, e la vista poi si stringe sotto
  // di lui senza dirgli che è uscito.
  await comandaBarra(app, 'chiudi');
  await barra.mouse.move(c.x, c.y);
  await expect.poll(async () => (await statoBarra(app)).bounds.width, { timeout: 4000 }).toBeLessThan(20);
  await pausa(700);
  expect(await etichetta(app)).toBe('');
});

test('un’etichetta chiesta a barra chiusa non compare', async ({ app, openTab, testServer }) => {
  const barra = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico').first();
  const nome = await ico.getAttribute('aria-label');
  await ico.hover();
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe(nome);
  await comandaBarra(app, 'chiudi');
  await expect.poll(() => etichetta(app), { timeout: 4000 }).toBe('');
  // L'attesa dell'etichetta scattata dopo la chiusura: la richiesta arriva al main con la barra già chiusa.
  await barra.evaluate((t) => window.barra.suggerimento({ testo: t, x: 64, y: 40 }), nome);
  await pausa(700);
  expect(await etichetta(app)).toBe('');
});

test('un’etichetta tolta nell’istante in cui compariva non resta appesa', async ({ app, openTab, testServer }) => {
  const barra = await barraAperta(app, openTab, testServer);
  const ico = barra.locator('#nav .ico').first();
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
