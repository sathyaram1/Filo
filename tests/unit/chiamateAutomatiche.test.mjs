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
  // Maiusc+frecce, Ctrl/Cmd+A, il mouse e il dito selezionano; la freccia senza Maiusc no.
  ev('keydown', 'ArrowRight');
  assert.equal(g.prendi('spiega', G.SELEZIONA), false);
  ev('keyup', 'ArrowRight');
  for (const [type, key, extra] of [['keydown', 'ArrowRight', { shiftKey: true }], ['keydown', 'End', { shiftKey: true }],
    ['keydown', 'a', { ctrlKey: true, code: 'KeyA' }], ['keydown', 'a', { metaKey: true, code: 'KeyA' }],
    ['mouseup'], ['dblclick'], ['touchend']]) {
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
  assert.deepEqual(Object.keys(Tetto.GRUPPI).sort(), [A.EXPLAIN, A.SPELLCHECK_SEMANTIC, A.SPELLCHECK_WORD].sort());
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
  assert.equal(t.passa({ action: SN_CONST.ACTIONS.SPELLCHECK_WORD }, wc), null);
  // Il tasto destro e le azioni non automatiche non si fermano e non si contano.
  assert.equal(t.passa({ ...spiega, suRichiesta: true }, wc), null);
  assert.equal(t.passa({ action: SN_CONST.ACTIONS.EXPLAIN_DEEP }, wc), null);

  c.avanti(Tetto.FINESTRA_MS);
  assert.equal(t.passa(spiega, wc), null, 'passato un minuto, si riparte');
  for (let i = 1; i < tetto; i += 1) t.passa(spiega, wc);
  assert.equal(t.passa(spiega, wc).primo, true, 'una pausa nuova avvisa di nuovo');
});

test('tetto: correttore, parola e controllo del testo stanno nello stesso conto', () => {
  const c = orologio();
  const t = Tetto.crea({ ora: c.ora });
  const wc = wcFinto(9);
  const tetto = Tetto.TETTI.correttore;
  for (let i = 0; i < tetto; i += 1) {
    const action = i % 2 ? SN_CONST.ACTIONS.SPELLCHECK_WORD : SN_CONST.ACTIONS.SPELLCHECK_SEMANTIC;
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
