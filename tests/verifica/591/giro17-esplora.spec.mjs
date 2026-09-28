// Verifica #591, giro 17 — esplorazione: cosa può fare una pagina sospetta dentro la finestra nascosta del controllo profondo.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOST = 'sito-giro17.test';

const esiti = [];
const PAGINE = {
  '/esterno': `<!doctype html><meta charset="utf-8"><title>Offerta</title><p>ciao</p>
<script>setTimeout(() => { location.href = 'filo-verifica-ext:prova-' + (window.name || 'x'); }, 300);</script>
<img src="/lento"><iframe src="/lento"></iframe>`,
  '/appunti': `<!doctype html><meta charset="utf-8"><title>Offerta</title><input autofocus>
<script>
  let n = 0;
  const t = setInterval(async () => {
    n++;
    try { const x = await navigator.clipboard.readText(); fetch('/esito?m=' + encodeURIComponent('letto:' + x)); clearInterval(t); }
    catch (e) { if (n > 12) { fetch('/esito?m=' + encodeURIComponent('negato:' + e.name + ':' + document.hasFocus())); clearInterval(t); } }
  }, 400);
</script>`,
  '/microfono': `<!doctype html><meta charset="utf-8"><title>Offerta</title><p>ciao</p>
<script>
  (async () => {
    const dove = document.visibilityState;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).join(',') + ':' + dove));
    } catch (e) {
      fetch('/esito?m=' + encodeURIComponent('negato:' + (e && e.name) + ':' + dove));
    }
  })();
</script><iframe src="/lento"></iframe>`,
};

let server;
let porta;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    if (u.pathname === '/lento') { setTimeout(() => { try { res.end('x'); } catch (_) {} }, 20_000); return; }
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
  const bin = join(userData, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(userData, 'xdg-open.log');
  writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\necho "$@" >> '${log}'\n`);
  chmodSync(join(bin, 'xdg-open'), 0o755);
  const app = await electron.launch({
    args: [...argomentiScala,
      `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
      '--use-fake-device-for-media-stream',
      `--unsafely-treat-insecure-origin-as-secure=http://${HOST}:${porta}`,
      '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', PATH: `${bin}:${process.env.PATH}` },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await new Promise((ok) => setTimeout(ok, 800));
    const lanci = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
    return await fn({ app, shell, lanci });
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
}

test('esplora: finestra nascosta e protocollo esterno', async () => {
  test.setTimeout(90_000);
  await conFilo(async ({ app, shell, lanci }) => {
    const r = await app.evaluate(async (_e, u) => {
      const SB = globalThis.SN_SAFEBROWSE;
      return { attivi: SB.activeProviders(), esito: await SB.sandbox.detonate(u) };
    }, `http://${HOST}:${porta}/esterno`);
    console.log('diretto', JSON.stringify(r), lanci());
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/esterno`);
    await new Promise((ok) => setTimeout(ok, 12_000));
    const stats = await app.evaluate(() => globalThis.SN_SAFEBROWSE.sandbox.stats());
    console.log('scheda', JSON.stringify(stats), lanci());
  });
});

test('esplora: microfono', async () => {
  test.setTimeout(90_000);
  await conFilo(async ({ app, shell }) => {
    esiti.length = 0;
    const r = await app.evaluate(async (_e, u) => globalThis.SN_SAFEBROWSE.sandbox.detonate(u), `http://${HOST}:${porta}/microfono`);
    await new Promise((ok) => setTimeout(ok, 1000));
    console.log('diretto', JSON.stringify(r), JSON.stringify(esiti));
    esiti.length = 0;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/microfono`);
    await new Promise((ok) => setTimeout(ok, 12_000));
    console.log('scheda', JSON.stringify(esiti));
  });
});

test('esplora: appunti', async () => {
  test.setTimeout(90_000);
  await conFilo(async ({ app, shell }) => {
    esiti.length = 0;
    await app.evaluate(({ clipboard }) => clipboard.writeText('parola-segreta-giro17'));
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/appunti`);
    await new Promise((ok) => setTimeout(ok, 9_000));
    console.log('scheda', JSON.stringify(esiti));
  });
});
