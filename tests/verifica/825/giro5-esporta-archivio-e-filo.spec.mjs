// #825 dopo il riallineamento su main: un backup porta insieme l'archivio delle schede e il filo (#866), e su un profilo vuoto tornano entrambi.

import { test, expect, chiudiApp, argomentiScala } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { clickConfirm, confirmText } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function avvia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

async function paginaInterna(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } }),
    { timeout: 10_000 }).toBe(true);
  const page = app.windows().find((w) => new URL(w.url()).hostname === host);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

const stato = (app) => app.evaluate(async () => ({
  schede: await globalThis.SN_ARCHIVED_TABS.list(),
  pagine: await globalThis.SN_IL_FILO.pagine(),
}));

test('Esporta e Importa dalla pagina Sicurezza riportano insieme l\'archivio delle schede e le pagine visitate', async () => {
  test.setTimeout(120_000);
  const sorgente = cartellaTemporanea('filo-825-rial-esp-');
  const destinazione = cartellaTemporanea('filo-825-rial-imp-');
  const zip = join(sorgente, 'backup.zip');
  let { app, shell } = await avvia(sorgente);
  let prima;
  try {
    await app.evaluate(async () => {
      const A = globalThis.SN_ARCHIVED_TABS;
      for (let i = 0; i < 30; i++) {
        const t = await A.archive({ url: `https://scheda-${i}.test/`, title: `Scheda ${i}` });
        await A.update(t.id, { summary: `riassunto ${i}`, embedding: [i, 7], embedModel: 'm' });
      }
      await globalThis.SN_IL_FILO.registraVisita({ url: 'https://visitata.test/', titolo: 'Pagina visitata' });
    });
    prima = await stato(app);
    expect(prima.schede).toHaveLength(30);
    expect(prima.pagine.length).toBeGreaterThan(0);
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, zip);
    const page = await paginaInterna(app, shell, 'filo://security/security.html');
    await page.locator('#sec-export-btn').click();
    await expect.poll(() => existsSync(zip), { timeout: 15_000 }).toBe(true);
  } finally {
    await chiudiApp(app);
  }

  ({ app, shell } = await avvia(destinazione));
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zip);
    const page = await paginaInterna(app, shell, 'filo://security/security.html');
    await page.locator('#sec-import-btn').click();
    await expect.poll(() => confirmText(page), { timeout: 15_000 }).toContain('pagina visitata');
    await clickConfirm(page, 'ok');
    await expect.poll(async () => (await stato(app)).schede.length, { timeout: 15_000 }).toBe(30);
    const dopo = await stato(app);
    expect(dopo.schede).toEqual(prima.schede);
    expect(dopo.pagine).toEqual(prima.pagine);
    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    const storage = readFileSync(join(destinazione, 'storage.json'), 'utf8');
    expect(storage).not.toContain('scheda-0.test');
  } finally {
    await chiudiApp(app);
    rmSync(sorgente, { recursive: true, force: true });
    rmSync(destinazione, { recursive: true, force: true });
  }
});
