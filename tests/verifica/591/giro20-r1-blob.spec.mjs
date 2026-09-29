// Verifica #591 giro 20, rilievo 1: una pagina che si riscrive in un documento blob: suo resta una pagina web, e i
// permessi si chiedono lo stesso. Sul ramo di oggi ottiene microfono, fotocamera, appunti, notifiche e altri programmi.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const esiti = [];
const figlio = (corpo) => `<!doctype html><meta charset="utf-8"><title>Offerta</title><p>attendi</p><script>
  const base = location.origin;
  const html = '<!doctype html><title>Offerta</title><p>ok</p><script>'
    + 'const m=(x)=>fetch(' + JSON.stringify(base) + '+"/esito?m="+encodeURIComponent(x));'
    + ${JSON.stringify(corpo)} + '<' + '/script>';
  location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
</script>`;
const PAGINE = {
  '/media': figlio('m("url:"+location.protocol);navigator.mediaDevices.getUserMedia({audio:true,video:true}).then((s)=>m("media:concesso"),(e)=>m("media:"+e.name));'),
  '/appunti': figlio('setTimeout(()=>navigator.clipboard.readText().then((x)=>m("appunti:"+x),(e)=>m("appunti:"+e.name)),500);'),
  '/notifiche': figlio('m("notifiche:"+Notification.permission);'),
  '/esterno': figlio('setTimeout(()=>{const f=document.createElement("iframe");f.style.display="none";f.src="prova-filo-esterno:apri-un-programma";document.body.appendChild(f);m("riquadro");},300);'),
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

let app;
let shell;
let userData;
let aperti;
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-verifica-591-r1-');
  const bin = join(userData, 'bin-finto');
  mkdirSync(bin, { recursive: true });
  aperti = join(userData, 'aperti.log');
  writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\necho "$@" >> "${aperti}"\n`);
  chmodSync(join(bin, 'xdg-open'), 0o755);
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, PATH: bin + delimiter + process.env.PATH, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

const apri = (percorso) => shell.evaluate((u) => window.filoShell.tabs.open(u), origine + percorso);
const barra = () => shell.locator('#permesso-bar');

test('microfono e fotocamera da un documento blob: la cornice chiede, e senza risposta la pagina non li ha', async () => {
  test.setTimeout(60_000);
  await apri('/media');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toContain('url:blob:');
  await new Promise((ok) => setTimeout(ok, 2000));
  expect(esiti, 'microfono e fotocamera concessi senza domanda').not.toContain('media:concesso');
  await expect(barra()).toBeVisible();
  await expect(barra()).toContainText('microfono e fotocamera');
});

test('appunti da un documento blob: la password copiata non esce senza un sì', async () => {
  test.setTimeout(60_000);
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-copiata'));
  await apri('/appunti');
  await new Promise((ok) => setTimeout(ok, 3000));
  expect(esiti, 'appunti letti senza domanda').not.toContain('appunti:password-copiata');
});

test('notifiche da un documento blob: si leggono «da chiedere», non concesse', async () => {
  test.setTimeout(60_000);
  await apri('/notifiche');
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(esiti[0]).toBe('notifiche:default');
});

test('un documento blob non apre un altro programma da un riquadro invisibile, senza un clic', async () => {
  test.skip(process.platform !== 'linux', 'l\'apertura si osserva sostituendo xdg-open');
  test.setTimeout(60_000);
  await apri('/esterno');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual(['riquadro']);
  await new Promise((ok) => setTimeout(ok, 3000));
  expect(existsSync(aperti) ? readFileSync(aperti, 'utf8').trim() : '').toBe('');
});
