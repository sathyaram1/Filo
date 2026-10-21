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
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { home, modelloFinto, ripristina, chiedi } from './helpers/chatFinta.mjs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { clickConfirm } from './helpers/confirm.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

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

// La pagina disegna le voci a lotti mentre si scorre: «le mostra tutte» vuol dire che scorrendo fino in fondo ci sono tutte.
// Un lotto per giro: con le pause di un secondo di expect.poll, 3000 voci erano trenta secondi di attesa della prova (#1115.1).
async function scorriFinoInFondo(page, n) {
  await expect.poll(async () => {
    await page.locator('.sn-history-item').last().scrollIntoViewIfNeeded();
    return page.locator('.sn-history-item').count();
  }, { timeout: 60_000, intervals: [50] }).toBe(n);
}

test('dopo 300 richieste la pagina le mostra tutte, e storage.json non contiene la cronologia', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await registra(app, 300, 'domanda');
  const dati = await cartellaDati(app);
  const storage = readFileSync(join(dati, 'storage.json'), 'utf8');
  expect(JSON.parse(storage).aiHistory).toBeUndefined();
  expect(storage).not.toContain('domanda 0');
  expect(storage.length).toBeLessThan(200_000);

  const page = await openTab('filo://history/history.html');
  await expect(page.locator('.sn-history-item').first()).toContainText('domanda 299', { timeout: 20_000 });
  await scorriFinoInFondo(page, 300);
  await expect(page.locator('.sn-history-item').last()).toContainText('domanda 0');

  // Tolta dalla pagina, la voce non resta in nessun file della cartella dati.
  const voce = page.locator('.sn-history-item', { hasText: 'domanda 150' });
  await voce.hover();
  await voce.locator('.sn-history-remove').click();
  await expect(page.locator('.sn-history-item')).toHaveCount(299);
  expect(fileCheContengono(dati, 'domanda 150"')).toEqual([]);
  await page.reload();
  await expect(page.locator('.sn-history-item').first()).toContainText('domanda 299', { timeout: 20_000 });
  await scorriFinoInFondo(page, 299);
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

test('con la cronologia che non si può scrivere la chat mostra comunque la risposta del modello', async ({ app }) => {
  test.setTimeout(60_000);
  const RISPOSTA = 'Il museo apre alle nove e chiude alle diciotto.';
  const dati = await cartellaDati(app);
  await app.evaluate(() => globalThis.SN_HISTORY.prepara());
  // Il file del mese non si apre in scrittura (disco pieno, file bloccato da un antivirus): qui è una cartella.
  const file = join(dati, 'cronologia-ai', new Date().toISOString().slice(0, 7) + '.jsonl');
  rmSync(file, { force: true, recursive: true });
  mkdirSync(file, { recursive: true });
  try {
    await modelloFinto(app, [{ text: RISPOSTA }]);
    const page = await home(app);
    await chiedi(page, 'A che ora apre il museo?');
    await expect(page.getByText(RISPOSTA)).toBeVisible({ timeout: 20_000 });
  } finally {
    await ripristina(app);
  }
});

test('la domanda fatta alla chat compare nella sua voce e la ricerca la trova', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  try {
    await modelloFinto(app, [{ text: 'Il museo apre alle nove.' }]);
    const page = await home(app);
    await chiedi(page, 'A che ora apre il museo civico?');
    await expect(page.getByText('Il museo apre alle nove.')).toBeVisible({ timeout: 20_000 });
  } finally {
    await ripristina(app);
  }
  const h = await openTab('filo://history/history.html');
  const voce = h.locator('.sn-history-item', { hasText: 'Il museo apre alle nove.' });
  await expect(voce).toHaveCount(1, { timeout: 20_000 });
  await expect(voce).toContainText('A che ora apre il museo civico?');
  await h.locator('#search').fill('museo civico');
  await expect(h.locator('.sn-history-item')).toHaveCount(1);
});

test('con 3000 voci la pagina si apre e cerca senza bloccarsi, e scorrendo e cercando le voci ci sono tutte', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const N = 3000;
  await app.evaluate(async (_e, { n }) => {
    const risposta = 'Questa è la risposta del modello, lunga come quelle vere. '.repeat(25);
    for (let i = 0; i < n; i++) {
      await globalThis.SN_HISTORY.append({
        action: i % 2 ? 'explain_selection' : 'filo_chat', provider: 'openrouter', model: 'deepseek/deepseek-v4-pro',
        input: { selection: `domanda ${i}` }, output: `${risposta} ${i}`, origin: 'https://esempio.test/', costEur: 0.001,
      });
    }
  }, { n: N });
  const page = await openTab('filo://history/history.html');
  await expect(page.locator('.sn-history-item').first()).toContainText(`domanda ${N - 1}`, { timeout: 60_000 });

  // Dal tasto al primo disegno dopo: quello che l'utente sente come pagina bloccata (prima, con 3000 voci, 1,5 s).
  const ms = await page.evaluate(async () => {
    const s = document.getElementById('search');
    s.focus();
    const t = performance.now();
    s.value = 'd';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return performance.now() - t;
  });
  expect(ms, `un tasto nella ricerca ha bloccato la pagina per ${Math.round(ms)} ms`).toBeLessThan(500);
  // Il tempo dipende dalla macchina; quello che lo tiene basso su tutte no: le voci fuori schermo non si impaginano (#1115.1).
  const impaginate = await page.evaluate(() => {
    const voci = [...document.querySelectorAll('.sn-history-item .sn-history-output')];
    return { tutte: voci.length, viste: voci.filter((v) => v.checkVisibility({ contentVisibilityAuto: true })).length };
  });
  expect(impaginate.tutte).toBeGreaterThanOrEqual(100);
  expect(impaginate.viste, `${impaginate.viste} voci su ${impaginate.tutte} impaginate a ogni tasto`).toBeLessThan(25);

  // La più vecchia si trova cercandola, e cancellando la ricerca si arriva in fondo scorrendo.
  await page.locator('#search').fill('domanda 0');
  await expect(page.locator('.sn-history-item')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('.sn-history-item')).toContainText('domanda 0');
  await page.locator('#search').fill('');
  await scorriFinoInFondo(page, N);
  await expect(page.locator('.sn-history-item').last()).toContainText('domanda 0');

  // Togliere una voce lontana dalla cima non riporta in cima la pagina.
  const voce = page.locator('.sn-history-item', { hasText: /domanda 5(?!\d)/ }).first();
  await voce.scrollIntoViewIfNeeded();
  await voce.hover();
  await voce.locator('.sn-history-remove').click();
  await expect(page.locator('.sn-history-item')).toHaveCount(N - 1);
  await expect(page.locator('.sn-history-item', { hasText: /domanda 4(?!\d)/ })).toBeInViewport();
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

    const shell = await primaFinestra(app);
    await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://history')); return !!page; }).toBe(true);
    await expect(page.locator('.sn-history-item').first()).toContainText('vecchia 1199', { timeout: 30_000 });
    await scorriFinoInFondo(page, 1200);
    await expect(page.locator('.sn-history-item').last()).toContainText('vecchia 0');
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});
