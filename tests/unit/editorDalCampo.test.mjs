// #2389 — la regia dell'editor che nasce dal campo: la bozza la prende una volta sola l'editor preparato per lei, una
// bozza non presa torna nel campo invece di sparire, l'editor viene davanti solo se la home è ancora davanti, e la home
// sa se torna dall'editor. Con schede finte: il main vero lo prova tests/editor-dal-campo.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'messages.js'));
const D = require(join(ROOT, 'src', 'main', 'services', 'editorDalCampo.js'));
const { MSG } = globalThis.SN_MSG;
const pulisci = () => { for (const a of D._attese.values()) clearTimeout(a.timer); D._attese.clear(); };

function wc() { return { mandati: [], send(_c, m) { this.mandati.push(m); }, isDestroyed: () => false }; }
function schede() {
  const home = { id: 'h', url: 'filo://newtab/', view: { webContents: wc() } };
  const t = {
    tabs: [home], activeId: 'h', sotto: null, attivate: [],
    openTab(url) { const x = { id: `e${this.tabs.length}`, url, view: { webContents: wc(), setBackgroundColor(c) { this.fondo = c; } } }; this.tabs.push(x); return x.id; },
    navigate(id, url) { this.tabs.find((x) => x.id === id).url = url; },
    arrivoSotto(id) { this.sotto = id; },
    fineArrivo(id) { if (this.sotto === id) this.sotto = null; },
    activate(id) { this.activeId = id; this.attivate.push(id); },
  };
  return { t, home };
}

test('la bozza la prende una volta sola l\'editor preparato, poi l\'editor viene davanti quando il velo è arrivato', () => {
  const { t, home } = schede();
  const r = D.consegna({ tabs: t, homeTab: home, homeWc: home.view.webContents, testo: 'Caro condominio,', sfondo: 'rgb(248, 246, 240)', velo: true });
  assert.equal(r.ok, true);
  const editor = t.tabs.find((x) => x.url.startsWith('filo://editor/'));
  assert.equal(editor.url, `filo://editor/editor.html?bozza=${r.id}`);
  assert.equal(t.sotto, editor.id);
  assert.equal(editor.view.fondo, 'rgb(248, 246, 240)');
  assert.deepEqual(D.prendi(r.id, home), { ok: false }, 'un\'altra scheda non la prende');
  assert.deepEqual(D.prendi(r.id, editor), { ok: true, testo: 'Caro condominio,' });
  assert.deepEqual(D.prendi(r.id, editor), { ok: false }, 'una volta sola');
  D.editorPronto(r.id, editor, { testo: { left: 88, top: 32, width: 720, height: 27 }, font: { size: 16, colore: 'rgb(1, 2, 3)' }, vw: 1280, vh: 800, sfondo: 'javascript:x' });
  const arrivo = home.view.webContents.mandati.find((m) => m.type === MSG.EDITOR_ARRIVO);
  assert.equal(arrivo.geometria.testo.left, 88);
  assert.equal(arrivo.geometria.sfondo, '', 'un colore non valido non passa');
  assert.deepEqual(t.attivate, [], 'aspetta il velo');
  assert.equal(D.veloPronto(r.id, wc()).ok, false, 'lo dice solo la home che l\'ha chiesto');
  D.veloPronto(r.id, home.view.webContents);
  assert.deepEqual(t.attivate, [editor.id]);
  assert.equal(t.sotto, null);
  pulisci();
});

test('senza velo l\'editor viene davanti appena ha disegnato; un editor già aperto si rinaviga', () => {
  const { t, home } = schede();
  t.openTab('filo://editor/editor.html?file=a');
  const r = D.consegna({ tabs: t, homeTab: home, homeWc: home.view.webContents, testo: 'x', velo: false });
  assert.equal(t.tabs.filter((x) => x.url.startsWith('filo://editor/')).length, 1);
  const editor = t.tabs.find((x) => x.url.startsWith('filo://editor/'));
  assert.equal(editor.url, `filo://editor/editor.html?bozza=${r.id}`);
  D.prendi(r.id, editor);
  D.editorPronto(r.id, editor, null);
  assert.deepEqual(t.attivate, [editor.id]);
  pulisci();
});

test('una bozza mai presa torna nel campo, e una home lasciata non si vede strappare via', async (c) => {
  c.mock.timers.enable({ apis: ['setTimeout'] });
  const { t, home } = schede();
  const r = D.consegna({ tabs: t, homeTab: home, homeWc: home.view.webContents, testo: 'Caro condominio,', velo: true });
  c.mock.timers.tick(10_000);
  const resa = home.view.webContents.mandati.find((m) => m.type === MSG.EDITOR_BOZZA_RESA);
  assert.deepEqual({ id: resa.id, testo: resa.testo }, { id: r.id, testo: 'Caro condominio,' });
  assert.deepEqual(t.attivate, []);

  const r2 = D.consegna({ tabs: t, homeTab: home, homeWc: home.view.webContents, testo: 'altro', velo: false });
  const editor = t.tabs.find((x) => x.url.startsWith('filo://editor/'));
  D.prendi(r2.id, editor);
  t.activeId = 'altrove';
  D.editorPronto(r2.id, editor, null);
  assert.deepEqual(t.attivate, []);
  c.mock.timers.reset();
  pulisci();
});

test('rifiuta il campo vuoto e dice il tetto quando lo supera', () => {
  const { t, home } = schede();
  assert.equal(D.consegna({ tabs: t, homeTab: home, testo: '  \n ' }).ok, false);
  const lungo = D.consegna({ tabs: t, homeTab: home, testo: 'a'.repeat(5_000_001) });
  assert.equal(lungo.ok, false);
  assert.match(lungo.error, /5000001 caratteri/);
});

test('la home che torna davanti sa se arriva dall\'editor', () => {
  const { home } = schede();
  D.schedaDavanti({ url: 'filo://editor/editor.html?file=a' }, home);
  D.schedaDavanti({ url: 'https://esempio.it/' }, home);
  D.schedaDavanti({ url: 'filo://editor/editor.html' }, { url: 'https://esempio.it/', view: { webContents: wc() } });
  const rientri = home.view.webContents.mandati.filter((m) => m.type === MSG.EDITOR_RIENTRO).map((m) => m.daEditor);
  assert.deepEqual(rientri, [true, false]);
});
