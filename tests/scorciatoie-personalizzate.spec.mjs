// #842 — Spiega, Traduci, Salva per dopo e Aiuto si cambiano: in Preferenze premendo i tasti nuovi, o chiedendolo a
// Filo. I tasti arrivano come quelli veri (sendInputEvent sul webContents a fuoco), quindi passano dal main come una
// pressione dell'utente: è lì che una scorciatoia vecchia o presa farebbe la cosa sbagliata.

import { test, expect, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paginaDellAiuto, statoDi } from './helpers/riquadri.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { apriImpostazioni, strumentiSalvati } from './helpers/strumentiEditor.mjs';

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
  mkdirSync(SHOTS, { recursive: true });
  await page.locator('#sec-scorciatoie').scrollIntoViewIfNeeded();
  await page.locator('#sec-scorciatoie').screenshot({ path: join(SHOTS, 'preferenze-scorciatoie-rifiuto.png') });
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

  await page.locator('#sec-scorciatoie').screenshot({ path: join(SHOTS, 'preferenze-scorciatoie.png') });
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }, { sender: null }));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
  await page.locator('#sec-scorciatoie').screenshot({ path: join(SHOTS, 'preferenze-scorciatoie-scuro.png') });
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'chiaro' }, { sender: null }));

  // Esc lascia quella di prima.
  await tastiDellaRiga(page, 'explain-selection').click();
  await premi(app, 'Escape');
  await expect(tastiDellaRiga(page, 'explain-selection')).toHaveText('Alt+E');

  // Tasto destro sulla riga: cambiarla e rimetterla, come i tasti della riga.
  await tastiDellaRiga(page, 'translate-selection').click({ button: 'right' });
  const voci = menuDi(page).locator('.sn-menu .sn-menu-item');
  await expect(voci.filter({ hasText: 'Cambia la scorciatoia di «Traduci»' })).toHaveCount(1);
  await voci.filter({ hasText: 'Rimetti Alt+T' }).click();
  await expect(tastiDellaRiga(page, 'translate-selection')).toHaveText('Alt+T');
  await expect.poll(async () => (await scelte(app))['translate-selection']).toBe('');

  // ↺ e «Ripristina i tasti di serie».
  expect((await chiedi(app, 'Aiuto: Alt+Shift+K')).executed).toBe(true);
  await expect(tastiDellaRiga(page, 'open-help-sidebar')).toHaveText('Alt+Shift+K');
  await page.locator('#scorciatoieFilo .sc-riga[data-azione="open-help-sidebar"] .sc-ripristina').click();
  await expect(tastiDellaRiga(page, 'open-help-sidebar')).toHaveText('Alt+H');
  expect((await chiedi(app, 'Spiega: Alt+Shift+E')).executed).toBe(true);
  await expect(tastiDellaRiga(page, 'explain-selection')).toHaveText('Alt+Shift+E');
  await page.locator('#scorciatoieRipristina').click();
  await expect(tastiDellaRiga(page, 'explain-selection')).toHaveText('Alt+E');
  await expect.poll(async () => Object.values(await scelte(app)).filter(Boolean)).toEqual([]);
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
  const menu = menuDi(page).locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-shortcut', { hasText: 'Alt+Shift+K' })).toHaveCount(1);
  await expect(menu.locator('.sn-menu-shortcut', { hasText: /^Alt\+H$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await premi(app, 'K', ['alt', 'shift']);
  await expect((await paginaDellAiuto(app, page)).locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });

  // «Rimetti di serie» chiesto a Filo: Alt+H torna di Filo.
  expect((await chiedi(app, 'tutte di serie')).executed).toBe(true);
  await expect(altro.locator('#shortcutsList')).toContainText('Alt+H — Aiuto');
});

test('la scorciatoia scelta resta dopo aver chiuso e riaperto Filo', async ({ testServer }) => {
  const userData = cartellaTemporanea('filo-scorciatoie-');
  const lancia = async () => {
    const app = await electron.launch({
      args: [...argomentiScala, '.'], cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
    });
    const shell = await primaFinestra(app);
    return { app, shell };
  };
  const apri = async ({ app, shell }) => {
    const url = testServer.html(TESTO);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    await expect.poll(() => {
      page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } }) || null;
      return !!page;
    }, { timeout: 20_000 }).toBe(true);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 20_000 });
    return page;
  };
  let filo = await lancia();
  try {
    await expect.poll(() => filo.app.evaluate(() => typeof globalThis.SN_EXECUTE_FILO_ACTION)).toBe('function');
    expect((await chiedi(filo.app, 'Traduci: Ctrl+Shift+Y')).executed).toBe(true);
    await expect.poll(async () => (await scelte(filo.app))['translate-selection']).toBe('Ctrl+Shift+Y');
  } finally {
    await filo.app.close();
  }
  filo = await lancia();
  try {
    const page = await apri(filo);
    await page.locator('#testo').click();
    await seleziona(page, '#testo');
    await premi(filo.app, 'T', ['alt']);
    await expect.poll(() => page.evaluate(() => window.__visti)).toContain('t');
    await premi(filo.app, 'Y', ['control', 'shift']);
    await expect.poll(() => titolo(filo.app, page), { timeout: 8000 }).toBe('Traduzione');
  } finally {
    await filo.app.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});

// Verifica #842: la combinazione di uno strumento dell'Editor non va a una delle quattro, che la prenderebbero prima
// dello strumento; e gli strumenti rifiutano il microfono delle chat come le quattro. Gli strumenti stanno nel pannello
// di destra e le loro scorciatoie nel main (#1433).
test('una combinazione già data a uno strumento dell\'Editor si rifiuta per Traduci, a parole e in Preferenze', async ({ app, openTab }) => {
  const editor = await openTab('filo://editor/editor.html');
  await expect(editor.locator('#doc')).toBeVisible();
  await apriImpostazioni(editor, 'word-count');
  await editor.fill('#cfgShortcut', 'Ctrl+Shift+Spazio');
  await editor.click('#cfgSave');
  await expect(editor.locator('#cfgShortcutTaken')).toContainText('microfono');
  await editor.fill('#cfgShortcut', 'Ctrl+Shift+Y');
  await editor.click('#cfgSave');
  await expect(editor.locator('#overlay')).toBeHidden();
  await expect.poll(async () => ((await strumentiSalvati(app))?.config?.['word-count'] || {}).shortcut).toBe('Ctrl+Shift+Y');

  const r = await chiedi(app, 'Traduci: Ctrl+Shift+Y');
  expect(r.executed).toBe(false);
  expect(r.output.error).toContain('fra gli strumenti dell\'Editor');

  await editor.click('#doc');
  await premi(app, 'Y', ['control', 'shift']);
  await expect(editor.locator('#overlay')).toBeVisible();
  await editor.keyboard.press('Escape');

  const pref = await openTab(PREFERENZE);
  await tastiDellaRiga(pref, 'translate-selection').click();
  await premi(app, 'Y', ['control', 'shift']);
  const errore = pref.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"] .sc-errore');
  await expect(errore).toContainText('fra gli strumenti dell\'Editor');
  expect((await scelte(app))['translate-selection'] || '').toBe('');
});
