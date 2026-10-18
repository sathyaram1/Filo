// Il «?» di livello 2 non ferma più il lavoro, il «!» marca una scelta difficile da disfare, e le segnalazioni
// seguono la stessa regola (decisioni dell'owner del 2026-10-12, #1202). Stesse regole sul server, che incorpora
// verifierRound.js al deploy, nello strumento delle routine e nella verifica locale.

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
const F = (s) => R.parseFindings(s).findings;
const decide = (s, counts = {}, caps = CAPS) => R.decideRound({ findings: F(s), caps, counts });
const tag = (list) => list.map(R.findingTag);

// ── Il segno «!» ────────────────────────────────────────────────────────────

test('il lettore accetta il «!» dopo il «?», anche nell\'ordine inverso o col «?» prima della lettera', () => {
  const p = R.parseFindings('Provato.\n[2i?!] cambia il formato del file salvato\n[2?i!] b\n- [3i!?] c\n[1v?] d');
  assert.deepEqual(p.rifiutati, []);
  assert.deepEqual(p.findings.map((f) => [f.level, f.sede, f.decision, f.irreversibile === true]), [
    [2, 'i', true, true], [2, 'i', true, true], [3, 'i', true, true], [1, 'v', true, false],
  ]);
  assert.equal(p.findings[0].text, 'cambia il formato del file salvato');
  assert.deepEqual(R.unparsedLevelLines('Provato.\n[2i?!] a\n[2?i!] b'), []);
  // La riga riscritta si rilegge uguale: è la forma con cui la critica viaggia nei feedback derivati.
  assert.equal(R.formatFinding(p.findings[0]), '- [2i?!] cambia il formato del file salvato');
  assert.deepEqual(R.parseFindings(R.formatFindings(p.findings)).findings, p.findings);
});

test('un «!» senza «?» non è una scelta: la critica si respinge con la spiegazione, mai letto come rilievo', () => {
  const p = R.parseFindings('Provato.\n[2i!] scelta sui dati');
  assert.deepEqual(p.findings, []);
  assert.equal(p.rifiutati.length, 1);
  assert.match(p.rifiutati[0], /va con il «\?» della decisione: \[2i\?!\]/);
  const brutte = R.unparsedLevelLines('Provato.\n[2i!] scelta sui dati');
  assert.equal(brutte.length, 1);
  assert.match(brutte[0], /\[2i!\] scelta sui dati/);
  // Nei dati strutturati il segno senza la domanda cade: senza «?» non c'è niente da disfare.
  assert.deepEqual(R.normalizeFindings([{ level: 2, sede: 'i', text: 'x', irreversibile: true }]), [{ level: 2, sede: 'i', text: 'x', decision: false }]);
  assert.equal(R.findingTag({ level: 2, sede: 'i', decision: false, irreversibile: true }), '[2i]');
});

// ── Cosa ferma ──────────────────────────────────────────────────────────────

test('[2i?] non ferma: va nella correzione E nel derivato con la domanda; paga il bilancio dei 2', () => {
  const d = decide('Provato.\n[2i?] Nel menu: A o B? Consiglio A.');
  assert.equal(d.stop, false);
  assert.deepEqual(tag(d.fix), ['[2i?]']);
  assert.equal(d.derived.length, 1);
  assert.equal(d.derived[0].inCorrezione, true);
  assert.equal(d.derived[0].priority, 2);
  assert.equal(d.consume, 'cap2');
  assert.equal(d.counts.count2, 1);
  const g = R.derivedGroups(d);
  assert.deepEqual(g.map((x) => [x.tipo, x.priority, x.decision]), [['decisione', 2, true]]);
  assert.match(R.groupLabel(g[0]), /intanto si applica l'opzione consigliata/);
  const nota = R.roundNote({ summary: '', findings: F('[2i?] A o B? Consiglio A.'), decision: d });
  assert.match(nota, /chi corregge applica intanto l'opzione consigliata/);
  assert.match(nota, /Se scegli diversamente, quel feedback cambia il codice già fuso/);
  assert.doesNotMatch(nota, /Il lavoro si ferma/);
  assert.doesNotMatch(nota, /Bilancio delle correzioni di livello 2|bilancio delle correzioni di livello 2/);
});

test('[2i?!] e [3i?] fermano; [1i?!] e [0i?] vanno da parte senza fermare', () => {
  for (const riga of ['[2i?!] sui dati salvati', '[3i?] chiavi SSH', '[3i?!] chiavi SSH']) {
    const d = decide(`Provato.\n${riga}\n[1i] lieve`);
    assert.equal(d.stop, true, riga);
    assert.deepEqual(d.fix, [], `${riga}: a lavoro fermo non si corregge niente`);
    assert.deepEqual(tag(d.sospesi), ['[1i]']);
  }
  const lieve = decide('Provato.\n[1i?!] formato del registro\n[0i?] gusto');
  assert.equal(lieve.stop, false);
  assert.deepEqual(lieve.fix, []);
  assert.deepEqual(tag(lieve.derived), ['[1i?!]', '[0i?]']);
  assert.ok(lieve.derived.every((f) => f.inCorrezione !== true), 'niente si applica: la domanda e basta');
});

test('[2i?] a bilancio dei 2 finito va da parte come un 2: domanda nel suo feedback, niente applicato, niente fermo', () => {
  const d = decide('Provato.\n[2i?] A o B? Consiglio A.', { count2: 5 });
  assert.equal(d.stop, false);
  assert.deepEqual(d.fix, []);
  assert.equal(d.derived.length, 1);
  assert.notEqual(d.derived[0].inCorrezione, true);
  // Con un 3 da correggere nello stesso giro, invece, entra: il giro lo paga il 3.
  const conTre = decide('Provato.\n[3i] perde i dati\n[2i?] A o B? Consiglio A.', { count2: 5 });
  assert.deepEqual(tag(conTre.fix), ['[3i]', '[2i?]']);
  assert.equal(conTre.consume, 'cap3');
  assert.equal(conTre.derived[0].inCorrezione, true);
});

test('decisioneFerma e segnalazioneFerma: fermano un 3 o una scelta difficile da disfare; senza livello ferma come prima', () => {
  assert.equal(R.decisioneFerma({ level: 3, decision: true }), true);
  assert.equal(R.decisioneFerma({ level: 2, decision: true, irreversibile: true }), true);
  assert.equal(R.decisioneFerma({ level: 2, decision: true }), false);
  assert.equal(R.decisioneFerma({ level: 1, decision: true, irreversibile: true }), false);
  assert.equal(R.decisioneFerma({ level: 3, decision: false }), false, 'senza «?» non è una domanda');
  assert.equal(R.segnalazioneFerma({ livello: 3 }), true);
  assert.equal(R.segnalazioneFerma({ livello: 1, irreversibile: true }), true, 'una segnalazione applica la scelta: difficile da disfare ferma a ogni livello');
  for (const livello of [0, 1, 2, '2']) assert.equal(R.segnalazioneFerma({ livello }), false, `livello ${livello}`);
  for (const livello of [undefined, null, '', 4, 'due', true]) assert.equal(R.segnalazioneFerma({ livello }), true, `livello ${livello}: uno strumento vecchio`);
});

// ── Gli strumenti: dispatch e verifica locale ───────────────────────────────

test('dispatch: la risposta dice di applicare l\'opzione consigliata, e la pulizia lascia la prova del rilievo in correzione', async () => {
  const { verifierReplyText, messiDaParte, DECISIONE_IN_CORREZIONE_NOTE } = await import('../../scripts/dispatch.mjs');
  const critica = F('Provato.\n[2i?] A o B? Consiglio A.\n[1e] bordo storto altrove');
  const d = R.decideRound({ findings: critica, caps: CAPS, counts: {} });
  // Come li rimanda il server: col numero del feedback, e col posto nella critica che dispatch ci rimette.
  const posto = (f) => critica.findIndex((c) => c.text === f.text) + 1;
  const derived = d.external.concat(d.derived).map((f, i) => ({ ...f, num: `#9.${i + 1}`, n: posto(f) }));
  const fix = d.fix.map((f) => ({ ...f, n: posto(f) }));
  assert.deepEqual(messiDaParte(derived, fix).flatMap((x) => x.rilievi.map((f) => f.n)), [2], 'la prova del 2 col ? resta: è in correzione');
  // Anche se il server non manda il segno, il numero uguale nei due elenchi lo riconosce.
  const senzaSegno = derived.map(({ inCorrezione, ...f }) => f);
  assert.deepEqual(messiDaParte(senzaSegno, fix).flatMap((x) => x.rilievi.map((f) => f.n)), [2]);
  const testo = verifierReplyText({ outcome: 'fix', phase2: { findings: fix, derived, budgets: d.budgets, instructions: 'ISTRUZIONI' } }, 'ID');
  assert.ok(testo.includes(DECISIONE_IN_CORREZIONE_NOTE));
  assert.match(testo, /le prove con r2 nel nome, per #9\.1/);
  assert.doesNotMatch(testo, /le prove con r1 nel nome/);
  assert.match(testo, /#9\.2, priorità 2, interno, da decidere: intanto si applica l'opzione consigliata/);
});

test('verifica locale: stessa regola, e la prova del 2 col ? non esce con la pulizia', async () => {
  const VL = await import('../../scripts/verify-local.mjs');
  const SHA = 'a'.repeat(40);
  const s = VL.withRequest({}, 'r', { request: 'x', sha: SHA });
  const r = VL.withCritique(s, 'r', { critique: 'Provato.\n[2i?] A o B? Consiglio A.\n[1e] altrove', sha: SHA, caps: CAPS });
  assert.equal(r.outcome, 'fix');
  assert.deepEqual(VL.numeriMessiDaParte(r.state.r), [2], 'solo l\'esterno: il 2 col ? si corregge');
  const coda = VL.codaText({ findings: r.decision.fix, derived: r.decision.derived, external: r.decision.external, budgets: r.decision.budgets, branch: 'r', instructions: 'CODA' });
  assert.match(coda, /applica l'opzione che il\nverificatore consiglia/);
  // Nessun commit dopo la critica: il 2 non è stato corretto, e un 2 interno lasciato lì ferma, come sempre.
  const c = VL.withFixed(r.state, 'r', { report: 'niente di nuovo', sha: SHA });
  assert.equal(c.outcome, 'stop');
  // Un vicino da solo non fa partire niente nemmeno qui, con cap0 sopra zero.
  const v = VL.withCritique(VL.withRequest({}, 'v', { request: 'x', sha: SHA }), 'v', { critique: 'Provato.\n[2v] nel file vicino', sha: SHA, caps: { ...CAPS, cap0: 3 } });
  assert.equal(v.outcome, 'pass');
});
