// Verifica #1618, giro 3: i gesti veri dell'utente fuori dal clic e dalla rotella tengono sveglio l'orologio della
// pulizia, e l'avviso di un giudizio mancato si legge in tema chiaro e scuro.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const ORA = 3600_000;

const pagina = (titolo, corpo = '') => `<!doctype html><html><head><title>${titolo}</title></head>`
  + `<body style="margin:0"><p>Testo di ${titolo}</p><input id="campo"><div style="height:4000px"></div>${corpo}</body></html>`;

const tm = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs._lastAppInteractionAt);
const indietro = (app, ms) => app.evaluate(({ BrowserWindow }, ms) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  t._lastAppInteractionAt = Date.now() - ms;
  for (const x of t.tabs) x.lastInteractionAt = Date.now() - ms;
  return t._lastAppInteractionAt;
}, ms);

test('la tastiera nella pagina e un clic nella barra delle schede contano come uso di Filo', async ({ app, openTab, testServer, shell }) => {
  const p = await testServer.openReady(openTab, pagina('Tasti'));
  await p.waitForTimeout(2200);
  let prima = await indietro(app, 7 * ORA);
  await p.bringToFront().catch(() => {});
  await p.keyboard.press('PageDown');
  await expect.poll(() => tm(app), { timeout: 5_000, message: 'PagGiù nella pagina non ha contato' }).toBeGreaterThan(prima + 6 * ORA);

  await p.waitForTimeout(2200);
  prima = await indietro(app, 7 * ORA);
  await p.click('#campo');
  await p.waitForTimeout(2200);
  prima = await indietro(app, 7 * ORA);
  await p.keyboard.type('ciao');
  await expect.poll(() => tm(app), { timeout: 5_000, message: 'scrivere in un campo non ha contato' }).toBeGreaterThan(prima + 6 * ORA);

  prima = await indietro(app, 7 * ORA);
  await shell.mouse.click(5, 5);
  await expect.poll(() => tm(app), { timeout: 5_000, message: 'un clic sulla barra non ha contato' }).toBeGreaterThan(prima + 6 * ORA);
});

test('l’avviso della pulizia senza giudizio si legge in tema chiaro e scuro', async ({ app, openTab, testServer, avvisi }) => {
  mkdirSync(SHOTS, { recursive: true });
  await testServer.openReady(openTab, pagina('Vecchia'));
  await testServer.openReady(openTab, pagina('Davanti'));
  await app.evaluate(() => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async () => {
      throw Object.assign(new Error('OpenRouter 402 Payment Required'), { provider: 'openrouter', status: 402, keySource: 'personal', keyRefused: true });
    };
  });
  await indietro(app, 7 * ORA);
  await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs._autoArchiveTick());
  const v = await avvisi();
  const avviso = v.locator('.shell-notif-msg', { hasText: 'La pulizia automatica non è riuscita' });
  await expect(avviso).toBeVisible({ timeout: 5_000 });
  await v.screenshot({ path: join(SHOTS, '1618-g3-avviso-chiaro.png') });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await v.waitForTimeout(600);
  await v.screenshot({ path: join(SHOTS, '1618-g3-avviso-scuro.png') });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
});
