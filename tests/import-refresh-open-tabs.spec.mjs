// Feedback #442: dopo un'importazione da backup le SCHEDE GIÀ APERTE restavano
// ferme all'elenco di prima. Le impostazioni si riallineavano ovunque (passano
// da applySettingsUpdate, che le annuncia a tutti), i contenuti no: li
// scrivevamo diretti sul disco e nessuno lo diceva alle pagine. Per vedere i
// dati bisognava chiudere e riaprire la scheda — e niente lo suggeriva, quindi
// l'impressione a caldo era che l'importazione non avesse funzionato.
//
// Questi spec asseriscono il SUCCESSO dal punto di vista dell'utente: la scheda
// che aveva aperta MENTRE importava mostra da sola i dati del backup. E lo fa
// senza ricaricarsi: un marcatore piantato su `window` prima dell'import deve
// sopravvivere, altrimenti staremmo testando una navigazione, non un
// riallineamento (e con una navigazione l'utente perderebbe ricerca, filtri e
// posizione nella lista).

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm } from './helpers/confirm.mjs';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { buildExportZip } = require('../src/main/services/exportData.js');

// Pianta un marcatore sulla pagina: se sopravvive all'import, la scheda si è
// riallineata da sé invece di ricaricarsi.
async function stampNoReloadMark(page) {
  await page.evaluate(() => { window.__filoNoReload = 1; });
}
async function markSurvived(page) {
  return page.evaluate(() => window.__filoNoReload === 1);
}

// Scrive un backup .zip col contenuto dato e fa scegliere quello al dialogo di
// apertura (niente finestra nativa, non automatizzabile headless).
async function prepareBackup(app, data) {
  const dir = mkdtempSync(join(tmpdir(), 'filo-imp442-'));
  const zipPath = join(dir, 'backup.zip');
  writeFileSync(zipPath, buildExportZip(data));
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, zipPath);
  return { dir, zipPath };
}

async function runImport(securityPage) {
  const btn = securityPage.locator('#sec-import-btn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await clickConfirm(securityPage, 'ok', { timeout: 10000 });
}

test('#442 — la lista delle pagine salvate aperta si riallinea da sola dopo un import', async ({ app, openTab }) => {
  const backup = await prepareBackup(app, {
    savedPages: [
      { id: 'bk-1', url: 'https://esempio.test/ricetta', title: 'Ricetta del backup', savedAt: '2026-01-01T10:00:00.000Z' },
    ],
  });

  try {
    // La scheda che l'utente ha già aperta mentre importa.
    const home = await openTab('filo://home/home.html');
    await expect(home.locator('#empty')).toBeVisible();
    await expect(home.locator('#grid')).not.toContainText('Ricetta del backup');
    await stampNoReloadMark(home);

    // …e la scheda da cui lancia l'importazione.
    const security = await openTab('filo://security/security.html');
    await runImport(security);

    // Il dato del backup arriva all'utente SENZA che debba toccare niente.
    await expect(home.locator('#grid')).toContainText('Ricetta del backup', { timeout: 10000 });
    expect(await markSurvived(home), 'riallineata, non ricaricata').toBe(true);
  } finally {
    rmSync(backup.dir, { recursive: true, force: true });
  }
});

test('#442 — anche cronologia AI e archivio aperti si riallineano', async ({ app, openTab }) => {
  const backup = await prepareBackup(app, {
    aiHistory: [{
      id: 'h-1', action: 'explain', model: 'test/model',
      timestamp: '2026-01-01T10:00:00.000Z',
      input: 'termine del backup', output: 'spiegazione del backup',
    }],
    archivedTabs: [{
      id: 'a-1', url: 'https://esempio.test/scheda', title: 'Scheda archiviata del backup',
      closedAt: '2026-01-01T10:00:00.000Z',
    }],
  });

  try {
    const history = await openTab('filo://history/history.html');
    await expect(history.locator('#empty')).toBeVisible();
    await stampNoReloadMark(history);

    const archive = await openTab('filo://archive/archive.html');
    await stampNoReloadMark(archive);

    const security = await openTab('filo://security/security.html');
    await runImport(security);

    await expect(history.locator('#list')).toContainText('spiegazione del backup', { timeout: 10000 });
    expect(await markSurvived(history), 'cronologia riallineata, non ricaricata').toBe(true);

    await expect(archive.locator('#list')).toContainText('Scheda archiviata del backup', { timeout: 10000 });
    expect(await markSurvived(archive), 'archivio riallineato, non ricaricato').toBe(true);
  } finally {
    rmSync(backup.dir, { recursive: true, force: true });
  }
});

test('#442 — la conferma "importazione completata" resta leggibile (niente reload della pagina)', async ({ app, openTab }) => {
  // Prima la pagina Sicurezza si ricaricava da sola 1,2s dopo l'import per
  // rileggere le impostazioni: portava via il messaggio di esito prima che si
  // finisse di leggerlo. Ora il riallineamento è mirato e il messaggio resta.
  const backup = await prepareBackup(app, { settings: { theme: 'dark' } });

  try {
    const security = await openTab('filo://security/security.html');
    await stampNoReloadMark(security);
    await runImport(security);

    const hint = security.locator('#sec-import-hint');
    await expect(hint).toBeVisible({ timeout: 10000 });
    // Ben oltre il vecchio reload a 1,2s: il messaggio dev'esserci ancora.
    await security.waitForTimeout(2000);
    await expect(hint).toBeVisible();
    expect(await markSurvived(security), 'Sicurezza riallineata, non ricaricata').toBe(true);

    // E le impostazioni importate sono davvero attive.
    await expect.poll(
      () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme),
      { timeout: 10000 },
    ).toBe('dark');
  } finally {
    rmSync(backup.dir, { recursive: true, force: true });
  }
});
