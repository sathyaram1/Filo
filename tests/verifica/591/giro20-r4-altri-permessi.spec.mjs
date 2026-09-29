// Verifica #591 giro 20, rilievo 4: quello che Chrome chiede (font del computer, schermi, inattività) Filo lo chiede,
// e quello che Chrome concede da solo (spazio persistente) lo concede. Sul ramo di oggi è no, senza domanda.

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
const pagina = (titolo, azione) => `<!doctype html><meta charset="utf-8"><title>${titolo}</title>
<button id="b" style="position:fixed;top:200px;left:200px">${titolo}</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  document.getElementById('b').addEventListener('click', () => { ${azione} });
</script>`;
const PAGINE = {
  // Un editor di grafica che elenca i font installati.
  '/font': pagina('Usa i miei font', "window.queryLocalFonts().then((f) => m('font:' + (f.length ? 'letti' : 'vuoti')), (e) => m('font:' + e.name));"),
  // Una presentazione che mette le note su uno schermo e le slide sull'altro.
  '/schermi': pagina('Presenta', "window.getScreenDetails().then((d) => m('schermi:letti'), (e) => m('schermi:' + e.name));"),
  // Un'app che lavora anche senza rete e chiede di non perdere i dati salvati.
  '/spazio': pagina('Salva per usarla senza rete', "navigator.storage.persist().then((x) => m('spazio:' + x), (e) => m('spazio:' + e.name));"),
  // Una chat che mostra agli altri se sei al computer.
  '/presenza': pagina('Mostra se sono al computer', "IdleDetector.requestPermission().then((x) => m('presenza:' + x), (e) => m('presenza:' + e.name));"),
};
const RIUSCITO = { '/font': 'font:letti', '/schermi': 'schermi:letti', '/spazio': 'spazio:true', '/presenza': 'presenza:granted' };

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
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-verifica-591-r4-');
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

for (const via of Object.keys(PAGINE)) {
  test(`dopo un clic sulla pagina, ${via.slice(1)}: Filo chiede o concede come Chrome, e col sì la pagina funziona`, async () => {
    test.setTimeout(60_000);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + via);
    let p = null;
    await expect.poll(() => { p = app.windows().find((w) => w.url().startsWith(origine + via)); return Boolean(p); }, { timeout: 10_000 }).toBe(true);
    await p.waitForLoadState('domcontentloaded');
    await p.locator('#b').click();
    // Se Filo fa la domanda, l'utente dice sì.
    const si = shell.locator('#permesso-bar').getByRole('button', { name: 'Consenti', exact: true });
    try { await expect(si).toBeEnabled({ timeout: 3_000 }); await si.click(); } catch (_) {}
    await expect.poll(() => esiti.slice(), { timeout: 10_000 }).toEqual([RIUSCITO[via]]);
  });
}
