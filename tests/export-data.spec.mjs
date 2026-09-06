// Feedback alpha: "aggiungi ad impostazioni/sicurezza «esporta dati» che salva
// tutti i dati di Filo (memorie agenti, contenuti copiati…) come file zip
// (json + immagini copiate)".
//
// Due verifiche, entrambe asseriscono il SUCCESSO (i dati finiscono davvero
// nello zip), non l'assenza di errore:
//   1) buildExportZip (logica pura) produce uno zip valido con data.json +
//      manifest.json + le immagini estratte dai data-URL.
//   2) end-to-end: il bottone "Esporta dati" nella pagina Sicurezza salva uno
//      zip che contiene i dati realmente presenti nello storage.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildExportZip } = require('../src/main/services/exportData.js');

// 1x1 PNG rosso
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('buildExportZip: zip valido con data.json, manifest e immagini estratte', () => {
  const data = {
    filo_memory: { PROFILO: 'Mario', PREFERENZE: 'caffè' },
    clipboardHistory: [
      { type: 'text', text: 'ciao' },
      { type: 'image', description: 'logo', dataUrl: `data:image/png;base64,${RED_PNG_B64}` },
    ],
  };
  const zip = buildExportZip(data);
  expect(Buffer.isBuffer(zip)).toBe(true);
  // Firma PK\x03\x04
  expect(zip[0]).toBe(0x50);
  expect(zip[1]).toBe(0x4b);

  const dir = mkdtempSync(join(tmpdir(), 'filo-zip-'));
  try {
    const zipPath = join(dir, 'export.zip');
    writeFileSync(zipPath, zip);

    // unzip riconosce ed elenca i contenuti (verifica integrità reale).
    const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
    expect(listing).toContain('data.json');
    expect(listing).toContain('manifest.json');
    expect(listing).toContain('images/img-1.png');

    // data.json contiene i dati e il data-URL è stato sostituito col percorso file.
    const jsonTxt = execFileSync('unzip', ['-p', zipPath, 'data.json'], { encoding: 'utf8' });
    const parsed = JSON.parse(jsonTxt);
    expect(parsed.filo_memory.PROFILO).toBe('Mario');
    expect(parsed.clipboardHistory[1].dataUrl).toBe('images/img-1.png');

    // L'immagine estratta ha gli stessi byte del PNG originale.
    execFileSync('unzip', ['-o', zipPath, 'images/img-1.png', '-d', dir]);
    const imgBytes = readFileSync(join(dir, 'images', 'img-1.png'));
    expect(Buffer.compare(imgBytes, Buffer.from(RED_PNG_B64, 'base64'))).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pagina Sicurezza: il bottone "Esporta dati" salva uno zip con i dati', async ({ testServer }) => {
  const userData = mkdtempSync(join(tmpdir(), 'filo-exp-'));
  const seed = {
    filo_memory: { PROFILO: 'TestUtente' },
    clipboardHistory: [
      { type: 'image', description: 'x', dataUrl: `data:image/png;base64,${RED_PNG_B64}` },
    ],
  };
  writeFileSync(join(userData, 'storage.json'), JSON.stringify(seed), 'utf8');
  const outPath = join(userData, 'out.zip');

  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });

  try {
    // Stub del dialog di salvataggio: nessuna finestra nativa, salva su outPath.
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, outPath);

    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));

    // Trova la Page della pagina Sicurezza.
    let page = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      page = app.windows().find((w) => {
        try { return new URL(w.url()).hostname === 'security'; } catch (_) { return false; }
      });
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(page).toBeTruthy();
    await page.waitForLoadState('domcontentloaded');

    const btn = page.locator('#sec-export-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText(/Esporta/);
    await btn.click();

    // Attendi che il file venga scritto.
    await expect.poll(() => existsSync(outPath), { timeout: 8000 }).toBe(true);

    // Lo zip è valido e contiene i dati seminati.
    const listing = execFileSync('unzip', ['-l', outPath], { encoding: 'utf8' });
    expect(listing).toContain('data.json');
    expect(listing).toContain('images/img-1.png');
    const jsonTxt = execFileSync('unzip', ['-p', outPath, 'data.json'], { encoding: 'utf8' });
    expect(JSON.parse(jsonTxt).filo_memory.PROFILO).toBe('TestUtente');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
