// #796 giro 4: un sito fidato salvato prima del cambio (gov.it, quando per Filo era un sito solo) deve restare fidato.

import { test as base, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOME = 'www.agenziaentrate.gov.it';

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-fidati-');
    const app = await electron.launch({
      args: [...argomentiScala, `--host-resolver-rules=MAP ${NOME} 127.0.0.1`, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

test('r1 un sito fidato salvato come gov.it resta connesso sul sito dell\'Agenzia delle Entrate', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: ['gov.it'] } } },
  }));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy')), { timeout: 5000 }).toBe(true);
  const porta = new URL(testServer.origin).port;
  const id = new URL(testServer.html('<title>AE</title><p>ae</p>')).pathname;
  await openTab(`http://${NOME}:${porta}${id}`);
  const partizione = await app.evaluate(({ BrowserWindow }, nome) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => String(x.url || '').includes(nome));
      if (t) return t.partition || null;
    }
    return null;
  }, NOME);
  expect(partizione, 'jar persistente: il sito fidato tiene l\'accesso').toMatch(/^persist:/);
});
