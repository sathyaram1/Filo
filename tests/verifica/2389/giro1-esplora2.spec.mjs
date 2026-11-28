// Verifica #2389 giro 1: esplorazione, seconda parte.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHOTS = join(ROOT, 'tests', '.shots', 'v2389');
mkdirSync(SHOTS, { recursive: true });

async function finestraCon(app, prefisso, tetto = 10_000) {
  const scadenza = Date.now() + tetto;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith(prefisso); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
async function home(app) {
  const w = await finestraCon(app, 'filo://newtab', 15_000);
  await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 });
  return w;
}
const testoDoc = (ed) => ed.locator('#doc').innerText();
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
  return { attiva: (tm.tabs.find((t) => t.id === tm.activeId) || {}).url, tabs: tm.tabs.map((t) => ({ id: t.id, url: t.url })) };
});
const attiva = (app, prefisso) => app.evaluate(({ BrowserWindow }, p) => {
  const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
  const t = tm.tabs.find((x) => x.url.startsWith(p));
  tm.activate(t.id);
}, prefisso);
function registra(nome, secondi = 3) {
  const dir = join(SHOTS, nome); mkdirSync(dir, { recursive: true });
  const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-framerate', '30', '-t', String(secondi),
    '-i', process.env.DISPLAY, join(dir, 'f%03d.png')], { stdio: 'ignore' });
  return new Promise((r) => p.on('exit', r));
}
const editorDavanti = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return !!t && t.url.startsWith('filo://editor');
});

test('movimento ridotto: quanto resta il campo vuoto senza niente', async ({ app }) => {
  const page = await home(app);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#input').fill('Movimento ridotto');
  await page.waitForTimeout(800);
  const t0 = Date.now();
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  let vuoto = null; let davanti = null;
  while (Date.now() - t0 < 8000 && davanti === null) {
    if (vuoto === null && (await page.locator('#input').inputValue()) === '') vuoto = Date.now() - t0;
    if (await editorDavanti(app)) davanti = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 30));
  }
  console.log('ridotto: campo vuoto a', vuoto, 'ms, editor davanti a', davanti, 'ms');
});

test('animato: quando parte il velo e quando arriva l\'editor', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Animato');
  await page.waitForTimeout(800);
  const t0 = Date.now();
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  let davanti = null;
  while (Date.now() - t0 < 8000 && davanti === null) {
    if (await editorDavanti(app)) davanti = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 30));
  }
  console.log('animato: editor davanti a', davanti, 'ms');
});

test('editor già aperto: una scheda sola, una chat sola, il documento di prima resta', async ({ app }) => {
  const page = await home(app);
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await ed.locator('#doc').click();
  await ed.keyboard.type('Documento di prima');
  await page.waitForTimeout(1500);
  await attiva(app, 'filo://newtab');
  await page.waitForTimeout(800);
  await page.locator('#input').fill('Seconda bozza');
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Seconda bozza');
  await page.waitForTimeout(1500);
  const s = await schede(app);
  console.log('gia aperto schede', JSON.stringify(s));
  expect(s.tabs.filter((x) => x.url.startsWith('filo://editor')).length).toBe(1);
  expect(await testoDoc(ed)).not.toContain('Documento di prima');
  console.log('sidebar nella pagina:', await ed.locator('.sn-sidebar').count());
  await ed.screenshot({ path: join(SHOTS, 'gia-aperto.png') });
});

test('tornare alla home dalla scheda: frame', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Torno alla home');
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  const ed = await finestraCon(app, 'filo://editor/editor.html');
  await expect.poll(() => testoDoc(ed), { timeout: 8000 }).toContain('Torno alla home');
  await page.waitForTimeout(1500);
  const rec = registra('torna-home', 2.5);
  await page.waitForTimeout(300);
  await attiva(app, 'filo://newtab');
  await rec;
  const rec2 = registra('torna-editor', 2);
  await page.waitForTimeout(300);
  await attiva(app, 'filo://editor');
  await rec2;
  console.log('campo', JSON.stringify(await page.locator('#input').inputValue()));
});

test('chiudi la scheda dell\'editor a metà animazione', async ({ app }) => {
  const page = await home(app);
  await page.locator('#input').fill('Chiudo a metà');
  await page.waitForTimeout(800);
  await page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-az.principale').click();
  let ed = null;
  for (let i = 0; i < 100 && !ed; i++) {
    const s = await schede(app);
    ed = s.tabs.find((x) => x.url.startsWith('filo://editor'));
    if (!ed) await new Promise((r) => setTimeout(r, 20));
  }
  await app.evaluate(({ BrowserWindow }, id) => {
    const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
    tm.closeTab(id);
  }, ed.id);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(SHOTS, 'chiusa-a-meta.png') });
  const campo = await page.locator('#input').inputValue();
  const s = await schede(app);
  console.log('chiusa a meta: campo', JSON.stringify(campo), 'schede', JSON.stringify(s));
  // il testo non deve essere perso: o nel campo o in un documento
  await page.waitForTimeout(1500);
  const docs = await app.evaluate(async ({ app: a }) => {
    const fs = require('node:fs'); const p = require('node:path');
    try { return fs.readFileSync(p.join(a.getPath('userData'), 'storage.json'), 'utf8').includes('Chiudo a metà'); } catch (e) { return 'err ' + e.message; }
  });
  console.log('nel salvato?', docs);
  const velo = await page.evaluate(() => [...document.querySelectorAll('body > *')].filter((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().width > 300).map((e) => e.className || e.id));
  console.log('elementi fissi grandi', JSON.stringify(velo));
});
