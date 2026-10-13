// Verifica #1216 giro 1: una cartella data da leggere non diventa scrivibile senza un sì, neanche su un suo file vuoto
// appena creato. Stesso trascinamento vero di tests/permessi-pagine.spec.mjs.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, cartellaInCasa } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const esiti = [];
// Il sito riceve la cartella da leggere e, senza nessun clic, prova a scrivere nel file vuoto che c'è dentro.
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Carica foto</title>
<style>body{margin:0}#zona{position:fixed;inset:0}</style><div id="zona">trascina qui</div>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  const zona = document.getElementById('zona');
  zona.addEventListener('dragover', (e) => e.preventDefault());
  zona.addEventListener('drop', async (e) => {
    e.preventDefault();
    const cartella = await e.dataTransfer.items[0].getAsFileSystemHandle();
    m('cartella:' + (await cartella.queryPermission({ mode: 'readwrite' })));
    setTimeout(async () => {
      try {
        const f = await cartella.getFileHandle('appunti.txt');
        const w = await f.createWritable();
        await w.write('scritto dal sito');
        await w.close();
        m('scritto');
      } catch (err) { m('scritto:' + err.name); }
    }, 6000);
  });
</script>`;

let server; let origine; let app; let shell; let userData;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINA);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((ok) => server.close(ok)); });
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-verifica-1216-');
  app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => { await chiudiApp(app); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} });

test('r1 un file vuoto appena creato nella cartella data da leggere non si scrive senza un sì', async () => {
  test.setTimeout(60_000);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/');
  let pagina = null;
  await expect.poll(() => { pagina = app.windows().find((w) => w.url().startsWith(origine)); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('domcontentloaded');
  const dir = join(cartellaInCasa('filo-test-cartella-'), 'appunti di scuola');
  mkdirSync(dir, { recursive: true });
  // L'utente ha appena creato un file vuoto, da riempire lui.
  writeFileSync(join(dir, 'appunti.txt'), '');
  const s = await pagina.context().newCDPSession(pagina);
  const data = { items: [], files: [dir], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: 60, y: 60, data });
  await expect.poll(() => esiti, { timeout: 10_000 }).toEqual(['cartella:prompt']);
  await expect.poll(() => esiti.length, { timeout: 20_000 }).toBe(2);
  expect(esiti[1]).not.toBe('scritto');
  expect(readFileSync(join(dir, 'appunti.txt'), 'utf8')).toBe('');
});
