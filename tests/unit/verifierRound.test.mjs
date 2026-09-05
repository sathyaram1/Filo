// Le regole del giro del verificatore che corregge (src/shared/verifierRound.js,
// feedback #561). PURE: sono le stesse che il server incorpora al deploy e che
// la verifica locale usa, quindi qui si inchiodano i casi della spec (§4).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
require(resolve(ROOT, 'src', 'shared', 'feedbackTransitions.js'));
require(resolve(ROOT, 'src', 'shared', 'verifierRound.js'));
const R = globalThis.SN_VERIFIER_ROUND;
const CAPS = globalThis.SN_FB_TRANSITIONS.VERIFIER_CAPS;

const f = (level, text, decision = false) => ({ level, text, decision });
const decide = (findings, counts = {}, caps = CAPS) => R.decideRound({ findings, caps, counts });

// ── Il formato della critica ─────────────────────────────────────────────────

test('parseFindings: riassunto prima, poi una riga per rilievo col livello; le righe senza livello continuano il rilievo', () => {
  const p = R.parseFindings([
    'Provato: incolla, trascina, tema scuro. Funziona.',
    'Anche gli stress test reggono.',
    '[2] Il pulsante non salva se il titolo è vuoto.',
    '    Passi: apri, lascia vuoto, premi Salva.',
    '- [1?] Bordo grigio freddo: caldo come il resto? Scelta di gusto.',
    '**[0]** Sotto i 300 pixel il menu esce.',
    '[7] livello inesistente: non è un rilievo',
    '[3]    ',
  ].join('\n'));
  assert.match(p.summary, /^Provato: incolla/);
  assert.match(p.summary, /stress test reggono\.$/);
  assert.equal(p.findings.length, 3, 'livello fuori scala e testo vuoto non sono rilievi');
  assert.deepEqual(p.findings[0], { level: 2, text: 'Il pulsante non salva se il titolo è vuoto.\nPassi: apri, lascia vuoto, premi Salva.', decision: false });
  assert.deepEqual(p.findings[1], { level: 1, text: 'Bordo grigio freddo: caldo come il resto? Scelta di gusto.', decision: true });
  assert.equal(p.findings[2].level, 0);
});

test('parseFindings: senza righe col livello → zero rilievi (è il pass), qualunque cosa dica il testo', () => {
  const p = R.parseFindings('FAIL — il bottone non salva (scritto alla vecchia maniera)');
  assert.equal(p.findings.length, 0);
  assert.match(p.summary, /bottone non salva/);
  assert.equal(R.parseFindings('').findings.length, 0);
  assert.equal(R.parseFindings(null).findings.length, 0);
});

test('normalizeFindings: tetti su numero e lunghezza, decision solo se true', () => {
  const tanti = Array.from({ length: 60 }, (_, i) => ({ level: 1, text: `r${i}` }));
  assert.equal(R.normalizeFindings(tanti).length, R.MAX_FINDINGS);
  const lungo = R.normalizeFindings([{ level: 0, text: 'x'.repeat(5000), decision: 'sì' }])[0];
  assert.equal(lungo.text.length, R.MAX_FINDING_TEXT);
  assert.equal(lungo.decision, false);
});

// ── I bilanci (spec §4) ──────────────────────────────────────────────────────

test('default: cap2 5, cap1 2, cap0 0 (fonte unica, feedbackTransitions.js)', () => {
  assert.deepEqual(CAPS, { cap2: 5, cap1: 2, cap0: 0 });
  assert.equal(R.capKeyOf(3), 'cap2', 'i livelli 3 e 2 condividono il bilancio');
  assert.equal(R.capKeyOf(2), 'cap2');
  assert.equal(R.capKeyOf(1), 'cap1');
  assert.equal(R.capKeyOf(0), 'cap0');
});

test('nessun rilievo: passa, niente da correggere, niente consumato', () => {
  const d = decide([]);
  assert.equal(d.stop, false);
  assert.deepEqual(d.fix, []);
  assert.deepEqual(d.derived, []);
  assert.equal(d.consume, null);
});

test('un 2 con bilancio: si corregge, e il giro si paga da cap2', () => {
  const d = decide([f(2, 'rotto')]);
  assert.equal(d.stop, false);
  assert.equal(d.fix.length, 1);
  assert.equal(d.consume, 'cap2');
  assert.equal(d.counts.count2, 1);
  assert.equal(d.budgets.cap2.left, 4);
});

test('un giro consuma dal livello PIÙ ALTO corretto: un 2 e tre 1 pagano da cap2, non da cap1', () => {
  const d = decide([f(1, 'a'), f(2, 'b'), f(1, 'c'), f(1, 'd')]);
  assert.equal(d.fix.length, 4);
  assert.equal(d.consume, 'cap2');
  assert.equal(d.counts.count1, 0);
  assert.equal(d.counts.count2, 1);
});

test('gli 0 da soli si ignorano (cap0 = 0): vanno nel derivato; con altro da correggere si correggono pure loro', () => {
  const soli = decide([f(0, 'raro'), f(0, 'rarissimo')]);
  assert.deepEqual(soli.fix, []);
  assert.equal(soli.derived.length, 2);
  assert.equal(soli.consume, null, 'niente corretto, niente pagato');
  const insieme = decide([f(1, 'bordo'), f(0, 'raro')]);
  assert.deepEqual(insieme.fix.map((x) => x.level), [1, 0]);
  assert.equal(insieme.consume, 'cap1');
  assert.equal(insieme.counts.count0, 0, 'gli 0 corretti insieme ad altro non pagano da cap0');
});

test('cap0 alzato dall\'owner: anche gli 0 da soli si correggono, pagando da cap0', () => {
  const d = decide([f(0, 'raro')], {}, { cap2: 5, cap1: 2, cap0: 1 });
  assert.equal(d.fix.length, 1);
  assert.equal(d.consume, 'cap0');
  const dopo = decide([f(0, 'raro')], d.counts, { cap2: 5, cap1: 2, cap0: 1 });
  assert.deepEqual(dopo.fix, [], 'al secondo giro il bilancio è finito');
});

test('a bilancio finito su quel livello non si corregge: un 1 con cap1 esaurito va nel derivato', () => {
  const d = decide([f(1, 'bordo')], { count1: 2 });
  assert.deepEqual(d.fix, []);
  assert.equal(d.derived.length, 1);
  assert.equal(d.stop, false, 'un 1 non ferma mai il lavoro');
});

test('un 2 o 3 a bilancio cap2 finito FERMA il lavoro: niente si corregge, decide l\'owner', () => {
  const d = decide([f(2, 'rotto'), f(1, 'bordo'), f(0, 'raro')], { count2: 5 });
  assert.equal(d.stop, true);
  assert.equal(d.blocking.length, 1);
  assert.deepEqual(d.fix, []);
  assert.deepEqual(d.derived, [], 'fermandosi non si mette da parte niente: l\'owner vede tutto');
  assert.equal(d.consume, null);
  assert.equal(d.counts.count2, 5, 'fermarsi non paga un giro');
});

test('rilievi che chiedono una decisione: a livello 3/2 fermano, a livello 1 vanno nel derivato, a livello 0 idem', () => {
  assert.equal(decide([f(3, 'chiavi SSH?', true)]).stop, true);
  assert.equal(decide([f(2, 'quale strada?', true)]).stop, true, 'anche a bilancio pieno');
  const uno = decide([f(1, 'gusto?', true)]);
  assert.equal(uno.stop, false);
  assert.deepEqual(uno.fix, []);
  assert.equal(uno.derived.length, 1);
  const zero = decide([f(0, 'raro, gusto?', true), f(1, 'bordo')]);
  assert.equal(zero.fix.length, 1, 'lo 0 che chiede una decisione non si corregge nemmeno insieme ad altro');
  assert.equal(zero.derived.length, 1);
});

test('i bilanci si normalizzano: fuori scala si stringe, assenti → default, contatori negativi → 0', () => {
  assert.deepEqual(R.normalizeCaps({ cap2: 99, cap1: -3 }, CAPS), { cap2: 10, cap1: 0, cap0: 0 });
  assert.deepEqual(R.normalizeCaps(null, CAPS), CAPS);
  assert.deepEqual(R.normalizeCounts({ count2: -1, count1: '2' }), { count2: 0, count1: 2, count0: 0 });
});

test('cap2 a 0: il primo 2 ferma subito (scelta possibile dell\'owner)', () => {
  assert.equal(decide([f(2, 'rotto')], {}, { cap2: 0, cap1: 2, cap0: 0 }).stop, true);
});

test('la sequenza intera: cinque correzioni di livello 2, poi la sesta ferma', () => {
  let counts = {};
  for (let i = 0; i < 5; i++) {
    const d = decide([f(2, `giro ${i}`)], counts);
    assert.equal(d.stop, false, `giro ${i} si corregge`);
    counts = d.counts;
  }
  assert.equal(decide([f(2, 'ancora')], counts).stop, true);
});

// ── Testi ────────────────────────────────────────────────────────────────────

test('formatFindings e roundNote: livelli davanti, il segno ? conservato, esito in chiaro', () => {
  const list = [f(2, 'rotto\ncon passi'), f(1, 'gusto', true)];
  const txt = R.formatFindings(list);
  assert.match(txt, /^- \[2\] rotto\n  con passi\n- \[1\?\] gusto$/);
  assert.equal(R.hasDecision(list), true);
  const fix = R.roundNote({ summary: 'il resto regge', findings: list, decision: decide(list) });
  assert.match(fix, /^Verifica: 2 rilievi\./);
  assert.match(fix, /il resto regge/);
  assert.match(fix, /Il verificatore corregge 1 su 2/);
  assert.match(fix, /\[2\] rotto/);
  assert.match(R.roundNote({ findings: [] }), /^Verifica superata\.$/);
  assert.match(R.roundNote({ findings: [f(2, 'x')], decision: { stop: true } }), /Il lavoro si ferma/);
  assert.match(R.roundNote({ findings: [f(0, 'x')], decision: { fix: [] } }), /feedback derivato/);
});
