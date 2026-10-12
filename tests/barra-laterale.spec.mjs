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
import { apriRedteamATutti } from './helpers/redteam.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

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
  // Striscia sola: 4 px, e 5 in più dove il sistema si prende la fascia del bordo (finestra non massimizzata).
  expect(s0.bounds.width).toBe(s0.chiusa);
  expect([4, 9]).toContain(s0.chiusa);
  expect(s0.bounds.x).toBe(0);
  expect(s0.bounds.y).toBe(s0.alto);
  await expect(barra.locator('#striscia')).toBeVisible();
  await expect(barra.locator('#pannello')).toBeHidden();
  // La scheda aperta per ultima entra in cima alle viste: la barra le torna sopra.
  const sopra = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const figli = w.contentView.children;
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return figli.indexOf(w._filoTabs.barra.vista) > figli.indexOf(t.view);
  });
  expect(sopra).toBe(true);

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
  await pannelloFermo(barra);
  const back = barra.locator('#nav .ico[data-id="back"]');
  const fwd = barra.locator('#nav .ico[data-id="forward"]');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect(fwd).toHaveAttribute('aria-disabled', 'true');
  // Spento si vede: sbiadito come nel menu.
  expect(await back.evaluate((el) => parseFloat(getComputedStyle(el).opacity))).toBeLessThan(1);
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
  await pannelloFermo(barra);
  const back = barra.locator('#nav .ico[data-id="back"]');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await page.evaluate(() => { location.href = 'filo://preferences/preferences.html'; });
  await page.waitForURL(/preferences/);
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  await back.click();
  await page.waitForURL(/options\.html/);
  await expect(barra.locator('#nav .ico[data-id="forward"]')).toHaveAttribute('aria-disabled', 'false');
});

test('Home e poi Indietro riportano al sito, con tutta la sua cronologia; una pagina nuova toglie il davanti', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><body><h1>A</h1></body>');
  const b = testServer.html('<!doctype html><title>B</title><body><h1>B</h1></body>');
  const c = testServer.html('<!doctype html><title>C</title><body><h1>C</h1></body>');
  const urlAttiva = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId).url;
  });
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  const barra = await barraPage(app);
  const icona = (id) => barra.locator(`#nav .ico[data-id="${id}"]`);
  const premiIcona = async (id) => {
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    await expect(icona(id)).toHaveAttribute('aria-disabled', 'false');
    await icona(id).click();
  };
  await premiIcona('home');
  await expect.poll(urlAttiva).toMatch(/^filo:\/\/newtab\//);
  // Il tasto destro su Indietro elenca le pagine del sito, dalla più vicina.
  const elenco = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.vociCronologia('indietro').map((v) => v.url));
  expect(elenco).toEqual([b, a]);
  await premiIcona('back');
  await expect.poll(urlAttiva).toBe(b);
  await premiIcona('back');
  await expect.poll(urlAttiva).toBe(a);
  await premiIcona('forward');
  await expect.poll(urlAttiva).toBe(b);
  await premiIcona('forward');
  await expect.poll(urlAttiva).toMatch(/^filo:\/\/newtab\//);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(icona('forward')).toHaveAttribute('aria-disabled', 'true');
  // Tornato al sito, un collegamento nuovo toglie il davanti: Avanti non porta più alla home.
  await premiIcona('back');
  await expect.poll(urlAttiva).toBe(b);
  const vista = app.windows().find((w) => { try { return w.url() === b; } catch (_) { return false; } });
  await vista.evaluate((u) => { location.href = u; }, c);
  await expect.poll(urlAttiva).toBe(c);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(icona('forward')).toHaveAttribute('aria-disabled', 'true');
  await expect(icona('back')).toHaveAttribute('aria-disabled', 'false');
});

test('Indietro e Avanti premuti di fila, prima che la pagina si carichi, non perdono le pagine saltate', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><body><h1>A</h1></body>');
  const b = testServer.html('<!doctype html><title>B</title><body><h1>B</h1></body>');
  const c = testServer.html('<!doctype html><title>C</title><body><h1>C</h1></body>');
  const scheda = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { url: t.url, dietro: w._filoTabs.vociCronologia('indietro').map((v) => v.url), davanti: w._filoTabs.vociCronologia('avanti').map((v) => v.url) };
  });
  // Due pressioni a un soffio: la seconda arriva mentre la vista nuova sta ancora caricando.
  const diFila = (verso, volte) => app.evaluate(async ({ BrowserWindow }, [v, n]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    for (let i = 0; i < n; i++) { w._filoTabs.navigaCronologia(v); await new Promise((r) => setTimeout(r, 20)); }
  }, [verso, volte]);
  const home = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.navigate(w._filoTabs.activeId, 'filo://newtab/');
  });
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate((u) => { location.href = u; }, b);
  await page.waitForURL(b);
  await page.evaluate((u) => { location.href = u; }, c);
  await expect.poll(async () => (await scheda()).url).toBe(c);
  await home();
  await expect.poll(async () => (await scheda()).dietro).toEqual([c, b, a]);
  await diFila('indietro', 3);
  await expect.poll(async () => (await scheda()).url).toBe(a);
  await expect.poll(async () => (await scheda()).davanti).toEqual([b, c, 'filo://newtab/']);
  await diFila('avanti', 2);
  await expect.poll(async () => (await scheda()).url).toBe(c);
  await expect.poll(async () => (await scheda()).dietro).toEqual([b, a]);
  // Home e subito Indietro: la home resta davanti.
  await home();
  await diFila('indietro', 1);
  await expect.poll(async () => (await scheda()).url).toBe(c);
  await expect.poll(async () => (await scheda()).davanti).toEqual(['filo://newtab/']);
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
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="fullscreen"]').click();
  await expect.poll(async () => (await statoBarra(app)).schermoIntero).toBe(true);
  await comandaBarra(app, 'chiudi');
  // A schermo intero la fascia del sistema non c'è: resta la striscia sola.
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

test('le voci che stavano in alto nella home sono in fondo alla barra; in alto a destra restano Impostazioni e Profilo', async ({ app, openTab }) => {
  await apriRedteamATutti(app);
  const home = await openTab('filo://newtab/');
  await expect.poll(() => home.$$eval('#dashControls .dash-ctrl', (els) => els.map((e) => e.dataset.command)), { timeout: 8_000 })
    .toEqual(['settings', 'account']);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect.poll(() => barra.$$eval('#fisse .ico:not([hidden])', (els) => els.map((e) => e.dataset.comando)))
    .toEqual(['history', 'apps', 'redteam', 'account', 'settings']);
  await expect(barra.locator('#ora')).toHaveText(/^\d{2}:\d{2}$/);

  await barra.locator('#fisse [data-comando="history"]').click();
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://archive/'); } catch (_) { return false; } })).toBe(true);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#fisse [data-comando="redteam"]').click();
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://redteam/'); } catch (_) { return false; } })).toBe(true);

  // App apre il menu delle app accanto alla barra, non in alto a destra.
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
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
    const shell = await primaFinestra(app);
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
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="incognito"]').click({ button: 'right' });
  let popup = null;
  const fine = Date.now() + 5000;
  // Anche il suggerimento è una finestra data:: il menu è quella con le voci.
  while (!popup && Date.now() < fine) {
    for (const w of app.windows()) {
      let url = '';
      try { url = w.url(); } catch (_) { continue; }
      if (url.startsWith('data:text/html') && await w.$('.menu').catch(() => null)) { popup = w; break; }
    }
    if (!popup) await pausa(100);
  }
  expect(popup, 'il menu della voce non si è aperto').toBeTruthy();
  await expect(popup.locator('button.item', { hasText: 'Rimetti nel menu del tasto destro' })).toBeVisible();
  // La scelta chiude il menu: il clic non aspetta una pagina che non c'è più.
  await popup.evaluate(() => {
    const b = [...document.querySelectorAll('button.item')].find((x) => x.textContent.includes('Rimetti nel menu'));
    b.click();
  }).catch(() => {});
  await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('incognito');
  expect((await statoBarra(app)).secondary).toContain('incognito');
  await expect(barra.locator('#nav .ico[data-id="incognito"]')).toHaveCount(0);
});

test('chiesta a Filo in chat la barra si apre e resta aperta mentre il mouse gira sulla pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  const r = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'COMANDO_FINESTRA', comando: 'sidebar' });
  expect(r.executed).toBe(true);
  await expect.poll(() => aperta(app)).toBe(true);
  await expect(barra.locator('#pannello')).toBeVisible();
  await page.mouse.move(400, 300);
  await page.mouse.move(420, 320);
  await pausa(700);
  expect(await aperta(app)).toBe(true);
  // Un clic sulla pagina la chiude.
  await page.mouse.click(420, 320);
  await expect.poll(() => aperta(app)).toBe(false);
});

test('aperta col mouse, il puntatore che torna sulla pagina la chiude', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await barra.mouse.move(0, 300);
  await expect.poll(() => aperta(app)).toBe(true);
  await pannelloFermo(barra);
  await barra.mouse.move(30, 300);
  await pausa(100);
  await page.mouse.move(500, 300);
  await page.mouse.move(520, 310);
  await expect.poll(() => aperta(app), { timeout: 3000 }).toBe(false);
  // E il pannello si ritira: la vista torna larga quanto la striscia.
  await expect.poll(async () => { const s = await statoBarra(app); return s.bounds.width === s.chiusa; }).toBe(true);
});

test('un trascinamento dal menu interrotto da una pagina che ricarica non lascia la barra appesa', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await barraPage(app);
  await page.locator('#p').click({ button: 'right' });
  const icona = page.locator('.sn-menu [data-sn-icon-id="share"]').first();
  await expect(icona).toBeVisible();
  const box = await icona.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 14, box.y + 14, { steps: 3 });
  await expect.poll(() => aperta(app)).toBe(true);
  await page.evaluate(() => location.reload());
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.mouse.up();
  await expect.poll(() => aperta(app), { timeout: 4000 }).toBe(false);
  expect((await statoBarra(app)).bar).not.toContain('share');
});

test('Nuova finestra incognito dalla barra: anche lei ha la sua barra, con le stesse icone', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="incognito"]').click();
  let privata = null;
  const fine = Date.now() + 10_000;
  while (!privata && Date.now() < fine) {
    privata = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/barra.html?incognito=1'); } catch (_) { return false; } });
    if (!privata) await pausa(100);
  }
  expect(privata, 'la finestra incognito non ha la barra').toBeTruthy();
  await privata.waitForFunction(() => document.querySelectorAll('#nav .ico').length > 0, null, { timeout: 5000 });
  const ids = await privata.$$eval('#nav .ico', (els) => els.map((e) => e.dataset.id));
  expect(ids).toEqual(['back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab']);
  const { larga, chiusa } = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoIncognito);
    return { larga: w._filoTabs.barra.vista.getBounds().width, chiusa: w._filoTabs.barra._larghezzaChiusa() };
  });
  expect(larga).toBe(chiusa);
});

test('dentro la barra le icone si riordinano trascinandole, e l\'ordine resta', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
  const back = await barra.locator('#nav .ico[data-id="back"]').boundingBox();
  await barra.mouse.move(home.x + home.width / 2, home.y + home.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(home.x + home.width / 2 + 2, home.y - 10, { steps: 3 });
  await barra.mouse.move(back.x + back.width / 2, back.y + 4, { steps: 6 });
  await expect(barra.locator('#nav .segno')).toHaveCount(1);
  await barra.mouse.up();
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 2)).toEqual(['home', 'back']);
  await expect.poll(() => barra.$$eval('#nav .ico', (els) => els.map((e) => e.dataset.id).slice(0, 2))).toEqual(['home', 'back']);
  // Il clic che chiude il trascinamento non preme l'icona: la scheda resta dov'era.
  expect(await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId).url;
  })).not.toMatch(/^filo:\/\/newtab/);
});

test('finestra bassa e barra piena: il gruppo sfuma dove ci sono altre icone, e quella appena portata si vede', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setSize(900, 540));
  await pausa(400);
  for (const id of ['translate', 'screenshot', 'screenshotCrop', 'transcribe', 'share', 'saveForLater', 'qrCode', 'colorPicker', 'newTab']) {
    await app.evaluate(async (_, i) => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: i, target: 'bar' }, {}), id);
  }
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  // Non ci stanno tutte: sotto c'è altro, e il gruppo lo dice.
  await expect(barra.locator('#nav')).toHaveClass(/altre-sotto/);
  // L'ultima arriva in fondo, come la posa un trascinamento che cade sotto le icone visibili.
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'editorApp', target: 'bar' }, {}));
  await expect(barra.locator('#nav .ico[data-id="editorApp"]')).toHaveCount(1);
  await pausa(500);
  const dove = await barra.evaluate(() => {
    const n = document.getElementById('nav').getBoundingClientRect();
    const b = document.querySelector('#nav .ico[data-id="editorApp"]').getBoundingClientRect();
    return { dentro: b.top >= n.top - 1 && b.bottom <= n.bottom + 1 };
  });
  expect(dove.dentro, 'l\'icona appena portata sta nella parte visibile del gruppo').toBe(true);
  await expect(barra.locator('#nav')).toHaveClass(/altre-sopra/);
});

test('menu aperto vicino al bordo: riordinandolo la barra non gli va sopra; al bordo si apre e riceve l\'icona', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:12px 16px;font:16px sans-serif;height:1400px">
    <p id="p">Un paragrafo che comincia vicino al bordo sinistro.</p></body></html>`);
  const barra = await barraPage(app);
  await page.mouse.click(20, 24, { button: 'right' });
  const icona = page.locator('.sn-menu [data-sn-icon-id="share"]').first();
  await expect(icona).toBeVisible();
  const box = await icona.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 2, { steps: 4 });
  await pausa(400);
  expect(await aperta(app), 'sopra il menu la barra resta chiusa').toBe(false);
  // Al bordo, a sinistra del menu, la barra si apre e mira.
  await page.mouse.move(6, 200, { steps: 8 });
  await expect.poll(() => aperta(app)).toBe(true);
  await pannelloFermo(barra);
  await expect(barra.locator('#nav')).toHaveClass(/mira/);
  // Tornando sopra il menu si richiude, e di nuovo al bordo si riapre.
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 6 });
  await expect.poll(() => aperta(app)).toBe(false);
  await page.mouse.move(6, 200, { steps: 6 });
  await expect.poll(() => aperta(app)).toBe(true);
  await page.mouse.up();
  await expect.poll(async () => (await statoBarra(app)).bar).toContain('share');
});

test('a parole: Filo mette un\'icona del tasto destro nella barra e la toglie, come il trascinamento', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  const esegui = (azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);

  let r = await esegui({ type: 'SPOSTA_ICONA', icona: 'screenshot', dove: 'barra', prima_di: 'home' });
  expect(r.executed).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).bar).toEqual(['back', 'forward', 'reload', 'screenshot', 'home', 'incognito', 'fullscreen', 'closeTab']);
  await expect(barra.locator('#nav .ico[data-id="screenshot"]')).toHaveCount(1);
  // Il menu del tasto destro non ce l'ha più.
  await page.locator('#p').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu [data-sn-icon-id="screenshot"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  r = await esegui({ type: 'SPOSTA_ICONA', icona: 'closeTab', dove: 'altro' });
  expect(r.executed).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('closeTab');
  expect((await statoBarra(app)).secondary).toContain('closeTab');
  await expect(barra.locator('#nav .ico[data-id="closeTab"]')).toHaveCount(0);

  // Un'icona che non esiste o un posto che non c'è: niente cambia.
  const prima = await statoBarra(app);
  expect((await esegui({ type: 'SPOSTA_ICONA', icona: 'volante', dove: 'barra' })).executed).toBe(false);
  expect((await esegui({ type: 'SPOSTA_ICONA', icona: 'reload', dove: 'cassetto' })).executed).toBe(false);
  const dopo = await statoBarra(app);
  expect([dopo.bar, dopo.primary, dopo.secondary]).toEqual([prima.bar, prima.primary, prima.secondary]);
});
