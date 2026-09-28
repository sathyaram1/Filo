// Verifica #591, giro 18 — il lasciapassare che Detta chiede per il microfono apre alla pagina anche la fotocamera,
// e passa sopra al «Non consentire» già detto dall'utente. Il lasciapassare si chiede come lo chiede Detta, al servizio
// dei permessi; dispositivi finti.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOST = 'modulo-giro18.test';
const esiti = [];
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Modulo</title><textarea autofocus></textarea><script>
  window.prova = () => navigator.mediaDevices.getUserMedia({ video: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)));
  prova();
</script>`;

let server;
let porta;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINA);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  porta = server.address().port;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

test('dopo «Non consentire» la pagina non ha la fotocamera nemmeno mentre l\'utente usa Detta', async () => {
  test.setTimeout(60_000);
  const userData = cartellaTemporanea('filo-verifica-591-');
  const app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=MAP ${HOST} 127.0.0.1`, '--use-fake-device-for-media-stream',
      `--unsafely-treat-insecure-origin-as-secure=http://${HOST}:${porta}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await new Promise((ok) => setTimeout(ok, 800));
    esiti.length = 0;
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/`);
    await shell.locator('#permesso-bar .permesso-no').click();
    await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(1);
    expect(esiti[0]).toMatch(/^negato/);

    // Detta: prima del microfono il contenuto di Filo nella pagina chiede il lasciapassare per la sua scheda.
    const dato = await app.evaluate(({ webContents }, host) => {
      const richiedi = process.getBuiltinModule('module').createRequire(process.cwd() + '/src/main/main.js');
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(host));
      return richiedi('./services/permessiPagine').lasciapassare(wc, 'media');
    }, HOST);
    expect(dato, 'Detta ha il suo lasciapassare').toBe(true);

    const pagina = app.context().pages().find((p) => p.url().includes(HOST));
    await pagina.evaluate(() => window.prova());
    await expect.poll(() => esiti.length, { timeout: 10_000 }).toBe(2);
    expect(esiti[1], 'la pagina ha preso la fotocamera col lasciapassare del microfono di Detta').toMatch(/^negato/);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
