// #1256 — «Importa dati»: quello che arriva dal backup si vede subito anche nelle schede già aperte, non si perde al
// primo salvataggio di chi tiene la lista in memoria (download, appunti), non allarga il tetto di spesa senza un sì, e
// un archivio con il record finale rovinato si importa lo stesso. Ogni prova asserisce quello che l'utente vede.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { clickConfirm, confirmText, confirmState } from './helpers/confirm.mjs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildExportZip } = require('../src/main/services/exportData.js');
require('../src/shared/filoEventi.js');
const E = globalThis.SN_FILO_EVENTI;

const RED_PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function lancia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  return { app, shell };
}

async function paginaInterna(app, hostname, timeout = 15000) {
  const fine = Date.now() + timeout;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === hostname; } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna pagina ${hostname}`);
}

async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  return paginaInterna(app, new URL(url).hostname);
}

// Sceglie il file, apre la conferma e aspetta che ci sia. La pagina Sicurezza è l'ultima aperta, quindi davanti.
async function apriConferma(app, page, zipPath, nome) {
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zipPath);
  await page.locator('#sec-import-btn').scrollIntoViewIfNeeded();
  await page.locator('#sec-import-btn').click();
  await expect.poll(() => confirmText(page), { timeout: 15000 }).toContain(nome);
  return confirmText(page);
}

const disco = (userData) => { try { return JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')); } catch (_) { return {}; } };

test('le schede già aperte mostrano subito le voci del backup, e i download importati restano dopo un download e un riavvio', async () => {
  const userData = cartellaTemporanea('filo-imp-vivo-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    savedPages: [{ id: 'mia-1', url: 'https://mia.example/', title: 'Pagina mia', savedAt: '2026-10-01T10:00:00.000Z' }],
  }), 'utf8');
  const backup = {
    savedPages: [{ id: 'backup-1', url: 'https://ricetta.example/', title: 'Ricetta dal backup', savedAt: '2026-10-02T10:00:00.000Z' }],
    aiHistory: [{ id: 'h-backup', timestamp: '2026-10-02T10:00:00.000Z', action: 'chat', provider: 'openrouter', model: 'm', input: 'domanda del backup', output: 'risposta del backup' }],
    downloads: [{ id: 'dl-backup', filename: 'manuale-backup.pdf', url: 'https://example.com/manuale-backup.pdf', state: 'completed', savePath: '', startedAt: '2026-10-02T10:00:00.000Z', endedAt: '2026-10-02T10:00:05.000Z' }],
  };
  const zipPath = join(userData, 'vivo.zip');
  writeFileSync(zipPath, buildExportZip(backup));

  const fileServer = createServer((req, res) => {
    const corpo = Buffer.from('%PDF-1.4\n% prova\n');
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': corpo.length, 'Content-Disposition': 'attachment; filename="nuovo.pdf"' });
    res.end(corpo);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));

  let { app, shell } = await lancia(userData);
  try {
    const home = await apri(app, shell, 'filo://home/home.html');
    const cronologia = await apri(app, shell, 'filo://history/history.html');
    await expect(home.locator('body')).toContainText('Pagina mia');
    await expect(cronologia.locator('body')).not.toContainText('domanda del backup');

    const sicurezza = await apri(app, shell, 'filo://security/security.html');
    await apriConferma(app, sicurezza, zipPath, 'vivo.zip');
    await clickConfirm(sicurezza, 'ok');

    // Le due schede restano dietro, mai riaperte né riportate davanti: le voci del backup ci sono lo stesso.
    await expect(home.locator('body')).toContainText('Ricetta dal backup', { timeout: 10000 });
    await expect(home.locator('body')).toContainText('Pagina mia');
    await expect(cronologia.locator('body')).toContainText('domanda del backup', { timeout: 10000 });

    const nomi = async () => ((await shell.evaluate(() => window.filoShell.downloads.list()))?.items || []).map((d) => d.filename);
    await expect.poll(nomi, { timeout: 10000 }).toContain('manuale-backup.pdf');

    // Un download vero dopo l'importazione: il primo salvataggio dell'elenco non cancella quelli del backup.
    await app.evaluate(({ session }, u) => session.defaultSession.downloadURL(u), `http://127.0.0.1:${fileServer.address().port}/nuovo.pdf`);
    const dir = join(userData, 'downloads');
    await expect.poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15000 }).toContain('nuovo.pdf');
    await expect.poll(async () => {
      const voce = ((await shell.evaluate(() => window.filoShell.downloads.list()))?.items || []).find((d) => d.filename === 'nuovo.pdf');
      return voce && voce.state;
    }, { timeout: 15000 }).toBe('completed');
    await expect.poll(() => (disco(userData).downloads || []).map((d) => d.filename).sort(), { timeout: 10000 })
      .toEqual(['manuale-backup.pdf', 'nuovo.pdf']);

    await app.close();
    ({ app, shell } = await lancia(userData));
    await expect.poll(nomi, { timeout: 15000 }).toEqual(expect.arrayContaining(['manuale-backup.pdf', 'nuovo.pdf']));
  } finally {
    try { await app.close(); } catch (_) {}
    fileServer.close();
    rmSync(userData, { recursive: true, force: true });
  }
});

test('50 appunti più 20 del backup: la conferma dice quanti escono, e dopo una copia non sparisce altro', async () => {
  const userData = cartellaTemporanea('filo-imp-appunti-');
  const mie = Array.from({ length: 50 }, (_, i) => ({ type: 'text', text: `mio ${i}`, ts: Date.UTC(2026, 0, 1) - i * 1000 }));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ clipboardHistory: mie }), 'utf8');
  const delBackup = Array.from({ length: 20 }, (_, i) => ({ type: 'text', text: `backup ${i}`, ts: Date.UTC(2026, 5, 1) - i * 1000 }));
  const zipPath = join(userData, 'appunti.zip');
  writeFileSync(zipPath, buildExportZip({ clipboardHistory: [...delBackup, { type: 'text', text: '  mio   0 ', ts: Date.UTC(2026, 6, 1) }] }));

  const { app, shell } = await lancia(userData);
  try {
    const page = await apri(app, shell, 'filo://security/security.html');
    const testo = await apriConferma(app, page, zipPath, 'appunti.zip');
    expect(testo).toContain('Appunti copiati che non entrano: 20. L’elenco ne tiene 50, i più recenti.');
    expect(testo).toContain('Fra questi, appunti che hai adesso: 20.');
    expect(testo).toContain('Di ciò che hai ora escono solo gli appunti copiati più vecchi');
    expect(testo).not.toContain('Nulla di ciò che hai ora viene cancellato');
    await page.screenshot({ path: 'tests/.shots/import-appunti-tetto.png' });
    await clickConfirm(page, 'ok');

    await expect.poll(() => (disco(userData).clipboardHistory || []).filter((x) => x.text.startsWith('backup')).length, { timeout: 10000 }).toBe(20);
    const dopo = disco(userData).clipboardHistory;
    expect(dopo).toHaveLength(50);
    expect(dopo.filter((x) => x.text.replace(/\s+/g, ' ').trim() === 'mio 0')).toHaveLength(1);

    // Una copia da Filo: entra in cima, ed esce solo il più vecchio, che la conferma aveva già contato.
    await page.evaluate((MSG) => chrome.runtime.sendMessage({ type: MSG, text: 'copiato adesso' }), 'copy_text_to_clipboard');
    await expect.poll(() => (disco(userData).clipboardHistory || [])[0]?.text, { timeout: 10000 }).toBe('copiato adesso');
    const finale = disco(userData).clipboardHistory;
    expect(finale.filter((x) => x.text.startsWith('backup'))).toHaveLength(20);
    expect(finale).toHaveLength(50);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('tetto di spesa a 5 €, backup senza tetto: resta 5 € e la conferma offre quello del backup col suo bottone', async () => {
  const userData = cartellaTemporanea('filo-imp-tetto-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { monthlyLimitEur: 5, theme: 'light' } }), 'utf8');
  const zipPath = join(userData, 'senza-tetto.zip');
  writeFileSync(zipPath, buildExportZip({ settings: { monthlyLimitEur: 0, theme: 'dark' } }));

  const { app, shell } = await lancia(userData);
  try {
    let page = await apri(app, shell, 'filo://security/security.html');
    // La descrizione fissa non promette quello che la conferma smentisce.
    const descrizione = await page.locator('#sec-import-desc').textContent();
    expect(descrizione).not.toMatch(/non viene cancellato|vince il backup/);
    expect(descrizione).toContain('Prima di importare Filo ti dice cosa entra e cosa cambia.');

    const testo = await apriConferma(app, page, zipPath, 'senza-tetto.zip');
    expect(testo).toContain('Il limite di spesa mensile resta 5 €. Nel backup non c’era un limite. Per toglierlo, scegli «Importa e togli il limite».');
    expect(testo).toContain('il limite di spesa mensile non si allarga e resta il più stretto dei due');
    expect((await confirmState(page)).altroLabel).toBe('Importa e togli il limite');
    await page.screenshot({ path: 'tests/.shots/import-tetto-offerto.png' });
    await clickConfirm(page, 'ok');

    await expect.poll(() => disco(userData).settings?.theme, { timeout: 10000 }).toBe('dark');
    expect(disco(userData).settings.monthlyLimitEur).toBe(5);
    expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).monthlyLimitEur)).toBe(5);

    // Lo stesso backup, col bottone che lo offre: il tetto si toglie perché l'hai scelto tu.
    await page.waitForEvent('load', { timeout: 10000 }).catch(() => {});
    page = await paginaInterna(app, 'security');
    await page.waitForLoadState('domcontentloaded');
    await apriConferma(app, page, zipPath, 'senza-tetto.zip');
    await page.screenshot({ path: 'tests/.shots/import-tetto-offerto-scuro.png' });
    await clickConfirm(page, 'altro');
    await expect.poll(() => disco(userData).settings?.monthlyLimitEur, { timeout: 10000 }).toBe(0);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('tetto di spesa a 50 €, backup con 5 €: il più stretto entra e la conferma lo dice coi due numeri', async () => {
  const userData = cartellaTemporanea('filo-imp-tetto-giu-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { monthlyLimitEur: 50 } }), 'utf8');
  const zipPath = join(userData, 'tetto5.zip');
  writeFileSync(zipPath, buildExportZip({ settings: { monthlyLimitEur: 5 } }));

  const { app, shell } = await lancia(userData);
  try {
    const page = await apri(app, shell, 'filo://security/security.html');
    const testo = await apriConferma(app, page, zipPath, 'tetto5.zip');
    expect(testo).toContain('Il limite di spesa mensile scende da 50 € a 5 €, quello del backup.');
    expect((await confirmState(page)).altroLabel).toBe('');
    await clickConfirm(page, 'ok');
    await expect.poll(() => disco(userData).settings?.monthlyLimitEur, { timeout: 10000 }).toBe(5);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('record finale dello zip rovinato: col numero di voci da 5 a 1 arrivano anteprime e chat, senza firma si importa lo stesso', async () => {
  const { conRecordFinale } = await import('./helpers/zipRovinato.mjs');
  const userData = cartellaTemporanea('filo-imp-fine-');
  const backup = {
    savedPages: [
      { id: 'p1', url: 'https://uno.example/', title: 'Uno', savedAt: '2026-10-02T10:00:00.000Z', thumbnail: RED_PNG_URL },
      { id: 'p2', url: 'https://due.example/', title: 'Due', savedAt: '2026-10-03T10:00:00.000Z', thumbnail: RED_PNG_URL },
    ],
  };
  const come = { dispositivo: 'pc-vecchio', ts: '2026-10-02T10:00:00.000Z' };
  const filo = E.riga(E.crea(E.TIPI.CHAT_APERTA, { chat: 'c-backup' }, come))
    + E.riga(E.crea(E.TIPI.MESSAGGIO, { chat: 'c-backup', msg: { role: 'user', text: 'ciao dal backup' } }, come));
  const zip = buildExportZip(backup, { filo });
  const numero = join(userData, 'numero-rovinato.zip');
  const firma = join(userData, 'firma-rovinata.zip');
  writeFileSync(numero, conRecordFinale(zip, 'numero', 1));
  writeFileSync(firma, conRecordFinale(zip, 'firma'));

  const { app, shell } = await lancia(userData);
  try {
    const page = await apri(app, shell, 'filo://security/security.html');
    const testo = await apriConferma(app, page, numero, 'numero-rovinato.zip');
    expect(testo).toContain('2 immagini');
    expect(testo).toContain('1 chat con Filo');
    expect(testo).not.toMatch(/non si leggono/);
    await clickConfirm(page, 'ok');
    await expect.poll(() => (disco(userData).savedPages || []).map((p) => String(p.thumbnail).slice(0, 11)), { timeout: 10000 })
      .toEqual(['data:image/', 'data:image/']);
    const eventi = join(userData, 'filo', 'eventi.jsonl');
    await expect.poll(() => (existsSync(eventi) ? readFileSync(eventi, 'utf8') : ''), { timeout: 10000 }).toContain('ciao dal backup');

    await page.waitForEvent('load', { timeout: 10000 }).catch(() => {});
    const dopo = await paginaInterna(app, 'security');
    await dopo.waitForLoadState('domcontentloaded');
    await apriConferma(app, dopo, firma, 'firma-rovinata.zip');
    await expect(dopo.locator('#sec-import-hint')).not.toContainText('Non è un archivio');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
