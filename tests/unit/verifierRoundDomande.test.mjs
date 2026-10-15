// Decisioni dell'owner del 2026-10-12 (#1202): i vicini non decidono mai se parte un giro; un 2 col «?» non ferma
// (si corregge con l'opzione consigliata ed esce anche come domanda), col «!» sì; le segnalazioni fermano solo per un 3
// o per una scelta difficile da disfare. Stessa regola per il server, la verifica locale e le routine.

import '../helpers/senzaSessione.mjs';
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
const { livelloSegnalazione } = await import('../../scripts/lib/livelli.mjs');
const { stripLivelloArgs, fixedPayload, fixedReplyText, verifierReplyText, separaDomandeInCorrezione, FERMA_NOTE } = await import('../../scripts/dispatch.mjs');
const VL = await import('../../scripts/verify-local.mjs');
const { derivatiDaAprire } = await import('../../scripts/lib/orchestratore.mjs');

const CAPS = { cap3: 5, cap2: 5, cap1: 2, cap0: 2 };
const decide = (critica, counts = {}, caps = CAPS) => R.decideRound({ findings: R.parseFindings(critica).findings, caps, counts });
const tag = (list) => list.map(R.findingTag);

// ── I vicini ─────────────────────────────────────────────────────────────────

test('un vicino da solo, con cap0 sopra zero, non fa partire il giro ed esce derivato col livello scritto', () => {
  const d = decide('Provato.\n[2v] etichetta tagliata nel file vicino');
  assert.equal(d.stop, false);
  assert.deepEqual(d.fix, []);
  assert.equal(d.consume, null);
  assert.deepEqual(d.counts, { count3: 0, count2: 0, count1: 0, count0: 0 }, 'nessun bilancio consumato');
  assert.deepEqual(d.derived.map((f) => [f.level, f.sede, f.priority]), [[2, 'v', 2]]);
  assert.match(R.roundNote({ findings: d.derived, decision: d }), /esce in un feedback derivato, a priorità 2: \[2v\]/);
});

test('un vicino insieme a un interno da correggere entra nel giro, che lo paga l\'interno', () => {
  const d = decide('Provato.\n[1i] il bordo resta grigio\n[3v] nel file vicino un errore grave');
  assert.deepEqual(tag(d.fix), ['[1i]', '[3v]']);
  assert.equal(d.consume, 'cap1');
  assert.equal(d.counts.count3, 0);
  // Un vicino col «?» va nel derivato anche con la correzione in corso, e non ferma.
  const domanda = decide('Provato.\n[1i] il bordo resta grigio\n[2v?!] scelta sul formato salvato, nel file vicino');
  assert.equal(domanda.stop, false);
  assert.deepEqual(tag(domanda.fix), ['[1i]']);
  assert.deepEqual(tag(domanda.derived), ['[2v?!]']);
});

// ── Il 2 col «?» ─────────────────────────────────────────────────────────────

test('[2i?] non ferma: finisce nella correzione e nel derivato con la domanda, e paga il bilancio dei 2', () => {
  const d = decide('Provato.\n[2i?] il salvataggio può partire da solo o chiedere: consiglio da solo, come le altre pagine\n[0i] bordo');
  assert.equal(d.stop, false);
  assert.deepEqual(tag(d.fix), ['[2i?]', '[0i]']);
  assert.equal(d.consume, 'cap2');
  assert.deepEqual(d.derived, [], 'non è un messo da parte: la sua prova resta');
  assert.deepEqual(d.domande.map((f) => [R.findingTag(f), f.inCorrezione, f.priority]), [['[2i?]', true, 2]]);
  const gruppi = R.derivedGroups(d);
  assert.deepEqual(gruppi.map((g) => [g.tipo, g.priority, g.decision, !!g.inCorrezione]), [['decisione', 2, true, true]]);
  assert.equal(R.groupLabel(gruppi[0]), 'interno, da decidere: intanto si corregge con l\'opzione consigliata');
  const nota = R.roundNote({ findings: R.parseFindings('[2i?] a\n[0i] b').findings, decision: d });
  assert.match(nota, /la correzione applica l'opzione consigliata da chi verifica, e la domanda esce in un feedback a parte\. Se scegli diversamente, quel feedback cambia il codice già fuso\./);
  assert.doesNotMatch(nota, /Il lavoro si ferma/);
});

test('[2i?!] e [3i?] fermano; 0 e 1 col «?» (anche col «!») escono derivati senza fermare e senza correggersi', () => {
  for (const critica of ['[2i?!] il formato dei dati salvati: A o B', '[3i?] le chiavi: A o B']) {
    const d = decide(`Provato.\n${critica}\n[1i] altro`);
    assert.equal(d.stop, true, critica);
    assert.deepEqual(tag(d.sospesi), ['[1i]']);
    assert.deepEqual(d.domande, []);
    assert.match(R.roundNote({ findings: R.parseFindings(critica).findings, decision: d }), /Il lavoro si ferma/);
  }
  const bassi = decide('Provato.\n[1i?!] scelta rara sui dati\n[0i?] gusto');
  assert.equal(bassi.stop, false);
  assert.deepEqual(bassi.fix, []);
  assert.deepEqual(tag(bassi.derived), ['[1i?!]', '[0i?]']);
});

// ── Il segno «!» nel lettore ─────────────────────────────────────────────────

test('il lettore accetta il «!» col «?», in qualunque ordine, e lo riscrive uguale', () => {
  for (const tagScritto of ['[2i?!]', '[2i!?]', '[2?i!]', '[2?!i]', '- [2i?!]', '1. **[2I?!]**']) {
    const p = R.parseFindings(`Provato.\n${tagScritto} scelta sul formato`);
    assert.deepEqual(p.rifiutati, [], tagScritto);
    assert.deepEqual(R.unparsedLevelLines(`${tagScritto} scelta sul formato`), [], tagScritto);
    assert.deepEqual(p.findings.map((f) => [f.level, f.sede, f.decision, f.difficile]), [[2, 'i', true, true]], tagScritto);
  }
  assert.equal(R.formatFinding(R.parseFindings('[2i?!] x').findings[0]), '- [2i?!] x');
  const giro = R.parseFindings(R.formatFindings(R.parseFindings('[2i?!] a\n[1v?] b\n[0e] c').findings));
  assert.deepEqual(tag(giro.findings), ['[2i?!]', '[1v?]', '[0e]']);
  // Senza il segno il campo non c'è: lo stato già scritto resta identico.
  assert.equal('difficile' in R.parseFindings('[2i?] x').findings[0], false);
});

test('il «!» senza il «?» si respinge con la spiegazione, nel controllo e nel lettore', () => {
  const brutte = R.unparsedLevelLines('Provato.\n[2i!] rotto');
  assert.equal(brutte.length, 1);
  assert.match(brutte[0], /^\[2i!\] rotto \(il «!» segna una scelta difficile da disfare e va insieme al «\?»/);
  const p = R.parseFindings('Provato.\n[2i!] rotto\n    passo uno');
  assert.deepEqual(p.findings, [], 'non diventa un rilievo');
  assert.equal(p.rifiutati.length, 1);
  assert.doesNotMatch(p.summary, /rotto|passo uno/, 'né riassunto');
  // Un elenco strutturato col solo `difficile` porta con sé la domanda: è il verso che ferma.
  assert.deepEqual(R.normalizeFindings([{ level: 2, sede: 'i', text: 'x', difficile: true }]), [{ level: 2, sede: 'i', text: 'x', decision: true, difficile: true }]);
  assert.equal(R.decideRound({ findings: [{ level: 2, sede: 'i', text: 'x', difficile: true }], caps: CAPS }).stop, true);
});

// ── Le segnalazioni ─────────────────────────────────────────────────────────

test('una segnalazione ferma solo per un 3 o per una scelta difficile da disfare; senza livello ferma come prima', () => {
  assert.equal(R.segnalazioneFerma({ level: 3 }), true);
  assert.equal(R.segnalazioneFerma({ level: 2 }), false);
  assert.equal(R.segnalazioneFerma({ level: '1' }), false);
  assert.equal(R.segnalazioneFerma({ level: 0 }), false);
  assert.equal(R.segnalazioneFerma({ level: 0, difficile: true }), true);
  assert.equal(R.segnalazioneFerma({ level: 2, difficile: true }), true);
  for (const vecchia of [{}, null, { level: '' }, { level: 'x' }, { level: 4 }, { level: true }]) {
    assert.equal(R.segnalazioneFerma(vecchia), true, JSON.stringify(vecchia));
  }
});

test('--livello e --difficile: obbligatorio il primo con --segnala, inutili da soli, e la regola dice cosa aspettarsi', () => {
  assert.deepEqual(livelloSegnalazione({ conSegnalazione: false }), { ok: true, campi: {}, ferma: false });
  assert.match(livelloSegnalazione({ conSegnalazione: true }).message, /--segnala vuole anche --livello <0-3>/);
  assert.match(livelloSegnalazione({ conSegnalazione: true, livello: true }).message, /--segnala vuole anche --livello/);
  assert.match(livelloSegnalazione({ conSegnalazione: true, livello: 'due' }).message, /letto: «due»/);
  assert.match(livelloSegnalazione({ conSegnalazione: false, livello: '2' }).message, /accompagnano --segnala/);
  assert.match(livelloSegnalazione({ conSegnalazione: false, difficile: true }).message, /accompagnano --segnala/);
  assert.match(livelloSegnalazione({ conSegnalazione: true, livello: '2', difficile: 'sì' }).message, /non vuole un valore/);
  assert.deepEqual(livelloSegnalazione({ conSegnalazione: true, livello: '2' }), { ok: true, campi: { segnalazioneLivello: 2 }, ferma: false });
  assert.deepEqual(livelloSegnalazione({ conSegnalazione: true, livello: ' 3 ' }), { ok: true, campi: { segnalazioneLivello: 3 }, ferma: true });
  assert.deepEqual(livelloSegnalazione({ conSegnalazione: true, livello: '1', difficile: true }), { ok: true, campi: { segnalazioneLivello: 1, segnalazioneDifficile: true }, ferma: true });
});

test('dispatch: le opzioni del livello si tolgono dagli argomenti, e i campi viaggiano solo con la segnalazione', () => {
  assert.deepEqual(stripLivelloArgs(['--record-fixed', 'ID', 'report', '--livello', '2', '--difficile']), { args: ['--record-fixed', 'ID', 'report'], livello: '2', difficile: true, error: '' });
  assert.deepEqual(stripLivelloArgs(['x', '--livello=3']).livello, '3');
  assert.equal(stripLivelloArgs(['x', '--livello']).livello, true);
  assert.equal(stripLivelloArgs(['x', '--livello', '--frase', 'f']).livello, true, 'un\'opzione dopo non è il valore');
  assert.deepEqual(stripLivelloArgs(['x', '--livello', '--frase', 'f']).args, ['x', '--frase', 'f']);
  assert.match(stripLivelloArgs(['--livello', '1', '--livello', '2']).error, /una volta sola/);
  const campi = { segnalazioneLivello: 2 };
  assert.deepEqual(fixedPayload({ report: 'r', frase: 'f', branch: 'b', segnalazione: '## Problema', campiSegnalazione: campi }),
    { report: 'r', userNote: 'f', branch: 'b', segnalazione: '## Problema', segnalazioneLivello: 2 });
  assert.deepEqual(fixedPayload({ report: 'r', frase: 'f', branch: 'b', campiSegnalazione: campi }), { report: 'r', userNote: 'f', branch: 'b' });
  assert.match(fixedReplyText('ID', { outcome: 'ok' }, true, false), /torna in coda per la verifica con la scelta che hai fatto/);
  assert.match(fixedReplyText('ID', { outcome: 'ok' }, true, true), /ATTENZIONE, la segnalazione era di livello 3 o difficile da disfare/);
  assert.match(fixedReplyText('ID', { outcome: 'stop' }, true, false), /lavoro FERMATO/);
  assert.match(FERMA_NOTE, /--livello <0-3> \[--difficile\]/);
  assert.match(FERMA_NOTE, /FERMA il lavoro/);
});

// ── Chi corregge: applica l'opzione consigliata e tiene la prova ─────────────

test('la risposta delle routine: il [2i?] da correggere chiede l\'opzione consigliata, e la sua prova non si toglie', () => {
  const critica = R.parseFindings('Provato.\n[2i?] parte da solo o chiede? Consiglio: da solo\n[1e] altrove');
  const da = { ...critica.findings[0], n: 1 };
  const reply = {
    outcome: 'fix',
    phase2: {
      findings: [da],
      derived: [
        { ...da, priority: 2, inCorrezione: true, num: '#9.1' },
        { ...critica.findings[1], n: 2, priority: 1, num: '#9.2' },
      ],
      instructions: 'FASE 2',
    },
  };
  const t = verifierReplyText(reply, 'ID');
  assert.match(t, /Il rilievo col «\?» qui sopra chiede una decisione dell'owner che non ferma il lavoro: applica l'opzione che chi verifica consiglia nel rilievo/);
  assert.match(t, /feedback derivato \(#9\.1\)/);
  assert.match(t, /le prove con r2 nel nome, per #9\.2/);
  assert.doesNotMatch(t, /le prove con r1 nel nome/, 'la prova di un rilievo in correzione resta');
  // Anche senza il segno del server: basta il numero fra quelli da correggere.
  const { daParte, domande } = separaDomandeInCorrezione([{ num: '#9.1', rilievi: [{ ...da }], tipo: 'decisione' }, { num: '#9.2', rilievi: [{ ...critica.findings[1], n: 2 }], tipo: 'esterno' }], [da]);
  assert.deepEqual(daParte.map((d) => d.num), ['#9.2']);
  assert.deepEqual(domande.map((d) => d.num), ['#9.1']);
});

test('la verifica locale: [2i?] va a correggere, esce fra i derivati da aprire, e la pulizia non lo conta fra i messi da parte', () => {
  let s = VL.withRequest({}, 'r', { request: 'fai X', sha: 'a'.repeat(40) });
  const r = VL.withCritique(s, 'r', { critique: 'Provato.\n[2i?] A o B? Consiglio A\n[1v] vicino', sha: 'a'.repeat(40), caps: CAPS });
  assert.equal(r.outcome, 'fix');
  assert.deepEqual(tag(r.state.r.pending.findings), ['[2i?]', '[1v]']);
  assert.deepEqual(r.state.r.pending.derived, []);
  assert.deepEqual(tag(r.state.r.pending.domande), ['[2i?]']);
  assert.deepEqual(r.state.r.derived.map((f) => [R.findingTag(f), f.inCorrezione]), [['[2i?]', true]], 'la domanda arriva all\'owner come feedback');
  const coda = VL.codaText({ findings: r.decision.fix, derived: r.decision.derived, external: r.decision.external, domande: r.decision.domande, budgets: r.decision.budgets, branch: 'claude/x', instructions: 'CODA' });
  assert.match(coda, /Il rilievo col «\?» qui sopra chiede una decisione dell'owner che non ferma il lavoro: applica l'opzione/);
  const [aperto] = derivatiDaAprire({ num: '42', branch: 'claude/x' }, r.state.r.derived);
  assert.match(aperto.testo, /il lavoro la corregge con l'opzione consigliata qui sotto\. Se scegli diversamente, questo feedback cambia il codice già fuso\./);
  // Un vicino da solo, invece, chiude il lavoro e resta fra i derivati.
  s = VL.withRequest({}, 'v', { request: 'fai X', sha: 'b'.repeat(40) });
  const v = VL.withCritique(s, 'v', { critique: 'Provato.\n[2v] vicino', sha: 'b'.repeat(40), caps: CAPS });
  assert.equal(v.outcome, 'pass');
  assert.deepEqual(tag(v.state.v.derived), ['[2v]']);
});
