// Verifica #1273 giro 7, rilievo 1: «Aperti per dopo» mostra come anteprima l'indirizzo che il backup importato scrive,
// e a ogni apertura lo chiede al sito che lo ospita: un contatto che né l'elenco né la sentinella dichiarano.

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';
import { clickConfirm, confirmText } from '../../helpers/confirm.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const { buildExportZip } = require('../../../src/main/services/exportData.js');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YaMBAAL8AS3/gzpXAAAAAElFTkSuQmCC', 'base64');

async function pagina(app, host) {
  let p = null;
  await expect.poll(() => Boolean(p = app.windows().find((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } })),
    { timeout: 20_000 }).toBe(true);
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  return p;
}

test('r1 una pagina salvata arrivata da un backup non fa chiedere a nessun sito la sua anteprima quando si apre «Aperti per dopo»', async () => {
  test.setTimeout(120_000);
  const richieste = [];
  const server = createServer((req, res) => {
    richieste.push(`${String(req.headers.host || '').split(':')[0]}${req.url}`);
    res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const P = server.address().port;
  const userData = cartellaTemporanea('filo-ver1273-g7-');
  mkdirSync(userData, { recursive: true });
  const zipPath = join(userData, 'backup.zip');
  writeFileSync(zipPath, buildExportZip({
    savedPages: [{ id: 'b1', url: 'https://ricette.example/torta', title: 'La torta della nonna',
      thumbnail: `http://traccia.test:${P}/anteprima.png`, savedAt: '2026-10-01T10:00:00.000Z' }],
  }));
  let app = null;
  try {
    app = await electron.launch({
      args: [...argomentiScala, '--host-resolver-rules=MAP traccia.test 127.0.0.1', '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
    });
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, zipPath);
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
    const sec = await pagina(app, 'security');
    const btn = sec.locator('#sec-import-btn');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expect.poll(() => confirmText(sec), { timeout: 10_000 }).toContain('backup.zip');
    await clickConfirm(sec, 'ok');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.title)), { timeout: 10_000 })
      .toContain('La torta della nonna');

    await shell.evaluate(() => window.filoShell.tabs.open('filo://home/home.html'));
    const home = await pagina(app, 'home');
    await expect(home.locator('.sn-card', { hasText: 'La torta della nonna' })).toBeVisible({ timeout: 15_000 });
    await home.waitForTimeout(2000);
    expect(richieste, 'aprendo «Aperti per dopo» nessun sito riceve la richiesta dell’anteprima').toEqual([]);
  } finally {
    if (app) await chiudiApp(app);
    await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
    rmSync(userData, { recursive: true, force: true });
  }
});
