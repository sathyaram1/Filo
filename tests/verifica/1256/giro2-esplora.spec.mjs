// Verifica #1256, giro 2: esplorazione delle strade vicine al caso della segnalazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { clickConfirm, confirmText, confirmState } from '../../helpers/confirm.mjs';
import { createRequire } from 'node:module';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const { buildExportZip } = require('../../../src/main/services/exportData.js');

async function lancia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  return { app, shell: await primaFinestra(app) };
}
async function paginaNuova(app, hostname, prima, timeout = 15000) {
  const fine = Date.now() + timeout;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).hostname === hostname && !prima.includes(w); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna pagina ${hostname}`);
}
async function apri(app, shell, url) {
  const prima = app.windows().slice();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  return paginaNuova(app, new URL(url).hostname, prima);
}
async function apriConferma(app, page, zipPath, nome) {
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zipPath);
  await page.locator('#sec-import-btn').scrollIntoViewIfNeeded();
  await page.locator('#sec-import-btn').click();
  await expect.poll(() => confirmText(page), { timeout: 15000 }).toContain(nome);
  return confirmText(page);
}
const disco = (userData) => { try { return JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')); } catch (_) { return {}; } };

test('computer nuovo, backup con 20 €: resta 5 €, il bottone mette 20 € e le Preferenze aperte lo mostrano', async () => {
  const userData = cartellaTemporanea('filo-ver1256-g2-nuovo-');
  const zipPath = join(userData, 'venti.zip');
  writeFileSync(zipPath, buildExportZip({ settings: { monthlyLimitEur: 20 }, downloads: [{ id: 'dl-b', filename: 'manuale-dal-backup.pdf', url: 'https://example.com/m.pdf', state: 'completed', savePath: '', startedAt: '2026-10-02T10:00:00.000Z', endedAt: '2026-10-02T10:00:05.000Z' }] }));
  const { app, shell } = await lancia(userData);
  try {
    const opzioni = await apri(app, shell, 'filo://options/options.html');
    const scaricati = await apri(app, shell, 'filo://downloads/downloads.html');
    await expect(scaricati.locator('body')).not.toContainText('manuale-dal-backup.pdf');
    const page = await apri(app, shell, 'filo://security/security.html');
    const testo = await apriConferma(app, page, zipPath, 'venti.zip');
    expect(testo).toContain('Il limite di spesa mensile resta 5 €. Nel backup era 20 €.');
    expect((await confirmState(page)).altroLabel).toBe('Importa col limite del backup');
    await page.screenshot({ path: 'tests/.shots/ver1256-g2-tetto20.png' });
    await clickConfirm(page, 'altro');
    await expect.poll(() => disco(userData).settings?.monthlyLimitEur, { timeout: 10000 }).toBe(20);
    await expect(scaricati.locator('body')).toContainText('manuale-dal-backup.pdf', { timeout: 10000 });
    await expect.poll(() => opzioni.locator('#monthlyLimit').inputValue(), { timeout: 10000 }).toBe('20');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
