// Feedback #234: "Esporta dati (.zip)" prometteva un backup e il trasferimento
// dei dati su un altro computer, ma in Filo non c'era NESSUN modo di ricaricare
// quel file — invariante UX "se puoi esportare, devi poter importare" rotta.
//
// Questi spec asseriscono il SUCCESSO del ripristino (i dati del backup
// esistono davvero nell'app dopo l'import), non l'assenza di un errore:
//   1) end-to-end sul flusso completo: bottone "Importa dati" → scelta file →
//      popup di conferma con l'anteprima del contenuto → i dati compaiono nello
//      storage, immagini comprese;
//   2) parità export/import: entrambi i controlli esistono nella stessa pagina;
//   3) confine d'origine: una pagina web non può innescare l'import.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildExportZip } = require('../src/main/services/exportData.js');

// 1x1 PNG rosso
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const RED_PNG_URL = `data:image/png;base64,${RED_PNG_B64}`;

// Attende la Page del WebContentsView di una pagina interna filo://<host>/.
async function findInternalPage(app, hostname, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === hostname; } catch (_) { return false; }
    });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('pagina Sicurezza: "Importa dati" ripristina davvero i dati di un backup', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'filo-imp-'));

  // Sul computer di destinazione c'è già qualcosa: deve sopravvivere all'import.
  const preesistente = {
    settings: { theme: 'light' },
    filo_memory: { PROFILO: 'GiaQui' },
    savedPages: [{ id: 'locale-1', title: 'Pagina mia' }],
  };
  writeFileSync(join(userData, 'storage.json'), JSON.stringify(preesistente), 'utf8');

  // Il backup da ricaricare: prodotto dallo STESSO esportatore dell'app.
  const backup = {
    settings: { theme: 'dark' },
    filo_memory: { PROFILO: 'DalBackup', PREFERENZE: 'caffè' },
    savedPages: [{ id: 'backup-1', title: 'Pagina del backup' }],
    clipboardHistory: [{ id: 'c1', type: 'image', description: 'logo', dataUrl: RED_PNG_URL }],
  };
  const zipPath = join(userData, 'backup.zip');
  writeFileSync(zipPath, buildExportZip(backup));

  const app = await electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    // Stub del dialog di apertura: niente finestra nativa, si sceglie il backup.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, zipPath);

    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));

    const page = await findInternalPage(app, 'security');
    expect(page).toBeTruthy();
    await page.waitForLoadState('domcontentloaded');

    const btn = page.locator('#sec-import-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText(/Importa/);
    await btn.scrollIntoViewIfNeeded();
    await btn.click();

    // Prima di scrivere, il popup dice COSA contiene il file scelto: nome,
    // quante sezioni e quante immagini. Conferma informata, non alla cieca.
    await expect.poll(() => confirmText(page), { timeout: 10000 })
      .toContain('backup.zip');
    const dialogText = await confirmText(page);
    expect(dialogText).toContain('4 sezioni di dati');
    expect(dialogText).toContain('1 immagine');
    expect(dialogText).not.toContain('1 immagini'); // conteggi declinati, non "1 immagini"

    await page.screenshot({ path: 'tests/.shots/import-data-confirm.png' });
    await clickConfirm(page, 'ok');

    // I dati del backup sono davvero nell'app: lo storage su disco li contiene.
    await expect.poll(() => {
      try {
        const d = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
        return d.clipboardHistory ? d.clipboardHistory.length : 0;
      } catch (_) { return 0; }
    }, { timeout: 10000 }).toBe(1);

    const stored = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));

    // 1) Le sezioni assenti in locale arrivano dal backup, immagine inclusa —
    //    ricomposta come data-URL, non lasciata come percorso "images/…".
    expect(stored.clipboardHistory[0].dataUrl).toBe(RED_PNG_URL);

    // 2) Le liste si UNISCONO: la pagina locale non è stata cancellata.
    const ids = stored.savedPages.map((p) => p.id).sort();
    expect(ids).toEqual(['backup-1', 'locale-1']);

    // 3) Sui conflitti vince il backup, ma ciò che il backup non conosce resta.
    expect(stored.filo_memory.PROFILO).toBe('DalBackup');
    expect(stored.filo_memory.PREFERENZE).toBe('caffè');

    // 4) Le impostazioni ripristinate sono ATTIVE, non solo scritte: il tema
    //    del backup ha sostituito quello locale ed è stato propagato ovunque.
    expect(stored.settings.theme).toBe('dark');
    const live = await app.evaluate(async ({ nativeTheme }) => {
      return {
        theme: (await globalThis.SN_STORAGE.getSettings()).theme,
        native: nativeTheme.themeSource,
      };
    });
    expect(live.theme).toBe('dark');
    expect(live.native).toBe('dark');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('le schede già aperte mostrano i dati importati senza chiuderle e riaprirle', async () => {
  // Feedback #442: le impostazioni ripristinate si applicavano subito ovunque,
  // i CONTENUTI no. Con "Aperti per dopo" e la cronologia già aperte durante
  // l'import, quelle schede continuavano a mostrare l'elenco di prima: i dati
  // c'erano, ma per vederli bisognava chiudere e riaprire la pagina.
  //
  // Qui asseriamo il SUCCESSO: nelle schede rimaste aperte (mai ricaricate)
  // compaiono le voci del backup, e ciò che l'utente aveva scritto nel campo di
  // ricerca resta dov'era.
  const userData = mkdtempSync(join(tmpdir(), 'filo-imp-live-'));
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    savedPages: [{ id: 'locale-1', title: 'Pagina mia', url: 'https://mia.example/' }],
    aiHistory: [],
  }), 'utf8');

  const zipPath = join(userData, 'backup.zip');
  writeFileSync(zipPath, buildExportZip({
    savedPages: [{ id: 'backup-1', title: 'Pagina del backup', url: 'https://backup.example/' }],
    aiHistory: [{
      id: 'h-backup-1',
      timestamp: new Date().toISOString(),
      action: 'translate',
      model: 'modello-di-prova',
      input: { text: 'ciao' },
      output: 'Risposta ritrovata nel backup',
      origin: '',
      costEur: 0,
    }],
  }));

  const app = await electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, zipPath);

    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');

    // Le due liste sono aperte PRIMA dell'import e non verranno più toccate.
    await shell.evaluate(() => window.filoShell.tabs.open('filo://home/home.html'));
    const home = await findInternalPage(app, 'home');
    expect(home).toBeTruthy();
    await home.waitForLoadState('domcontentloaded');
    await expect(home.locator('[data-page-id="locale-1"]')).toBeVisible();

    await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
    const history = await findInternalPage(app, 'history');
    expect(history).toBeTruthy();
    await history.waitForLoadState('domcontentloaded');
    await expect(history.locator('#empty')).toBeVisible(); // cronologia vuota: è lo stato di partenza

    // L'utente stava filtrando la sua lista: quello che ha scritto non deve
    // sparire perché nel frattempo è arrivato un ripristino.
    await home.fill('#search', 'pagina');
    await expect(home.locator('[data-page-id="locale-1"]')).toBeVisible();
    expect(await home.locator('[data-page-id="backup-1"]').count()).toBe(0);

    // Import dalla pagina Sicurezza, in una TERZA scheda.
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
    const security = await findInternalPage(app, 'security');
    expect(security).toBeTruthy();
    await security.waitForLoadState('domcontentloaded');
    await security.locator('#sec-import-btn').scrollIntoViewIfNeeded();
    await security.locator('#sec-import-btn').click();
    await clickConfirm(security, 'ok', { timeout: 10000 });

    // Le schede aperte si sono riallineate da sole.
    await expect(home.locator('[data-page-id="backup-1"]')).toBeVisible({ timeout: 10000 });
    await expect(history.locator('#list')).toContainText('Risposta ritrovata nel backup', { timeout: 10000 });

    // …senza buttare via lo stato della pagina: la ricerca scritta è ancora lì
    // (una ricarica secca della scheda l'avrebbe cancellata).
    expect(await home.inputValue('#search')).toBe('pagina');

    await home.screenshot({ path: 'tests/.shots/import-data-live-refresh.png' });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('"trasferire i dati su un altro computer": esporto da un profilo, importo in uno vuoto', async () => {
  // La promessa scritta sotto "Esporta dati". Qui la esercitiamo per intero,
  // dalla UI: nessuno dei due passaggi usa scorciatoie interne.
  const profiloA = mkdtempSync(join(tmpdir(), 'filo-pcA-'));
  const profiloB = mkdtempSync(join(tmpdir(), 'filo-pcB-'));
  const trasferimento = join(profiloA, 'trasferimento.zip');

  const miei = {
    filo_memory: { PROFILO: 'Mario', PREFERENZE: 'caffè lungo' },
    savedPages: [{ id: 's1', title: 'Ricetta', thumbnail: RED_PNG_URL }],
  };
  writeFileSync(join(profiloA, 'storage.json'), JSON.stringify(miei), 'utf8');

  const launch = (userData) => electron.launch({
    args: ['.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  // --- Computer A: esporto dalla pagina Sicurezza ---------------------------
  const appA = await launch(profiloA);
  try {
    await appA.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, trasferimento);
    const shellA = await appA.firstWindow();
    await shellA.waitForLoadState('domcontentloaded');
    await shellA.evaluate(() => window.filoShell.tabs.open('filo://security/'));
    const pageA = await findInternalPage(appA, 'security');
    expect(pageA).toBeTruthy();
    await pageA.waitForLoadState('domcontentloaded');
    await pageA.locator('#sec-export-btn').click();
    await expect.poll(() => existsSync(trasferimento), { timeout: 10000 }).toBe(true);
  } finally {
    try { await appA.close(); } catch (_) {}
  }

  // --- Computer B: profilo vuoto, importo lo stesso file --------------------
  const appB = await launch(profiloB);
  try {
    await appB.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, trasferimento);
    const shellB = await appB.firstWindow();
    await shellB.waitForLoadState('domcontentloaded');
    await shellB.evaluate(() => window.filoShell.tabs.open('filo://security/'));
    const pageB = await findInternalPage(appB, 'security');
    expect(pageB).toBeTruthy();
    await pageB.waitForLoadState('domcontentloaded');
    await pageB.locator('#sec-import-btn').scrollIntoViewIfNeeded();
    await pageB.locator('#sec-import-btn').click();
    await clickConfirm(pageB, 'ok', { timeout: 10000 });

    // Sul secondo computer ritrovo i MIEI dati, miniatura compresa.
    await expect.poll(async () => {
      try {
        const d = await appB.evaluate(async () => globalThis.SN_STORAGE.getRaw('filo_memory', null));
        return d && d.PROFILO;
      } catch (_) { return null; }
    }, { timeout: 10000 }).toBe('Mario');

    const pagine = await appB.evaluate(async () => globalThis.SN_STORAGE.getRaw('savedPages', []));
    expect(pagine).toHaveLength(1);
    expect(pagine[0].title).toBe('Ricetta');
    expect(pagine[0].thumbnail).toBe(RED_PNG_URL);
  } finally {
    try { await appB.close(); } catch (_) {}
    rmSync(profiloA, { recursive: true, force: true });
    rmSync(profiloB, { recursive: true, force: true });
  }
});

test('invariante: nella pagina Sicurezza esporta e importa esistono entrambi', async ({ openTab }) => {
  const page = await openTab('filo://security/security.html');
  await page.waitForLoadState('domcontentloaded');

  const exportBtn = page.locator('#sec-export-btn');
  const importBtn = page.locator('#sec-import-btn');
  await expect(exportBtn).toBeVisible();
  await expect(importBtn).toBeVisible();
  expect(((await exportBtn.textContent()) || '').toLowerCase()).toContain('esporta');
  expect(((await importBtn.textContent()) || '').toLowerCase()).toContain('importa');

  // La descrizione dell'import spiega cosa succede ai dati già presenti.
  const desc = ((await page.locator('#sec-import-desc').textContent()) || '').toLowerCase();
  expect(desc).toContain('esportato da filo');

  await importBtn.scrollIntoViewIfNeeded();
  await page.locator('#sec-import-row').screenshot({ path: 'tests/.shots/import-data-row.png' });
});

test('una pagina web non può innescare né applicare un import', async ({ app, shell }) => {
  void shell; // attende il boot: SN_HANDLE_MESSAGE dev'essere già montato
  const res = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const web = { url: 'https://evil.example/page' };
    const preview = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.IMPORT_DATA_PREVIEW }, web);
    const apply = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.IMPORT_DATA_APPLY, token: 'x' }, web);
    return { preview, apply };
  });
  expect(res.preview.ok).toBe(false);
  expect(res.preview.error).toBe('forbidden');
  expect(res.apply.ok).toBe(false);
  expect(res.apply.error).toBe('forbidden');
});
