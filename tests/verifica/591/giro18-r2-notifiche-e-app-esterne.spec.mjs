// Verifica #591, giro 18 — tutto quello che la regola dei permessi non nomina una pagina lo ottiene senza chiedere:
// le notifiche di sistema e l'apertura di un'applicazione esterna da un riquadro invisibile, senza un clic.
// L'applicazione esterna si osserva su Linux sostituendo xdg-open con uno che prende nota.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, readFileSync, existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOST = 'sito-giro18.test';
const esiti = [];
const PAGINE = {
  '/notifiche': `<!doctype html><meta charset="utf-8"><title>Offerta</title><script>
    (async () => {
      let dopo = 'x';
      try { dopo = await Notification.requestPermission(); } catch (e) { dopo = 'errore:' + e.name; }
      fetch('/esito?m=' + encodeURIComponent('notifiche:' + dopo));
    })();
  </script>`,
  '/esterno': `<!doctype html><meta charset="utf-8"><title>Offerta</title><p>niente da vedere</p><script>
    setTimeout(() => {
      const f = document.createElement('iframe');
      f.style.display = 'none';
      f.src = 'prova-giro-diciotto:apri-un-programma';
      document.body.appendChild(f);
      fetch('/esito?m=riquadro');
    }, 300);
  </script>`,
};

let server;
let porta;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINE[u.pathname] || '<p>vuota</p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  porta = server.address().port;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

async function conFilo(fn) {
  const userData = cartellaTemporanea('filo-verifica-591-');
  const bin = join(userData, 'bin-finto');
  mkdirSync(bin, { recursive: true });
  const registro = join(userData, 'aperti.log');
  writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\necho "$@" >> "${registro}"\n`);
  chmodSync(join(bin, 'xdg-open'), 0o755);
  const app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
      `--unsafely-treat-insecure-origin-as-secure=http://${HOST}:${porta}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await new Promise((ok) => setTimeout(ok, 800));
    esiti.length = 0;
    return await fn({ app, shell, registro });
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
}

test('una pagina non si prende le notifiche di sistema senza che l\'utente le conceda', async () => {
  test.setTimeout(60_000);
  await conFilo(async ({ shell }) => {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/notifiche`);
    await expect.poll(() => esiti.length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(esiti, 'notifiche concesse senza nessuna risposta dell\'utente').not.toContain('notifiche:granted');
  });
});

test('una pagina non apre un\'applicazione esterna da un riquadro invisibile senza un clic e senza chiedere', async () => {
  test.skip(process.platform !== 'linux', 'l\'apertura si osserva sostituendo xdg-open');
  test.setTimeout(60_000);
  await conFilo(async ({ shell, registro }) => {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/esterno`);
    await expect.poll(() => esiti.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await new Promise((ok) => setTimeout(ok, 3000));
    const aperti = existsSync(registro) ? readFileSync(registro, 'utf8').trim() : '';
    expect(aperti, 'Filo ha consegnato al sistema un indirizzo di un\'altra applicazione').toBe('');
  });
});
