// Una chiamata al modello che parte da sola da una pagina ha dietro un gesto vero dell'utente, e il main ha un tetto
// per scheda (#1070). Qui la logica pura: cosa conta come gesto, quante chiamate paga, quando il tetto ferma e avvisa.
// Il comportamento nella pagina vera lo prova tests/chiamate-automatiche-solo-da-gesto.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/content/gesto.js');
const { SN_GESTO: G, SN_CONST } = globalThis;
const Tetto = require('../../src/main/services/tettoAutomatiche.js');

function orologio(t0 = 1_000_000) {
  let t = t0;
  return { ora: () => t, avanti: (ms) => { t += ms; } };
}

test('gesto: niente gesto, niente chiamata; un gesto vale 1,5 s', () => {
  const c = orologio();
  const g = G.crea(c.ora);
  assert.equal(g.recente(), false);
  g.segna();
  assert.equal(g.recente(), true);
  c.avanti(G.FINESTRA_MS);
  assert.equal(g.recente(), true);
  c.avanti(1);
  assert.equal(g.recente(), false);
});

test('gesto: uno script che dopo un clic cambia la selezione tre volte ottiene una chiamata sola', () => {
  const c = orologio();
  const g = G.crea(c.ora);
  g.segna();
  assert.equal(g.prendi('spiega'), true);
  c.avanti(400);
  assert.equal(g.prendi('spiega'), false);
  assert.equal(g.prendi('spiega'), false);
  // Chi prende per un altro scopo ha la sua parte dello stesso gesto.
  assert.equal(g.prendi('altro'), true);
  c.avanti(100);
  g.segna();
  assert.equal(g.prendi('spiega'), true);
});

test('gesto: contano solo eventi veri, e solo quelli che uno script non sa rendere veri', () => {
  const c = orologio();
  const g = G.crea(c.ora);
  const ascoltatori = new Map();
  g.ascolta({ addEventListener: (tipo, fn, opz) => { ascoltatori.set(tipo, { fn, opz }); } });
  for (const tipo of ascoltatori.keys()) assert.ok(G.EVENTI.includes(tipo));
  assert.equal(ascoltatori.get('mouseup').opz.capture, true);

  ascoltatori.get('mouseup').fn({ isTrusted: false });
  ascoltatori.get('keyup').fn({});
  assert.equal(g.recente(), false, 'un evento fabbricato non è un gesto');
  ascoltatori.get('keyup').fn({ isTrusted: true });
  assert.equal(g.recente(), true);

  // `input` (execCommand), `focus`/`focusin` (focus()), `selectionchange` (addRange) e `beforeinput` arrivano
  // isTrusted anche da uno script; mousemove non è chiedere niente.
  for (const vietato of ['input', 'beforeinput', 'focus', 'focusin', 'selectionchange', 'select', 'mousemove', 'pointermove', 'scroll', 'wheel']) {
    assert.ok(!G.EVENTI.includes(vietato), `${vietato} non può valere come gesto`);
  }
  // Selezione da tastiera (Maiusc+frecce, Ctrl+A), col mouse, col dito, doppio clic.
  for (const serve of ['keydown', 'keyup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick']) {
    assert.ok(G.EVENTI.includes(serve), `${serve} è un gesto`);
  }
});

test('gesto: un tasto tenuto premuto è un gesto solo, le sue ripetizioni e il rilascio lo tengono vivo', () => {
  const c = orologio();
  const g = G.crea(c.ora);
  const tasto = (type, code, repeat = false) => g.suEvento({ isTrusted: true, type, code, repeat });
  tasto('keydown', 'ArrowDown');
  assert.equal(g.prendi('correttore'), true);
  for (let i = 0; i < 30; i++) {
    c.avanti(33);
    tasto('keydown', 'ArrowDown', true);
    assert.equal(g.prendi('correttore'), false, 'una ripetizione non è un gesto nuovo');
  }
  c.avanti(2000);
  tasto('keyup', 'ArrowDown');
  assert.equal(g.recente(), true, 'il rilascio tiene vivo il gesto');
  assert.equal(g.prendi('correttore'), false, 'il rilascio non è un gesto nuovo');
  // Un tasto diverso premuto dopo è un gesto suo; un rilascio senza pressione vista, anche.
  tasto('keydown', 'KeyA');
  assert.equal(g.prendi('correttore'), true);
  tasto('keyup', 'KeyB');
  assert.equal(g.prendi('correttore'), true);
});

test('gesto: una chiamata col tipo la paga solo il gesto che la chiede, non un tasto qualunque', () => {
  const c = orologio();
  const g = G.crea(c.ora);
  const ev = (type, key, extra = {}) => g.suEvento({ isTrusted: true, type, key, code: extra.code || key, ...extra });
  // Scrivere lettere non seleziona e non chiude parole: una pagina che a ogni lettera sposta la selezione o
  // aggiunge una parola non ne ottiene niente.
  for (const k of ['c', 'i', 'a', 'o', 'Backspace', 'Shift']) {
    ev('keydown', k); ev('keyup', k);
    assert.equal(g.prendi('spiega', G.SELEZIONA), false, `${k} non seleziona`);
    assert.equal(g.prendi('parola', G.CHIUDE), false, `${k} non chiude una parola`);
    assert.equal(g.prendi('correttore'), true, 'ma resta un gesto per lo scan');
  }
  // Uno spazio, una virgola, Invio chiudono una parola: un controllo per tasto.
  for (const k of [' ', ',', 'Enter']) {
    ev('keydown', k);
    assert.equal(g.prendi('parola', G.CHIUDE), true, `${JSON.stringify(k)} chiude`);
    assert.equal(g.prendi('parola', G.CHIUDE), false);
    ev('keyup', k);
  }
  // Maiusc+frecce, Ctrl/Cmd+A e il doppio clic selezionano; la freccia senza Maiusc no. Il mouse e il dito: il test dopo.
  ev('keydown', 'ArrowRight');
  assert.equal(g.prendi('spiega', G.SELEZIONA), false);
  ev('keyup', 'ArrowRight');
  for (const [type, key, extra] of [['keydown', 'ArrowRight', { shiftKey: true }], ['keydown', 'End', { shiftKey: true }],
    ['keydown', 'a', { ctrlKey: true, code: 'KeyA' }], ['keydown', 'a', { metaKey: true, code: 'KeyA' }],
    ['dblclick']]) {
    ev(type, key, extra);
    assert.equal(g.prendi('spiega', G.SELEZIONA), true, `${type} ${key || ''} seleziona`);
    if (key) ev('keyup', key, extra);
  }
  // Selezionare e poi copiare subito: Ctrl+C dopo il doppio clic non toglie l'anticipo della selezione.
  ev('dblclick');
  ev('keydown', 'Control', { ctrlKey: true });
  ev('keydown', 'c', { ctrlKey: true, code: 'KeyC' });
  assert.equal(g.prendi('spiega', G.SELEZIONA), true);
  // Il rilascio di un tasto premuto prima non riporta indietro il gesto in corso.
  ev('keyup', 'c', { ctrlKey: true, code: 'KeyC' });
  ev('keyup', 'Control');
  c.avanti(G.FINESTRA_MS + 1);
  assert.equal(g.prendi('spiega', G.SELEZIONA), false, 'scaduto');
});

// Un clic semplice non può fare una selezione: se ne compare una dopo, l'ha fatta la pagina (#1070.1).
test('gesto: un clic semplice non seleziona; trascinare, doppio e triplo clic, Maiusc+clic e la pressione lunga del dito sì', () => {
  const c = orologio();
  const nuovo = () => {
    const g = G.crea(c.ora);
    const ev = (type, x, y, extra = {}) => g.suEvento({ isTrusted: true, type, clientX: x, clientY: y, detail: 1, ...extra });
    const dito = (type, x, y) => g.suEvento({ isTrusted: true, type, detail: 0, changedTouches: [{ clientX: x, clientY: y }] });
    return { ev, dito, seleziona: () => g.prendi('spiega', G.SELEZIONA) };
  };

  let { ev, dito, seleziona } = nuovo();
  ev('mouseup', 300, 300);
  assert.equal(seleziona(), false, 'un rilascio senza pressione vista non è un trascinamento');
  // Il clic semplice, anche col puntatore che trema di poco e con la coppia pointer*/mouse* che Chromium manda.
  for (const d of [0, 1, G.SPOSTAMENTO_PX.puntatore]) {
    ev('pointerdown', 100, 100, { pointerType: 'mouse', detail: 0 });
    ev('mousedown', 100, 100);
    assert.equal(seleziona(), false, 'la pressione da sola non seleziona');
    c.avanti(120);
    ev('pointerup', 100 + d, 100, { pointerType: 'mouse', detail: 0 });
    ev('mouseup', 100 + d, 100);
    assert.equal(seleziona(), false, `un clic che si sposta di ${d} px non seleziona`);
    c.avanti(500);
  }
  // Il mouse tenuto fermo a lungo non seleziona: la pressione lunga seleziona solo col dito.
  ev('mousedown', 100, 100); c.avanti(2000); ev('mouseup', 100, 100);
  assert.equal(seleziona(), false);
  // Trascinare, anche lentamente.
  ev('mousedown', 100, 100); c.avanti(3000); ev('mouseup', 160, 104);
  assert.equal(seleziona(), true, 'trascinare seleziona');
  // Doppio e triplo clic: la pressione che conta due o tre seleziona già lei; poi il dblclick.
  for (const detail of [2, 3]) {
    ev('mousedown', 100, 100, { detail });
    assert.equal(seleziona(), true, `pressione numero ${detail}`);
    ev('mouseup', 100, 100, { detail });
  }
  ev('dblclick', 100, 100, { detail: 2 });
  assert.equal(seleziona(), true);
  // Maiusc+clic allarga la selezione.
  ev('mousedown', 200, 100, { shiftKey: true });
  assert.equal(seleziona(), true, 'Maiusc+clic seleziona');

  ({ ev, dito, seleziona } = nuovo());
  // Il tocco breve no, anche se il dito trema; nemmeno i mousedown/mouseup che Chromium aggiunge dopo un tocco.
  dito('touchstart', 50, 50); c.avanti(150); dito('touchend', 58, 54);
  ev('mousedown', 58, 54); ev('mouseup', 58, 54);
  assert.equal(seleziona(), false, 'un tocco non seleziona');
  // La pressione lunga del dito e il dito che trascina (le maniglie della selezione) sì, anche via pointer*.
  dito('touchstart', 50, 50); c.avanti(G.PRESSIONE_LUNGA_MS); dito('touchend', 50, 50);
  assert.equal(seleziona(), true, 'pressione lunga');
  dito('touchstart', 50, 50); c.avanti(150); dito('touchend', 50, 50 + G.SPOSTAMENTO_PX.dito + 1);
  assert.equal(seleziona(), true, 'il dito che trascina');
  ev('pointerdown', 50, 50, { pointerType: 'touch', detail: 0 }); c.avanti(G.PRESSIONE_LUNGA_MS);
  ev('pointerup', 50, 50, { pointerType: 'touch', detail: 0 });
  assert.equal(seleziona(), true, 'pressione lunga vista dai pointer*');
  // Il tocco di un dito non fa da pressione al mouse: un mouseup lontano da un tocco non è un trascinamento.
  ({ ev, dito, seleziona } = nuovo());
  dito('touchstart', 10, 10);
  ev('mouseup', 300, 300);
  assert.equal(seleziona(), false);
});

test('gesto: paga solo la cosa che ha toccato; il rilascio del mouse tocca anche dove è cominciata la pressione', () => {
  const c = orologio();
  const g = G.crea(c.ora);
  const nodo = (nome, figli = []) => ({ nome, nodeType: 1, contains: (n) => n === nodo || figli.includes(n) });
  const casella = nodo('casella');
  const ricerca = nodo('ricerca');
  const ev = (type, target, extra = {}) => g.suEvento({ isTrusted: true, type, target, ...extra });
  // Scrivere nella ricerca della pagina non paga il controllo della sua casella, nemmeno con uno spazio.
  ev('keydown', ricerca, { key: ' ', code: 'Space' });
  assert.equal(g.prendi('correttore', undefined, G.dentro(casella)), false);
  assert.equal(g.prendi('parola', G.CHIUDE, G.dentro(casella)), false);
  assert.equal(g.prendi('parola', G.CHIUDE, G.dentro(ricerca)), true, 'nel campo dove si scrive, sì');
  ev('keyup', ricerca, { key: ' ', code: 'Space' });
  // Tab cade sul campo di prima; il rilascio, già nella casella, si aggiunge allo stesso gesto.
  ev('keydown', ricerca, { key: 'Tab', code: 'Tab' });
  assert.equal(g.prendi('correttore', undefined, G.dentro(casella)), false);
  ev('keyup', casella, { key: 'Tab', code: 'Tab' });
  assert.equal(g.prendi('correttore', undefined, G.dentro(casella)), true);
  // Pressione su un pulsante, rilascio altrove: il rilascio porta con sé anche il punto della pressione.
  const pulsante = nodo('pulsante');
  ev('mousedown', pulsante, { clientX: 10, clientY: 20 });
  ev('mouseup', casella, { clientX: 300, clientY: 400 });
  const punti = [];
  g.prendi('spiega', G.SELEZIONA, (l) => { punti.push([l.el.nome, l.x, l.y]); return false; });
  assert.deepEqual(punti, [['casella', 300, 400], ['pulsante', 10, 20]]);
  // Un gesto senza luogo (un evento senza bersaglio) non paga niente che chieda dove.
  g.segna([G.SELEZIONA]);
  assert.equal(g.prendi('spiega2', G.SELEZIONA, () => true), false);
  assert.equal(g.prendi('spiega3', G.SELEZIONA), true, 'senza la domanda «dove» resta un gesto');
});

test('tetto: le azioni contate sono quelle automatiche di SN_CONST', () => {
  const A = SN_CONST.ACTIONS;
  assert.deepEqual(Object.keys(Tetto.GRUPPI).sort(), [A.EXPLAIN, A.SPELLCHECK_SEMANTIC, A.SPELLCHECK_CONTEXT].sort());
  for (const g of Object.values(Tetto.GRUPPI)) assert.ok(Tetto.TETTI[g] > 0, `il gruppo ${g} ha un tetto`);
});

function wcFinto(id) {
  const ascoltatori = {};
  return { id, once: (ev, fn) => { ascoltatori[ev] = fn; }, distruggi: () => ascoltatori.destroyed && ascoltatori.destroyed() };
}

test('tetto: oltre il tetto per scheda si ferma, avvisa una volta per pausa, e riparte quando la finestra scorre', () => {
  const c = orologio();
  const t = Tetto.crea({ ora: c.ora });
  const wc = wcFinto(7);
  const spiega = { action: SN_CONST.ACTIONS.EXPLAIN };
  const tetto = Tetto.TETTI.spiegazioni;
  for (let i = 0; i < tetto; i += 1) assert.equal(t.passa(spiega, wc), null, `la ${i + 1}ª passa`);
  const prima = t.passa(spiega, wc);
  assert.deepEqual(prima, { gruppo: 'spiegazioni', tetto, primo: true });
  assert.equal(t.passa(spiega, wc).primo, false, 'l\'avviso non si ripete nella stessa pausa');

  // Un'altra scheda e un altro gruppo hanno il loro conto.
  assert.equal(t.passa(spiega, wcFinto(8)), null);
  assert.equal(t.passa({ action: SN_CONST.ACTIONS.SPELLCHECK_SEMANTIC }, wc), null);
  // Il tasto destro e le azioni non automatiche non si fermano e non si contano.
  assert.equal(t.passa({ ...spiega, suRichiesta: true }, wc), null);
  assert.equal(t.passa({ action: SN_CONST.ACTIONS.EXPLAIN_DEEP }, wc), null);

  c.avanti(Tetto.FINESTRA_MS);
  assert.equal(t.passa(spiega, wc), null, 'passato un minuto, si riparte');
  for (let i = 1; i < tetto; i += 1) t.passa(spiega, wc);
  assert.equal(t.passa(spiega, wc).primo, true, 'una pausa nuova avvisa di nuovo');
});

test('tetto: i due controlli del correttore, rapido e ragionato, stanno nello stesso conto', () => {
  const c = orologio();
  const t = Tetto.crea({ ora: c.ora });
  const wc = wcFinto(9);
  const tetto = Tetto.TETTI.correttore;
  for (let i = 0; i < tetto; i += 1) {
    const action = i % 2 ? SN_CONST.ACTIONS.SPELLCHECK_CONTEXT : SN_CONST.ACTIONS.SPELLCHECK_SEMANTIC;
    assert.equal(t.passa({ action }, wc), null);
  }
  assert.equal(t.passa({ action: SN_CONST.ACTIONS.SPELLCHECK_SEMANTIC }, wc).gruppo, 'correttore');
  // Una scheda chiusa non lascia il suo conto a un'altra che riusa l'id.
  wc.distruggi();
  assert.equal(t.passa({ action: SN_CONST.ACTIONS.SPELLCHECK_SEMANTIC }, wcFinto(9)), null);
});

test('tetto: senza scheda (main, shell) non si conta', () => {
  const t = Tetto.crea();
  for (let i = 0; i < 500; i += 1) assert.equal(t.passa({ action: SN_CONST.ACTIONS.EXPLAIN }, null), null);
});
