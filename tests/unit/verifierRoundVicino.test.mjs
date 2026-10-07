// La sede `v` (vicino: un altro lavoro, ma in un file che il ramo modifica già)
// e l'accorpamento dei rimasti di un giro in un feedback solo (decisioni
// dell'owner del 2026-09-27). Stesse regole sul server, che le incorpora al deploy.

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
const CAPS = { cap3: 5, cap2: 5, cap1: 2, cap0: 0 };

const f = (level, sede, text, decision = false) => ({ level, sede, text, decision });
const decide = (findings, counts = {}, caps = CAPS) => R.decideRound({ findings, caps, counts });
const tag = (list) => list.map((x) => `${x.level}${x.sede}${x.decision ? '?' : ''}`);

// ── Il formato ───────────────────────────────────────────────────────────────

test('la critica accetta la sede v, col ? prima o dopo la lettera', () => {
  const p = R.parseFindings('Provato tutto.\n[1v] etichetta tagliata\n- [2v?] scelta sul file vicino\n[3?V] grave nel file vicino');
  assert.deepEqual(p.rifiutati, []);
  assert.deepEqual(tag(p.findings), ['1v', '2v?', '3v?']);
  assert.deepEqual(R.unparsedLevelLines('[1v] bene\n[2v?] bene'), [], 'una riga col v non è scritta male');
  assert.match(R.SPIEGAZIONE_SEDE, /«v» se è di un altro lavoro ma sta in un file che il ramo modifica già/);
  assert.ok(R.SEDI.includes('v'));
});

test('i dati strutturati tengono la sede v, e formatFinding la riscrive uguale', () => {
  assert.deepEqual(R.normalizeFindings([{ level: 2, sede: 'V', text: 'x' }]).map((x) => x.sede), ['v']);
  assert.equal(R.formatFinding(f(3, 'v', 'vicino', true)), '- [3v?] vicino');
  const giro = R.parseFindings(R.formatFindings([f(3, 'v', 'a'), f(1, 'v', 'b', true)]));
  assert.deepEqual(giro.findings, [f(3, 'v', 'a'), f(1, 'v', 'b', true)]);
});

// ── La decisione del giro ────────────────────────────────────────────────────

test('con una correzione in corso i vicini entrano, e il giro lo paga il livello degli interni', () => {
  const r = decide([f(1, 'i', 'qui'), f(3, 'v', 'nel file vicino')]);
  assert.equal(r.stop, false);
  assert.deepEqual(tag(r.fix), ['1i', '3v']);
  assert.equal(r.consume, 'cap1', 'il 3 scritto sul vicino non paga cap3');
  assert.equal(r.budgets.cap3.left, 5);
});

test('da soli i vicini valgono 0: senza cap0 escono, con cap0 partono e lo consumano', () => {
  const senza = decide([f(3, 'v', 'grave ma non di questo lavoro')]);
  assert.equal(senza.stop, false, 'un 3 vicino non ferma il lavoro');
  assert.deepEqual(senza.fix, []);
  assert.equal(senza.consume, null);
  assert.deepEqual(senza.derived.map((x) => [x.level, x.sede, x.priority]), [[3, 'v', 3]], 'priorità = il livello SCRITTO');
  const con = decide([f(2, 'v', 'a'), f(0, 'v', 'b')], {}, { ...CAPS, cap0: 1 });
  assert.deepEqual(tag(con.fix), ['2v', '0v']);
  assert.equal(con.consume, 'cap0');
  assert.equal(con.counts.count0, 1);
  assert.equal(con.counts.count2, 0);
});

test('un 3 vicino a cap3 finito non ferma; un v col ? non ferma e va da parte', () => {
  const finito = decide([f(3, 'v', 'a')], { count3: 5 }, { ...CAPS, cap0: 1 });
  assert.equal(finito.stop, false);
  assert.equal(finito.consume, 'cap0');
  const domanda = decide([f(3, 'v', 'scelta', true), f(2, 'i', 'qui')]);
  assert.equal(domanda.stop, false);
  assert.deepEqual(tag(domanda.fix), ['2i']);
  assert.deepEqual(tag(domanda.derived), ['3v?']);
  assert.equal(domanda.derived[0].priority, 3);
});

test('allo stop i vicini restano fra i sospesi, come gli interni', () => {
  const r = decide([f(2, 'i', 'da decidere', true), f(1, 'v', 'vicino'), f(1, 'e', 'altrove')]);
  assert.equal(r.stop, true);
  assert.deepEqual(tag(r.sospesi), ['1v']);
  assert.deepEqual(tag(r.external), ['1e']);
});

// ── I gruppi dei derivati ────────────────────────────────────────────────────

test('derivedGroups: esterni e domande da soli, tutti gli altri in un feedback solo a priorità massima', () => {
  const r = decide([f(3, 'e', 'esterno grave'), f(1, 'i', 'lieve'), f(3, 'v', 'vicino grave'), f(1, 'i', 'domanda', true), f(0, 'v', 'cosmetico')], { count1: 2 });
  assert.equal(r.consume, null);
  const g = R.derivedGroups(r);
  assert.deepEqual(g.map((x) => [x.tipo, x.priority, x.decision, tag(x.findings)]), [
    ['esterno', 3, false, ['3e']],
    ['decisione', 1, true, ['1i?']],
    ['rimasti', 3, false, ['1i', '3v', '0v']],
  ]);
  assert.deepEqual(g[2].findings.map((x) => x.priority), [1, 3, 0], 'ciascuno tiene il suo livello');
});

test('derivedGroups accetta un elenco piatto e tiene i campi in più (numero, id)', () => {
  const g = R.derivedGroups([
    { level: 2, sede: 'i', text: 'a', num: '#7.1', id: 'x' },
    { level: 1, sede: 'e', text: 'b', decision: true },
    { level: 1, text: 'senza sede' },
    { level: 9, text: 'fuori scala' },
  ]);
  assert.deepEqual(g.map((x) => x.tipo), ['esterno', 'rimasti']);
  assert.equal(g[0].decision, true, 'un esterno col ? resta un esterno, con la domanda dentro');
  assert.equal(g[1].findings[0].num, '#7.1');
  assert.equal(g[1].findings[0].id, 'x');
  assert.equal(g[1].findings[1].sede, 'i');
  assert.equal(g[1].priority, 2);
  assert.deepEqual(R.derivedGroups([]), []);
  assert.deepEqual(R.derivedGroups(null), []);
});

test('groupLabel dice cosa contiene il feedback, con livello e sede di ciascun rilievo', () => {
  const [esterno, domanda, rimasti] = R.derivedGroups([f(2, 'e', 'x', true), f(1, 'v', 'y', true), f(2, 'i', 'z'), f(1, 'v', 'w')]);
  assert.equal(R.groupLabel(esterno), 'esterno, da decidere');
  assert.equal(R.groupLabel(domanda), 'vicino, da decidere');
  assert.equal(R.groupLabel(rimasti), 'rimasti del giro: 2 rilievi ([2i], [1v])');
});

test('roundNote parla per gruppi: il feedback dei rimasti coi suoi rilievi, i vicini corretti insieme', () => {
  const list = [f(2, 'i', 'Non salva. Passi: …'), f(1, 'v', 'Etichetta tagliata.'), f(0, 'i', 'Bordo storto.'), f(1, 'e', 'Altrove.')];
  const r = decide(list, { count2: 5 });
  const nota = R.roundNote({ summary: 'provato', findings: list, decision: r });
  assert.match(nota, /I 3 rilievi non corretti in questo giro escono insieme in un solo feedback derivato, a priorità 2 \(il livello più alto fra loro\): \[2i\] Non salva\.; \[1v\] Etichetta tagliata\.; \[0i\] Bordo storto\./);
  assert.match(nota, /il rilievo interno di livello 2 rimasto non ferma il lavoro ed entra nel feedback dei rimasti/);
  assert.doesNotMatch(nota, /escono come feedback a parte/);
  const fix = decide([f(2, 'i', 'qui'), f(3, 'v', 'vicino')]);
  assert.match(R.roundNote({ findings: [f(2, 'i', 'qui'), f(3, 'v', 'vicino')], decision: fix }), /Un rilievo è vicino \(di un altro lavoro, ma in un file che il ramo modifica già\): si corregge insieme al resto\./);
  // Un vicino di livello scritto 2 messo da parte non è «il bilancio dei 2 finito».
  const vicino2 = decide([f(2, 'v', 'vicino')]);
  assert.doesNotMatch(R.roundNote({ findings: [f(2, 'v', 'vicino')], decision: vicino2 }), /bilancio delle correzioni di livello 2/i);
});

test('roundNote: una domanda che non ferma esce da sola', () => {
  const list = [f(1, 'i', 'scelta di gusto', true)];
  const nota = R.roundNote({ findings: list, decision: decide(list) });
  assert.match(nota, /Un rilievo chiede una tua decisione senza fermare il lavoro: esce in un feedback a parte/);
  assert.doesNotMatch(nota, /feedback dei rimasti|rilievi non corretti in questo giro/);
});
