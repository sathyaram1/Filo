// #2377 — il doppio Ctrl (src/shared/doppioCtrl.js): sequenze di eventi → box aperto, annullato, chiuso o comando;
// lettere di serie, scelte dell'utente, ordine per uso e frasi della chat. Il gesto vero: tests/doppio-ctrl.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/carteHome.js');
require('../../src/shared/doppioCtrl.js');

const D = globalThis.SN_DOPPIO_CTRL;
const CFG = { sogliaMs: 400 };

// Una sequenza di eventi → gli esiti diversi da null, e la fase in cui resta.
function gioca(eventi, cfg = CFG) {
  const r = D.riconoscitore();
  const esiti = [];
  for (const e of eventi) {
    const x = e === 'scade' ? r.scaduto() : r.evento(e, cfg);
    if (x) esiti.push(x);
  }
  return { esiti, fase: r.fase() };
}
const giu = (t, extra = {}) => ({ tipo: 'giu', t, ...extra });
const su = (t) => ({ tipo: 'su', t });
const tasto = (key, t, mod = {}, code = '') => ({ tipo: 'tasto', key, code, t, mod });
const tocco = (t) => [giu(t), su(t + 60)];

test('Ctrl, Ctrl: il box dopo l\'attesa', () => {
  const { esiti, fase } = gioca([...tocco(0), ...tocco(200), 'scade']);
  assert.deepEqual(esiti, [{ attendi: 400 }, 'apri']);
  assert.equal(fase, 'aperto');
});

test('Ctrl, Ctrl, D: la lettera è un comando e il box non compare', () => {
  const { esiti, fase } = gioca([...tocco(0), ...tocco(200), tasto('d', 300), 'scade']);
  assert.deepEqual(esiti, [{ attendi: 400 }, { lettera: 'd', inghiotti: true }]);
  assert.equal(fase, 'riposo');
  // Con Shift vale la stessa lettera; con una tastiera cirillica vale quella stampata sul tasto.
  assert.deepEqual(gioca([...tocco(0), ...tocco(200), tasto('D', 300, { shift: true })]).esiti[1], { lettera: 'd', inghiotti: true });
  assert.deepEqual(gioca([...tocco(0), ...tocco(200), tasto('в', 300, {}, 'KeyD')]).esiti[1], { lettera: 'd', inghiotti: true });
});

test('Ctrl+C poi Ctrl+V, e Ctrl+clic, non sono tocchi', () => {
  assert.deepEqual(gioca([giu(0), tasto('c', 50, { ctrl: true }), su(100), giu(200), tasto('v', 250, { ctrl: true }), su(300), 'scade']).esiti, []);
  assert.deepEqual(gioca([giu(0), { tipo: 'mouse', t: 40 }, su(80), ...tocco(200), 'scade']).esiti, []);
  // Un tasto fra i due tocchi rompe la coppia.
  assert.deepEqual(gioca([...tocco(0), tasto('a', 100), ...tocco(200), 'scade']).esiti, []);
});

test('tre tocchi non aprono niente, e il quarto ricomincia da capo', () => {
  const tre = gioca([...tocco(0), ...tocco(200), ...tocco(400), 'scade']);
  assert.deepEqual(tre.esiti, [{ attendi: 400 }, 'annulla']);
  assert.equal(tre.fase, 'riposo');
  const quattro = gioca([...tocco(0), ...tocco(200), ...tocco(400), ...tocco(600), 'scade']);
  assert.deepEqual(quattro.esiti, [{ attendi: 400 }, 'annulla']);
  assert.equal(quattro.fase, 'su1');
});

test('troppo lenti, o Ctrl tenuto a lungo, non fanno un doppio tocco; la soglia cambiata vale subito', () => {
  assert.deepEqual(gioca([...tocco(0), ...tocco(1000), 'scade']).esiti, []);
  assert.deepEqual(gioca([giu(0), su(2000), ...tocco(2100), 'scade']).esiti, []);
  // Con la soglia larga (tremori) gli stessi tocchi lenti valgono.
  assert.deepEqual(gioca([...tocco(0), ...tocco(1000), 'scade'], { sogliaMs: 1200 }).esiti, [{ attendi: 1200 }, 'apri']);
  // Il tasto tenuto si ripete da sé: non è una seconda pressione.
  assert.deepEqual(gioca([giu(0), giu(30, { repeat: true }), su(60), ...tocco(200), 'scade']).esiti, [{ attendi: 400 }, 'apri']);
});

test('col box aperto un tocco lo chiude; Ctrl+qualcosa no', () => {
  const r = D.riconoscitore();
  for (const e of [...tocco(0), ...tocco(200)]) r.evento(e, CFG);
  assert.equal(r.scaduto(), 'apri');
  assert.equal(r.evento(giu(1000), CFG), null);
  assert.equal(r.evento(tasto('c', 1010, { ctrl: true }), CFG), null);
  assert.equal(r.evento(su(1020), CFG), null);
  assert.equal(r.fase(), 'aperto');
  r.evento(giu(1500), CFG);
  assert.equal(r.evento(su(1560), CFG), 'chiudi');
  assert.equal(r.fase(), 'riposo');
});

test('dopo il doppio tocco Esc annulla e si tiene, un altro tasto annulla e passa alla pagina', () => {
  assert.deepEqual(gioca([...tocco(0), ...tocco(200), tasto('Escape', 300)]).esiti[1], { annulla: true, inghiotti: true });
  assert.equal(gioca([...tocco(0), ...tocco(200), tasto('ArrowDown', 300)]).esiti[1], 'annulla');
  assert.equal(gioca([...tocco(0), ...tocco(200), tasto('d', 300, { alt: true })]).esiti[1], 'annulla');
});

test('le lettere di serie: quelle scelte dall\'owner, R non c\'è finché non c\'è la registrazione', () => {
  const v = D.voci(D.normalizza(globalThis.SN_CONST.DEFAULT_SETTINGS.doppioCtrl));
  const serie = Object.fromEntries(v.filter((x) => x.lettera).map((x) => [x.lettera, x.id]));
  assert.deepEqual(serie, {
    c: 'cerca', i: 'impostazioni', s: 'cattura', d: 'tema', f: 'schermoIntero', h: 'aiuto', m: 'muto', p: 'pausa',
    l: 'leggi', a: 'salvaPerDopo', z: 'riapri', b: 'blocca', u: 'cuffie', o: 'trascrivi',
  });
  for (const scartata of ['n', 't', 'q', 'k', 'g', 'w', 'r']) assert.equal(D.diLettera({}, scartata), null);
  // Le app ci sono, senza lettera.
  assert.ok(v.some((x) => x.id === 'app:editor' && x.lettera === ''));
  assert.deepEqual(D.normalizza(globalThis.SN_CONST.DEFAULT_SETTINGS.doppioCtrl), { acceso: true, sogliaMs: 400, lettere: [] });
});

test('una lettera data a un\'app: chi l\'aveva prende quella di prima, e tornare alla serie pulisce le scelte', () => {
  const r = D.assegna({}, 'app:editor', 'c');
  assert.deepEqual(r.lettere, [{ azione: 'cerca', lettera: '' }, { azione: 'app:editor', lettera: 'c' }]);
  assert.equal(D.diLettera({ lettere: r.lettere }, 'c').id, 'app:editor');
  // Scambio fra due azioni con lettera: nessuna resta senza.
  const s = D.assegna({}, 'muto', 'p');
  assert.equal(D.diLettera({ lettere: s.lettere }, 'p').id, 'muto');
  assert.equal(D.diLettera({ lettere: s.lettere }, 'm').id, 'pausa');
  // Rimettere tutto com'era non lascia scelte.
  const indietro = D.assegna({ lettere: s.lettere }, 'muto', 'm');
  assert.deepEqual(indietro.lettere, []);
  assert.deepEqual(D.assegna({ lettere: r.lettere }, 'cerca', 'c').lettere, []);
  assert.ok(D.assegna({}, 'muto', '1').rifiuto);
  assert.ok(D.assegna({}, 'nessuna', 'x').rifiuto);
  // Togliere una lettera: l'azione va fra quelle senza; rimetterla torna alla serie.
  const tolta = D.assegna({}, 'blocca', '');
  assert.deepEqual(tolta.lettere, [{ azione: 'blocca', lettera: '' }]);
  assert.deepEqual(D.assegna(tolta, 'blocca', 'b').lettere, []);
  // Scelte rovinate sul disco: si scartano, la serie resta.
  assert.deepEqual(D.normalizza({ lettere: [{ azione: 'x', lettera: 'q' }, { azione: 'tema', lettera: '9' }, null] }).lettere, []);
});

test('il box mette prima le lettere usate da poco, in fondo quelle senza lettera', () => {
  const { con, senza } = D.ordinate({}, { riapri: 2000, tema: 3000 });
  assert.deepEqual(con.slice(0, 3).map((v) => v.id), ['tema', 'riapri', 'cerca']);
  assert.ok(senza.every((v) => !v.lettera));
  assert.ok(senza.some((v) => v.id === 'app:editor'));
});

test('la frase della chat: assegna, toglie, torna alla serie', () => {
  const a = D.daTesto('e editor', {});
  assert.deepEqual(a.lettere, [{ azione: 'app:editor', lettera: 'e' }]);
  assert.match(a.label, /E → Editor/);
  assert.equal(D.diLettera({ lettere: D.daTesto('editor: e', {}).lettere }, 'e').id, 'app:editor');
  const t = D.daTesto('togli b', {});
  assert.deepEqual(t.lettere, [{ azione: 'blocca', lettera: '' }]);
  assert.deepEqual(D.daTesto('di serie', { doppioCtrl: { lettere: t.lettere } }).lettere, []);
  assert.ok(D.daTesto('togli x', {}).rifiuto);
  assert.ok(D.daTesto('x pizza margherita', {}).rifiuto);
  assert.equal(D.daTesto('', {}), null);
  assert.equal(D.descrivi([{ azione: 'blocca', lettera: '' }, { azione: 'app:editor', lettera: 'e' }]), 'Blocca il computer senza lettera, E → Editor');
});

test('ogni azione del catalogo ha chi la fa nel main', () => {
  const src = readFileSync(new URL('../../src/main/lettereDiFilo.js', import.meta.url), 'utf8');
  const blocco = src.slice(src.indexOf('const AZIONI = {'), src.indexOf('\n};', src.indexOf('const AZIONI = {')));
  for (const a of D.AZIONI) assert.match(blocco, new RegExp(`\\n  (async )?${a.id}(\\(|:)`), `${a.id} non ha la sua azione`);
  // Le app si aprono dal loro indirizzo.
  assert.ok(D.catalogo().filter((a) => a.id.startsWith('app:')).every((a) => /^filo:\/\//.test(a.url)));
});

test('la soglia sta nei suoi limiti, e l\'interruttore spento resta spento', () => {
  assert.equal(D.sogliaMs(5), 150);
  assert.equal(D.sogliaMs(99999), 1500);
  assert.equal(D.sogliaMs('abc'), 400);
  assert.equal(D.normalizza({ acceso: false }).acceso, false);
  assert.equal(D.normalizza({}).acceso, true);
});
