// La Cronologia AI non sta più in storage.json e non ha tetti (#1065).
//
// Prima: ogni richiesta a un modello aggiungeva una voce dentro storage.json, che
// si riscrive intero a ogni modifica di qualunque chiave; a 4 MB le voci più
// vecchie sparivano senza avviso. Qui si asserisce il successo dal punto di vista
// dell'utente: dopo 300 richieste la pagina le mostra tutte e storage.json resta
// leggero; una cronologia vecchia si migra intera; una voce tolta dalla pagina
// non resta su disco; il backup la riporta uguale.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron, test as testSenzaFixture } from '@playwright/test';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { clickConfirm } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cartellaDati = (app) => app.evaluate(() => process.env.FILO_USER_DATA);
const PAGINA = 'testo della pagina letta dal modello '.repeat(200);

function fileSotto(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    let st;
    try { st = statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) out.push(...fileSotto(p));
    else out.push(p);
  }
  return out;
}
const fileCheContengono = (dir, ago) => fileSotto(dir).filter((f) => {
  try { return readFileSync(f, 'latin1').includes(ago); } catch (_) { return false; }
});

// Quello che scrive il main a ogni richiesta: il payload intero, qualche KB.
const registra = (app, n, prefisso) => app.evaluate(async (_e, { n, prefisso, pagina }) => {
  for (let i = 0; i < n; i++) {
    await globalThis.SN_HISTORY.append({
      action: 'explain_selection', provider: 'openrouter', model: 'deepseek/deepseek-v4-pro',
      input: { selection: `${prefisso} ${i}`, pageText: pagina }, output: `spiegazione ${i}`,
      origin: 'https://esempio.test/', costEur: 0.001,
    });
  }
  await globalThis.__filoStorage.whenSettled();
}, { n, prefisso, pagina: PAGINA });

test('dopo 300 richieste la pagina le mostra tutte, e storage.json non contiene la cronologia', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await registra(app, 300, 'domanda');
  const dati = await cartellaDati(app);
  const storage = readFileSync(join(dati, 'storage.json'), 'utf8');
  expect(JSON.parse(storage).aiHistory).toBeUndefined();
  expect(storage).not.toContain('domanda 0');
  expect(storage.length).toBeLessThan(200_000);

  const page = await openTab('filo://history/history.html');
  await expect(page.locator('.sn-history-item')).toHaveCount(300, { timeout: 20_000 });
  await expect(page.locator('.sn-history-item').first()).toContainText('domanda 299');
  await expect(page.locator('.sn-history-item').last()).toContainText('domanda 0');

  // Tolta dalla pagina, la voce non resta in nessun file della cartella dati.
  const voce = page.locator('.sn-history-item', { hasText: 'domanda 150' });
  await voce.hover();
  await voce.locator('.sn-history-remove').click();
  await expect(page.locator('.sn-history-item')).toHaveCount(299);
  expect(fileCheContengono(dati, 'domanda 150"')).toEqual([]);
  await page.reload();
  await expect(page.locator('.sn-history-item')).toHaveCount(299, { timeout: 20_000 });
  await expect(page.locator('.sn-history-item', { hasText: 'domanda 150' })).toHaveCount(0);

  // «Cancella tutto» svuota anche i file.
  await page.locator('#clear').click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.sn-history-item')).toHaveCount(0);
  await expect(page.locator('#empty')).toBeVisible();
  expect(fileCheContengono(dati, 'domanda 1"')).toEqual([]);
});

test('esporta e reimporta: la cronologia torna uguale, e reimportare due volte non duplica', async ({ app, openTab }) => {
  await registra(app, 40, 'backup');
  const dati = await cartellaDati(app);
  const zip = join(dati, 'backup-1065.zip');
  await app.evaluate(({ dialog }, z) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: z });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [z] });
  }, zip);
  const prima = await app.evaluate(async () => globalThis.SN_HISTORY.list());
  expect(prima).toHaveLength(40);

  const page = await openTab('filo://newtab/');
  const esportato = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'export_data' }));
  expect(esportato.ok).toBe(true);
  expect(existsSync(zip)).toBe(true);

  await app.evaluate(async () => globalThis.SN_HISTORY.clear());
  expect(await app.evaluate(async () => (await globalThis.SN_HISTORY.list()).length)).toBe(0);

  const reimporta = async () => {
    const anteprima = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'import_data_preview' }));
    expect(anteprima.ok).toBe(true);
    const esito = await page.evaluate(async (token) =>
      chrome.runtime.sendMessage({ type: 'import_data_apply', token }), anteprima.token);
    expect(esito.ok).toBe(true);
  };
  await reimporta();
  expect(await app.evaluate(async () => globalThis.SN_HISTORY.list())).toEqual(prima);
  await reimporta();
  expect(await app.evaluate(async () => globalThis.SN_HISTORY.list())).toEqual(prima);
  await app.evaluate(() => globalThis.__filoStorage.whenSettled());
  expect(JSON.parse(readFileSync(join(dati, 'storage.json'), 'utf8')).aiHistory).toBeUndefined();
});

testSenzaFixture('una cronologia oltre i 4 MB in storage.json si migra intera, e la pagina la mostra', async () => {
  testSenzaFixture.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-migra-cronologia-');
  const vecchia = [];
  for (let i = 1199; i >= 0; i--) {
    vecchia.push({
      id: `v-${i}`, timestamp: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
      action: 'explain_selection', provider: 'openrouter', model: 'deepseek/deepseek-v4-pro',
      input: { selection: `vecchia ${i}`, pageText: PAGINA }, output: `risposta ${i}`,
      origin: 'https://esempio.test/', costEur: 0.001,
    });
  }
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ aiHistory: vecchia }), 'utf8');
  expect(statSync(join(userData, 'storage.json')).size).toBeGreaterThan(4 * 1024 * 1024);

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    // Nessuno apre la cronologia: la migrazione parte da sola all'avvio.
    await expect.poll(async () => {
      try { return 'aiHistory' in JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')); } catch (_) { return true; }
    }, { timeout: 20_000 }).toBe(false);
    expect(statSync(join(userData, 'storage.json')).size).toBeLessThan(200_000);
    const dopo = await app.evaluate(async () => globalThis.SN_HISTORY.list());
    expect(dopo).toEqual(vecchia);

    const shell = await app.firstWindow();
    await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://history')); return !!page; }).toBe(true);
    await expect(page.locator('.sn-history-item')).toHaveCount(1200, { timeout: 30_000 });
    await expect(page.locator('.sn-history-item').last()).toContainText('vecchia 0');
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});
