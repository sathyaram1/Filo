// #871 — la barra laterale dal bordo sinistro: si apre spingendo sul bordo, dalla striscia, dalla
// maniglia e dalla scorciatoia; porta indietro/avanti/ricarica/home; riceve le icone trascinate dal
// tasto destro e le restituisce; un sito non la comanda; a schermo intero resta raggiungibile.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from './helpers/barra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const aperta = async (app) => (await statoBarra(app)).aperta;

const SITO = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <h1>Pagina di prova</h1><p id="p">Clic destro qui.</p><a id="vai" href="#">vai</a>
</body></html>`;

test('a barra chiusa si vede la striscia; spingere sul bordo la apre, passarci di corsa no', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  const s0 = await statoBarra(app);
  expect(s0.aperta).toBe(false);
  expect(s0.bounds.width).toBe(4);
  expect(s0.bounds.x).toBe(0);
  expect(s0.bounds.y).toBe(s0.alto);
  await expect(barra.locator('#striscia')).toBeVisible();
  await expect(barra.locator('#pannello')).toBeHidden();

  // Di corsa: entra e se ne va prima dell'attesa.
  await barra.mouse.move(1, 300);
  await pausa(60);
  await barra.mouse.move(60, 300);
  await pausa(500);
  expect(await aperta(app)).toBe(false);

  // Con un tasto premuto (una scheda trascinata, del testo selezionato) non spinge.
  const cdp = await barra.context().newCDPSession(barra);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 320, button: 'left', buttons: 1 });
  await pausa(500);
  expect(await aperta(app)).toBe(false);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 60, y: 320, button: 'none', buttons: 0 });
  await pausa(100);

  // La spinta: il puntatore resta contro il bordo.
  await barra.mouse.move(0, 300);
  await expect.poll(() => aperta(app)).toBe(true);
  const s1 = await statoBarra(app);
  expect(s1.motivo).toBe('spinta');
  expect(s1.bounds.width).toBeGreaterThan(56);
  await expect(barra.locator('#pannello')).toBeVisible();
  await expect(barra.locator('#nav .ico[data-id="back"]')).toBeVisible();
});

test('la striscia e la maniglia la aprono, la scorciatoia la apre e la chiude, Esc la chiude', async ({ app, shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);

  await barra.locator('#striscia').click({ position: { x: 1, y: 200 } });
  await expect.poll(() => aperta(app)).toBe(true);
  await comandaBarra(app, 'chiudi');
  await expect.poll(() => aperta(app)).toBe(false);

  const maniglia = shell.locator('#barra-maniglia');
  await expect(maniglia).toBeVisible();
  expect(await maniglia.getAttribute('data-tip')).toMatch(/Barra laterale \((Ctrl|Cmd)\+Shift\+B\)/);
  await maniglia.click();
  await expect.poll(() => aperta(app)).toBe(true);
  await maniglia.click();
  await expect.poll(() => aperta(app)).toBe(false);

  // Dalla pagina, con un campo a fuoco: il tasto è di Filo.
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'campo'; document.body.appendChild(i); i.focus(); });
  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(() => aperta(app)).toBe(true);
  expect((await statoBarra(app)).motivo).toBe('tasto');
  // Aperta da tastiera prende il fuoco sulla prima icona che fa qualcosa.
  await expect.poll(() => barra.evaluate(() => document.activeElement && document.activeElement.dataset.id)).toBe('reload');
  await premi(app, 'barra', 'Escape');
  await expect.poll(() => aperta(app)).toBe(false);
  // …e la tastiera torna alla pagina.
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId).view.webContents.isFocused();
  })).toBe(true);

  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(() => aperta(app)).toBe(true);
  await premi(app, 'barra', 'B', ['control', 'shift']);
  await expect.poll(() => aperta(app)).toBe(false);

  // Dalla fila delle schede, e con Cmd come su Mac.
  await premi(app, 'shell', 'B', ['meta', 'shift']);
  await expect.poll(() => aperta(app)).toBe(true);
  await premi(app, 'shell', 'Escape');
  await expect.poll(() => aperta(app)).toBe(false);
  // Ctrl+B resta alla pagina (è il grassetto).
  await premi(app, 'scheda', 'B', ['control']);
  await pausa(300);
  expect(await aperta(app)).toBe(false);
});

test('indietro, avanti, ricarica e home funzionano da un sito, spenti quando non c\'è dove andare', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><body><h1>A</h1></body>');
  const b = testServer.html('<!doctype html><title>B</title><body><h1>B</h1></body>');
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  const back = barra.locator('#nav .ico[data-id="back"]');
  const fwd = barra.locator('#nav .ico[data-id="forward"]');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect(fwd).toHaveAttribute('aria-disabled', 'true');
  // Spento vuol dire che non fa niente.
  await back.click({ force: true });
  await pausa(300);
  expect(page.url()).toBe(a);

  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  await back.click();
  await page.waitForURL(a);
  await expect(fwd).toHaveAttribute('aria-disabled', 'false');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await fwd.click();
  await page.waitForURL(b);

  await page.evaluate(() => { window.__segno = 1; });
  await barra.locator('#nav .ico[data-id="reload"]').click();
  await expect.poll(() => page.evaluate(() => window.__segno).catch(() => 'ricaricata')).not.toBe(1);

  await barra.locator('#nav .ico[data-id="home"]').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return t && t.url;
  })).toMatch(/^filo:\/\/newtab\//);
});

test('indietro e avanti funzionano anche fra le pagine di Filo', async ({ app, openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForLoadState('domcontentloaded');
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  const back = barra.locator('#nav .ico[data-id="back"]');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => { location.href = 'filo://preferences/preferences.html'; });
  await page.waitForURL(/preferences/);
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  await back.click();
  await page.waitForURL(/options\.html/);
  await expect(barra.locator('#nav .ico[data-id="forward"]')).toHaveAttribute('aria-disabled', 'false');
});

test('«Altro…» non ha più le voci globali, e la barra le ha', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await page.locator('#p').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.sn-menu-row-overflow').first().hover();
  const grid = page.locator('.sn-menu-icon-grid');
  await expect(grid).toBeVisible();
  for (const id of ['back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab']) {
    await expect(page.locator(`.sn-menu [data-sn-icon-id="${id}"], .sn-menu-icon-grid [data-sn-icon-id="${id}"]`)).toHaveCount(0);
  }
  await expect(grid.locator('[data-sn-icon-id="openOptions"]')).toHaveCount(1);
  const barra = await barraPage(app);
  const ids = await barra.$$eval('#nav .ico', (els) => els.map((e) => e.dataset.id));
  expect(ids).toEqual(['back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab']);
});

test('un sito non apre la barra e non la comanda con eventi finti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await barraPage(app);
  // Il tasto finto.
  await page.evaluate(() => {
    for (const t of ['keydown', 'keyup']) {
      document.dispatchEvent(new KeyboardEvent(t, { key: 'B', code: 'KeyB', ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true }));
    }
  });
  // Un trascinamento finto dal menu aperto per davvero.
  await page.locator('#p').click({ button: 'right' });
  const icona = page.locator('.sn-menu [data-sn-icon-id="screenshot"]').first();
  await expect(icona).toBeVisible();
  const prima = (await statoBarra(app)).bar;
  await page.evaluate(() => {
    const el = document.querySelector('.sn-menu [data-sn-icon-id="screenshot"]');
    const r = el.getBoundingClientRect();
    const opts = (x, y, extra = {}) => ({ bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y, isPrimary: true, ...extra });
    el.dispatchEvent(new PointerEvent('pointerdown', opts(r.x + 5, r.y + 5)));
    for (let i = 1; i <= 20; i++) window.dispatchEvent(new PointerEvent('pointermove', opts(r.x + 5 - i * 20, 200)));
    window.dispatchEvent(new PointerEvent('pointerup', opts(10, 200, { buttons: 0 })));
  });
  await pausa(600);
  const dopo = await statoBarra(app);
  expect(dopo.aperta).toBe(false);
  expect(dopo.bar).toEqual(prima);
});

test('a schermo intero la barra resta raggiungibile, e il primo Esc chiude lei, il secondo esce', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await barra.locator('#nav .ico[data-id="fullscreen"]').click();
  await expect.poll(async () => (await statoBarra(app)).schermoIntero).toBe(true);
  await comandaBarra(app, 'chiudi');
  await expect.poll(async () => (await statoBarra(app)).bounds.width).toBe(4);
  const s = await statoBarra(app);
  expect(s.bounds.y).toBe(0);
  await expect(barra.locator('#striscia')).toBeVisible();
  // L'icona dice come uscire.
  await barra.mouse.move(0, 300);
  await expect.poll(() => aperta(app)).toBe(true);
  await expect(barra.locator('#nav .ico[data-id="fullscreen"]')).toHaveAttribute('aria-label', 'Esci da schermo intero');

  await premi(app, 'scheda', 'Escape');
  await expect.poll(() => aperta(app)).toBe(false);
  expect((await statoBarra(app)).schermoIntero).toBe(true);
  await premi(app, 'scheda', 'Escape');
  await expect.poll(async () => (await statoBarra(app)).schermoIntero).toBe(false);
});

test('le voci che stavano in alto nella home sono in fondo alla barra, e la home non ha più la fila', async ({ app, openTab }) => {
  const home = await openTab('filo://newtab/');
  await home.waitForLoadState('domcontentloaded');
  await expect(home.locator('#dashControls')).toHaveCount(0);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  const fisse = await barra.$$eval('#fisse .ico', (els) => els.map((e) => e.dataset.comando));
  expect(fisse).toEqual(['history', 'apps', 'redteam', 'account', 'settings']);
  await expect(barra.locator('#ora')).toHaveText(/^\d{2}:\d{2}$/);

  await barra.locator('#fisse [data-comando="history"]').click();
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://archive/'); } catch (_) { return false; } })).toBe(true);
  await comandaBarra(app, 'clic');
  await barra.locator('#fisse [data-comando="redteam"]').click();
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://redteam/'); } catch (_) { return false; } })).toBe(true);

  // App apre il menu delle app accanto alla barra, non in alto a destra.
  await comandaBarra(app, 'clic');
  const vistaPrima = app.windows().length;
  await barra.locator('#fisse [data-comando="apps"]').click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const pop = BrowserWindow.getAllWindows().find((x) => x !== main && !x._filoTabs && x.isVisible() && x.getBounds().height > 100);
    if (!pop) return null;
    return pop.getBounds().x - main.getContentBounds().x;
  })).toBeLessThan(200);
  expect(app.windows().length).toBeGreaterThanOrEqual(vistaPrima);
});

test('trascino «Screenshot» dal tasto destro alla barra: resta dopo il riavvio, riportato nel menu sparisce dalla barra', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-barra-');
  const avvia = async () => {
    const app = await electron.launch({
      args: [...argomentiScala, '.'], cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
    });
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    return { app, shell };
  };
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(SITO); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const indirizzo = `http://127.0.0.1:${server.address().port}/sito`;
  // Un indirizzo per giro: al riavvio torna anche la scheda di prima, con il suo.
  const apriSito = async (app, shell, giro) => {
    const url = `${indirizzo}?giro=${giro}`;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    const fine = Date.now() + 10_000;
    while (!page && Date.now() < fine) {
      page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
      if (!page) await pausa(100);
    }
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    return page;
  };
  try {
    let { app, shell } = await avvia();
    let page = await apriSito(app, shell, 1);
    const barra = await barraPage(app);
    await page.locator('#p').click({ button: 'right' });
    const icona = page.locator('.sn-menu [data-sn-icon-id="screenshot"]').first();
    await expect(icona).toBeVisible();
    const box = await icona.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 12, box.y + 12, { steps: 3 });
    // Il trascinamento apre la barra.
    await expect.poll(() => aperta(app)).toBe(true);
    await pannelloFermo(barra);
    const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
    await page.mouse.move(30, home.y + 4, { steps: 8 });
    await expect(barra.locator('#nav')).toHaveClass(/mira/);
    await page.mouse.up();
    await expect.poll(async () => (await statoBarra(app)).bar).toEqual(['back', 'forward', 'reload', 'screenshot', 'home', 'incognito', 'fullscreen', 'closeTab']);
    await expect(barra.locator('#nav .ico[data-id="screenshot"]')).toBeVisible();
    // Il menu aperto non ce l'ha più.
    await expect(page.locator('.sn-menu [data-sn-icon-id="screenshot"]')).toHaveCount(0);
    await chiudiApp(app);

    ({ app, shell } = await avvia());
    page = await apriSito(app, shell, 2);
    const barra2 = await barraPage(app);
    await expect.poll(async () => (await statoBarra(app)).bar).toContain('screenshot');
    await expect(barra2.locator('#nav .ico[data-id="screenshot"]')).toHaveCount(1);

    // Dalla barra al menu aperto: la barra manda il gesto, la pagina lo posa nella sua riga.
    await page.locator('#p').click({ button: 'right' });
    const riga = page.locator('.sn-menu .sn-menu-row[data-sn-drop-target="primary"]').first();
    await expect(riga).toBeVisible();
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra2);
    const src = await barra2.locator('#nav .ico[data-id="screenshot"]').boundingBox();
    const dst = await riga.boundingBox();
    const s = await statoBarra(app);
    // Stessa origine per la barra e la scheda: le coordinate della pagina valgono nella barra.
    const alto = s.bounds.y - s.alto;
    await barra2.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await barra2.mouse.down();
    await barra2.mouse.move(src.x + 30, src.y + 10, { steps: 3 });
    await barra2.mouse.move(dst.x + dst.width - 20, dst.y + dst.height / 2 - alto, { steps: 10 });
    await expect(page.locator('.sn-drag-preview')).toHaveCount(1);
    await barra2.mouse.up();
    await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('screenshot');
    const dopo = await statoBarra(app);
    expect([...dopo.primary, ...dopo.secondary]).toContain('screenshot');
    await expect(barra2.locator('#nav .ico[data-id="screenshot"]')).toHaveCount(0);
    await expect(page.locator('.sn-drag-preview')).toHaveCount(0);
    await chiudiApp(app);
  } finally {
    try { server.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('col tasto destro un\'icona della barra torna nel menu', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await barra.locator('#nav .ico[data-id="incognito"]').click({ button: 'right' });
  let popup = null;
  const fine = Date.now() + 5000;
  while (!popup && Date.now() < fine) {
    popup = app.windows().find((w) => { try { return w.url().startsWith('data:text/html'); } catch (_) { return false; } });
    if (!popup) await pausa(100);
  }
  expect(popup, 'il menu della voce non si è aperto').toBeTruthy();
  await popup.waitForSelector('.menu');
  await popup.locator('button.item', { hasText: 'Rimetti nel menu del tasto destro' }).click();
  await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('incognito');
  expect((await statoBarra(app)).secondary).toContain('incognito');
  await expect(barra.locator('#nav .ico[data-id="incognito"]')).toHaveCount(0);
});
