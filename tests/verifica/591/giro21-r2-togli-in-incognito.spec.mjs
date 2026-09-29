// Giro 21 di #591, rilievo 2: una risposta tolta dalla pagina Sicurezza resta tolta dopo aver riaperto Filo anche se la
// pagina era aperta in una finestra in incognito. Il caso di riscontro, dalla finestra normale, passa già.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const esiti = [];
const MICROFONO = `<!doctype html><meta charset="utf-8"><title>Riunione</title><script>
  navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)));
</script>`;

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
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
async function avvia() {
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
}
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-g21r2-');
  await avvia();
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

const barra = () => shell.locator('#permesso-bar');

for (const dove of ['normale', 'incognito']) {
  test(`il microfono tolto dalla pagina Sicurezza della finestra ${dove} resta tolto dopo aver riaperto Filo`, async () => {
    test.setTimeout(150_000);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
    const si = barra().getByRole('button', { name: 'Consenti', exact: true });
    await expect(si).toBeEnabled({ timeout: 10_000 });
    await si.click();
    await expect.poll(() => esiti.includes('concesso:audio'), { timeout: 10_000 }).toBe(true);

    if (dove === 'incognito') {
      await shell.evaluate(() => window.filoShell.openIncognito());
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab('filo://security/security.html');
      });
    } else {
      await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
    }
    let sicurezza = null;
    await expect.poll(() => { sicurezza = app.windows().find((w) => w.url().startsWith('filo://security')); return Boolean(sicurezza); }, { timeout: 15_000 }).toBe(true);
    const righe = sicurezza.locator('#sec-perm-list li');
    await expect(righe.filter({ hasText: 'Microfono: consentito' })).toHaveCount(1, { timeout: 10_000 });
    await righe.filter({ hasText: 'Microfono' }).getByRole('button', { name: 'Togli' }).click();
    await expect(righe.filter({ hasText: 'Microfono' })).toHaveCount(0, { timeout: 10_000 });
    await new Promise((ok) => setTimeout(ok, 2000));
    await chiudiApp(app);

    esiti.length = 0;
    await avvia();
    await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
    await new Promise((ok) => setTimeout(ok, 4000));
    expect(esiti, 'il microfono tolto torna concesso senza domanda dopo aver riaperto Filo').not.toContain('concesso:audio');
    await expect(barra()).toContainText('vuole usare il microfono', { timeout: 10_000 });
  });
}
