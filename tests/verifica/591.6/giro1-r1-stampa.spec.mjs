// Verifica #591.6, giro 1, rilievo 1: la copia nascosta del controllo profondo non deve mostrare niente all'utente,
// nemmeno la finestra di stampa che un finto avviso apre a pagina già caricata.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const esiti = [];
// Come i finti avvisi che bloccano il browser: appena caricata la pagina apre l'avviso e poi la stampa.
const AVVISO = `<!doctype html><meta charset="utf-8"><title>Avviso</title><p>Il tuo computer è infetto</p>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  addEventListener('load', () => {
    setTimeout(() => { alert('Il tuo computer è infetto, chiama il numero'); m('dopo:avviso'); }, 100);
    setTimeout(() => { window.print(); m('dopo:stampa'); }, 300);
  });
</script>`;

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(AVVISO);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

let app;
let userData;
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-verifica-5916-');
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

test('r1 la copia nascosta di un finto avviso, a pagina caricata, non apre la finestra di stampa', async () => {
  test.setTimeout(60_000);
  // Playwright chiude da sé le finestre di dialogo che vede: chi le ascolta le lascia come davanti all'utente.
  app.on('window', (p) => p.on('dialog', () => {}));
  // La copia che segue un link accorciato resta aperta qualche secondo dopo il caricamento, ad aspettare un rimando.
  const finito = app.evaluate(async (_e, u) => { await globalThis.SN_SAFEBROWSE.sandbox.destinazione(u, () => true); return true; }, origine + '/avviso');
  expect(await finito).toBe(true);
  expect(esiti, 'l\'avviso della pagina non si mostra').toContain('dopo:avviso');
  // Con la finestra di stampa di sistema aperta la pagina resta ferma sulla chiamata e non arriva mai oltre.
  expect(esiti, 'la stampa non apre la sua finestra').toContain('dopo:stampa');
});
