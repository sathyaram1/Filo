// Le prove importanti (#2501): i cammini principali in fila su un avvio solo, più il riavvio che il cammino
// dell'impostazione chiede. Decidono la pubblicazione; si lanciano con `npm run test:importanti`, che ne misura il tetto.
// L'elenco lo cambiano solo l'owner e il manutentore (i titoli: CAMMINI in scripts/test-importanti.mjs, che li confronta).

import { test, expect, _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { paginaDellaScheda } from './helpers/schede.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Gli appunti come li scriveva una versione vecchia, prima dell'editor: l'aggiornamento li porta nel file «Appunti».
const APPUNTI_VECCHI = [
  { id: 'n2', ts: '2026-01-02T10:00:00.000Z', text: 'IMPORTANTI_secondo_appunto', context: 'casa' },
  { id: 'n1', ts: '2026-01-01T10:00:00.000Z', text: 'IMPORTANTI_primo_appunto', context: 'spesa' },
];

let userData = null;
let app = null;
let shell = null;
let server = null;
let pagina = '';

const avvia = async () => {
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), FILO_STRATO_MENU: '0', NODE_ENV: 'test' },
  });
  shell = await primaFinestra(app);
};

async function apriScheda(url, vale) {
  const aperta = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(async () => {
    page = aperta?.id != null
      ? await paginaDellaScheda(app, aperta.id, vale)
      : app.windows().find((w) => { try { return vale(w); } catch (_) { return false; } }) || null;
    return Boolean(page);
  }, { message: `scheda ${url} non trovata`, timeout: 15_000, intervals: [100] }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = cartellaTemporanea('filo-importanti-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ filo_notes: APPUNTI_VECCHI }), 'utf8');
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Pagina di prova</title><h1>Una pagina web</h1><p id="paragrafo">Un paragrafo da toccare col tasto destro.</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  pagina = `http://127.0.0.1:${server.address().port}/pagina`;
  await avvia();
});

test.afterAll(async () => {
  try { server?.closeAllConnections?.(); } catch (_) {}
  if (server) await new Promise((r) => server.close(r));
  if (app) await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

test('Filo si avvia e mostra la home', async () => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
  await expect(shell.locator('.tab .title')).toContainText('Home', { timeout: 8_000 });
  await home(app);
});

test('il controllo degli aggiornamenti trova una versione nuova', async () => {
  const h = await home(app);
  await app.evaluate(async () => {
    const ascolta = {};
    const u = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on(e, f) { (ascolta[e] ||= []).push(f); return u; },
      emit(e, ...a) { for (const f of ascolta[e] || []) f(...a); },
      async checkForUpdates() { u.emit('update-available', { version: '9.9.9', tag: 'v9.9.9' }); return { downloadPromise: null }; },
      checkForUpdatesAndNotify() { return u.checkForUpdates(); },
      downloadUpdate() { return new Promise(() => {}); },
    };
    await globalThis.SN_STORAGE.updateSettings({ aggiornamenti: { automatici: false } });
    await globalThis.__filoUpdater.avviaAggiornatore(u, { automatici: false, annuncia: () => globalThis.__filoHandlers.broadcastLiveUpdate() });
  });
  const carta = h.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'versione 9.9.9' });
  await expect(carta).toBeVisible({ timeout: 10_000 });
  await expect(carta.locator('.dash-carta-az.principale')).toHaveText('Installa');
});

test('la chat di Filo risponde', async () => {
  const h = await home(app);
  await modelloFinto(app, [{ text: 'Risposta del modello finto per le prove importanti.' }]);
  try {
    await chiedi(h, 'ciao Filo');
    await expect(h.locator('.dash-bubble-filo', { hasText: 'Risposta del modello finto per le prove importanti.' })).toBeVisible({ timeout: 15_000 });
  } finally {
    await ripristina(app);
  }
});

test('una pagina web si apre in una scheda', async () => {
  const page = await apriScheda(pagina, (w) => new URL(w.url()).hostname === '127.0.0.1');
  await expect(page.locator('h1')).toHaveText('Una pagina web');
  await expect(shell.locator('.tab .title', { hasText: 'Pagina di prova' })).toHaveCount(1, { timeout: 8_000 });
});

test('il tasto destro apre il suo menu', async () => {
  const page = app.windows().find((w) => { try { return new URL(w.url()).hostname === '127.0.0.1'; } catch (_) { return false; } });
  expect(page, 'la pagina web del cammino di prima').toBeTruthy();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  await page.locator('#paragrafo').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  await expect(menu.voci.first()).toBeVisible();
  await page.keyboard.press('Escape');
});

test('i dati salvati da una versione precedente si leggono dopo l\'aggiornamento', async () => {
  const editor = await apriScheda('filo://editor/editor.html', (w) => new URL(w.url()).hostname === 'editor');
  await editor.waitForSelector('#doc', { timeout: 15_000 });
  await editor.click('#docSwitch');
  const voce = editor.locator('.ed-doc-item', { hasText: 'Appunti' });
  await expect(voce).toHaveCount(1, { timeout: 15_000 });
  await voce.click();
  for (const n of APPUNTI_VECCHI) await expect(editor.locator('#doc')).toContainText(n.text);
});

test('un\'impostazione cambiata resta dopo il riavvio', async () => {
  const h = await home(app);
  await h.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await expect(h.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
  await chiudiApp(app);
  app = null;
  await avvia();
  const dopo = await home(app);
  await expect(dopo.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 10_000 });
});
