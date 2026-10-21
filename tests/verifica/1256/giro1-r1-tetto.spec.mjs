// Verifica #1256, giro 1: r1 il limite di spesa che scende per un backup più stretto non è detto dalla conferma.
import { test, expect } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { confirmText } from '../../helpers/confirm.mjs';
import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
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

test('r1 tetto di qui 50 €, backup con 5 €: la conferma dice che il limite scende', async () => {
  const userData = cartellaTemporanea('filo-ver1256-tetto-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { monthlyLimitEur: 50 } }), 'utf8');
  const zipPath = join(userData, 'tetto5.zip');
  writeFileSync(zipPath, buildExportZip({ settings: { monthlyLimitEur: 5, theme: 'dark' } }));
  const { app, shell } = await lancia(userData);
  try {
    const page = await apri(app, shell, 'filo://security/security.html');
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zipPath);
    await page.locator('#sec-import-btn').scrollIntoViewIfNeeded();
    await page.locator('#sec-import-btn').click();
    await expect.poll(() => confirmText(page), { timeout: 15000 }).toContain('tetto5.zip');
    const testo = await confirmText(page);
    // Il limite di adesso (50 €) lascia il posto a quello del backup (5 €): la conferma lo dice coi numeri.
    expect(testo).toMatch(/50 €/);
    expect(testo).toMatch(/(^|\D)5 €/);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
