// Verifica #1905.1 giro 2: le foto e gli script accanto a una pagina del computer non si leggono, da nessuna strada.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
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
const schedeFile = (app, fine) => tm(app, (t, fine) => t.tabs.filter((x) => { try { const u = x.view.webContents.getURL() || x.url; return /^file:/.test(u) && u.endsWith(fine); } catch (_) { return false; } }).map((x) => x.id), fine);
async function paginaDi(app, id, fine) {
  let p = null;
  await expect.poll(async () => Boolean(p = await paginaDellaScheda(app, id, (x) => x.url().endsWith(fine))), { timeout: 15_000, message: `la pagina della scheda ${id} su ${fine}` }).toBe(true);
  return p;
}
const execAction = (app, action, opts) => app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

function cartella() {
  const dir = join(cartellaTemporanea('scaricati-'), 'Scaricati');
  mkdirSync(join(dir, 'Foto'), { recursive: true });
  mkdirSync(join(dir, 'progetto'), { recursive: true });
  copyFileSync(FOTO, join(dir, 'IMG_0001.png'));
  copyFileSync(FOTO, join(dir, 'Foto', 'IMG_0002.png'));
  writeFileSync(join(dir, 'disegno.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#123456"/></svg>');
  writeFileSync(join(dir, 'progetto', 'config.js'), 'TOKEN=chiaveSegretaUno\n');
  writeFileSync(join(dir, 'progetto', 'altro.js'), 'API_KEY = chiaveSegretaDue;\n');
  writeFileSync(join(dir, 'seconda.html'), `<!doctype html><title>Seconda</title><img id="i" src="IMG_0001.png">`);
  return dir;
}

async function apri(app, file) {
  await home(app);
  expect((await execAction(app, { type: 'NAVIGA', url: file }, { parole: `aprimi ${file}` })).executed).toBe(true);
  let ids = [];
  const nome = file.split(/[\\/]/).pop();
  await expect.poll(async () => (ids = await schedeFile(app, nome)).length, { timeout: 10_000 }).toBeGreaterThan(0);
  await tm(app, (t, i) => t.activate(i), ids[0]);
  return { id: ids[0], pagina: await paginaDellaScheda(app, ids[0], (p) => p.url().startsWith('file:')) };
}

test('tela, WebGL, bitmap, fotogrammi e immagini svg non leggono le foto accanto; gli errori e i nomi degli script restano chiusi', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartella();
  writeFileSync(join(dir, 'ostile.html'), `<!doctype html><meta charset="utf-8"><title>Ostile</title><body>
<img id="a" src="IMG_0001.png"><img id="b" src="Foto/IMG_0002.png"><img id="c" src="Foto/../IMG_0001.png"><img id="d" src="disegno.svg">
<img id="e" srcset="Foto/IMG_0002.png 1x"><script>
const esito = { errori: [], nomi: [] };
const segna = () => { document.body.dataset.esito = JSON.stringify(esito); };
window.onerror = (msg, src, l, c, err) => { esito.errori.push([msg, String(err && err.message), String(err && err.stack)].join(' ')); segna(); };
// Un proxy in fondo alla catena dei prototipi della finestra vede i nomi che uno script cerca e non trova.
try {
  Object.setPrototypeOf(EventTarget.prototype, new Proxy(Object.getPrototypeOf(EventTarget.prototype), {
    has(t, k) { if (typeof k === 'string' && /^chiave/.test(k)) esito.nomi.push(k); return Reflect.has(t, k); },
  }));
} catch (e) { esito.nomi.push('PROTO:' + e.name); }
</script><script src="progetto/config.js"></script><script src="progetto/altro.js"></script><script>
const prova = (k, f) => { try { const v = f(); esito[k] = v == null ? 'NO' : 'LETTO:' + String(v).slice(0, 40); } catch (e) { esito[k] = e.name; } };
window.addEventListener('load', async () => {
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    const img = document.getElementById(id);
    esito['vede_' + id] = img.naturalWidth > 0;
    prova('tela_' + id, () => { const c = document.createElement('canvas'); c.width = 2; c.height = 2; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, 1, 1).data[0]; });
    prova('url_' + id, () => { const c = document.createElement('canvas'); c.width = 2; c.height = 2; c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL(); });
    prova('gl_' + id, () => { const c = document.createElement('canvas'); const gl = c.getContext('webgl'); if (!gl) return null; const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); return 'caricata'; });
    prova('off_' + id, () => { const c = new OffscreenCanvas(2, 2); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, 1, 1).data[0]; });
    try { const bm = await createImageBitmap(img); const c = document.createElement('canvas'); const g = c.getContext('2d'); g.drawImage(bm, 0, 0); esito['bitmap_' + id] = 'LETTO:' + g.getImageData(0, 0, 1, 1).data[0]; } catch (e) { esito['bitmap_' + id] = e.name; }
    try { const vf = new VideoFrame(img, { timestamp: 0 }); const buf = new Uint8Array(vf.allocationSize()); await vf.copyTo(buf); esito['frame_' + id] = 'LETTO:' + buf[0]; vf.close(); } catch (e) { esito['frame_' + id] = e.name; }
  }
  esito.fine = 1; segna();
});
</script></body>`);
  const { pagina } = await apri(app, join(dir, 'ostile.html'));
  const esito = async () => JSON.parse((await pagina.locator('body').getAttribute('data-esito')) || '{}');
  await expect.poll(async () => (await esito()).fine, { timeout: 20_000 }).toBe(1);
  const e = await esito();
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    expect.soft(e['vede_' + id], `la foto ${id} si vede`).toBe(true);
    for (const k of ['tela', 'url', 'gl', 'off', 'bitmap', 'frame']) expect.soft(String(e[`${k}_${id}`]), `${k}_${id}`).not.toMatch(/^LETTO/);
  }
  expect.soft(e.errori.length, 'gli script di chiavi sono girati').toBeGreaterThan(0);
  expect.soft(e.errori.join(' | '), 'gli errori arrivano senza testo').not.toMatch(/chiaveSegreta/);
  expect.soft(e.nomi.join(' | '), 'i nomi cercati dagli script accanto non arrivano alla pagina').not.toMatch(/chiaveSegreta/);
});

test('«Duplica» della scheda di un file tornata dalla sessione e non ancora guardata apre la copia con le foto', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartella();
  const url = pathToFileURL(join(dir, 'seconda.html')).href;
  await home(app);
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    await globalThis.SN_STORAGE.setRaw(t._sessionKey(), { tabs: ['filo://newtab/', u], activeIndex: 0 });
    await t.restoreSession();
  }, url);
  let ids = [];
  await expect.poll(async () => (ids = await schedeFile(app, 'seconda.html')).length, { timeout: 10_000 }).toBe(1);
  const nuova = await tm(app, (t, i) => t.duplicateTab(i), ids[0]);
  expect(nuova, 'la copia nasce').toBeTruthy();
  const pagina = await paginaDellaScheda(app, nuova, (p) => p.url().startsWith('file:'));
  await expect(pagina).toHaveTitle('Seconda', { timeout: 10_000 });
  await expect.poll(() => pagina.evaluate(() => document.getElementById('i').naturalWidth), { message: 'la copia vede la foto della sua cartella' }).toBeGreaterThan(0);
});

test('«Duplica» due volte di fila e dopo un collegamento a una pagina accanto apre copie che si vedono', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartella();
  writeFileSync(join(dir, 'prima.html'), '<!doctype html><title>Prima</title><a id="l" href="seconda.html">vai</a>');
  const { id, pagina } = await apri(app, join(dir, 'prima.html'));
  await expect(pagina).toHaveTitle('Prima', { timeout: 10_000 });
  await pagina.click('#l');
  await expect(pagina).toHaveTitle('Seconda', { timeout: 10_000 });
  const [c1, c2] = await tm(app, (t, i) => Promise.all([t.duplicateTab(i), t.duplicateTab(i)]), id);
  for (const c of [c1, c2]) {
    expect(c, 'la copia nasce').toBeTruthy();
    const p = await paginaDellaScheda(app, c, (x) => x.url().endsWith('seconda.html'));
    await expect(p).toHaveTitle('Seconda', { timeout: 10_000 });
    await expect.poll(() => p.evaluate(() => document.getElementById('i').naturalWidth), { message: 'la copia vede la foto' }).toBeGreaterThan(0);
  }
});
