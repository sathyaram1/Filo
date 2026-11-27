// Verifica #1905.1 giro 4: esplorazione (si cancella o si rinomina col numero del rilievo).

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { paginaDellaScheda } from '../../helpers/schede.mjs';

const FOTO = join(process.cwd(), 'tests', 'fixtures', 'provenienza', 'c2pa-ufficiale-ai.png');
const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, { fn, arg }) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return new Function('tm', 'arg', `return (${fn})(tm, arg)`)(t, arg);
}, { fn: fn.toString(), arg });
const schede = (app) => tm(app, (t) => t.tabs.map((x) => { let u = ''; try { u = x.view.webContents.getURL() || x.url; } catch (_) { u = x.url; } return { id: x.id, url: u, tabUrl: x.url }; }));
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

function wav(path) {
  const n = 8000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 3) * 20000), 44 + i * 2);
  writeFileSync(path, b);
}

function cartella() {
  const dir = join(cartellaTemporanea('esplora-'), 'Scaricati');
  mkdirSync(dir, { recursive: true });
  copyFileSync(FOTO, join(dir, 'IMG_0001.png'));
  wav(join(dir, 'memo.wav'));
  writeFileSync(join(dir, 'seconda.html'), '<!doctype html><title>Seconda</title><img id="i" src="IMG_0001.png">');
  return dir;
}

async function apri(app, file) {
  await home(app);
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  const nome = file.split(/[\\/]/).pop();
  let id = null;
  await expect.poll(async () => (id = ((await schede(app)).find((s) => s.url.endsWith(nome)) || {}).id || null), { timeout: 10_000 }).toBeTruthy();
  await tm(app, (t, i) => t.activate(i), id);
  let p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, id, (x) => x.url().endsWith(nome))), { timeout: 15_000 }).toBe(true);
  return { id, pagina: p };
}

test('audio accanto letto con WebAudio', async ({ app }) => {
  const dir = cartella();
  writeFileSync(join(dir, 'audio.html'), `<!doctype html><title>Audio</title><audio id="a" src="memo.wav"></audio><button id="b">play</button><script>
document.getElementById('b').onclick = async () => {
  const a = document.getElementById('a');
  const ctx = new AudioContext();
  const src = ctx.createMediaElementSource(a);
  const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an); an.connect(ctx.destination);
  a.muted = false; a.loop = true;
  try { await a.play(); } catch (e) { document.body.dataset.esito = 'PLAY:' + e.name; return; }
  setTimeout(() => { const d = new Float32Array(2048); an.getFloatTimeDomainData(d); let m = 0; for (const x of d) m = Math.max(m, Math.abs(x)); document.body.dataset.esito = 'MAX:' + m.toFixed(3) + ' dur:' + a.duration; }, 700);
  try { const s = a.captureStream(); document.body.dataset.cattura = 'OK:' + s.getAudioTracks().length; } catch (e) { document.body.dataset.cattura = e.name; }
};
</script>`);
  const { pagina } = await apri(app, join(dir, 'audio.html'));
  await pagina.click('#b');
  await expect.poll(() => pagina.locator('body').getAttribute('data-esito'), { timeout: 10_000 }).toBeTruthy();
  console.log('AUDIO', await pagina.locator('body').getAttribute('data-esito'), await pagina.locator('body').getAttribute('data-cattura'));
});

test('duplica di una foto aperta dal computer', async ({ app }) => {
  const dir = cartella();
  const { id } = await apri(app, join(dir, 'IMG_0001.png'));
  const c = await tm(app, (t, i) => t.duplicateTab(i), id);
  expect(c).toBeTruthy();
  let p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, c, (x) => x.url().endsWith('IMG_0001.png'))), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => p.evaluate(() => { const i = document.querySelector('img'); return i ? i.naturalWidth : -1; }), { timeout: 10_000 }).toBeGreaterThan(0);
});

test('collegamento a un sito da una pagina del computer, poi duplica', async ({ app, testServer }) => {
  const dir = cartella();
  writeFileSync(join(dir, 'link.html'), `<!doctype html><title>Link</title><a id="l" href="${testServer.url}/">sito</a>`);
  const { id, pagina } = await apri(app, join(dir, 'link.html'));
  await pagina.click('#l');
  await pagina.waitForTimeout(2500);
  console.log('DOPO CLIC', JSON.stringify(await schede(app)));
  const c = await tm(app, (t, i) => t.duplicateTab(i), id);
  await pagina.waitForTimeout(2500);
  console.log('DOPO DUPLICA', c, JSON.stringify(await schede(app)));
});

test('Ctrl+Shift+T di un file poi cancellato', async ({ app }) => {
  const dir = cartella();
  const file = join(dir, 'seconda.html');
  const { id } = await apri(app, file);
  await tm(app, (t, i) => t.closeTab(i), id);
  rmSync(file);
  await tm(app, (t) => t.riapriChiusa());
  await new Promise((r) => setTimeout(r, 2500));
  console.log('RIAPERTA', JSON.stringify(await schede(app)));
});

test('Ctrl+Shift+T dopo un collegamento a una pagina accanto', async ({ app }) => {
  const dir = cartella();
  writeFileSync(join(dir, 'prima.html'), '<!doctype html><title>Prima</title><a id="l" href="seconda.html">vai</a>');
  const { id, pagina } = await apri(app, join(dir, 'prima.html'));
  await pagina.click('#l');
  await expect(pagina).toHaveTitle('Seconda', { timeout: 10_000 });
  await tm(app, (t, i) => t.closeTab(i), id);
  await tm(app, (t) => t.riapriChiusa());
  let nid = null;
  await expect.poll(async () => (nid = ((await schede(app)).find((s) => s.url.endsWith('seconda.html')) || {}).id || null), { timeout: 10_000 }).toBeTruthy();
  await tm(app, (t, i) => t.activate(i), nid);
  let p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, nid, (x) => x.url().endsWith('seconda.html'))), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => p.evaluate(() => document.getElementById('i').naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  // indietro torna alla prima?
  await tm(app, (t, i) => t.goBack && t.goBack(i), nid);
  await p.waitForTimeout(2000);
  console.log('INDIETRO', JSON.stringify(await schede(app)));
});
