// #796 giro 5: un sito fidato scritto a mano vale per il suo sito e per nessun altro.

import { test as base, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOMI = ['www.bbc.co.uk', 'www.argos.co.uk', 'webmail.libero.it'];

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-fidati5-');
    const app = await electron.launch({
      args: [...argomentiScala, `--host-resolver-rules=${NOMI.map((n) => `MAP ${n} 127.0.0.1`).join(', ')}`, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

async function privacyCon(app, shell, fidati) {
  await shell.evaluate((f) => window.filoShell.message({
    type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: f } } },
  }), fidati);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy')), { timeout: 5000 }).toBe(true);
}

async function partizioneDi(app, openTab, testServer, nome) {
  const porta = new URL(testServer.origin).port;
  const id = new URL(testServer.html(`<title>${nome}</title><p>${nome}</p>`)).pathname;
  await openTab(`http://${nome}:${porta}${id}`);
  return app.evaluate(({ BrowserWindow }, n) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => String(x.url || '').includes(n));
      if (t) return t.partition || null;
    }
    return null;
  }, nome);
}

test('r1 fidarsi di «co.uk» non mette due siti inglesi diversi nello stesso vaso di cookie', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await privacyCon(app, shell, ['co.uk']);
  const bbc = await partizioneDi(app, openTab, testServer, 'www.bbc.co.uk');
  const argos = await partizioneDi(app, openTab, testServer, 'www.argos.co.uk');
  expect(bbc).toBeTruthy();
  expect(argos, 'bbc.co.uk e argos.co.uk sono due siti: due vasi').not.toBe(bbc);
});

test('r2 un sito fidato scritto col suo sottodominio (webmail.libero.it) resta connesso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await privacyCon(app, shell, ['webmail.libero.it']);
  const p = await partizioneDi(app, openTab, testServer, 'webmail.libero.it');
  expect(p, 'vaso persistente: il sito fidato tiene l\'accesso').toMatch(/^persist:/);
});
