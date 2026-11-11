// La sede `v` (vicino) non c'è più dal #2339: nella critica si respinge col perché, e nello
// stato già scritto si legge esterno. Più l'accorpamento dei rimasti di un giro in un feedback
// solo (decisione dell'owner del 2026-09-27). Stesse regole sul server, che le incorpora al deploy.

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
const CAPS = { cap3: 5, cap2: 5, cap1: 2 };

const f = (level, sede, text, decision = false) => ({ level, sede, text, decision });
const decide = (findings, counts = {}, caps = CAPS) => R.decideRound({ findings, caps, counts });
const tag = (list) => list.map((x) => `${x.level == null ? '' : x.level}${x.sede}${x.decision ? '?' : ''}`);

// ── Il formato: il vicino si respinge ────────────────────────────────────────

test('la critica respinge la sede v, col ? prima o dopo la lettera, e dice che ora è un esterno senza livello', () => {
  const p = R.parseFindings('Provato tutto.\n[1v] etichetta tagliata\n- [2v?] scelta sul file vicino\n[3?V] grave nel file vicino\n[2i] qui');
  assert.deepEqual(tag(p.findings), ['2i'], 'solo l\'interno è un rilievo');
  assert.equal(p.rifiutati.length, 3);
  for (const r of p.rifiutati) assert.match(r, /la sede «vicino» non c'è più[\s\S]*è esterno[\s\S]*non prende livello: \[e\] testo/);
  assert.doesNotMatch(p.summary, /etichetta|vicino/, 'e non finisce nel riassunto');
  assert.equal(R.unparsedLevelLines('[1v] male\n[2v?] male').length, 2, 'una riga col v è scritta male');
  assert.match(R.testoRilieviNonRiconosciuti('Provato.\n[1v] male'), /\[1v\] male \(la sede «vicino» non c'è più/);
  assert.doesNotMatch(R.SPIEGAZIONE_SEDE, /«v»/);
  assert.deepEqual(R.SEDI, ['i', 'e']);
});

test('nello stato già scritto un vicino si legge esterno: senza livello, e formatFinding lo riscrive [e]', () => {
  assert.deepEqual(R.normalizeFindings([{ level: 2, sede: 'V', text: 'x' }]).map((x) => [x.level, x.sede]), [[null, 'e']]);
  assert.equal(R.sedeDi('v'), 'e');
  assert.equal(R.formatFinding(f(3, 'v', 'vicino', true)), '- [e?] vicino');
  const giro = R.parseFindings(R.formatFindings([f(3, 'v', 'a'), f(1, 'v', 'b', true)]));
  assert.deepEqual(giro.rifiutati, []);
  assert.deepEqual(giro.findings, [f(null, 'e', 'a'), f(null, 'e', 'b', true)]);
});

// ── La decisione del giro con lo stato vecchio ───────────────────────────────

test('un vicino dello stato vecchio è un esterno: non fa partire il giro, non paga, non ferma', () => {
  const solo = decide([f(3, 'v', 'grave ma non di questo lavoro'), f(2, 'v', 'scelta', true)]);
  assert.equal(solo.stop, false, 'nemmeno un 3 col ? scritto sul vicino ferma');
  assert.deepEqual(solo.fix, []);
  assert.equal(solo.consume, null);
  assert.deepEqual(solo.counts, { count3: 0, count2: 0, count1: 0 });
  assert.deepEqual(solo.external.map((x) => [x.level, x.sede, x.priority, x.decision]), [[null, 'e', null, false], [null, 'e', null, true]]);
  assert.deepEqual(solo.derived, []);
  // Accanto a un interno da correggere: il giro lo paga l'interno, il vicino esce a parte.
  const r = decide([f(1, 'i', 'qui'), f(3, 'v', 'nel file vicino')]);
  assert.deepEqual(tag(r.fix), ['1i']);
  assert.equal(r.consume, 'cap1');
  assert.deepEqual(tag(r.external), ['e']);
});

test('allo stop i vicini dello stato vecchio escono con gli esterni, non fra i sospesi', () => {
  const r = decide([f(3, 'i', 'da decidere', true), f(1, 'v', 'vicino'), f(null, 'e', 'altrove'), f(1, 'i', 'lieve')]);
  assert.equal(r.stop, true);
  assert.deepEqual(tag(r.sospesi), ['1i']);
  assert.deepEqual(tag(r.external), ['e', 'e']);
});

// ── I gruppi dei derivati ────────────────────────────────────────────────────

test('derivedGroups: esterni e domande da soli, tutti gli altri in un feedback solo a priorità massima', () => {
  const r = decide([f(null, 'e', 'esterno grave'), f(1, 'i', 'lieve'), f(2, 'i', 'non salva'), f(1, 'i', 'domanda', true), f(3, 'v', 'vicino vecchio')], { count2: 5, count1: 2 });
  assert.equal(r.consume, null);
  const g = R.derivedGroups(r);
  assert.deepEqual(g.map((x) => [x.tipo, x.priority, x.decision, tag(x.findings)]), [
    ['esterno', null, false, ['e']],
    ['esterno', null, false, ['e']],
    ['decisione', 1, true, ['1i?']],
    ['rimasti', 1, false, ['1i', '2i']],
  ]);
  assert.deepEqual(g[3].findings.map((x) => x.priority), [1, 1], 'un 2 nasce a 1');
});

test('derivedGroups accetta un elenco piatto e tiene i campi in più (numero, id); lo stato vecchio si legge con la regola scritta', () => {
  const g = R.derivedGroups([
    { level: 2, sede: 'i', text: 'a', num: '#7.1', id: 'x' },
    { level: 2, sede: 'e', text: 'b', decision: true },
    { level: 1, text: 'senza sede' },
    { level: 0, sede: 'i', text: 'zero vecchio' },
    { level: 9, text: 'fuori scala' },
  ]);
  assert.deepEqual(g.map((x) => x.tipo), ['esterno', 'rimasti']);
  assert.equal(g[0].decision, true, 'un esterno col ? resta un esterno, con la domanda dentro');
  assert.deepEqual([g[0].priority, g[0].findings[0].level, g[0].findings[0].priority], [null, null, null], 'l\'esterno perde il livello scritto');
  assert.equal(g[1].findings[0].num, '#7.1');
  assert.equal(g[1].findings[0].id, 'x');
  assert.equal(g[1].findings[1].sede, 'i');
  assert.deepEqual(g[1].findings[2].level, 1, 'uno 0 interno vale 1');
  assert.equal(g[1].priority, 1);
  assert.deepEqual(R.derivedGroups([]), []);
  assert.deepEqual(R.derivedGroups(null), []);
});

test('groupLabel dice cosa contiene il feedback, con livello e sede di ciascun rilievo', () => {
  const [esterno, domanda, rimasti] = R.derivedGroups([f(null, 'e', 'x', true), f(1, 'i', 'y', true), f(2, 'i', 'z'), f(1, 'i', 'w')]);
  assert.equal(R.groupLabel(esterno), 'esterno, da decidere');
  assert.equal(R.groupLabel(domanda), 'interno, da decidere');
  assert.equal(R.groupLabel(rimasti), 'rimasti del giro: 2 rilievi ([2i], [1i])');
  assert.equal(R.findingTag(f(null, 'e', 'x')), '[e]');
  assert.equal(R.findingTag(f(2, 'v', 'x', true)), '[e?]');
});

test('roundNote parla per gruppi: il feedback dei rimasti coi suoi rilievi, nessuna riga sui vicini', () => {
  const list = [f(2, 'i', 'Non salva. Passi: …'), f(1, 'i', 'Etichetta tagliata.'), f(1, 'i', 'Bordo storto.'), f(null, 'e', 'Altrove.')];
  const r = decide(list, { count2: 5, count1: 2 });
  const nota = R.roundNote({ summary: 'provato', findings: list, decision: r });
  assert.match(nota, /I 3 rilievi non corretti in questo giro escono insieme in un solo feedback derivato, a priorità 1 \(la più alta fra loro\): \[2i\] Non salva\.; \[1i\] Etichetta tagliata\.; \[1i\] Bordo storto\./);
  assert.match(nota, /il rilievo interno di livello 2 rimasto non ferma il lavoro ed entra nel feedback dei rimasti/);
  assert.match(nota, /Un rilievo è esterno/);
  assert.doesNotMatch(nota, /escono come feedback a parte/);
  // Uno stato vecchio col vicino: la nota lo conta fra gli esterni, e non parla di vicini.
  const vecchio = [f(2, 'i', 'qui'), f(3, 'v', 'vicino')];
  const notaVecchia = R.roundNote({ findings: vecchio, decision: decide(vecchio) });
  assert.match(notaVecchia, /Un rilievo è esterno/);
  assert.doesNotMatch(notaVecchia, /vicino \(|è vicino|bilancio delle correzioni di livello 2/i);
  assert.match(notaVecchia, /- \[e\] vicino/);
});

test('roundNote: una domanda che non ferma esce da sola', () => {
  const list = [f(1, 'i', 'scelta di gusto', true)];
  const nota = R.roundNote({ findings: list, decision: decide(list) });
  assert.match(nota, /Un rilievo chiede una tua decisione senza fermare il lavoro: esce in un feedback a parte/);
  assert.doesNotMatch(nota, /feedback dei rimasti|rilievi non corretti in questo giro/);
});
