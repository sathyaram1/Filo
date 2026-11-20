// #1589.8 — i livelli di privacy visti da chi arriva con dati suoi: chi aggiorna con la protezione delle pagine delicate
// accesa (anche solo di serie) apre Filo su «Chiedi sulle delicate»; un backup importato da Sicurezza con un livello più
// largo non allarga quello di adesso. Filo si apre su un file di dati scritto prima, come sul computer di chi aggiorna.

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';
import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildExportZip } = require('../src/main/services/exportData.js');

async function avvia(userData, storage) {
  writeFileSync(join(userData, 'storage.json'), JSON.stringify(storage), 'utf8');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}
async function sicurezza(app, shell) {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'security'; } catch (_) { return false; } });
    return Boolean(page);
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  return page;
}
const regola = (app) => app.evaluate(async () => globalThis.SN_LIVELLI_PRIVACY.regola(await globalThis.SN_STORAGE.getSettings()));

// Le impostazioni come le scriveva Filo prima dei livelli: l'interruttore c'era sempre, acceso di serie.
const diPrima = (enabled) => ({ settings: { theme: 'light', security: { pagineDelicate: { enabled, siti: [], righeScartate: [], nonDelicati: [] } } } });

test('chi aggiorna con la protezione delle pagine delicate accesa apre Filo su «Chiedi sulle delicate»', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-1589-agg-');
  const { app, shell } = await avvia(userData, diPrima(true));
  try {
    expect((await regola(app)).livello).toBe('delicate');
    const page = await sicurezza(app, shell);
    await expect(page.locator('#privacy-livello-delicate')).toBeChecked({ timeout: 8000 });
    // Dalla posta non parte niente da solo: la regola che usano spiegazioni e descrizioni.
    expect(await app.evaluate(() => globalThis.SN_DELICATE.chiede('https://mail.google.com/mail/u/0/'))).toBe('posta');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('chi l\'aveva spenta resta su «Tutto in anticipo»', async () => {
  test.setTimeout(60_000);
  const userData = cartellaTemporanea('filo-1589-agg-off-');
  const { app } = await avvia(userData, diPrima(false));
  try {
    expect((await regola(app)).livello).toBe('anticipo');
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});

test('un backup importato da Sicurezza con un livello più largo tiene quello di adesso', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-1589-imp-');
  const qui = { settings: { theme: 'light', security: { privacy: { livello: 'sempre', incognito: 'sempre', chiedi: ['sanita', 'banche'], sitiAnticipo: [] } } } };
  const backup = { settings: { theme: 'dark', security: { privacy: { livello: 'anticipo', incognito: 'anticipo', chiedi: [], sitiAnticipo: ['banca-di-prova.it'] } } } };
  const zip = join(userData, 'backup.zip');
  writeFileSync(zip, buildExportZip(backup));
  const { app, shell } = await avvia(userData, qui);
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zip);
    const page = await sicurezza(app, shell);
    await page.locator('#sec-import-btn').scrollIntoViewIfNeeded();
    await page.locator('#sec-import-btn').click();
    await expect.poll(() => confirmText(page), { timeout: 10_000 }).toContain('backup.zip');
    await clickConfirm(page, 'ok');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme), { timeout: 10_000 }).toBe('dark');
    const r = await regola(app);
    expect(r.livello).toBe('sempre');
    expect(r.incognito).toBe('sempre');
    expect(r.chiedi).toEqual(['banche', 'sanita']);
    expect(r.sitiAnticipo).toEqual([]);
    await expect(page.locator('#privacy-livello-sempre')).toBeChecked({ timeout: 8000 });
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
