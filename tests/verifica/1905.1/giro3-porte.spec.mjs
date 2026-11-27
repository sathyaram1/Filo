// Verifica #1905.1 giro 3: altre strade con cui una pagina del computer proverebbe a leggere i file accanto.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const FOTO = join(process.cwd(), 'tests', 'fixtures', 'provenienza', 'c2pa-ufficiale-ai.png');
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });
const schedaFile = (app, fine) => app.evaluate(({ BrowserWindow }, fine) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => { try { const u = x.view.webContents.getURL() || x.url; return /^file:/.test(u) && u.endsWith(fine); } catch (_) { return false; } });
  return t ? t.id : null;
}, fine);

test('tracce, lavoratori condivisi, richieste sincrone, embed, svg, import di stili e caratteri non leggono i file accanto', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(cartellaTemporanea('scaricati-'), 'Scaricati');
  mkdirSync(join(dir, 'progetto'), { recursive: true });
  copyFileSync(FOTO, join(dir, 'IMG_0001.png'));
  writeFileSync(join(dir, 'sottotitoli.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:01:00.000\nSEGRETO-VTT\n');
  writeFileSync(join(dir, 'vicino.txt'), 'SEGRETO-VICINO');
  writeFileSync(join(dir, 'w.js'), "onconnect = (e) => { const p = e.ports[0]; fetch('vicino.txt').then((r) => r.text()).then((t) => p.postMessage(t), () => p.postMessage('NO')); };");
  writeFileSync(join(dir, 'icone.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text id="s">SEGRETO-SVG</text></svg>');
  writeFileSync(join(dir, 'base.css'), '.x{content:"SEGRETO-CSS"}');
  writeFileSync(join(dir, 'progetto', '.env'), 'TOKEN=abc\n');
  const nome = 'tracce.html';
  writeFileSync(join(dir, nome), `<!doctype html><meta charset="utf-8"><title>Tracce</title>
<style>@import url("base.css");</style><body>
<video id="v" muted><track id="t" kind="subtitles" default src="sottotitoli.vtt"></video>
<embed id="em" src="vicino.txt" type="text/plain"><iframe id="fs" src="icone.svg"></iframe>
<svg id="u"><use href="icone.svg#s"></use></svg><script>
const esito = {};
const segna = () => { document.body.dataset.esito = JSON.stringify(esito); };
const leggi = (k, f) => { try { const v = f(); esito[k] = v == null ? 'NO' : String(v); } catch (err) { esito[k] = 'NO:' + err.name; } };
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
window.addEventListener('load', async () => {
  await attesa(1500);
  leggi('traccia', () => { const c = document.getElementById('t').track.cues; return c && c.length ? c[0].text : null; });
  leggi('embed', () => document.getElementById('em').getSVGDocument && document.getElementById('em').getSVGDocument()?.body?.innerText);
  leggi('iframe_svg', () => document.getElementById('fs').contentDocument.getElementById('s').textContent);
  leggi('import_css', () => document.styleSheets[0].cssRules[0].styleSheet.cssRules[0].cssText);
  leggi('xhr', () => { const x = new XMLHttpRequest(); x.open('GET', 'vicino.txt', false); x.send(); return x.responseText; });
  leggi('xhr_env', () => { const x = new XMLHttpRequest(); x.open('GET', 'progetto/.env', false); x.send(); return x.responseText; });
  esito.condiviso = await new Promise((ok) => {
    try { const w = new SharedWorker('w.js'); w.port.onmessage = (m) => ok(String(m.data)); w.onerror = () => ok('NO'); setTimeout(() => ok('NO:tempo'), 4000); } catch (err) { ok('NO:' + err.name); }
  });
  try { const f = new FontFace('x', 'url(vicino.txt)'); await f.load(); esito.font = 'CARICATO'; } catch (err) { esito.font = 'NO:' + err.name; }
  try { const r = await fetch('progetto/.env'); esito.fetch_env = await r.text(); } catch (err) { esito.fetch_env = 'NO:' + err.name; }
  try { esito.dimensione = performance.getEntriesByType('resource').filter((x) => /vtt|svg|css/.test(x.name)).map((x) => x.encodedBodySize).join(','); } catch (err) { esito.dimensione = 'NO'; }
  esito.fine = 1; segna();
});
</script></body>`);
  await home(app);
  const file = join(dir, nome);
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, nome)), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  const esito = async () => JSON.parse((await pagina.locator('body').getAttribute('data-esito')) || '{}');
  await expect.poll(async () => (await esito()).fine, { timeout: 25_000 }).toBe(1);
  const e = await esito();
  console.log('ESITO', JSON.stringify(e));
  for (const k of ['traccia', 'embed', 'iframe_svg', 'import_css', 'xhr', 'xhr_env', 'condiviso', 'fetch_env']) {
    expect.soft(String(e[k]), `${k}: ${e[k]}`).not.toMatch(/SEGRETO|TOKEN/);
  }
});
