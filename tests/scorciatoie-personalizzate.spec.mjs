// #842 — Spiega, Traduci, Salva per dopo e Aiuto si cambiano: in Preferenze premendo i tasti nuovi, o chiedendolo a
// Filo. I tasti arrivano come quelli veri (sendInputEvent sul webContents a fuoco), quindi passano dal main come una
// pressione dell'utente: è lì che una scorciatoia vecchia o presa farebbe la cosa sbagliata.

import { test, expect, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statoDi } from './helpers/riquadri.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const PREFERENZE = 'filo://preferences/preferences.html';

const TESTO = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="testo">Una frase abbastanza lunga da poterla selezionare, spiegare e tradurre.</p>
  <script>
    window.__visti = [];
    addEventListener('keydown', (e) => { if (e.altKey || e.ctrlKey) window.__visti.push(e.key.toLowerCase()); }, true);
  </script>
</body></html>`;

// Sui siti il riquadro sta in uno shadow root chiuso (#1071): il titolo si legge dal mondo dei content script.
const titolo = async (app, page) => (await statoDi(app, page, '.sn-popup .sn-popup-title'))?.testo || '';

function premi(app, keyCode, modifiers = []) {
  return app.evaluate(({ BrowserWindow }, o) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = t.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: o.keyCode, modifiers: o.modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: o.keyCode, modifiers: o.modifiers });
  }, { keyCode, modifiers });
}

const quanteSchede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w._filoTabs.tabs.length;
});

const scelte = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).scorciatoie || {});

const chiedi = (app, valore) => app.evaluate((_e, v) => globalThis.SN_EXECUTE_FILO_ACTION(
  { type: 'IMPOSTA_PREFERENZA', chiave: 'scorciatoia', valore: v }, { sender: null }), valore);

function seleziona(page, selettore) {
  return page.evaluate((sel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(sel));
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selettore);
}

const tastiDellaRiga = (page, id) => page.locator(`#scorciatoieFilo .sc-riga[data-azione="${id}"] .sc-tasti`);

test('in Preferenze Traduci si cambia premendo i tasti; un tasto preso o di un\'altra azione si rifiuta col motivo', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await expect(page.locator('#scorciatoieFilo .sc-riga')).toHaveCount(4);
  await expect(tastiDellaRiga(page, 'translate-selection')).toHaveText('Alt+T');
  const schedePrima = await quanteSchede(app);

  const riga = page.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"]');
  await tastiDellaRiga(page, 'translate-selection').click();
  await expect(riga).toHaveClass(/sc-registra/);
  await expect(tastiDellaRiga(page, 'translate-selection')).toHaveText('Premi i tasti…');
  // L'ascolto lo sa anche il main, che allora lascia arrivare alla pagina i tasti che prende per sé.
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return (t.view.webContents._filoRegistraTastiFino || 0) > Date.now();
  })).toBe(true);

  const errore = riga.locator('.sc-errore');
  // Ctrl+T non apre una scheda: dice perché non si può.
  await premi(app, 'T', ['control']);
  await expect(errore).toContainText('apre una scheda nuova');
  // #545.5: con Shift è lo stesso tasto della shell.
  await premi(app, 'T', ['control', 'shift']);
  await expect(errore).toContainText('Ctrl+Shift+T');
  await premi(app, 'E', ['alt']);
  await expect(errore).toContainText('«Spiega»');
  await premi(app, 'Y');
  await expect(errore).toContainText('Ctrl o Alt');
  expect(await quanteSchede(app)).toBe(schedePrima);
  expect((await scelte(app))['translate-selection'] || '').toBe('');

  await premi(app, 'Y', ['control', 'shift']);
  await expect(tastiDellaRiga(page, 'translate-selection')).toHaveText('Ctrl+Shift+Y');
  await expect(riga).toHaveClass(/sc-cambiata/);
  await expect(riga).not.toHaveClass(/sc-registra/);
  await expect(errore).toBeHidden();
  await expect.poll(async () => (await scelte(app))['translate-selection']).toBe('Ctrl+Shift+Y');
  // Finito l'ascolto, il main torna a prendersi i suoi tasti.
  expect(await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return (t.view.webContents._filoRegistraTastiFino || 0) > Date.now();
  })).toBe(false);

  mkdirSync(SHOTS, { recursive: true });
  await page.locator('#sec-scorciatoie').scrollIntoViewIfNeeded();
  await page.locator('#sec-scorciatoie').screenshot({ path: join(SHOTS, 'preferenze-scorciatoie.png') });

  // Esc lascia quella di prima.
  await tastiDellaRiga(page, 'explain-selection').click();
  await premi(app, 'Escape');
  await expect(tastiDellaRiga(page, 'explain-selection')).toHaveText('Alt+E');

  // ↺ la rimette com'era.
  await riga.locator('.sc-ripristina').click();
  await expect(tastiDellaRiga(page, 'translate-selection')).toHaveText('Alt+T');
  await expect.poll(async () => (await scelte(app))['translate-selection']).toBe('');
});

test('cambiata Traduci, la nuova funziona su un sito e su una pagina interna e la vecchia arriva alla pagina', async ({ app, openTab, testServer }) => {
  const r = await chiedi(app, 'Traduci: Ctrl+Maiusc+Y');
  expect(r.executed).toBe(true);

  const page = await testServer.openReady(openTab, TESTO);
  await page.locator('#testo').click();
  await seleziona(page, '#testo');
  await premi(app, 'T', ['alt']);
  // La vecchia non è più di Filo: la vede la pagina, e la traduzione non parte.
  await expect.poll(() => page.evaluate(() => window.__visti)).toContain('t');
  await page.waitForTimeout(800);
  expect(await titolo(app, page)).toBe('');

  await premi(app, 'Y', ['control', 'shift']);
  await expect.poll(() => titolo(app, page), { timeout: 8000 }).toBe('Traduzione');
  expect(await page.evaluate(() => window.__visti)).not.toContain('y');

  const interna = await openTab('filo://options/altro.html');
  await interna.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8000 });
  await expect(interna.locator('#shortcutsList')).toContainText('Ctrl+Shift+Y — Traduci');
  await expect(interna.locator('#shortcutsList')).not.toContainText('Fase 2');
  await seleziona(interna, '#h-blocklist');
  await premi(app, 'Y', ['control', 'shift']);
  await expect.poll(() => titolo(app, interna), { timeout: 8000 }).toBe('Traduzione');
});

test('il menu del tasto destro e Altro dicono il tasto scelto; un tasto preso chiesto a Filo si rifiuta', async ({ app, openTab, testServer }) => {
  const rifiutata = await chiedi(app, 'Aiuto: Ctrl+T');
  expect(rifiutata.executed).toBe(false);
  expect(rifiutata.output.error).toContain('apre una scheda nuova');

  const altro = await openTab('filo://options/altro.html');
  await expect(altro.locator('#shortcutsList')).toContainText('Alt+H — Aiuto');

  expect((await chiedi(app, 'Aiuto: Alt+Shift+K')).executed).toBe(true);
  // Altro, già aperta, segue il cambio.
  await expect(altro.locator('#shortcutsList')).toContainText('Alt+Shift+K — Aiuto');

  const page = await testServer.openReady(openTab, TESTO);
  await page.locator('#testo').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-shortcut', { hasText: 'Alt+Shift+K' })).toHaveCount(1);
  await expect(menu.locator('.sn-menu-shortcut', { hasText: /^Alt\+H$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await premi(app, 'K', ['alt', 'shift']);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });

  // «Rimetti di serie» chiesto a Filo: Alt+H torna di Filo.
  expect((await chiedi(app, 'tutte di serie')).executed).toBe(true);
  await expect(altro.locator('#shortcutsList')).toContainText('Alt+H — Aiuto');
});

test('la scorciatoia scelta resta dopo aver chiuso e riaperto Filo', async () => {
  const userData = cartellaTemporanea('filo-scorciatoie-');
  const lancia = async () => {
    const app = await electron.launch({
      args: [...argomentiScala, '.'], cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
    });
    await primaFinestra(app);
    return app;
  };
  let app = await lancia();
  try {
    await expect.poll(() => app.evaluate(() => typeof globalThis.SN_EXECUTE_FILO_ACTION)).toBe('function');
    expect((await chiedi(app, 'Traduci: Ctrl+Shift+Y')).executed).toBe(true);
    await expect.poll(async () => (await scelte(app))['translate-selection']).toBe('Ctrl+Shift+Y');
  } finally {
    await app.close();
  }
  app = await lancia();
  try {
    // Al riavvio il main ascolta la scelta salvata, prima di qualunque visita alle Preferenze.
    const ascolta = await app.evaluate(() => {
      const { comandoDaTasto } = require(require('node:path').join(process.cwd(), 'src', 'main', 'shortcuts.js'));
      const p = (key, mods) => ({ type: 'keyDown', key, code: `Key${key.toUpperCase()}`, alt: false, control: false, meta: false, shift: false, ...mods });
      return {
        nuova: comandoDaTasto(p('Y', { control: true, shift: true }), 'win32'),
        vecchia: comandoDaTasto(p('t', { alt: true }), 'win32'),
      };
    });
    expect(ascolta).toEqual({ nuova: 'translate-selection', vecchia: null });
  } finally {
    await app.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
