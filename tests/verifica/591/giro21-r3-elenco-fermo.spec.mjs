// Giro 21 di #591, rilievo 3: la pagina Sicurezza aperta mostra anche le risposte date dopo che si è aperta.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const MICROFONO = `<!doctype html><meta charset="utf-8"><title>Riunione</title><script>
  navigator.mediaDevices.getUserMedia({ audio: true }).then(() => {}, () => {});
</script>`;

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MICROFONO);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

let app;
let shell;
let userData;
test.beforeEach(async () => {
  userData = cartellaTemporanea('filo-test-g21r3-');
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

test('la pagina Sicurezza già aperta mostra il permesso concesso in un\'altra scheda quando ci si torna', async () => {
  test.setTimeout(60_000);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  let sicurezza = null;
  await expect.poll(() => { sicurezza = app.windows().find((w) => w.url().startsWith('filo://security')); return Boolean(sicurezza); }, { timeout: 15_000 }).toBe(true);
  await expect(sicurezza.locator('#sec-perm-list')).toContainText('Nessuna risposta', { timeout: 10_000 });

  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
  const si = shell.locator('#permesso-bar').getByRole('button', { name: 'Consenti', exact: true });
  await expect(si).toBeEnabled({ timeout: 10_000 });
  await si.click();
  await expect(shell.locator('#permesso-bar')).toBeHidden({ timeout: 10_000 });

  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  await expect(sicurezza.locator('#sec-perm-list li').filter({ hasText: 'Microfono: consentito' }),
    'la pagina Sicurezza aperta non mostra la risposta appena data').toHaveCount(1, { timeout: 10_000 });
});
