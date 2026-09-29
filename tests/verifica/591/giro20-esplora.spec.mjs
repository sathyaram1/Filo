// Verifica #591 giro 20: prove esplorative sui permessi delle pagine.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = resolve(APP_ROOT, 'tests', '.shots');

const esiti = [];
const PAGINE = {};
PAGINE['/messaggi'] = `<!doctype html><meta charset="utf-8"><title>Messaggi</title>
<button id="attiva" hidden style="position:fixed;top:200px;left:200px">Attiva le notifiche</button>
<script>
  const manda = (m) => fetch('/esito?m=' + encodeURIComponent(m));
  navigator.permissions.query({ name: 'notifications' }).then((s) => {
    manda('stato:' + Notification.permission + '/' + s.state);
    if (Notification.permission !== 'default') return;
    const b = document.getElementById('attiva');
    b.hidden = false;
    b.addEventListener('click', () => Notification.requestPermission().then((x) => manda('notifiche:' + x + '/' + Notification.permission)));
  });
</script>`;
PAGINE['/subito'] = `<!doctype html><html><head><script>fetch('/esito?m=' + encodeURIComponent('sincrono:' + Notification.permission));</script></head><body>x</body></html>`;
PAGINE['/microfono'] = `<!doctype html><meta charset="utf-8"><title>Riunione</title><p>stanza</p>
<script>
  navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).sort().join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)),
  );
</script>`;
// Un gioco a clic: il pulsante sta in alto a destra, dove comparirà Consenti; al primo clic chiede microfono e fotocamera.
PAGINE['/gioco'] = `<!doctype html><meta charset="utf-8"><title>Gioco</title>
<style>body{margin:0}#b{position:fixed;top:0;right:0;width:260px;height:60px}</style>
<button id="b">Clicca più veloce che puoi</button>
<script>
  let chiesto = false;
  document.getElementById('b').addEventListener('click', () => {
    if (chiesto) return; chiesto = true;
    navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(
      (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).sort().join(','))),
      (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)));
  });
</script>`;
PAGINE['/font'] = `<!doctype html><meta charset="utf-8"><title>Editor</title>
<button id="b" style="position:fixed;top:200px;left:200px">Usa i miei font</button>
<script>
  document.getElementById('b').addEventListener('click', () => {
    if (!window.queryLocalFonts) { fetch('/esito?m=font:assente'); return; }
    window.queryLocalFonts().then((f) => fetch('/esito?m=font:' + (f.length > 0 ? 'letti' : 'vuoti')), (e) => fetch('/esito?m=' + encodeURIComponent('font:' + e.name)));
  });
</script>`;
PAGINE['/schermi'] = `<!doctype html><meta charset="utf-8"><title>Presentazione</title>
<button id="b" style="position:fixed;top:200px;left:200px">Presenta</button>
<script>
  document.getElementById('b').addEventListener('click', () => {
    if (!window.getScreenDetails) { fetch('/esito?m=schermi:assente'); return; }
    window.getScreenDetails().then((d) => fetch('/esito?m=schermi:' + d.screens.length), (e) => fetch('/esito?m=' + encodeURIComponent('schermi:' + e.name)));
  });
</script>`;

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
test.beforeEach(() => { esiti.length = 0; userData = cartellaTemporanea('filo-verifica-591-'); });
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
const paginaDi = (app, base) => app.windows().find((w) => w.url().startsWith(base));
async function attendiPagina(app, url) {
  let p = null;
  await expect.poll(() => { p = paginaDi(app, url); return Boolean(p); }, { timeout: 10_000 }).toBe(true);
  await p.waitForLoadState('domcontentloaded');
  return p;
}

test('esplora: il sì alle notifiche e al microfono dopo una riapertura di Filo', async () => {
  test.setTimeout(120_000);
  let { app, shell } = await avvia();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/messaggi');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default/prompt']);
  const p = await attendiPagina(app, origine + '/messaggi');
  await p.locator('#attiva').click();
  const si = shell.locator('#permesso-bar').getByRole('button', { name: 'Consenti', exact: true });
  await expect(si).toBeEnabled({ timeout: 10_000 });
  await si.click();
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['stato:default/prompt', 'notifiche:granted/granted']);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
  await expect(si).toBeEnabled({ timeout: 10_000 });
  await si.click();
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(3);
  console.log('PRIMA:', JSON.stringify(esiti));
  await chiudiApp(app);

  esiti.length = 0;
  ({ app, shell } = await avvia());
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/messaggi');
  await expect.poll(() => esiti.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
  await new Promise((ok) => setTimeout(ok, 3000));
  const barra = await shell.locator('#permesso-bar').isVisible();
  console.log('DOPO:', JSON.stringify(esiti), 'barra visibile:', barra);
  await chiudiApp(app);
});

test('esplora: Notification.permission letto da uno script sincrono in testa alla pagina', async () => {
  test.setTimeout(60_000);
  const { app, shell } = await avvia();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/subito');
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBeGreaterThan(0);
  console.log('SINCRONO:', JSON.stringify(esiti));
  await chiudiApp(app);
});

test('esplora: clic ripetuti sul punto dove compare Consenti', async () => {
  test.setTimeout(60_000);
  const { app, shell } = await avvia();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/gioco');
  const p = await attendiPagina(app, origine + '/gioco');
  await p.locator('#b').click();
  const si = shell.locator('#permesso-bar .permesso-si');
  await expect(si).toBeVisible({ timeout: 10_000 });
  const box = await si.boundingBox();
  // L'utente continua a cliccare nello stesso punto dello schermo, cinque volte al secondo, per due secondi.
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) {
    await shell.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise((ok) => setTimeout(ok, 200));
  }
  await new Promise((ok) => setTimeout(ok, 1000));
  console.log('GIOCO:', JSON.stringify(esiti));
  await chiudiApp(app);
});

test('esplora: font del computer e schermi, dopo un clic', async () => {
  test.setTimeout(60_000);
  const { app, shell } = await avvia();
  for (const via of ['/font', '/schermi']) {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + via);
    const p = await attendiPagina(app, origine + via);
    await p.locator('#b').click();
    await new Promise((ok) => setTimeout(ok, 2500));
    console.log('BARRA', via, await shell.locator('#permesso-bar').isVisible());
  }
  console.log('API:', JSON.stringify(esiti));
  await chiudiApp(app);
});

test('esplora: aspetto della domanda nei due temi', async () => {
  test.setTimeout(60_000);
  mkdirSync(SHOTS, { recursive: true });
  const { app, shell } = await avvia();
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/microfono');
  await expect(shell.locator('#permesso-bar')).toBeVisible({ timeout: 10_000 });
  await new Promise((ok) => setTimeout(ok, 1200));
  await shell.screenshot({ path: join(SHOTS, 'v591-g20-chiaro.png') });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await new Promise((ok) => setTimeout(ok, 800));
  await shell.screenshot({ path: join(SHOTS, 'v591-g20-scuro.png') });
  await chiudiApp(app);
});
