// Verifica #591, giro 18 — la riga della domanda si taglia in fondo: con un indirizzo lungo spariscono il dominio vero
// e la cosa chiesta, e resta la parte che la pagina ha scelto. Dispositivi finti.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOST = 'videochiamata.sessione-sicura-verifica-account-utente-accesso-autorizzato'
  + '.conferma-identita-riunione-video-chiamata-partecipante.attacco-esempio.test';
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Riunione</title><p>Sala d'attesa</p>
<script>navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(() => {}, () => {});</script>`;

let server;
let porta;
test.beforeAll(async () => {
  server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGINA); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  porta = server.address().port;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

test('con un indirizzo lungo la domanda mostra ancora il dominio vero e che cosa viene chiesto', async () => {
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
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      w.setContentSize(1280, 800);
    });
    await new Promise((ok) => setTimeout(ok, 800));
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${HOST}:${porta}/`);
    await shell.locator('#permesso-bar').waitFor({ state: 'visible', timeout: 10_000 });
    await new Promise((ok) => setTimeout(ok, 500));
    // Quello che si vede: il testo dentro il riquadro della riga, senza la parte nascosta dall'ellissi.
    const visibile = await shell.evaluate(() => {
      const msg = document.querySelector('#permesso-bar .permesso-msg');
      const r = msg.getBoundingClientRect();
      const range = document.createRange();
      let out = '';
      const giro = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
      for (let n = giro.nextNode(); n; n = giro.nextNode()) {
        for (let i = 0; i < n.length; i++) {
          range.setStart(n, i); range.setEnd(n, i + 1);
          const c = range.getBoundingClientRect();
          if (c.width > 0 && c.right <= r.right - 12) out += n.data[i];
        }
      }
      return out;
    });
    console.log('si legge:', visibile);
    expect(visibile, 'il dominio vero non si legge').toContain('attacco-esempio.test');
    expect(visibile, 'che cosa viene chiesto non si legge').toContain('microfono e fotocamera');
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
