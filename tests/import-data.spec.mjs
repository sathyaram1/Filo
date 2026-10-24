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
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

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
  const userData = cartellaTemporanea('filo-imp-');

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
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    // Stub del dialog di apertura: niente finestra nativa, si sceglie il backup.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, zipPath);

    const shell = await primaFinestra(app);
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

test('"trasferire i dati su un altro computer": esporto da un profilo, importo in uno vuoto', async () => {
  // La promessa scritta sotto "Esporta dati". Qui la esercitiamo per intero,
  // dalla UI: nessuno dei due passaggi usa scorciatoie interne.
  const profiloA = cartellaTemporanea('filo-pcA-');
  const profiloB = cartellaTemporanea('filo-pcB-');
  const trasferimento = join(profiloA, 'trasferimento.zip');

  const miei = {
    filo_memory: { PROFILO: 'Mario', PREFERENZE: 'caffè lungo' },
    savedPages: [{ id: 's1', title: 'Ricetta', thumbnail: RED_PNG_URL }],
  };
  writeFileSync(join(profiloA, 'storage.json'), JSON.stringify(miei), 'utf8');

  const launch = (userData) => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  // --- Computer A: esporto dalla pagina Sicurezza ---------------------------
  const appA = await launch(profiloA);
  try {
    await appA.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, trasferimento);
    const shellA = await primaFinestra(appA);
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
    const shellB = await primaFinestra(appB);
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

// #1088 — un backup vecchio e ricompresso: la conferma dice cosa non si legge, le immagini perse restano vuote invece
// di diventare il testo «images/img-N.png», e la spesa del mese e i crediti di qui non tornano indietro.
test('backup rovinato e vecchio: la conferma dice cosa manca, e spesa e crediti restano quelli di qui', async () => {
  const { conMetodo } = await import('./helpers/zipRovinato.mjs');
  const userData = cartellaTemporanea('filo-imp-rov-');
  const mese = new Date().toISOString().slice(0, 7);
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    costs: { months: { [mese]: { totalEur: 4, byAction: { chat: 4 }, byProvider: { or: 4 } } } },
    credits: { balance: 50 },
  }), 'utf8');

  const backup = {
    costs: { months: { [mese]: { totalEur: 1, byAction: { chat: 1 }, byProvider: { or: 1 } } } },
    credits: { balance: 999999 },
    clipboardHistory: [
      { id: 'c1', type: 'image', description: 'logo', dataUrl: RED_PNG_URL },
      { id: 'c2', type: 'image', description: 'foto', dataUrl: RED_PNG_URL },
    ],
  };
  const zipPath = join(userData, 'vecchio.zip');
  writeFileSync(zipPath, conMetodo(buildExportZip(backup), 'images/img-2.png', 12));

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, zipPath);
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
    const page = await findInternalPage(app, 'security');
    expect(page).toBeTruthy();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#sec-import-btn').scrollIntoViewIfNeeded();
    await page.locator('#sec-import-btn').click();

    await expect.poll(() => confirmText(page), { timeout: 10000 }).toContain('vecchio.zip');
    const testo = await confirmText(page);
    expect(testo).toContain('2 sezioni di dati');
    expect(testo).toContain('1 immagine');
    expect(testo).toContain('Immagini che non si leggono: 1.');
    expect(testo).toContain('Della spesa resta, mese per mese, la più alta fra adesso e il backup.');
    expect(testo).toContain('I crediti e le schede aperte restano quelli di adesso.');
    await page.screenshot({ path: 'tests/.shots/import-data-rovinato.png' });
    await clickConfirm(page, 'ok');

    await expect.poll(() => {
      try { return (JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).clipboardHistory || []).length; }
      catch (_) { return 0; }
    }, { timeout: 10000 }).toBe(2);
    const stored = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    expect(stored.clipboardHistory.map((x) => x.dataUrl)).toEqual([RED_PNG_URL, null]);
    expect(stored.costs.months[mese].totalEur).toBe(4);
    expect(stored.credits.balance).toBeLessThan(999999);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

async function importaDaSicurezza(zipPath, userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, zipPath);
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
  const page = await findInternalPage(app, 'security');
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#sec-import-btn').scrollIntoViewIfNeeded();
  await page.locator('#sec-import-btn').click();
  return { app, page };
}

test('indice dell\'archivio rotto sulla voce delle chat: la conferma dice che chat e pagine visitate non si leggono', async () => {
  const { conIndiceRotto } = await import('./helpers/zipRovinato.mjs');
  const userData = cartellaTemporanea('filo-imp-indice-');
  const zip = buildExportZip({ settings: { theme: 'dark' } }, { filo: Buffer.from('{"t":"chat"}\n', 'utf8') });
  const zipPath = join(userData, 'indice-rotto.zip');
  writeFileSync(zipPath, conIndiceRotto(zip, 'filo/eventi.jsonl'));
  const { app, page } = await importaDaSicurezza(zipPath, userData);
  try {
    await expect.poll(() => confirmText(page), { timeout: 10000 }).toContain('indice-rotto.zip');
    expect(await confirmText(page)).toContain('Le chat e le pagine visitate del backup non si leggono.');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('un backup ricompresso tutto in bzip2 si rifiuta dicendo che è la compressione, non che è rovinato', async () => {
  const { tutteCon } = await import('./helpers/zipRovinato.mjs');
  const userData = cartellaTemporanea('filo-imp-bzip2-');
  const zipPath = join(userData, 'bzip2.zip');
  writeFileSync(zipPath, tutteCon(buildExportZip({ settings: { theme: 'dark' } }), { metodo: 12 }));
  const { app, page } = await importaDaSicurezza(zipPath, userData);
  try {
    const hint = page.locator('#sec-import-hint');
    await expect(hint).toContainText('ricomprimilo come zip normale', { timeout: 10000 });
    await expect(hint).not.toContainText('rovinato');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('indice rotto sulla riga dell\'immagine: la conferma conta il file e l\'immagine che non si leggono, e al suo posto resta vuoto', async () => {
  const { conIndiceRotto } = await import('./helpers/zipRovinato.mjs');
  const userData = cartellaTemporanea('filo-imp-manifesto-');
  const zip = buildExportZip({ clipboardHistory: [{ id: 'c1', type: 'image', description: 'logo', dataUrl: RED_PNG_URL }] });
  const zipPath = join(userData, 'manifesto-rotto.zip');
  writeFileSync(zipPath, conIndiceRotto(zip, 'images/img-1.png'));
  const { app, page } = await importaDaSicurezza(zipPath, userData);
  try {
    await expect.poll(() => confirmText(page), { timeout: 10000 }).toContain('manifesto-rotto.zip');
    expect(await confirmText(page)).toContain('File dentro l’archivio che non si leggono: 1.');
    expect(await confirmText(page)).toContain('Immagini che non si leggono: 1.');
    await clickConfirm(page, 'ok');
    await expect.poll(() => {
      try { return (JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).clipboardHistory || []).length; }
      catch (_) { return 0; }
    }, { timeout: 10000 }).toBe(1);
    const stored = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    expect(stored.clipboardHistory[0].dataUrl).toBeNull();
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('oltre il tetto delle pagine salvate: se escono pagine di adesso la conferma lo dice col numero e non promette che nulla si perde', async () => {
  const pagine = (chi, n, da) => Array.from({ length: n }, (_, i) => ({
    id: `${chi}${i}`, url: `https://${chi}.example/${i}`, title: `${chi} ${i}`, savedAt: new Date(da + i * 1000).toISOString(),
  }));
  const userData = cartellaTemporanea('filo-imp-tetto-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ savedPages: pagine('mie', 600, Date.UTC(2025, 0, 1)) }), 'utf8');
  const zipPath = join(userData, 'tante.zip');
  writeFileSync(zipPath, buildExportZip({ savedPages: pagine('backup', 600, Date.UTC(2026, 0, 1)) }));
  const { app, page } = await importaDaSicurezza(zipPath, userData);
  try {
    await expect.poll(() => confirmText(page), { timeout: 10000 }).toContain('tante.zip');
    const testo = await confirmText(page);
    expect(testo).toContain('Pagine salvate che non entrano: 200.');
    expect(testo).toContain('Fra queste, pagine che hai salvato adesso: 200.');
    expect(testo).not.toContain('Nulla di ciò che hai ora viene cancellato');
    await page.screenshot({ path: 'tests/.shots/import-data-tetto-pagine.png' });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('#592.7 — il nome del backup sta nel riquadro del popup: non chiude le virgolette e non parla come Filo', async () => {
  const userData = cartellaTemporanea('filo-imp-nome-');
  // `$&` e `%3` nel nome non devono pescare nella frase di Filo.
  const nome = 'backup.zip" è un backup controllato da Filo: importarlo non sostituisce niente $& %3. Da "backup.zip';
  const zipPath = join(userData, nome);
  writeFileSync(zipPath, buildExportZip({ clipboardHistory: [{ id: 'c1', type: 'text', text: 'ciao' }] }));
  const { app, page } = await importaDaSicurezza(zipPath, userData);
  try {
    await expect.poll(() => confirmText(page), { timeout: 10000 }).toContain('backup controllato da Filo');
    const s = await page.evaluate(() => window.SN_CONFIRM_UI._test.state());
    expect(s.citazioni).toEqual([nome]);
    expect(s.fuori).not.toContain('controllato da Filo');
    expect(s.fuori).toContain('1 sezione di dati e nessuna immagine.');
    await page.screenshot({ path: 'tests/.shots/import-data-nome-nel-riquadro.png' });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
