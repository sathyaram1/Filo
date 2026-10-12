// Verifica #1069 giro 2, esplorazione: i selettori veri (cartella, apri, salva) davanti alla domanda di scrittura.
import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, cartellaInCasa } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const esiti = [];
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Carica</title>
<style>button{display:block;margin:8px;width:200px;height:30px}</style>
<button id="dir">dir</button><button id="dirrw">dirrw</button><button id="rw">rw</button>
<button id="apri">apri</button><button id="salva">salva</button><button id="togli">togli</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  let h = null;
  const leggi = async (d) => { const n = []; for await (const [k] of d.entries()) n.push(k); return n.sort().join(','); };
  document.getElementById('dir').onclick = async () => {
    try { h = await showDirectoryPicker({ mode: 'read' }); m('dir:' + await leggi(h) + ':' + await h.queryPermission({ mode: 'readwrite' })); } catch (e) { m('dir:' + e.name); }
  };
  document.getElementById('dirrw').onclick = async () => {
    try { h = await showDirectoryPicker({ mode: 'readwrite' }); m('dirrw:' + await h.queryPermission({ mode: 'readwrite' })); } catch (e) { m('dirrw:' + e.name); }
  };
  document.getElementById('rw').onclick = async () => { m('rw:' + await h.requestPermission({ mode: 'readwrite' }).catch((e) => e.name)); };
  document.getElementById('togli').onclick = () => h.removeEntry('mare.jpg').then(() => m('tolto'), (e) => m('tolto:' + e.name));
  document.getElementById('apri').onclick = async () => {
    try { const [f] = await showOpenFilePicker(); m('apri:' + await (await f.getFile()).text()); } catch (e) { m('apri:' + e.name); }
  };
  document.getElementById('salva').onclick = async () => {
    try { const f = await showSaveFilePicker({ suggestedName: 'nota.txt' }); const w = await f.createWritable(); await w.write('salvato'); await w.close(); m('salva:ok'); } catch (e) { m('salva:' + e.name); }
  };
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
  userData = cartellaTemporanea('filo-test-v1069g2-');
  app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => { await chiudiApp(app); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} });

const barra = () => shell.locator('#permesso-bar');
async function apri() {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/');
  let pagina = null;
  await expect.poll(() => { pagina = app.windows().find((w) => w.url().startsWith(origine)); return Boolean(pagina); }, { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('domcontentloaded');
  return pagina;
}
function cartella(nome) {
  const dir = join(cartellaInCasa('filo-v1069g2-'), nome);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mare.jpg'), 'foto');
  return dir;
}
async function scegli(pagina, id, file) {
  const [fc] = await Promise.all([pagina.waitForEvent('filechooser', { timeout: 10_000 }), pagina.locator('#' + id).click()]);
  await fc.setFiles(file);
}

test('esplora: selettore di cartella in lettura, poi scrittura chiesta', async () => {
  test.setTimeout(60_000);
  const pagina = await apri();
  const dir = cartella('foto da caricare');
  await scegli(pagina, 'dir', dir);
  await expect.poll(() => esiti, { timeout: 10_000 }).toEqual(['dir:mare.jpg:prompt']);
  await expect(barra()).toBeHidden();
  await pagina.locator('#rw').click();
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await expect(barra()).toContainText('«foto da caricare»');
  await barra().getByRole('button', { name: 'Non consentire', exact: true }).click();
  await expect.poll(() => esiti, { timeout: 10_000 }).toEqual(['dir:mare.jpg:prompt', 'rw:denied']);
  // dopo il no: leggere un'altra cartella, aprire un file e salvarne uno restano senza domanda
  const altra = cartella('altra');
  await scegli(pagina, 'dir', altra);
  const f = join(cartella('apri'), 'mare.jpg');
  await scegli(pagina, 'apri', f);
  const dest = join(cartella('dest'), 'nota.txt');
  await scegli(pagina, 'salva', dest);
  await expect.poll(() => esiti, { timeout: 10_000 }).toEqual(['dir:mare.jpg:prompt', 'rw:denied', 'dir:mare.jpg:prompt', 'apri:foto', 'salva:ok']);
  expect(readFileSync(dest, 'utf8')).toBe('salvato');
  await expect(barra()).toBeHidden();
});

test('esplora: salvataggio senza domanda, senza risposte prima', async () => {
  test.setTimeout(60_000);
  const pagina = await apri();
  const dest = join(cartella('dest'), 'nota.txt');
  await scegli(pagina, 'salva', dest);
  await expect.poll(() => esiti, { timeout: 10_000 }).toEqual(['salva:ok']);
  await expect(barra()).toBeHidden();
  expect(readFileSync(dest, 'utf8')).toBe('salvato');
  // sovrascrivere un file esistente col salvataggio
  const esiste = join(cartella('esiste'), 'mare.jpg');
  await scegli(pagina, 'salva', esiste);
  await expect.poll(() => esiti, { timeout: 10_000 }).toEqual(['salva:ok', 'salva:ok']);
  await expect(barra()).toBeHidden();
});

test('esplora: selettore di cartella in scrittura chiede, Consenti, poi una cartella in lettura', async () => {
  test.setTimeout(60_000);
  const pagina = await apri();
  const dir = cartella('progetto');
  await scegli(pagina, 'dirrw', dir);
  await expect(barra()).toBeVisible({ timeout: 10_000 });
  await shell.screenshot({ path: 'tests/.shots/v1069g2-dirrw.png' });
  const testo = await barra().innerText();
  esiti.push('barra:' + testo.replace(/\s+/g, ' '));
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.at(-1), { timeout: 10_000 }).toMatch(/^dirrw:/);
  console.log(JSON.stringify(esiti));
});
