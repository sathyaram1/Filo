// Verifica #1905.1 giro 5: altre porte per leggere il contenuto dei file accanto a una pagina del computer.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const FOTO = join(process.cwd(), 'tests', 'fixtures', 'provenienza', 'c2pa-ufficiale-ai.png');

function wav() {
  const n = 8000; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 3) * 20000), 44 + i * 2);
  return b;
}

const schedaFile = (app, fine) => app.evaluate(({ BrowserWindow }, fine) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => { try { return (x.view.webContents.getURL() || x.url || '').endsWith(fine); } catch (_) { return false; } });
  return t ? t.id : null;
}, fine);
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('la copia di un file sopravvive alla chiusura dell\'originale e alla ricarica; la copia di una foto aperta da sola si vede', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(cartellaTemporanea('esplora5b-'), 'Report');
  mkdirSync(dir, { recursive: true });
  copyFileSync(FOTO, join(dir, 'foto.png'));
  copyFileSync(FOTO, join(dir, 'sola.png'));
  writeFileSync(join(dir, 'r.html'), '<!doctype html><title>Rep</title><img id="i" src="foto.png">');
  await home(app);
  const tmEval = (fn, arg) => app.evaluate(({ BrowserWindow }, [src, a]) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return (0, eval)(src)(tm, a);
  }, [fn.toString(), arg]);
  const file = join(dir, 'r.html');
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, 'r.html')), { timeout: 10_000 }).toBeTruthy();
  await tmEval((tm, i) => tm.duplicateTab(i), id);
  let copia = null;
  await expect.poll(async () => (copia = await tmEval((tm, i) => { const t = tm.tabs.find((x) => x.id !== i && /r\.html$/.test(x.url || '')); return t ? t.id : null; }, id)), { timeout: 10_000 }).toBeTruthy();
  await tmEval((tm, i) => tm.closeTab(i), id);
  await new Promise((r) => setTimeout(r, 800));
  await tmEval((tm, i) => { tm.activate(i); tm.tabs.find((x) => x.id === i).view.webContents.reload(); }, copia);
  await new Promise((r) => setTimeout(r, 1500));
  const pagina = await paginaDellaScheda(app, copia, (p) => p.url().startsWith('file:'));
  await expect.poll(() => pagina.evaluate(() => document.getElementById('i') && document.getElementById('i').naturalWidth), { timeout: 10_000, message: 'la copia ricaricata vede ancora la foto' }).toBeGreaterThan(0);

  const sola = join(dir, 'sola.png');
  expect((await execAction(app, { type: 'NAVIGA', url: sola }, { parole: `aprimi ${sola}` })).executed).toBe(true);
  let idf = null;
  await expect.poll(async () => (idf = await schedaFile(app, 'sola.png')), { timeout: 10_000 }).toBeTruthy();
  await tmEval((tm, i) => tm.duplicateTab(i), idf);
  let copiaf = null;
  await expect.poll(async () => (copiaf = await tmEval((tm, i) => { const t = tm.tabs.find((x) => x.id !== i && /sola\.png$/.test(x.url || '')); return t ? t.id : null; }, idf)), { timeout: 10_000 }).toBeTruthy();
  await tmEval((tm, i) => tm.activate(i), copiaf);
  const stato = (i) => app.evaluate(async ({ BrowserWindow }, i) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const t = tm.tabs.find((x) => x.id === i);
    const wc = t && t.view && t.view.webContents;
    if (!wc) return 'senza vista';
    try { return wc.getURL() + ' ' + await wc.executeJavaScript('(()=>{const im=document.querySelector("img");return im?im.naturalWidth:-1})()'); } catch (e) { return 'err ' + e.message; }
  }, i);
  console.log('ORIG', await stato(idf));
  await expect.poll(async () => { const s = await stato(copiaf); console.log('COPIA', s); return Number(s.split(' ').pop()); }, { timeout: 10_000, message: 'la copia della foto si vede' }).toBeGreaterThan(0);
});

test('una pagina salvata col suo font, una cornice accanto e la memoria locale funziona come in un browser', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(cartellaTemporanea('esplora5c-'), 'Salvata');
  mkdirSync(join(dir, 'font'), { recursive: true });
  copyFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', join(dir, 'font', 'f.ttf'));
  writeFileSync(join(dir, 'stile.css'), '@font-face{font-family:Mio;src:url(font/f.ttf)} #t{font-family:Mio}');
  writeFileSync(join(dir, 'cornice.html'), '<!doctype html><title>C</title><p id="c">dentro la cornice</p>');
  writeFileSync(join(dir, 'p.html'), `<!doctype html><meta charset="utf-8"><title>Salvata</title><link rel="stylesheet" href="stile.css">
<body><h1 id="t">Titolo</h1><iframe id="f" src="cornice.html"></iframe><script>
const e = {};
window.addEventListener('load', async () => {
  try { localStorage.setItem('k', 'v'); e.ls = localStorage.getItem('k'); } catch (x) { e.ls = 'NO:' + x.name; }
  try { await new Promise((ok, ko) => { const r = indexedDB.open('db'); r.onsuccess = ok; r.onerror = () => ko(r.error); }); e.idb = 'si'; } catch (x) { e.idb = 'NO:' + (x && x.name); }
  try { await document.fonts.load('16px Mio'); e.font = [...document.fonts].map((f) => f.family + ':' + f.status).join(','); } catch (x) { e.font = 'NO:' + x.name; }
  e.fine = 1; document.body.dataset.esito = JSON.stringify(e);
});
</script></body>`);
  await home(app);
  const file = join(dir, 'p.html');
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, 'p.html')), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  await expect.poll(async () => JSON.parse((await pagina.locator('body').getAttribute('data-esito')) || '{}').fine, { timeout: 20_000 }).toBe(1);
  const e = JSON.parse(await pagina.locator('body').getAttribute('data-esito'));
  const cornice = await app.evaluate(async ({ BrowserWindow }, i) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((x) => x.id === i).view.webContents;
    const fr = wc.mainFrame.frames;
    const out = [];
    for (const f of fr) { try { out.push(f.url + ' => ' + await f.executeJavaScript('document.body ? document.body.innerText : "senza body"')); } catch (x) { out.push(f.url + ' err ' + x.message); } }
    return out.join(' | ') || 'nessuna cornice';
  }, id);
  console.log('ESITO', JSON.stringify(e), 'CORNICE', cornice);
  expect({ font: e.font, ls: e.ls, cornice: /dentro la cornice/.test(cornice) }).toEqual({ font: 'Mio:loaded', ls: 'v', cornice: true });
});

test('fetch, XHR, import, tracce, audio, @import e stili non leggono i file accanto', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(cartellaTemporanea('esplora5-'), 'Scaricati');
  mkdirSync(join(dir, 'progetto'), { recursive: true });
  copyFileSync(FOTO, join(dir, 'IMG_0001.png'));
  writeFileSync(join(dir, 'progetto', '.env'), 'TOKEN=chiave-del-punto-env');
  writeFileSync(join(dir, 'progetto', 'mod.js'), 'export const K = "chiave-del-modulo";');
  writeFileSync(join(dir, 'progetto', 'dati.json'), '{"k":"chiave-json"}');
  writeFileSync(join(dir, 'sub.vtt'), 'WEBVTT\n\n00:00.000 --> 00:05.000\nchiave-della-traccia\n');
  writeFileSync(join(dir, 'base.css'), '@import "dentro.css"; #t{color:rgb(4, 5, 6)}');
  writeFileSync(join(dir, 'dentro.css'), '#u{color:rgb(7, 8, 9)}');
  writeFileSync(join(dir, 'suono.wav'), wav());
  writeFileSync(join(dir, 'pagina.html'), `<!doctype html><meta charset="utf-8"><title>Esplora</title><link rel="stylesheet" href="base.css">
<body><h1 id="t">x</h1><p id="u">y</p><video id="v" src="IMG_0001.png"><track id="tr" kind="subtitles" src="sub.vtt" default></video><audio id="au" src="suono.wav"></audio><script>
const e = {};
const segna = () => { document.body.dataset.esito = JSON.stringify(e); };
const prova = async (k, f) => { try { e[k] = String(await f()).slice(0, 80); } catch (x) { e[k] = 'NO:' + x.name; } segna(); };
window.addEventListener('load', async () => {
  e.origine = location.origin;
  await prova('fetch', () => fetch('progetto/.env').then((r) => r.text()));
  await prova('fetchAss', () => fetch(location.href.replace(/[^/]*$/, 'progetto/.env')).then((r) => r.text()));
  await prova('fetchNoCors', () => fetch('progetto/.env', { mode: 'no-cors' }).then((r) => r.text()));
  await prova('xhr', () => new Promise((ok, ko) => { const x = new XMLHttpRequest(); x.open('GET', 'progetto/dati.json'); x.onload = () => ok(x.responseText); x.onerror = () => ko(Object.assign(new Error('x'), { name: 'XHRErr' })); x.send(); }));
  await prova('xhrSync', () => { const x = new XMLHttpRequest(); x.open('GET', 'progetto/dati.json', false); x.send(); return x.responseText; });
  await prova('import', () => import('./progetto/mod.js').then((m) => m.K));
  await prova('importJson', () => import('./progetto/dati.json', { with: { type: 'json' } }).then((m) => JSON.stringify(m.default)));
  await prova('regoleImport', () => { const s = document.styleSheets[0]; const r = s.cssRules[0]; return r.styleSheet.cssRules.length; });
  e.coloreImport = getComputedStyle(document.getElementById('u')).color;
  await new Promise((r) => setTimeout(r, 800));
  await prova('traccia', () => { const t = document.getElementById('tr').track; t.mode = 'hidden'; return t.cues ? (t.cues.length ? t.cues[0].text : 'vuota') : 'nulla'; });
  await prova('audio', async () => {
    const au = document.getElementById('au');
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(au); const an = ctx.createAnalyser(); src.connect(an); an.connect(ctx.destination);
    await au.play();
    await new Promise((r) => setTimeout(r, 400));
    const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
    return 'max ' + Math.max(...d.map(Math.abs)).toFixed(3);
  });
  e.fine = 1; segna();
});
</script></body>`);
  await home(app);
  const file = join(dir, 'pagina.html');
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, 'pagina.html')), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  const esito = async () => JSON.parse((await pagina.locator('body').getAttribute('data-esito')) || '{}');
  await expect.poll(async () => (await esito()).fine, { timeout: 30_000 }).toBe(1);
  const e = await esito();
  console.log('ESITO', JSON.stringify(e, null, 1));
  const letti = Object.entries(e).filter(([, v]) => /chiave/.test(String(v)));
  expect(letti, 'nessun contenuto dei file accanto arriva alla pagina').toEqual([]);
});
