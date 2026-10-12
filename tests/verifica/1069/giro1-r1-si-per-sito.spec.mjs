// Verifica #1069 giro 1, rilievo 1: il sì a modificare una cartella non si estende alle cartelle date dopo solo da leggere.
import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, cartellaInCasa } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const esiti = [];
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Carica</title>
<style>body{margin:0}#zona{position:fixed;inset:0}button{position:fixed;left:200px;z-index:1}</style>
<div id="zona">trascina qui</div>
<button id="togli" style="top:200px">Togli</button><button id="sposta" style="top:240px">Sposta</button>
<button id="scrivi" style="top:280px">Scrivi</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  let h = null;
  const zona = document.getElementById('zona');
  zona.addEventListener('dragover', (e) => e.preventDefault());
  zona.addEventListener('drop', async (e) => {
    e.preventDefault();
    h = await e.dataTransfer.items[0].getAsFileSystemHandle();
    m('dato:' + h.kind);
  });
  document.getElementById('togli').addEventListener('click', () => h.removeEntry('mare.jpg').then(() => m('tolto'), (err) => m('tolto:' + err.name)));
  document.getElementById('sposta').addEventListener('click', () => h.move('rubato.jpg').then(() => m('spostato'), (err) => m('spostato:' + err.name)));
  document.getElementById('scrivi').addEventListener('click', async () => {
    try { const w = await h.createWritable(); await w.write('x'); await w.close(); m('scritto'); } catch (err) { m('scritto:' + err.name); }
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
  userData = cartellaTemporanea('filo-test-v1069-');
  app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => { await chiudiApp(app); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} });

const barra = () => shell.locator('#permesso-bar');
async function dai(nomeCartella, comeFile = false) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/');
  let pagina = null;
  await expect.poll(() => { pagina = app.windows().find((w) => w.url().startsWith(origine)); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('domcontentloaded');
  return { pagina, dir: await lascia(pagina, nomeCartella, comeFile) };
}
async function lascia(pagina, nomeCartella, comeFile = false) {
  const dir = join(cartellaInCasa('filo-v1069-'), nomeCartella);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mare.jpg'), 'foto');
  const prima = esiti.length;
  const s = await pagina.context().newCDPSession(pagina);
  const data = { items: [], files: [comeFile ? join(dir, 'mare.jpg') : dir], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await s.send('Input.dispatchDragEvent', { type, x: 60, y: 60, data });
  await expect.poll(() => esiti.slice(prima), { timeout: 10_000 }).toEqual([comeFile ? 'dato:file' : 'dato:directory']);
  return dir;
}

test('r1 il sì dato per una cartella non vale per la cartella che dai dopo, solo da leggere', async () => {
  test.setTimeout(60_000);
  const { pagina, dir } = await dai('esportazioni');
  await pagina.locator('#togli').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('«esportazioni»');
  await new Promise((ok) => setTimeout(ok, 1200));
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(1), { timeout: 10_000 }).toEqual(['tolto']);
  expect(existsSync(join(dir, 'mare.jpg'))).toBe(false);
  // Giorni dopo l'utente dà allo stesso sito un'altra cartella, per farla leggere: cancellarci si chiede di nuovo, col suo nome.
  const documenti = await lascia(pagina, 'Documenti');
  await pagina.locator('#togli').click();
  await expect(barra()).toBeVisible({ timeout: 5_000 });
  await expect(barra()).toContainText('«Documenti»');
  expect(existsSync(join(documenti, 'mare.jpg'))).toBe(true);
});
