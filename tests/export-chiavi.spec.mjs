// #905 — l'archivio esportato dalla pagina Sicurezza non porta le chiavi API, a meno che l'utente spunti «Includi le
// chiavi»; un archivio senza chiavi importato lascia quelle che ci sono; senza portachiavi Filo dice, una volta sola,
// che le chiavi API vanno sul disco in chiaro.

import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const require = createRequire(import.meta.url);
const { buildExportZip, readExportZip } = require('../src/main/services/exportData.js');

const CHIAVE = 'sk-or-v1-chiave-di-prova-0123456789abcdef';
const CHIAVE_QUI = 'sk-or-v1-chiave-di-questo-computer-98765';

async function avvia(userData) {
  return electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
}

async function apriSicurezza(app) {
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
  const page = await aspettaFinestra(app, (w) => { try { return new URL(w.url()).hostname === 'security'; } catch (_) { return false; } }, 'la pagina Sicurezza non si è aperta');
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('Esporta: senza la spunta le chiavi restano fuori dall\'archivio, con la spunta entrano', async () => {
  const userData = cartellaTemporanea('filo-chiavi-exp-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    settings: { theme: 'dark', apiKeys: { openrouter: CHIAVE, tavily: '' } },
    clipboardHistory: [{ type: 'text', text: CHIAVE, ts: 1 }],
    filo_memory: { PROFILO: 'Chi esporta' },
  }), 'utf8');
  const senza = join(userData, 'senza.zip');
  const con = join(userData, 'con.zip');
  const app = await avvia(userData);
  try {
    await app.evaluate(({ dialog }, percorsi) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: percorsi.shift() });
    }, [senza, con]);
    const page = await apriSicurezza(app);

    const casella = page.locator('#sec-export-keys');
    await expect(page.locator('#sec-export-keys-row')).toBeVisible();
    await expect(page.locator('#sec-export-keys-label')).toHaveText('Includi le chiavi');
    await expect(page.locator('#sec-export-keys-desc')).toContainText('Trattalo come una password');
    await expect(casella).not.toBeChecked();

    await page.locator('#sec-export-btn').click();
    await expect.poll(() => existsSync(senza), { timeout: 8000 }).toBe(true);
    const zipSenza = readFileSync(senza);
    expect(zipSenza.includes(Buffer.from(CHIAVE)), 'la chiave non deve stare da nessuna parte nell\'archivio').toBe(false);
    const dati = readExportZip(zipSenza).data;
    expect(dati.settings.apiKeys).toBeUndefined();
    expect(dati.filo_memory.PROFILO).toBe('Chi esporta');

    // La stessa scelta vale dalla conferma di «Cancella tutti i dati»: le due caselle vanno insieme.
    await casella.check();
    await page.locator('#sec-wipe-btn').click();
    await expect(page.locator('#sec-wipe-export-keys')).toBeChecked();
    await page.locator('#sec-wipe-export-keys').uncheck();
    await expect(casella).not.toBeChecked();
    await page.locator('#sec-wipe-export-keys').check();
    await expect(casella).toBeChecked();
    mkdirSync(SHOTS, { recursive: true });
    await page.locator('#sec-export-row').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOTS, 'export-chiavi.png'), fullPage: false });

    await page.locator('#sec-wipe-export').click();
    await expect.poll(() => existsSync(con), { timeout: 8000 }).toBe(true);
    const conChiavi = readExportZip(readFileSync(con)).data;
    expect(conChiavi.settings.apiKeys.openrouter).toBe(CHIAVE);
    expect(conChiavi.clipboardHistory[0].text).toBe(CHIAVE);

    // Tolta la chiave dalle Opzioni, la casella non ha più niente da includere e sparisce.
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '', tavily: '' } }); });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#sec-export-btn')).toBeVisible();
    await expect(page.locator('#sec-export-keys-row')).toBeHidden();
    await expect(page.locator('#sec-wipe-export-keys-row')).toBeHidden();
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('Importa: un archivio senza chiavi lascia quelle di questo computer, e la conferma lo dice prima', async () => {
  const userData = cartellaTemporanea('filo-chiavi-imp-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    settings: { theme: 'light', apiKeys: { openrouter: CHIAVE_QUI, tavily: '' } },
  }), 'utf8');
  const zipPath = join(userData, 'backup.zip');
  // Esportato com'è di serie da un altro computer, che una chiave l'aveva.
  writeFileSync(zipPath, buildExportZip({ settings: { theme: 'dark', apiKeys: { openrouter: CHIAVE, tavily: '' } }, filo_memory: { PROFILO: 'Dal backup' } }));
  const app = await avvia(userData);
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zipPath);
    const page = await apriSicurezza(app);
    await page.locator('#sec-import-btn').click();
    await expect.poll(() => confirmText(page), { timeout: 10000 }).toContain('backup.zip');
    expect(await confirmText(page)).toContain('Le chiavi API non sono nell’archivio. Quelle salvate qui restano come sono.');
    await clickConfirm(page, 'ok');

    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme), { timeout: 10000 }).toBe('dark');
    const dopo = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys);
    expect(dopo.openrouter).toBe(CHIAVE_QUI);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('Importa: il proxy con password arriva col solo indirizzo, e la conferma dice di riscriverlo (#905.1)', async () => {
  const userData = cartellaTemporanea('filo-chiavi-proxy-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: 'light' } }), 'utf8');
  const zipPath = join(userData, 'backup-proxy.zip');
  writeFileSync(zipPath, buildExportZip({ settings: { theme: 'dark', proxy: { datacenter: 'http://mario:password-del-proxy@gate.example.com:8080' } } }));
  const app = await avvia(userData);
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zipPath);
    const page = await apriSicurezza(app);
    await page.locator('#sec-import-btn').click();
    await expect.poll(() => confirmText(page), { timeout: 10000 }).toContain('backup-proxy.zip');
    expect(await confirmText(page)).toContain('Il proxy arriva senza utente e password');
    await clickConfirm(page, 'ok');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).proxy?.datacenter), { timeout: 10000 })
      .toBe('http://gate.example.com:8080');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

// Il portachiavi si spegne a comando, come in auth-accesso-non-ricordato.spec.mjs.
async function senzaPortachiavi(app) {
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => false;
    safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret';
  });
}
const avvisiInChiaro = (app) => app.evaluate(() => globalThis.__filoStorage.statoDisco().avvisi.filter((a) => a.chiave === 'chiavi-in-chiaro').length);

test('senza portachiavi: alla prima chiave salvata Filo dice che resta in chiaro, una volta sola', async () => {
  const userData = cartellaTemporanea('filo-chiavi-chiaro-');
  // Coi modelli di Filo la casella della chiave non si vede: qui l'utente usa la sua.
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: 'light', useDefaultModels: false } }), 'utf8');
  let app = await avvia(userData);
  try {
    await senzaPortachiavi(app);
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://options/'));
    const opzioni = await aspettaFinestra(app, (w) => { try { return new URL(w.url()).hostname === 'options'; } catch (_) { return false; } }, 'le Opzioni non si sono aperte');
    await opzioni.waitForLoadState('domcontentloaded');
    const campo = opzioni.locator('#apiKey');
    await campo.fill(CHIAVE);
    await campo.press('Tab');

    const vista = await aspettaFinestra(app, (w) => w.url().startsWith('filo://shell/avvisi.html'), 'nessun avviso nella finestra');
    const avviso = vista.locator('.shell-notif-msg', { hasText: 'chiavi API in chiaro' });
    await expect(avviso).toBeVisible({ timeout: 10000 });
    if (process.platform === 'linux') await expect(avviso).toContainText('GNOME Keyring');
    mkdirSync(SHOTS, { recursive: true });
    await vista.screenshot({ path: join(SHOTS, 'chiavi-in-chiaro.png') });

    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    const suDisco = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    expect(suDisco.settings.apiKeys.openrouter, 'senza portachiavi la chiave sta in chiaro: è quello che l\'avviso dice').toBe(CHIAVE);
    await expect.poll(() => JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).avvisoChiaviInChiaro > 0, { timeout: 5000 }).toBe(true);

    // Un'altra chiave, nella stessa sessione: niente secondo avviso.
    await campo.fill(`${CHIAVE}-nuova`);
    await campo.press('Tab');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter)).toBe(`${CHIAVE}-nuova`);
    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    expect(await avvisiInChiaro(app)).toBe(1);
    await expect(avviso).toHaveCount(1);

    // Riaperto Filo, sempre senza portachiavi: l'avviso è già stato dato.
    await app.close();
    app = await avvia(userData);
    await senzaPortachiavi(app);
    await primaFinestra(app);
    await app.evaluate(async () => {
      await globalThis.__filoStorage.set({ provaRiapertura: Date.now() });
      await globalThis.__filoStorage.whenSettled();
    });
    expect(JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).settings.apiKeys.openrouter).toBe(`${CHIAVE}-nuova`);
    expect(await avvisiInChiaro(app)).toBe(0);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('col portachiavi la chiave salvata non fa partire nessun avviso', async () => {
  const userData = cartellaTemporanea('filo-chiavi-cifrate-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: 'light' } }), 'utf8');
  const app = await avvia(userData);
  try {
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = (s) => Buffer.from(String(s), 'utf8');
      safeStorage.decryptString = (b) => Buffer.from(b).toString('utf8');
    });
    await primaFinestra(app);
    await app.evaluate(async (k) => {
      await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k } });
      await globalThis.__filoStorage.whenSettled();
    }, CHIAVE);
    const suDisco = readFileSync(join(userData, 'storage.json'), 'utf8');
    expect(suDisco.includes(CHIAVE)).toBe(false);
    expect(await avvisiInChiaro(app)).toBe(0);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
