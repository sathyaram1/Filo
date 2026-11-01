// #1431 — il lucchetto della barra laterale: bloccata resta aperta e spinge la pagina, la scelta resta dopo il riavvio,
// e si cambia dal lucchetto, dal tasto destro, dalla scorciatoia, dalle Preferenze e a parole (#1292: da ogni chat).

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi, menuAperto, vociDelMenu, scegliNelMenu } from './helpers/barra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <h1 id="h">Pagina</h1><p>Testo.</p><script>window.esc = 0; addEventListener('keydown', (e) => { if (e.key === 'Escape') window.esc++; });</script></body></html>`;

// Dove sta la pagina davanti, e se il lucchetto è scritto nelle impostazioni.
const pagina = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t.view.getBounds();
});
const finestraIntera = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).isFullScreen());
const bloccata = (app) => app.evaluate(async () => !!(await globalThis.SN_STORAGE.getSettings()).barraLaterale?.bloccata);

test('il lucchetto tiene aperta la barra e spinge la pagina; il mouse, i clic e l\'Esc sulla pagina non la chiudono, il tasto sì', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  expect((await pagina(app)).x).toBe(0);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const lucchetto = barra.locator('#testa .lucchetto');
  await expect(lucchetto).toHaveAttribute('aria-pressed', 'false');
  await expect(lucchetto).toHaveAttribute('aria-label', 'Tieni aperta accanto alla pagina');
  await lucchetto.click();

  await expect.poll(() => bloccata(app)).toBe(true);
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
  await expect(lucchetto).toHaveAttribute('aria-pressed', 'true');
  await expect(barra.locator('html.accanto')).toHaveCount(1);
  // Accanto alla pagina la vista finisce dove lei comincia: niente ombra sopra il testo.
  expect((await statoBarra(app)).bounds.width).toBe(56);
  const larga = (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).getContentSize()[0]));
  expect((await pagina(app)).width).toBe(larga - 56);

  // Il puntatore va sulla pagina, ci clicca, preme Esc: la barra resta, e l'Esc arriva alla pagina.
  await barra.mouse.move(30, 300);
  await page.mouse.move(400, 300);
  await page.mouse.move(420, 320);
  await pausa(700);
  await page.mouse.click(420, 320);
  await premi(app, 'scheda', 'Escape');
  await pausa(400);
  expect((await statoBarra(app)).aperta).toBe(true);
  expect((await pagina(app)).x).toBe(56);
  await expect.poll(() => page.evaluate(() => window.esc)).toBeGreaterThan(0);

  // Il tasto la chiude anche bloccata, e la pagina torna larga; riaperta, spinge di nuovo.
  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  await expect.poll(async () => (await pagina(app)).x).toBe(0);
  expect(await bloccata(app)).toBe(true);
  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
  // Aperta da tastiera e bloccata: Esc rende la tastiera alla pagina e la barra resta.
  await premi(app, 'barra', 'Escape');
  await pausa(300);
  expect((await statoBarra(app)).aperta).toBe(true);
  expect((await statoBarra(app)).motivo).toBe('bloccata');

  // Sbloccata col puntatore sopra resta finché lui c'è; la pagina torna larga subito.
  await lucchetto.click();
  await expect.poll(() => bloccata(app)).toBe(false);
  await expect.poll(async () => (await pagina(app)).x).toBe(0);
  await expect(lucchetto).toHaveAttribute('aria-pressed', 'false');
  expect((await statoBarra(app)).aperta).toBe(true);

  // Due clic di fila: bloccata e di nuovo sbloccata, non due volte la stessa scelta.
  await lucchetto.click();
  await lucchetto.click();
  await pausa(400);
  expect(await bloccata(app)).toBe(false);
  expect((await pagina(app)).x).toBe(0);
});

test('dal tasto destro, dalla scorciatoia e dalle Preferenze: la stessa impostazione', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);

  // Tasto destro sulla striscia.
  await barra.locator('#striscia').click({ button: 'right', position: { x: 1, y: 200 } });
  let menu = await menuAperto(app);
  expect(await vociDelMenu(menu)).toContain('Tieni aperta la barra laterale');
  await scegliNelMenu(menu, 'Tieni aperta la barra laterale');
  await expect.poll(() => bloccata(app)).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await expect.poll(async () => (await pagina(app)).x).toBe(56);

  // Tasto destro sul lucchetto: le stesse voci, a barra aperta «Chiudi».
  await pannelloFermo(barra);
  await barra.locator('#testa .lucchetto').click({ button: 'right' });
  menu = await menuAperto(app);
  const voci = await vociDelMenu(menu);
  expect(voci).toContain('Sblocca la barra laterale');
  expect(voci).toContain('Chiudi la barra laterale');
  await scegliNelMenu(menu, 'Sblocca la barra laterale');
  await expect.poll(() => bloccata(app)).toBe(false);
  await expect.poll(async () => (await pagina(app)).x).toBe(0);

  // La scorciatoia del lucchetto, da qualunque vista; Cmd come su Mac.
  await premi(app, 'scheda', 'B', ['control', 'alt', 'shift']);
  await expect.poll(() => bloccata(app)).toBe(true);
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
  await premi(app, 'shell', 'B', ['meta', 'alt', 'shift']);
  await expect.poll(() => bloccata(app)).toBe(false);

  // Preferenze → Avanzate.
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForSelector('#barraBloccata', { timeout: 8000 });
  await expect(pref.locator('#barraBloccata')).not.toBeChecked();
  await pref.locator('#barraBloccata').check();
  await expect.poll(() => bloccata(app)).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
  // Cambiata altrove, la casella lo dice.
  await premi(app, 'scheda', 'B', ['control', 'alt', 'shift']);
  await expect.poll(() => bloccata(app)).toBe(false);
  await expect(pref.locator('#barraBloccata')).not.toBeChecked();
});

test('a parole, dalla home e dall\'Aiuto: apri, chiudi, blocca e sblocca', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  await barraPage(app);
  const chat = (comando) => app.evaluate((_e, c) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'COMANDO_FINESTRA', comando: c }), comando);

  expect((await chat('sidebar_lock')).executed).toBe(true);
  await expect.poll(() => bloccata(app)).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
  // Chiudere vale anche bloccata; chiederla bloccata di nuovo la riapre.
  expect((await chat('sidebar_close')).executed).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  await expect.poll(async () => (await pagina(app)).x).toBe(0);
  await chat('sidebar_lock');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await chat('sidebar_unlock');
  await expect.poll(() => bloccata(app)).toBe(false);
  await expect.poll(async () => (await pagina(app)).x).toBe(0);
  await chat('sidebar');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await chat('sidebar_close');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);

  // La stessa impostazione dalla chiave delle Preferenze a parole.
  const built = await app.evaluate(async () => {
    const b = globalThis.SN_PREF.buildPreferencePartial('tieni aperta la barra', 'sì');
    await globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: b.partial }, { url: 'filo://preferences/preferences.html' });
    return b.label;
  });
  expect(built).toMatch(/bloccata aperta/);
  await expect.poll(async () => (await pagina(app)).x).toBe(56);

  // L'Aiuto: lo stesso comando, dalla sua azione «shell» (lo stesso ponte del content script).
  const aiuto = (command) => shell.evaluate((c) => window.filoShell.message({ type: 'shell_action', command: c, assistente: true }), command);
  expect((await aiuto('sidebar_unlock')).ok).toBe(true);
  await expect.poll(() => bloccata(app)).toBe(false);
  expect((await aiuto('sidebar_close')).ok).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  expect((await aiuto('sidebar')).ok).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  expect((await aiuto('sidebar_lock')).ok).toBe(true);
  await expect.poll(() => bloccata(app)).toBe(true);
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
});

test('a tutto schermo bloccata vale da sbloccata: si chiude e la pagina prende tutto; uscendo torna accanto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  await barraPage(app);
  await app.evaluate((_e) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'COMANDO_FINESTRA', comando: 'sidebar_lock' }));
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
  // Il puntatore sulla pagina: quello vero dello schermo virtuale può essere rimasto sul bordo, sopra la barra.
  await page.mouse.move(600, 300);
  await page.mouse.move(610, 305);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(true));
  await expect.poll(async () => (await statoBarra(app)).schermoIntero).toBe(true);
  // Lo schermo intero del sistema arriva dopo: uscirne prima lo farebbe rientrare quando arriva.
  await expect.poll(() => finestraIntera(app), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  expect((await pagina(app)).x).toBe(0);
  // Il tasto la apre sopra la pagina, che non si sposta.
  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  expect((await pagina(app)).x).toBe(0);
  await comandaBarra(app, 'chiudi');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.setContentFullscreen(false));
  await expect.poll(() => finestraIntera(app), { timeout: 10_000 }).toBe(false);
  await expect.poll(async () => (await statoBarra(app)).schermoIntero).toBe(false);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await expect.poll(async () => (await pagina(app)).x).toBe(56);
});

test('bloccata resta bloccata dopo il riavvio: si apre da sola accanto alla pagina', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-lucchetto-');
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
  try {
    let { app } = await avvia();
    await barraPage(app);
    // Appena avviato, le azioni di Filo arrivano un attimo dopo la finestra.
    await expect.poll(() => app.evaluate(() => typeof globalThis.SN_EXECUTE_FILO_ACTION), { timeout: 15_000 }).toBe('function');
    await app.evaluate((_e) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'COMANDO_FINESTRA', comando: 'sidebar_lock' }));
    await expect.poll(() => bloccata(app)).toBe(true);
    await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
    await chiudiApp(app);

    // Bloccata, la barra nasce già all'avvio, e la prima pagina che si annuncia può essere la sua: la scheda si apre dal main.
    ({ app } = await avvia());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)), { timeout: 15_000 }).toBe(true);
    await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.openTab(u), `${indirizzo}?giro=2`);
    const barra = await barraPage(app);
    await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await pagina(app)).x, { timeout: 10_000 }).toBe(56);
    await expect(barra.locator('html.accanto')).toHaveCount(1);
    await expect(barra.locator('#testa .lucchetto')).toHaveAttribute('aria-pressed', 'true');
    await chiudiApp(app);
  } finally {
    try { server.close(); } catch (_) {}
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
