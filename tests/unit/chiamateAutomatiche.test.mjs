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
