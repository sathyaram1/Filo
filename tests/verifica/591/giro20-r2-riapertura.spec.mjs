// Verifica #591 giro 20, rilievo 2: un sì dato a un sito vale anche dopo aver chiuso e riaperto Filo, come in Chrome.
// Sul ramo di oggi le notifiche tornano «da chiedere» e il microfono si richiede.

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
const PAGINE = {
  // Come la posta sul web: se le notifiche non risultano concesse non avvisa, e il pulsante sta nelle sue impostazioni.
  '/posta': `<!doctype html><meta charset="utf-8"><title>Posta</title>
<button id="attiva" style="position:fixed;top:200px;left:200px">Attiva le notifiche</button>
<script>
  const manda = (m) => fetch('/esito?m=' + encodeURIComponent(m));
  manda('stato:' + Notification.permission);
  document.getElementById('attiva').addEventListener('click', () => Notification.requestPermission().then((x) => manda('notifiche:' + x)));
</script>`,
  '/riunione': `<!doctype html><meta charset="utf-8"><title>Riunione</title><script>
  navigator.mediaDevices.getUserMedia({ audio: true }).then(
    () => fetch('/esito?m=microfono:concesso'), (e) => fetch('/esito?m=' + encodeURIComponent('microfono:' + e.name)));
</script>`,
};

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINE[u.pathname] || '<p>vuota</p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

let userData;
test.beforeEach(() => { esiti.length = 0; userData = cartellaTemporanea('filo-verifica-591-r2-'); });
test.afterEach(() => { try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} });

async function avvia() {
  const app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

test('le notifiche e il microfono concessi a un sito restano concessi dopo aver riaperto Filo', async () => {
  test.setTimeout(120_000);
  let { app, shell } = await avvia();
  const si = () => shell.locator('#permesso-bar').getByRole('button', { name: 'Consenti', exact: true });
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/posta');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default']);
  let pagina = null;
  await expect.poll(() => { pagina = app.windows().find((w) => w.url().startsWith(origine + '/posta')); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.locator('#attiva').click();
  await expect(si()).toBeEnabled({ timeout: 10_000 });
  await si().click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default', 'notifiche:granted']);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/riunione');
  await expect(si()).toBeEnabled({ timeout: 10_000 });
  await si().click();
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(3);
  expect(esiti[2]).toBe('microfono:concesso');
  await chiudiApp(app);

  esiti.length = 0;
  ({ app, shell } = await avvia());
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/posta');
    await expect.poll(() => esiti.slice(), { timeout: 15_000 }).toEqual(['stato:granted']);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/riunione');
    await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:granted', 'microfono:concesso']);
  } finally {
    await chiudiApp(app);
  }
});
