// Verifica #1069 giro 1: la cartella o il file dati da leggere non diventano scrivibili, cancellabili o spostabili senza un sì.
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

test('cancellare un file nella cartella data da leggere si chiede, e senza sì il file resta', async () => {
  test.setTimeout(60_000);
  const { pagina, dir } = await dai('foto da caricare');
  await pagina.locator('#togli').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('«foto da caricare»');
  expect(existsSync(join(dir, 'mare.jpg'))).toBe(true);
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(1), { timeout: 10_000 }).toEqual(['tolto:NotAllowedError']);
  expect(existsSync(join(dir, 'mare.jpg'))).toBe(true);
});

test('un file dato da leggere: spostarlo o scriverci si chiede col nome del file', async () => {
  test.setTimeout(60_000);
  const { pagina, dir } = await dai('album', true);
  await pagina.locator('#sposta').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('vuole modificare «mare.jpg»');
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti.slice(1), { timeout: 10_000 }).toEqual(['spostato:NotAllowedError']);
  expect(readdirSync(dir)).toEqual(['mare.jpg']);
  await pagina.locator('#scrivi').click();
  await expect.poll(() => esiti.slice(1), { timeout: 10_000 }).toEqual(['spostato:NotAllowedError', 'scritto:NotAllowedError']);
});

test('nome lungo con markup: si legge come testo, accorciato; aspetto chiaro e scuro', async () => {
  test.setTimeout(60_000);
  const nome = '<b>x<b> vacanze estate al mare con gli amici di sempre e tutti i parenti 2026';
  const { pagina } = await dai(nome);
  await pagina.locator('#togli').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra().locator('b')).toHaveCount(0);
  await expect(barra()).toContainText('«<b>x<b> vacanze');
  const box = await barra().boundingBox();
  expect(box.height).toBeLessThan(90);
  await shell.screenshot({ path: 'tests/.shots/v1069-chiaro.png' });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await shell.screenshot({ path: 'tests/.shots/v1069-scuro.png' });
});

test('la risposta sulla modifica dei file si vede nella pagina Sicurezza e si toglie', async () => {
  test.setTimeout(60_000);
  const { pagina } = await dai('foto');
  await pagina.locator('#togli').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  let sec = null;
  await expect.poll(() => { sec = app.windows().find((w) => w.url().startsWith('filo://security')); return Boolean(sec); }, { timeout: 10_000 }).toBe(true);
  const riga = sec.locator('#sec-perm-list li', { hasText: 'Modifica dei file' });
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await expect(riga).toContainText('127.0.0.1');
  await riga.getByRole('button').click();
  await expect(riga).toHaveCount(0, { timeout: 10_000 });
});
