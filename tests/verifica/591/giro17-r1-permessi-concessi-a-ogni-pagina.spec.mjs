// Verifica #591, giro 17 — Filo concede a qualunque pagina microfono, fotocamera e lettura degli appunti senza chiedere
// niente all'utente, nelle schede e nella finestra nascosta dove il controllo profondo riapre le pagine sospette.
// Il sito vero sarebbe in https: qui un indirizzo di prova è trattato come sicuro, e i dispositivi sono finti.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOST = 'sito-giro17.test';

const esiti = [];
const PAGINE = {
  '/microfono': `<!doctype html><meta charset="utf-8"><title>Offerta</title><p>ciao</p>
<script>
  (async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).join(',')));
    } catch (e) {
      fetch('/esito?m=' + encodeURIComponent('negato:' + (e && e.name)));
    }
  })();
</script><iframe src="/lento"></iframe>`,
  '/appunti': `<!doctype html><meta charset="utf-8"><title>Offerta</title><input autofocus>
<script>
  let n = 0;
  const t = setInterval(async () => {
    n++;
    try { const x = await navigator.clipboard.readText(); fetch('/esito?m=' + encodeURIComponent('letto:' + x)); clearInterval(t); }
    catch (e) { if (n > 12) { fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)); clearInterval(t); } }
  }, 400);
</script>`,
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
  const app = await electron.launch({
    args: [...argomentiScala,
      `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
      '--use-fake-device-for-media-stream',
      `--unsafely-treat-insecure-origin-as-secure=http://${HOST}:${porta}`,
      '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await new Promise((ok) => setTimeout(ok, 800));
    esiti.length = 0;
    return await fn({ app, shell });
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
}

test('una pagina aperta in una scheda non si prende microfono e fotocamera senza che l\'utente li conceda', async () => {
  test.setTimeout(60_000);
  await conFilo(async ({ shell }) => {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/microfono`);
    await expect.poll(() => esiti.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(esiti.filter((e) => e.startsWith('concesso')), 'la pagina ha avuto microfono e fotocamera').toEqual([]);
  });
});

test('una pagina aperta in una scheda non legge gli appunti senza che l\'utente lo conceda', async () => {
  test.setTimeout(60_000);
  await conFilo(async ({ app, shell }) => {
    await app.evaluate(({ clipboard }) => clipboard.writeText('parola-segreta-giro17'));
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/appunti`);
    await expect.poll(() => esiti.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(esiti.filter((e) => e.startsWith('letto')), 'la pagina ha letto gli appunti').toEqual([]);
  });
});

test('la finestra nascosta del controllo profondo non dà microfono e fotocamera alla pagina sospetta che riapre', async () => {
  test.setTimeout(60_000);
  await conFilo(async ({ app }) => {
    await app.evaluate(async (_e, u) => globalThis.SN_SAFEBROWSE.sandbox.detonate(u), `http://${HOST}:${porta}/microfono`);
    await new Promise((ok) => setTimeout(ok, 1000));
    expect(esiti.filter((e) => e.startsWith('concesso')), 'la pagina nella finestra nascosta ha avuto microfono e fotocamera').toEqual([]);
  });
});
