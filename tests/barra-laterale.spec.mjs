// #871, #1246 — la barra laterale dal bordo sinistro: si apre spingendo sul bordo, dalla striscia, dalla
// maniglia e dalla scorciatoia; porta indietro/avanti/ricarica/home e le azioni sulla pagina che stavano in cima al
// tasto destro; le icone si riordinano e si mettono in «Altro…»; un sito non la comanda; a schermo intero resta.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi, puntatoreCheSegue, spostaIcone, apriAltro, iconaDellaBarra, menuAperto, scegliNelMenu } from './helpers/barra.mjs';
import { apriRedteamATutti } from './helpers/redteam.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

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
  await puntatoreCheSegue(app);
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
  // Aperta da tastiera prende il fuoco sulla prima icona che fa qualcosa: l'Aiuto, in cima (#1432).
  await expect.poll(() => barra.evaluate(() => document.activeElement && document.activeElement.dataset.id)).toBe('help');
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

const BARRA_DI_SERIE = ['help', 'back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab',
  'translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab'];
const idsIn = (barra, zona) => barra.$$eval(`#nav .ico[data-zona="${zona}"]`, (els) => els.map((e) => e.dataset.id));

test('#1246: le icone che stavano in cima al tasto destro sono nella barra, e il tasto destro non ne ha più', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await page.locator('#p').click({ button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
  await expect(menuDi(page).locator('[data-sn-icon-id]')).toHaveCount(0);
  await expect(menuDi(page).locator('.sn-menu-row')).toHaveCount(0);
  // Il menu comincia da una voce, non da una linea.
  expect(await menuDi(page).valuta(() => document.querySelector('.sn-menu:not(.sn-menu-sub)').firstElementChild.className))
    .not.toMatch(/sn-menu-sep/);
  await page.keyboard.press('Escape');

  const barra = await barraPage(app);
  expect(await idsIn(barra, 'bar')).toEqual(BARRA_DI_SERIE);
  // «Altro…» chiuso: le icone messe da parte non si vedono, la piega dice quante sono.
  expect(await idsIn(barra, 'secondary')).toEqual([]);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const piega = barra.locator('#nav .altro-tasto');
  await expect(piega).toHaveAttribute('aria-expanded', 'false');
  await expect(piega).toHaveAttribute('aria-label', /^Altro… \(5\)$/);
  await piega.click();
  await expect(piega).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => idsIn(barra, 'secondary')).toEqual(['openOptions', 'editorApp', 'screenshotCrop', 'transcribe', 'colorPicker']);
  await barra.screenshot({ path: 'tests/.shots/barra-icone-altro-aperto.png' });
  await piega.click();
  await expect.poll(() => idsIn(barra, 'secondary')).toEqual([]);
});

test('le azioni della pagina dalla barra agiscono sulla scheda in primo piano, anche quelle di «Altro…»', async ({ app, openTab, testServer }) => {
  const dietro = await testServer.openReady(openTab, SITO);
  const davanti = await testServer.openReady(openTab, SITO.replace('Pagina di prova', 'Davanti'));
  await expect.poll(() => davanti.evaluate(() => document.visibilityState)).toBe('visible');
  const qr = await iconaDellaBarra(app, 'qrCode');
  await expect(qr).toHaveAttribute('aria-label', 'QR code della pagina');
  await qr.click();
  // Il QR si apre nella pagina davanti, e la barra si è chiusa per lasciargliela.
  await expect(davanti.locator('.sn-qr-overlay')).toBeVisible();
  await expect(davanti.locator('.sn-qr-overlay')).toContainText(davanti.url().replace(/\/$/, '').slice(0, 30));
  await expect(dietro.locator('.sn-qr-overlay')).toHaveCount(0);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  // Un'icona di «Altro…» si preme allo stesso modo.
  await davanti.keyboard.press('Escape');
  const opzioni = await iconaDellaBarra(app, 'openOptions');
  await opzioni.click();
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://options/'); } catch (_) { return false; } })).toBe(true);
});

test('Condividi e il contagocce dalla barra: l\'indirizzo della pagina e il colore preso finiscono negli appunti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  await (await iconaDellaBarra(app, 'share')).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(page.url());

  // Il contagocce chiede un gesto vero: lo apre la barra, dove c'è il clic, e la pagina riceve solo il colore.
  const barra = await barraPage(app);
  await barra.evaluate(() => { window.EyeDropper = class { open() { return Promise.resolve({ sRGBHex: '#c45a3b' }); } }; });
  await (await iconaDellaBarra(app, 'colorPicker')).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('#C45A3B');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
});

test('sulla pagina «sito non raggiungibile» Condividi e il QR portano l\'indirizzo del sito, non quello dell\'errore (#1343)', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const voluto = 'http://127.0.0.1:9/';
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.navigate(w._filoTabs.activeId, u);
  }, voluto);
  let errore = null;
  await expect.poll(() => {
    errore = app.windows().find((w) => { try { return w.url().startsWith('filo://error/'); } catch (_) { return false; } }) || null;
    return !!errore;
  }, { timeout: 8000 }).toBe(true);
  await errore.waitForLoadState('domcontentloaded');
  await pausa(800);
  await app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
  await (await iconaDellaBarra(app, 'share')).click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(voluto);
  await (await iconaDellaBarra(app, 'qrCode')).click();
  await expect(errore.locator('.sn-qr-overlay')).toContainText(voluto);
  await errore.keyboard.press('Escape');
  await (await iconaDellaBarra(app, 'saveForLater')).click();
  await expect.poll(() => app.evaluate(async () => {
    const r = await globalThis.chrome.storage.local.get('savedPages');
    return (r.savedPages || []).map((p) => p.url);
  }), { timeout: 8000 }).toContain(voluto);
});

test('su un sito dove Filo è spento le azioni sulla pagina della barra si vedono spente e dicono perché (#1343)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const qr = await iconaDellaBarra(app, 'qrCode');
  await expect(qr).toHaveAttribute('aria-disabled', 'false');
  await comandaBarra(app, 'chiudi');
  await app.evaluate(async (_e, h) => globalThis.SN_HANDLE_MESSAGE(
    { type: 'update_settings', settings: { blocklist: [h] } }, { url: 'filo://preferences/preferences.html' }), new URL(page.url()).hostname);
  const spento = await iconaDellaBarra(app, 'qrCode');
  await expect(spento).toHaveAttribute('aria-disabled', 'true');
  await expect(spento).toHaveAttribute('data-sugg', /Filo è spento su questo sito/);
  // Le azioni sulla finestra restano accese.
  await expect((await barraPage(app)).locator('#nav .ico[data-id="reload"]')).toHaveAttribute('aria-disabled', 'false');
  // Riacceso, tornano.
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'update_settings', settings: { blocklist: [] } }, { url: 'filo://preferences/preferences.html' }));
  await expect(spento).toHaveAttribute('aria-disabled', 'false');
  await spento.click();
  await expect(page.locator('.sn-qr-overlay')).toBeVisible();
});

test('con «Altro…» aperto nessuna icona della barra ha lo stesso disegno di un\'altra (#1343)', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .altro-tasto').click();
  await expect(barra.locator('#nav .ico[data-zona="secondary"]').first()).toBeVisible();
  const doppie = await barra.evaluate(() => {
    const visti = new Map();
    const out = [];
    for (const b of document.querySelectorAll('#pannello .ico:not([hidden]):not(.altro-tasto)')) {
      const disegno = (b.querySelector('svg') || {}).innerHTML || '';
      if (!disegno) continue;
      const nome = b.getAttribute('aria-label') || b.dataset.id || '';
      if (visti.has(disegno)) out.push(`${visti.get(disegno)} = ${nome}`);
      else visti.set(disegno, nome);
    }
    return out;
  });
  expect(doppie).toEqual([]);
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
  // Un puntatore finto che si ferma contro il bordo sinistro.
  const prima = (await statoBarra(app)).bar;
  await page.evaluate(() => {
    const opts = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, isPrimary: true });
    for (let i = 1; i <= 20; i++) document.dispatchEvent(new PointerEvent('pointermove', opts(200 - i * 10, 200)));
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
  await puntatoreCheSegue(app);
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
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://quaderno/'); } catch (_) { return false; } })).toBe(true);
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

test('trascino «Screenshot» in «Altro…» e poi di nuovo nella barra: ogni posa resta dopo il riavvio', async () => {
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
  const centro = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  try {
    let { app, shell } = await avvia();
    await apriSito(app, shell, 1);
    let barra = await barraPage(app);
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    // Trascinata sulla piega chiusa, «Altro…» si apre da solo; posata sopra «Opzioni Filo», ci resta davanti.
    const da = centro(await barra.locator('#nav .ico[data-id="screenshot"]').boundingBox());
    const piega = centro(await barra.locator('#nav .altro-tasto').boundingBox());
    await barra.mouse.move(da.x, da.y);
    await barra.mouse.down();
    await barra.mouse.move(da.x + 2, da.y + 10, { steps: 3 });
    await barra.mouse.move(piega.x, piega.y + 14, { steps: 8 });
    await expect(barra.locator('#nav .altro-tasto')).toHaveAttribute('aria-expanded', 'true');
    const opzioni = await barra.locator('#nav .ico[data-id="openOptions"]').boundingBox();
    await barra.mouse.move(opzioni.x + opzioni.width / 2, opzioni.y + 4, { steps: 6 });
    await expect(barra.locator('#nav .segno')).toHaveCount(1);
    await barra.mouse.up();
    await expect.poll(async () => (await statoBarra(app)).secondary[0]).toBe('screenshot');
    expect((await statoBarra(app)).bar).not.toContain('screenshot');
    await expect.poll(() => idsIn(barra, 'secondary')).toContain('screenshot');
    await chiudiApp(app);

    ({ app, shell } = await avvia());
    await apriSito(app, shell, 2);
    barra = await barraPage(app);
    await expect.poll(async () => (await statoBarra(app)).secondary[0]).toBe('screenshot');
    expect((await statoBarra(app)).bar).not.toContain('screenshot');

    // Da «Altro…» di nuovo nella barra, davanti a Home.
    await comandaBarra(app, 'clic');
    await apriAltro(app, true);
    await pannelloFermo(barra);
    const via = centro(await barra.locator('#nav .ico[data-id="screenshot"]').boundingBox());
    const home = await barra.locator('#nav .ico[data-id="home"]').boundingBox();
    await barra.mouse.move(via.x, via.y);
    await barra.mouse.down();
    await barra.mouse.move(via.x + 2, via.y - 10, { steps: 3 });
    await barra.mouse.move(home.x + home.width / 2, home.y + 4, { steps: 10 });
    await barra.mouse.up();
    await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 6)).toEqual(['help', 'back', 'forward', 'reload', 'screenshot', 'home']);
    expect((await statoBarra(app)).secondary).not.toContain('screenshot');
    await chiudiApp(app);
  } finally {
    try { server.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

test('col tasto destro un\'icona va in «Altro…», e da lì torna in vista', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="incognito"]').click({ button: 'right' });
  let menu = await menuAperto(app);
  expect(menu, 'il menu della voce non si è aperto').toBeTruthy();
  await scegliNelMenu(menu, 'Metti in «Altro…»');
  await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('incognito');
  expect((await statoBarra(app)).secondary).toContain('incognito');
  await expect(barra.locator('#nav .ico[data-id="incognito"]')).toHaveCount(0);

  await apriAltro(app, true);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="incognito"]').click({ button: 'right' });
  menu = await menuAperto(app);
  await scegliNelMenu(menu, 'Porta in vista nella barra');
  await expect.poll(async () => (await statoBarra(app)).bar.at(-1)).toBe('incognito');
  expect((await statoBarra(app)).secondary).not.toContain('incognito');
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
  await puntatoreCheSegue(app);
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

test('un\'icona trascinata fuori dalla barra, sopra la pagina, non cade da nessuna parte', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const prima = await statoBarra(app);
  const b = await barra.locator('#nav .ico[data-id="share"]').boundingBox();
  await barra.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(b.x + 20, b.y + 6, { steps: 3 });
  await barra.mouse.move(400, b.y + 6, { steps: 8 });
  await expect(barra.locator('.fantasma.fuori')).toHaveCount(1);
  await expect(barra.locator('#nav .segno')).toHaveCount(0);
  await barra.mouse.up();
  await pausa(300);
  const dopo = await statoBarra(app);
  expect([dopo.bar, dopo.secondary]).toEqual([prima.bar, prima.secondary]);
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
  expect(await idsIn(privata, 'bar')).toEqual(BARRA_DI_SERIE);
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
  // Sopra di loro resta l'Aiuto, che per partenza sta in cima (#1432).
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 3)).toEqual(['help', 'home', 'back']);
  await expect.poll(() => barra.$$eval('#nav .ico', (els) => els.map((e) => e.dataset.id).slice(0, 3))).toEqual(['help', 'home', 'back']);
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
  await spostaIcone(app, ['screenshotCrop', 'transcribe', 'colorPicker', 'openOptions'], 'bar');
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  // Non ci stanno tutte: sotto c'è altro, e il gruppo lo dice.
  await expect(barra.locator('#nav')).toHaveClass(/altre-sotto/);
  // L'ultima arriva in fondo, come la posa un trascinamento che cade sotto le icone visibili.
  await spostaIcone(app, ['editorApp'], 'bar');
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

test('a parole: Filo mette un\'icona di «Altro…» nella barra e la toglie, come il trascinamento', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  const esegui = (azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);

  let r = await esegui({ type: 'SPOSTA_ICONA', icona: 'transcribe', dove: 'barra', prima_di: 'home' });
  expect(r.executed).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).bar.slice(0, 6)).toEqual(['help', 'back', 'forward', 'reload', 'transcribe', 'home']);
  expect((await statoBarra(app)).secondary).not.toContain('transcribe');
  await expect(barra.locator('#nav .ico[data-zona="bar"][data-id="transcribe"]')).toHaveCount(1);

  r = await esegui({ type: 'SPOSTA_ICONA', icona: 'closeTab', dove: 'altro' });
  expect(r.executed).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).bar).not.toContain('closeTab');
  expect((await statoBarra(app)).secondary).toContain('closeTab');
  await expect(barra.locator('#nav .ico[data-id="closeTab"]')).toHaveCount(0);

  // Un'icona che non esiste o un posto che non c'è: niente cambia.
  const prima = await statoBarra(app);
  expect((await esegui({ type: 'SPOSTA_ICONA', icona: 'volante', dove: 'barra' })).executed).toBe(false);
  expect((await esegui({ type: 'SPOSTA_ICONA', icona: 'reload', dove: 'cassetto' })).executed).toBe(false);
  // Il menu del tasto destro non ha più una riga di icone in cui metterla.
  expect((await esegui({ type: 'SPOSTA_ICONA', icona: 'reload', dove: 'menu' })).executed).toBe(false);
  const dopo = await statoBarra(app);
  expect([dopo.bar, dopo.primary, dopo.secondary]).toEqual([prima.bar, prima.primary, prima.secondary]);
});
