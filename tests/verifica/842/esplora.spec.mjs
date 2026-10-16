// Verifica #842 giro 3: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statoDi } from '../../helpers/riquadri.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const PREFERENZE = 'filo://preferences/preferences.html';
const TESTO = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="testo">Una frase abbastanza lunga da poterla selezionare, spiegare e tradurre.</p>
  <input id="campo" value="">
  <script>window.__visti = []; addEventListener('keydown', (e) => { if (e.altKey || e.ctrlKey) window.__visti.push(e.key.toLowerCase()); }, true);</script>
</body></html>`;

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
const quanteSchede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.tabs.length);
const scelte = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).scorciatoie || {});
const chiedi = (app, v) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'scorciatoia', valore: x }, { sender: null }), v);
const tasti = (page, id) => page.locator(`#scorciatoieFilo .sc-riga[data-azione="${id}"] .sc-tasti`);
function seleziona(page, sel) {
  return page.evaluate((s) => { const r = document.createRange(); r.selectNodeContents(document.querySelector(s)); const g = getSelection(); g.removeAllRanges(); g.addRange(r); }, sel);
}

test('due cambi a parole di fila si tengono entrambi, e Preferenze aperta li segue', async ({ app, openTab }) => {
  const pref = await openTab(PREFERENZE);
  await expect(pref.locator('#scorciatoieFilo .sc-riga')).toHaveCount(4);
  expect((await chiedi(app, 'Spiega: Alt+Shift+E')).executed).toBe(true);
  expect((await chiedi(app, 'Traduci: Ctrl+Shift+Y')).executed).toBe(true);
  await expect.poll(() => scelte(app)).toMatchObject({ 'explain-selection': 'Alt+Shift+E', 'translate-selection': 'Ctrl+Shift+Y' });
  await expect(tasti(pref, 'explain-selection')).toHaveText('Alt+Shift+E');
  await expect(tasti(pref, 'translate-selection')).toHaveText('Ctrl+Shift+Y');
});

test('scambio: Traduci libera Alt+T, poi Spiega lo prende e Alt+T spiega', async ({ app, openTab, testServer }) => {
  expect((await chiedi(app, 'Spiega: Alt+T')).executed).toBe(false);
  expect((await chiedi(app, 'Traduci: Alt+Y')).executed).toBe(true);
  expect((await chiedi(app, 'Spiega: Alt+T')).executed).toBe(true);
  const page = await testServer.openReady(openTab, TESTO);
  await page.locator('#testo').click();
  await seleziona(page, '#testo');
  await premi(app, 'T', ['alt']);
  await expect.poll(() => titolo(app, page), { timeout: 8000 }).not.toBe('');
  const t1 = await titolo(app, page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await premi(app, 'E', ['alt']);
  await expect.poll(() => page.evaluate(() => window.__visti)).toContain('e');
  console.log('titolo con Alt+T dopo lo scambio:', t1);
  expect(t1).not.toBe('Traduzione');
});

test('una riga in ascolto lasciata con un clic altrove: Ctrl+T torna a aprire una scheda', async ({ app, openTab }) => {
  const pref = await openTab(PREFERENZE);
  await expect(pref.locator('#scorciatoieFilo .sc-riga')).toHaveCount(4);
  await tasti(pref, 'translate-selection').click();
  await expect(pref.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"]')).toHaveClass(/sc-registra/);
  await pref.locator('h1, h2').first().click();
  await expect(pref.locator('#scorciatoieFilo .sc-riga[data-azione="translate-selection"]')).not.toHaveClass(/sc-registra/);
  const prima = await quanteSchede(app);
  await premi(app, 'T', ['control']);
  await expect.poll(() => quanteSchede(app)).toBe(prima + 1);
});

test('aspetto: riga cambiata, Altro e menu in tema scuro', async ({ app, openTab, testServer }) => {
  mkdirSync(SHOTS, { recursive: true });
  expect((await chiedi(app, 'Aiuto: Ctrl+Shift+Y')).executed).toBe(true);
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }, { sender: null }));
  const altro = await openTab('filo://options/altro.html');
  await expect(altro.locator('#shortcutsList')).toContainText('Ctrl+Shift+Y — Aiuto');
  await altro.locator('#shortcutsList').scrollIntoViewIfNeeded();
  await altro.screenshot({ path: join(SHOTS, 'v842-altro-scuro.png') });
  const page = await testServer.openReady(openTab, TESTO);
  await page.locator('#testo').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'v842-menu-scuro.png') });
});
