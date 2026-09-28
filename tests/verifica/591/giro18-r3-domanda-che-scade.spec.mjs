// Verifica #591, giro 18 — la domanda dei permessi sparisce da sola dopo una dozzina di secondi e vale «no»:
// chi risponde con calma non può più concedere il microfono, e la pagina resta senza. Dispositivi finti.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOST = 'riunione-giro18.test';
const esiti = [];
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Riunione</title><p>Sala d'attesa</p><script>
  navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (s) => fetch('/esito?m=' + encodeURIComponent('concesso:' + s.getTracks().map((t) => t.kind).join(','))),
    (e) => fetch('/esito?m=' + encodeURIComponent('negato:' + e.name)),
  );
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

test('chi risponde alla domanda dopo quindici secondi concede il microfono alla pagina', async () => {
  test.setTimeout(90_000);
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
    await shell.locator('#permesso-bar').waitFor({ state: 'visible', timeout: 10_000 });
    await new Promise((ok) => setTimeout(ok, 15_000));
    expect(await shell.locator('#permesso-bar .permesso-si').isVisible(), 'la domanda è sparita prima che l\'utente rispondesse').toBe(true);
    await shell.locator('#permesso-bar .permesso-si').click();
    await expect.poll(() => esiti.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(esiti).toEqual(['concesso:audio']);
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
