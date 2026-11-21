// Esplorazione del giro 4 di #1905: porte dei giri passati e strade nuove sulle schede dei file del computer.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const FOTO = join(process.cwd(), 'tests', 'fixtures', 'provenienza', 'c2pa-ufficiale-ai.png');
const SHOTS = join(process.cwd(), 'tests', '.shots');

function prepara(nome = 'indice.html', corpo = '') {
  const radice = cartellaTemporanea('g4-');
  const dir = join(radice, 'Scaricati');
  mkdirSync(join(dir, 'Foto'), { recursive: true });
  mkdirSync(join(dir, 'progetto'), { recursive: true });
  mkdirSync(join(dir, 'indice_files'), { recursive: true });
  mkdirSync(join(radice, 'assets'), { recursive: true });
  copyFileSync(FOTO, join(dir, 'IMG_0001.png'));
  copyFileSync(FOTO, join(dir, 'Foto', 'IMG_0002.png'));
  copyFileSync(FOTO, join(dir, 'indice_files', 'logo.png'));
  copyFileSync(FOTO, join(radice, 'assets', 'su.png'));
  writeFileSync(join(dir, 'indice_files', 'stile.css'), '#t{color:rgb(4, 5, 6)}');
  writeFileSync(join(dir, 'progetto', '.env'), 'TOKEN="abc123SEGRETO"\n');
  writeFileSync(join(dir, 'progetto', 'nudo.env'), 'TOKEN=abc123SEGRETO\n');
  writeFileSync(join(dir, 'progetto', 'config.js'), 'var API_KEY = "chiaveSEGRETA";\n');
  writeFileSync(join(dir, 'note.txt'), 'password = "hunter2SEGRETO"\n');
  writeFileSync(join(dir, 'capitolo.html'), '<!doctype html><title>Capitolo</title><p>cap</p>');
  writeFileSync(join(dir, nome), `<!doctype html><html><head><meta charset="utf-8"><title>Indice</title>
    <link rel="stylesheet" href="indice_files/stile.css"></head><body>
    <h1 id="t">Indice</h1><img id="sub" src="indice_files/logo.png" width="40"><img id="su" src="../assets/su.png" width="40">
    <a id="cap" href="capitolo.html">capitolo</a>${corpo}</body></html>`);
  return { radice, dir, file: join(dir, nome) };
}

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, { src, arg }) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('tm', 'arg', `return (${src})(tm, arg);`)(t, arg);
}, { src: fn.toString(), arg });
const schedaFile = (app, fine) => tm(app, (t, fine) => {
  const x = t.tabs.find((s) => { const u = (() => { try { return s.view.webContents.getURL() || s.url; } catch (_) { return s.url; } })(); return /^file:/.test(u || '') && u.endsWith(fine); });
  return x ? x.id : null;
}, fine);
const contaFile = (app, fine) => tm(app, (t, fine) => t.tabs.filter((s) => String(s.url || '').startsWith('file:') && String(s.url).endsWith(fine)).length, fine);
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

async function apri(app, file) {
  const r = await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` });
  expect(r.executed, JSON.stringify(r)).toBe(true);
  const fine = encodeURIComponent(file.split('/').pop());
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, fine)), { timeout: 10_000 }).toBeTruthy();
  await tm(app, (t, i) => t.activate(i), id);
  let pagina = null;
  await expect.poll(async () => Boolean(pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'))), { timeout: 10_000 }).toBe(true);
  await pagina.waitForLoadState('load');
  return { id, pagina };
}

test('porte dei giri passati: tela, errori degli script, iframe, script accanto', async ({ app }) => {
  test.setTimeout(90_000);
  const { file } = prepara();
  await home(app);
  const { pagina } = await apri(app, file);
  const esiti = await pagina.evaluate(async () => {
    const out = {};
    const img = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
    for (const src of ['IMG_0001.png', 'Foto/IMG_0002.png']) {
      const i = await img(src);
      if (!i) { out[src] = 'non caricata'; continue; }
      const c = document.createElement('canvas'); c.width = 4; c.height = 4;
      const g = c.getContext('2d'); g.drawImage(i, 0, 0);
      try { out[src] = 'LETTA ' + g.getImageData(0, 0, 1, 1).data.join(','); } catch (e) { out[src] = 'chiusa ' + e.name; }
      try { out[src + ' bitmap'] = 'LETTA ' + (await createImageBitmap(i)).width; } catch (e) { out[src + ' bitmap'] = 'chiusa ' + e.name; }
    }
    const errori = [];
    window.addEventListener('error', (e) => errori.push(String(e.message)), true);
    const script = (src) => new Promise((ok) => { const s = document.createElement('script'); s.src = src; s.onload = () => ok('caricato'); s.onerror = () => ok('errore'); document.head.appendChild(s); });
    out.env = await script('progetto/.env');
    out.nudo = await script('progetto/nudo.env');
    out.config = await script('progetto/config.js');
    out.note = await script('note.txt');
    out.TOKEN = typeof window.TOKEN === 'undefined' ? null : String(window.TOKEN);
    out.API_KEY = typeof window.API_KEY === 'undefined' ? null : String(window.API_KEY);
    out.password = typeof window.password === 'undefined' ? null : String(window.password);
    out.errori = errori;
    const fr = document.createElement('iframe'); fr.src = 'capitolo.html';
    await new Promise((ok) => { fr.onload = ok; document.body.appendChild(fr); setTimeout(ok, 3000); });
    try { out.iframe = 'LETTO ' + fr.contentDocument.title; } catch (e) { out.iframe = 'chiuso ' + e.name; }
    try { out.css = 'LETTO ' + document.styleSheets[0].cssRules.length; } catch (e) { out.css = 'chiuso ' + e.name; }
    out.sub = document.getElementById('sub').naturalWidth;
    out.su = document.getElementById('su').naturalWidth;
    out.colore = getComputedStyle(document.getElementById('t')).color;
    out.origine = location.origin + ' ' + String(window.origin);
    return out;
  });
  console.log('ESITI', JSON.stringify(esiti, null, 1));
});

test('duplica, ricarica, collegamento e indietro sulla scheda di un file', async ({ app }) => {
  test.setTimeout(90_000);
  const { file } = prepara();
  await home(app);
  const { id, pagina } = await apri(app, file);
  const nuovo = await tm(app, (t, i) => t.duplicateTab(i), id);
  await new Promise((ok) => setTimeout(ok, 3000));
  const copia = nuovo ? await paginaDellaScheda(app, nuovo, (p) => p.url().startsWith('file:')) : null;
  console.log('DUPLICA', nuovo, await contaFile(app, 'indice.html'), copia ? await copia.title() : 'nessuna pagina',
    copia ? await copia.evaluate(() => document.getElementById('sub').naturalWidth) : -1);
  await tm(app, (t, i) => t.activate(i), id);
  await tm(app, (t, i) => t.reload(i), id);
  await new Promise((ok) => setTimeout(ok, 2500));
  const dopo = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  console.log('RICARICA', dopo ? await dopo.title() : 'nessuna', dopo ? await dopo.evaluate(() => document.getElementById('sub').naturalWidth) : -1);
  await dopo.click('#cap');
  await new Promise((ok) => setTimeout(ok, 2000));
  const cap = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  console.log('LINK', cap ? cap.url() + ' ' + await cap.title() : 'nessuna');
  await tm(app, (t, i) => t.navigaCronologia(-1, i), id);
  await new Promise((ok) => setTimeout(ok, 2500));
  const ind = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  console.log('INDIETRO', ind ? ind.url() + ' ' + await ind.title() + ' ' + await ind.evaluate(() => document.getElementById('sub') && document.getElementById('sub').naturalWidth) : 'nessuna');
});

test('barra degli indirizzi: percorso scritto e indirizzo file:', async ({ app }) => {
  test.setTimeout(90_000);
  const { file, dir } = prepara();
  const casa = await home(app);
  const homeId = await tm(app, (t) => t.activeId);
  await tm(app, (t, { i, u }) => t.navigate(i, u), { i: homeId, u: file });
  await new Promise((ok) => setTimeout(ok, 3000));
  const stato = await tm(app, (t, i) => { const s = t.tabs.find((x) => x.id === i); return { url: s && s.url, wc: s && s.view.webContents.getURL(), n: t.tabs.length }; }, homeId);
  console.log('BARRA PERCORSO', JSON.stringify(stato));
  const p = await paginaDellaScheda(app, homeId, (x) => x.url().startsWith('file:'));
  console.log('BARRA PAGINA', p ? await p.title() + ' ' + await p.evaluate(() => document.getElementById('sub') && document.getElementById('sub').naturalWidth) : 'nessuna');
  const nuova = await tm(app, (t) => t.openTab('filo://newtab/'));
  await new Promise((ok) => setTimeout(ok, 1500));
  const id2 = await tm(app, (t) => t.activeId);
  await tm(app, (t, { i, u }) => t.navigate(i, u), { i: id2, u: pathToFileURL(join(dir, 'capitolo.html')).href });
  await new Promise((ok) => setTimeout(ok, 3000));
  console.log('BARRA URL', nuova, JSON.stringify(await tm(app, (t, i) => { const s = t.tabs.find((x) => x.id === i); return { url: s && s.url, wc: s && s.view.webContents.getURL() }; }, id2)));
  void casa;
});

test('nomi insoliti: accenti, emoji, cancelletto, percentuale, maiuscole', async ({ app }) => {
  test.setTimeout(90_000);
  await home(app);
  const esiti = [];
  for (const nome of ['caffè è 😀.html', 'report #3.html', 'sconto 50%.html', 'MAIUSCOLO.HTM', 'pagina.svg']) {
    const { file } = prepara(nome, '');
    if (nome.endsWith('.svg')) writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><title>Svg</title><rect width="40" height="40" fill="red"/></svg>');
    for (const forma of ['grezzo', 'url']) {
      const u = forma === 'grezzo' ? file : pathToFileURL(file).href;
      const r = await execAction(app, { type: 'NAVIGA', url: u }, { parole: `aprimi ${file}` });
      await new Promise((ok) => setTimeout(ok, 2000));
      const aperte = await tm(app, (t) => t.tabs.map((s) => { try { return s.view.webContents.getURL() + ' | ' + s.view.webContents.getTitle(); } catch (_) { return s.url; } }).filter((x) => x.startsWith('file:')));
      esiti.push({ nome, forma, executed: r.executed, out: r.output && JSON.stringify(r.output).slice(0, 200), aperte });
      await tm(app, (t) => { for (const s of t.tabs.filter((x) => String(x.url).startsWith('file:'))) t.closeTab(s.id); });
      await new Promise((ok) => setTimeout(ok, 500));
    }
  }
  console.log('NOMI', JSON.stringify(esiti, null, 1));
});

test('la pagina prova a uscire: window.open, location verso altri file, cartelle', async ({ app }) => {
  test.setTimeout(90_000);
  const { file, radice } = prepara();
  writeFileSync(join(radice, 'fuori.html'), '<!doctype html><title>FUORI</title>');
  await home(app);
  const { id, pagina } = await apri(app, file);
  await pagina.evaluate(() => { window.open('file:///etc/passwd'); window.open('../fuori.html'); window.open('Foto/'); });
  await new Promise((ok) => setTimeout(ok, 2500));
  const tutte = await tm(app, (t) => t.tabs.map((s) => { try { return s.view.webContents.getURL() + ' | ' + s.view.webContents.getTitle(); } catch (_) { return s.url; } }));
  console.log('APERTE', JSON.stringify(tutte));
  await pagina.evaluate(() => { location.href = './'; });
  await new Promise((ok) => setTimeout(ok, 2000));
  const p = await paginaDellaScheda(app, id);
  console.log('CARTELLA', p ? p.url() + ' ' + (await p.evaluate(() => document.body && document.body.innerText.slice(0, 200)).catch(() => 'x')) : 'nessuna');
  mkdirSync(SHOTS, { recursive: true });
});
