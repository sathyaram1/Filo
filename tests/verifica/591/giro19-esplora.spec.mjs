// Esplorazione del giro 19 (#591): cosa vede una pagina dei permessi che la regola nuova non chiede.

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
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Posta</title>
<button id="b" style="position:fixed;top:100px;left:100px;width:200px;height:80px">vai</button>
<script>
  const manda = (m) => fetch('/esito?m=' + encodeURIComponent(m));
  manda('vis:' + document.visibilityState);
  manda('Notification.permission:' + Notification.permission);
  navigator.permissions.query({ name: 'notifications' }).then((s) => manda('query-notifiche:' + s.state), (e) => manda('query-notifiche-err:' + e.name));
  navigator.permissions.query({ name: 'microphone' }).then((s) => manda('query-mic:' + s.state), (e) => manda('query-mic-err:' + e.name));
  navigator.storage && navigator.storage.persist && navigator.storage.persist().then((x) => manda('persist:' + x), (e) => manda('persist-err:' + e.name));
  document.getElementById('b').addEventListener('click', () => {
    manda('clic');
    if (navigator.wakeLock) navigator.wakeLock.request('screen').then(() => manda('wakelock:ok'), (e) => manda('wakelock:' + e.name + ':' + e.message));
    Notification.requestPermission().then((x) => manda('richiesta-notifiche:' + x));
  });
</script>`;

let server; let origine; let app; let shell; let userData;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINA);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((ok) => server.close(ok)); });
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-esplora-');
  app = await electron.launch({ args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => { await chiudiApp(app); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} });

test('esplora', async () => {
  test.setTimeout(60_000);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/');
  await expect.poll(() => esiti.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
  await new Promise((r) => setTimeout(r, 1500));
  // Clic vero nella pagina: si cerca la view per URL.
  const pagina = app.windows().find((w) => w.url().startsWith(origine));
  if (pagina) await pagina.click('#b');
  await new Promise((r) => setTimeout(r, 3000));
  const bar = await shell.evaluate(() => { const b = document.getElementById('permesso-bar'); return b && !b.hidden ? b.innerText : '(nessuna domanda)'; });
  console.log('ESITI', JSON.stringify(esiti, null, 1), 'BARRA', bar);
});

test('aspetto della domanda, chiaro e scuro, stretto', async () => {
  test.setTimeout(60_000);
  const mic = `<!doctype html><title>Riunione</title><script>navigator.mediaDevices.getUserMedia({audio:true,video:true}).catch(()=>{})</script>`;
  server.removeAllListeners('request');
  server.on('request', (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(mic); });
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/');
  await expect(shell.locator('#permesso-bar')).toBeVisible({ timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 1300));
  await shell.screenshot({ path: 'tests/.shots/giro19-permesso-chiaro.png' });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await new Promise((r) => setTimeout(r, 300));
  await shell.screenshot({ path: 'tests/.shots/giro19-permesso-scuro.png' });
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setSize(720, 500); });
  await new Promise((r) => setTimeout(r, 600));
  await shell.screenshot({ path: 'tests/.shots/giro19-permesso-stretto.png' });
});

test('nome del permesso', async () => {
  test.setTimeout(60_000);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/');
  await expect.poll(() => esiti.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
  await app.evaluate(({ webContents }, o) => {
    globalThis.__nomi = [];
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(o));
    wc.session.setPermissionRequestHandler((_w, p, cb) => { globalThis.__nomi.push(p); cb(false); });
  }, origine);
  const pagina = app.windows().find((w) => w.url().startsWith(origine));
  await pagina.click('#b');
  await new Promise((r) => setTimeout(r, 1500));
  console.log('NOMI', await app.evaluate(() => globalThis.__nomi));
});

test('incognito: la domanda compare nella sua cornice', async () => {
  test.setTimeout(60_000);
  const mic = `<!doctype html><title>Riunione</title><script>navigator.mediaDevices.getUserMedia({audio:true}).then(()=>fetch('/esito?m=ok'),(e)=>fetch('/esito?m=no:'+e.name))</script>`;
  server.removeAllListeners('request');
  server.on('request', (req, res) => { const u = new URL(req.url, 'http://x'); if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; } res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(mic); });
  await shell.evaluate(() => window.filoShell.openIncognito());
  let incog = null;
  await expect.poll(() => { incog = app.windows().find((w) => w.url().includes('incognito=1')); return Boolean(incog); }, { timeout: 10_000 }).toBe(true);
  await incog.waitForFunction(() => document.documentElement.dataset.incognito === '1', null, { timeout: 10000 });
  await incog.evaluate((u) => window.filoShell.tabs.open(u), origine + '/');
  await expect(incog.locator('#permesso-bar')).toBeVisible({ timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 1200));
  await incog.screenshot({ path: 'tests/.shots/giro19-permesso-incognito.png' });
  await incog.locator('#permesso-bar').getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toContain('ok');
  console.log('SHELL NORMALE BARRA', await shell.evaluate(() => { const b = document.getElementById('permesso-bar'); return b && !b.hidden; }));
});
