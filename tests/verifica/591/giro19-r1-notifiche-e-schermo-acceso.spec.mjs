// Giro 19, rilievo 1 (#591): una pagina legge «bloccato» per cose che l'utente non ha mai rifiutato.
// Notifiche: le app di posta e messaggi offrono il pulsante solo se lo stato è «da chiedere». Schermo acceso: Chrome lo dà.

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

// Come WhatsApp Web e Gmail: il pulsante per attivare le notifiche compare solo se il browser dice che si può chiedere.
const MESSAGGI = `<!doctype html><meta charset="utf-8"><title>Messaggi</title>
<button id="attiva" hidden style="position:fixed;top:120px;left:120px;width:260px;height:60px">Attiva le notifiche</button>
<script>
  const manda = (m) => fetch('/esito?m=' + encodeURIComponent(m));
  const stato = Notification.permission;
  if (stato === 'granted') manda('notifiche:granted');
  else if (stato === 'denied') manda('notifiche:bloccate');
  else {
    const b = document.getElementById('attiva');
    b.hidden = false;
    b.addEventListener('click', () => Notification.requestPermission().then((x) => manda('notifiche:' + x)));
    manda('pulsante');
  }
</script>`;

// Come la «modalità cucina» di un sito di ricette: tiene lo schermo acceso dopo un clic.
const RICETTA = `<!doctype html><meta charset="utf-8"><title>Ricetta</title>
<button id="cucina" style="position:fixed;top:120px;left:120px;width:260px;height:60px">Modalità cucina</button>
<script>
  document.getElementById('cucina').addEventListener('click', () => navigator.wakeLock.request('screen').then(
    () => fetch('/esito?m=schermo:acceso'), (e) => fetch('/esito?m=' + encodeURIComponent('schermo:' + e.name))));
</script>`;

let server; let origine; let app; let shell; let userData;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(u.pathname === '/ricetta' ? RICETTA : MESSAGGI);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((ok) => server.close(ok)); });
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-g19-permessi-');
  app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => { await chiudiApp(app); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} });

async function pagina(percorso) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + percorso);
  let p = null;
  await expect.poll(() => { p = app.windows().find((w) => w.url() === origine + percorso); return Boolean(p); }, { timeout: 10_000 }).toBe(true);
  await p.waitForLoadState('domcontentloaded');
  return p;
}

test('un\'app di messaggi offre il pulsante delle notifiche e, col sì dell\'utente, le riceve', async () => {
  test.setTimeout(60_000);
  const p = await pagina('/');
  await expect.poll(() => esiti.length, { timeout: 10_000 }).toBeGreaterThan(0);
  if (esiti[0] === 'pulsante') {
    await p.click('#attiva');
    const barra = shell.locator('#permesso-bar');
    await expect(barra).toBeVisible({ timeout: 10_000 });
    const si = barra.getByRole('button', { name: 'Consenti', exact: true });
    await expect(si).toBeEnabled({ timeout: 5_000 });
    await si.click();
  }
  await expect.poll(() => esiti.slice(), { timeout: 10_000, message: 'la pagina deve poter avere le notifiche' }).toContain('notifiche:granted');
});

test('la modalità cucina di un sito tiene lo schermo acceso dopo un clic', async () => {
  test.setTimeout(60_000);
  const p = await pagina('/ricetta');
  await p.click('#cucina');
  await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toContain('schermo:acceso');
});
