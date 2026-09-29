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
const PAGINA = `<!doctype html><meta charset="utf-8"><title>X</title><script>
fetch('/esito?m=' + encodeURIComponent('sync:' + Notification.permission + ':' + String(Notification.requestPermission).includes('gesto') + ':' + (navigator.userActivation && navigator.userActivation.isActive)));
Notification.requestPermission().then((x) => fetch('/esito?m=' + encodeURIComponent('req:' + x)));
</script>`;
let server; let origine; let app; let shell; let userData;
test.beforeAll(async () => {
  server = createServer((req, res) => { const u = new URL(req.url, 'http://x'); if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; } res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGINA); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((ok) => server.close(ok)); });
test('x', async () => {
  test.setTimeout(90_000);
  userData = cartellaTemporanea('filo-test-e2-');
  app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  for (let i = 0; i < 4; i++) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/p' + i);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('ESITI', JSON.stringify(esiti));
  await chiudiApp(app); rmSync(userData, { recursive: true, force: true });
});
