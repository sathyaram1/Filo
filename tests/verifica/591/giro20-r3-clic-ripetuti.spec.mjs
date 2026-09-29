// Verifica #591 giro 20, rilievo 3: chi clicca a raffica nel punto dove compare la domanda non la conferma; Consenti
// vale solo per un clic dopo una pausa. Sul ramo di oggi il clic che arriva dopo un secondo di raffica concede.

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
// Un gioco a clic col pulsante in alto a destra, dove comparirà Consenti: al primo clic chiede microfono e fotocamera.
const GIOCO = `<!doctype html><meta charset="utf-8"><title>Gioco</title>
<style>body{margin:0}#b{position:fixed;top:0;right:0;width:260px;height:60px}</style>
<button id="b">Clicca più veloce che puoi</button>
<script>
  let chiesto = false;
  document.getElementById('b').addEventListener('click', () => {
    if (chiesto) return; chiesto = true;
    navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(
      () => fetch('/esito?m=concesso'), (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)));
  });
</script>`;

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(GIOCO);
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
  esiti.length = 0;
  userData = cartellaTemporanea('filo-verifica-591-r3-');
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

test('una raffica di clic sul punto di Consenti non concede; un clic dopo una pausa sì', async () => {
  test.setTimeout(60_000);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/gioco');
  let pagina = null;
  await expect.poll(() => { pagina = app.windows().find((w) => w.url().startsWith(origine)); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('domcontentloaded');
  await pagina.locator('#b').click();
  const si = shell.locator('#permesso-bar .permesso-si');
  await expect(si).toBeVisible({ timeout: 10_000 });
  const box = await si.boundingBox();
  // Cinque clic al secondo nello stesso punto dello schermo, per due secondi e mezzo.
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    await shell.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise((ok) => setTimeout(ok, 200));
  }
  await new Promise((ok) => setTimeout(ok, 1000));
  expect(esiti, 'concesso da un clic della raffica').toEqual([]);

  // L'utente si ferma, legge e sceglie.
  await new Promise((ok) => setTimeout(ok, 1500));
  await expect(si).toBeEnabled({ timeout: 5_000 });
  await si.click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['concesso']);
});
