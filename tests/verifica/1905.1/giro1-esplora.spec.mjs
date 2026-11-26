// Verifica #1905.1 giro 1: una pagina del computer non legge i file accanto, da nessuna strada.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const FOTO = join(process.cwd(), 'tests', 'fixtures', 'provenienza', 'c2pa-ufficiale-ai.png');
const schedaFile = (app, fine) => app.evaluate(({ BrowserWindow }, fine) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => { try { const u = x.view.webContents.getURL() || x.url; return /^file:/.test(u) && u.endsWith(fine); } catch (_) { return false; } });
  return t ? t.id : null;
}, fine);
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

async function apri(app, dir, nome, html) {
  writeFileSync(join(dir, nome), html);
  await home(app);
  const file = join(dir, nome);
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  let id = null;
  await expect.poll(async () => (id = await schedaFile(app, nome)), { timeout: 10_000 }).toBeTruthy();
  await app.evaluate(({ BrowserWindow }, i) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activate(i), id);
  const pagina = await paginaDellaScheda(app, id, (p) => p.url().startsWith('file:'));
  const esito = async () => JSON.parse((await pagina.locator('body').getAttribute('data-esito')) || '{}');
  await expect.poll(async () => (await esito()).fine, { timeout: 20_000 }).toBe(1);
  const r = await esito();
  console.log(nome, JSON.stringify(r));
  return r;
}

function cartella() {
  const dir = join(cartellaTemporanea('scaricati-'), 'Scaricati');
  mkdirSync(join(dir, 'progetto'), { recursive: true });
  copyFileSync(FOTO, join(dir, 'IMG_0001.png'));
  writeFileSync(join(dir, 'vicino.txt'), 'SEGRETO-VICINO');
  writeFileSync(join(dir, 'altra.html'), '<!doctype html><title>Altra</title><p id="s">SEGRETO-HTML</p>');
  writeFileSync(join(dir, 'dati.json'), '{"conto":"SEGRETO-JSON"}');
  writeFileSync(join(dir, 'w.js'), "fetch('vicino.txt').then((r) => r.text()).then((t) => postMessage(t), () => postMessage('NO'));");
  writeFileSync(join(dir, 'progetto', '.env'), 'TOKEN="chiave-env-virgolette"\n');
  writeFileSync(join(dir, 'progetto', 'settings.py'), 'SECRET_KEY = "chiave-python"\n');
  writeFileSync(join(dir, 'progetto', 'config.toml'), 'api_key = "chiave-toml"\n');
  writeFileSync(join(dir, 'progetto', 'credenziali'), 'PASSWORD="chiave-senza-estensione"\n');
  writeFileSync(join(dir, 'progetto', 'chiavi.ini'), 'CHIAVE_INI="chiave-ini"\n');
  return dir;
}

test('cornici, oggetti, finestre, lavoratori e moduli non leggono i file accanto alla pagina', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartella();
  const e = await apri(app, dir, 'cornici.html', `<!doctype html><meta charset="utf-8"><title>Cornici</title><body>
<iframe id="f1" src="vicino.txt"></iframe><iframe id="f2" src="altra.html"></iframe>
<iframe id="f3" sandbox="allow-scripts allow-same-origin" src="altra.html"></iframe>
<object id="o1" data="vicino.txt" type="text/plain"></object><script>
const esito = {};
const segna = () => { document.body.dataset.esito = JSON.stringify(esito); };
const leggi = (k, f) => { try { const v = f(); esito[k] = v == null ? 'NO' : String(v); } catch (err) { esito[k] = 'NO:' + err.name; } };
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
window.addEventListener('load', async () => {
  leggi('iframe_txt', () => document.getElementById('f1').contentDocument.body.innerText);
  leggi('iframe_html', () => document.getElementById('f2').contentDocument.getElementById('s').textContent);
  leggi('iframe_sandbox', () => document.getElementById('f3').contentDocument.getElementById('s').textContent);
  leggi('iframe_win', () => document.getElementById('f2').contentWindow.document.title);
  leggi('object_txt', () => document.getElementById('o1').contentDocument.body.innerText);
  try {
    const w = window.open('altra.html');
    await attesa(1500);
    leggi('finestra', () => w && w.document && w.document.getElementById('s').textContent);
    try { w && w.close(); } catch (_) {}
  } catch (err) { esito.finestra = 'NO:' + err.name; }
  esito.worker = await new Promise((ok) => {
    try { const wk = new Worker('w.js'); wk.onmessage = (m) => ok(String(m.data)); wk.onerror = () => ok('NO'); setTimeout(() => ok('NO:tempo'), 4000); } catch (err) { ok('NO:' + err.name); }
  });
  try { const m = await import('./dati.json', { with: { type: 'json' } }); esito.modulo_json = JSON.stringify(m.default); } catch (err) { esito.modulo_json = 'NO:' + err.name; }
  try { esito.nocors = await (await fetch('vicino.txt', { mode: 'no-cors' })).text() || 'NO'; } catch (err) { esito.nocors = 'NO:' + err.name; }
  esito.fine = 1; segna();
});
</script></body>`);
  for (const k of ['iframe_txt', 'iframe_html', 'iframe_sandbox', 'iframe_win', 'object_txt', 'finestra', 'worker', 'modulo_json', 'nocors']) {
    expect.soft(String(e[k]), `${k}: ${e[k]}`).not.toMatch(/SEGRETO|Altra/);
  }
});

test('un file di chiavi con i valori fra virgolette, caricato come script, non lascia la chiave alla pagina', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartella();
  const e = await apri(app, dir, 'chiavi.html', `<!doctype html><meta charset="utf-8"><title>Chiavi</title><body><script>
const esito = { errori: [] };
const segna = () => { document.body.dataset.esito = JSON.stringify(esito); };
window.addEventListener('error', (ev) => { esito.errori.push(String(ev.message || '')); segna(); });
</script><script src="progetto/.env"></script><script src="progetto/settings.py"></script><script src="progetto/config.toml"></script>
<script src="progetto/credenziali"></script><script src="progetto/chiavi.ini"></script><script src="progetto/mio.js"></script><script>
window.addEventListener('load', () => {
  const g = (n) => { try { return eval(n); } catch (_) { return 'NO'; } };
  esito.mio = g('MIO'); esito.env = g('TOKEN'); esito.py = g('SECRET_KEY'); esito.toml = g('api_key'); esito.senza = g('PASSWORD'); esito.ini = g('CHIAVE_INI');
  esito.fine = 1; segna();
});
</script></body>`);
  expect({ env: e.env, py: e.py, toml: e.toml, senza: e.senza, ini: e.ini }).toEqual({ env: 'NO', py: 'NO', toml: 'NO', senza: 'NO', ini: 'NO' });
});
