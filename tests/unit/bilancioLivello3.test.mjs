// Il bilancio del livello 3 separato da quello del 2 (decisione dell'owner
// del 2026-09-23): un 3 interno a bilancio finito ferma il lavoro, un 2 interno
// a bilancio finito NON ferma — esce nel feedback dei rimasti — e i quattro
// nomi dei bilanci sono gli stessi nella regola, nelle tabelle e in dashboard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
require(resolve(ROOT, 'src', 'shared', 'constants.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackTransitions.js'));
require(resolve(ROOT, 'src', 'shared', 'verifierRound.js'));
const R = globalThis.SN_VERIFIER_ROUND;
const T = globalThis.SN_FB_TRANSITIONS;
const C = globalThis.SN_CONST;

// I bilanci di QUESTI test (quelli decisi dall'owner il 2026-09-23 stanno
// solo in config/routines: qui non c'è un default).
const CAPS = { cap3: 5, cap2: 4, cap1: 1, cap0: 0 };
const f = (level, sede, text, decision = false) => ({ level, sede, text, decision });
const decide = (findings, counts = {}, caps = CAPS) => R.decideRound({ findings, caps, counts });
const livelli = (list) => list.map((x) => `${x.level}${x.sede}`);

test('un 3 interno paga il bilancio dei 3; a bilancio finito ferma il lavoro, con gli altri interni sospesi', () => {
  const d = decide([f(3, 'i', 'perde i dati')]);
  assert.equal(d.stop, false);
  assert.deepEqual(livelli(d.fix), ['3i']);
  assert.equal(d.consume, 'cap3');
  assert.equal(d.counts.count3, 1);
  assert.equal(d.budgets.cap3.left, 4);
  assert.equal(d.budgets.cap2.left, 4, 'il bilancio dei 2 non si muove');

  const fermo = decide([f(3, 'i', 'perde i dati'), f(1, 'i', 'bordo')], { count3: 5 });
  assert.equal(fermo.stop, true);
  assert.deepEqual(livelli(fermo.blocking), ['3i']);
  assert.deepEqual(livelli(fermo.sospesi), ['1i']);
  assert.deepEqual(fermo.fix, []);
  assert.deepEqual(fermo.derived, [], 'fermandosi non si mette da parte niente');
  assert.equal(fermo.consume, null, 'fermarsi non paga');
  assert.equal(decide([f(3, 'i', 'x')], {}, { ...CAPS, cap3: 0 }).stop, true, 'cap3 a zero: il primo 3 ferma subito');
});

test('un 2 interno paga il bilancio dei 2; a bilancio finito NON ferma: va da parte a priorità 2 e il giro passa', () => {
  const d = decide([f(2, 'i', 'non salva')]);
  assert.deepEqual(livelli(d.fix), ['2i']);
  assert.equal(d.consume, 'cap2');
  assert.equal(d.counts.count2, 1);

  const finito = decide([f(2, 'i', 'non salva'), f(2, 'i', 'nemmeno la scorciatoia')], { count2: 4 });
  assert.equal(finito.stop, false, 'un 2 a bilancio finito non ferma');
  assert.deepEqual(finito.blocking, []);
  assert.deepEqual(finito.fix, []);
  assert.deepEqual(finito.derived.map((x) => [x.level, x.sede, x.priority]), [[2, 'i', 2], [2, 'i', 2]]);
  assert.equal(finito.consume, null, 'niente corretto, niente pagato');
  assert.equal(finito.counts.count2, 4);
  // Anche a cap2 = 0: il primo 2 esce come feedback, il lavoro non si ferma.
  const zero = decide([f(2, 'i', 'non salva')], {}, { ...CAPS, cap2: 0 });
  assert.equal(zero.stop, false);
  assert.equal(zero.derived.length, 1);

  const nota = R.roundNote({ summary: 'il resto regge', findings: [f(2, 'i', 'non salva'), f(2, 'i', 'nemmeno la scorciatoia')], decision: finito });
  assert.match(nota, /Nessun rilievo interno da correggere adesso/);
  assert.match(nota, /Il bilancio delle correzioni di livello 2 è finito: i 2 rilievi interni di livello 2 rimasti non fermano il lavoro ed entrano nel feedback dei rimasti\./);
  assert.match(nota, /I 2 rilievi non corretti in questo giro escono insieme in un solo feedback derivato, a priorità 2/);
  assert.doesNotMatch(nota, /Il lavoro si ferma/);
  const uno = R.roundNote({ summary: '', findings: [f(2, 'i', 'non salva')], decision: zero });
  assert.match(uno, /il rilievo interno di livello 2 rimasto non ferma il lavoro ed entra nel feedback dei rimasti\./);
  assert.match(uno, /Il rilievo non corretto in questo giro esce in un feedback derivato, a priorità 2: \[2i\] non salva/);
});

test('un 2 interno col segno ? ferma ancora: la decisione dell\'owner non dipende dal bilancio', () => {
  const d = decide([f(2, 'i', 'A o B?', true)], { count2: 4 });
  assert.equal(d.stop, true);
  assert.deepEqual(livelli(d.blocking), ['2i']);
  assert.match(R.roundNote({ summary: '', findings: [f(2, 'i', 'A o B?', true)], decision: d }), /livello 3 o 2 che chiede una tua decisione/);
});

test('3 e 2 insieme: il giro si paga dal 3, e il 2 entra anche a bilancio dei 2 finito; a cap3 finito il 3 ferma e il 2 resta sospeso', () => {
  const d = decide([f(2, 'i', 'non salva'), f(3, 'i', 'perde i dati')], { count2: 4 });
  assert.equal(d.stop, false);
  assert.deepEqual(livelli(d.fix), ['2i', '3i'], 'ordine della critica');
  assert.equal(d.consume, 'cap3');
  assert.equal(d.counts.count3, 1);
  assert.equal(d.counts.count2, 4, 'il 2 non paga: il giro è del 3');
  assert.deepEqual(d.derived, []);

  const fermo = decide([f(2, 'i', 'non salva'), f(3, 'i', 'perde i dati')], { count3: 5 });
  assert.equal(fermo.stop, true);
  assert.deepEqual(livelli(fermo.blocking), ['3i']);
  assert.deepEqual(livelli(fermo.sospesi), ['2i']);
});

test('gli 1 e gli 0 come prima: con un 2 corretto entrano; senza un giro che parta escono tutti', () => {
  const insieme = decide([f(2, 'i', 'a'), f(1, 'i', 'b'), f(0, 'i', 'c')]);
  assert.deepEqual(livelli(insieme.fix), ['2i', '1i', '0i']);
  assert.equal(insieme.consume, 'cap2');
  const tuttoFinito = decide([f(2, 'i', 'a'), f(1, 'i', 'b'), f(0, 'i', 'c')], { count2: 4, count1: 1 });
  assert.deepEqual(tuttoFinito.fix, []);
  assert.deepEqual(tuttoFinito.derived.map((x) => x.priority), [2, 1, 0]);
  assert.equal(tuttoFinito.consume, null);
  // Gli esterni come prima: fuori dal conto, con la priorità uguale al livello.
  const conEsterno = decide([f(2, 'e', 'altrove'), f(3, 'e', 'grave altrove')], { count2: 4 });
  assert.equal(conEsterno.stop, false);
  assert.deepEqual(conEsterno.external.map((x) => x.priority), [2, 3]);
});

// #744: un 2 a bilancio finito non fa partire un giro, ma se il giro parte lo
// stesso (lo paga un 1 o uno 0) ci sale come ci salgono gli 1 sul giro di un 2.
test('un 2 a bilancio dei 2 finito sale sulla correzione che un 1 fa partire, e il giro lo paga cap1', () => {
  const d = decide([f(2, 'i', 'non salva'), f(1, 'i', 'bordo storto')], { count2: 4 });
  assert.equal(d.stop, false);
  assert.deepEqual(livelli(d.fix), ['2i', '1i'], 'si correggono tutti e due, nell\'ordine della critica');
  assert.deepEqual(d.derived, [], 'nessun feedback a parte per il 2');
  assert.equal(d.consume, 'cap1', 'il giro lo paga chi lo fa partire');
  assert.equal(d.counts.count1, 1);
  assert.equal(d.counts.count2, 4, 'il 2 non paga: cap2 non va oltre il suo tetto');
  assert.equal(d.budgets.cap2.used, 4);
  assert.equal(d.budgets.cap2.left, 0);
  assert.equal(d.budgets.cap1.left, 0);

  // Il giro dopo, con cap1 finito anche lui e niente che lo faccia partire,
  // il 2 esce nel feedback dei rimasti come prima.
  const dopo = decide([f(2, 'i', 'non salva ancora'), f(1, 'i', 'bordo')], d.counts);
  assert.deepEqual(dopo.fix, []);
  assert.deepEqual(dopo.derived.map((x) => [x.level, x.priority]), [[2, 2], [1, 1]]);
  assert.equal(dopo.consume, null);
});

test('un vicino o uno 0 che fanno partire il giro con cap0 si portano dietro i 2 e gli 1 a bilancio finito', () => {
  const caps = { ...CAPS, cap0: 1 };
  const d = decide([f(2, 'i', 'non salva'), f(1, 'i', 'bordo'), f(3, 'v', 'nel file accanto')], { count2: 4, count1: 1 }, caps);
  assert.deepEqual(livelli(d.fix), ['2i', '1i', '3v']);
  assert.equal(d.consume, 'cap0');
  assert.deepEqual([d.counts.count2, d.counts.count1, d.counts.count0], [4, 1, 1]);
  // A cap0 = 0 nessuno lo fa partire: escono tutti, il lavoro passa.
  const senza = decide([f(2, 'i', 'non salva'), f(1, 'i', 'bordo'), f(3, 'v', 'nel file accanto')], { count2: 4, count1: 1 });
  assert.deepEqual(senza.fix, []);
  assert.equal(senza.stop, false);
  assert.deepEqual(livelli(senza.derived), ['2i', '1i', '3v']);
});

test('chi sale non cambia chi paga né chi ferma: un 3 a bilancio finito ferma anche accanto a un 1 col bilancio, un ? resta fuori', () => {
  const fermo = decide([f(3, 'i', 'perde i dati'), f(1, 'i', 'bordo')], { count3: 5 });
  assert.equal(fermo.stop, true);
  assert.deepEqual(livelli(fermo.blocking), ['3i']);
  const domanda = decide([f(2, 'i', 'non salva'), f(1, 'i', 'bordo'), f(1, 'i', 'A o B?', true)], { count2: 4 });
  assert.deepEqual(livelli(domanda.fix), ['2i', '1i']);
  assert.deepEqual(domanda.derived.map((x) => [x.level, x.decision]), [[1, true]]);
  // Col bilancio dei 2 ancora aperto il giro resta del 2, come prima.
  assert.equal(decide([f(2, 'i', 'a'), f(1, 'i', 'b')]).consume, 'cap2');
});

test('la nota del giro dice che il 2 sale e chi paga, e non parla di 2 messi da parte', () => {
  const list = [f(2, 'i', 'Non salva.'), f(1, 'i', 'Bordo storto.')];
  const d = decide(list, { count2: 4 });
  const nota = R.roundNote({ summary: 'provato', findings: list, decision: d });
  assert.match(nota, /La correzione riguarda tutti i rilievi; poi un'altra verifica ricontrolla\./);
  assert.match(nota, /Il giro lo paga il bilancio del livello 1: un rilievo di livello più alto, col suo bilancio finito, sale sulla correzione che parte comunque\./);
  assert.doesNotMatch(nota, /feedback dei rimasti|non corretti in questo giro/);
  const due = [f(2, 'i', 'a'), f(2, 'i', 'b'), f(0, 'v', 'c')];
  assert.match(R.roundNote({ findings: due, decision: decide(due, { count2: 4 }, { ...CAPS, cap0: 1 }) }), /Il giro lo paga il bilancio del livello 0: 2 rilievi di livello più alto, col loro bilancio finito, salgono/);
  // Gli 1 sul giro di un 2, o i vicini: nessuno sta sopra chi paga, la riga non c'è.
  assert.doesNotMatch(R.roundNote({ findings: list, decision: decide(list) }), /Il giro lo paga/);
  const vicino = [f(1, 'i', 'qui'), f(3, 'v', 'accanto')];
  assert.doesNotMatch(R.roundNote({ findings: vicino, decision: decide(vicino) }), /Il giro lo paga/);
});

test('senza uno dei quattro bilanci si ferma e dice quale manca: nessun default', () => {
  assert.throws(() => R.decideRound({ findings: [f(2, 'i', 'x')], caps: { cap2: 4, cap1: 1, cap0: 0 } }), /bilanci del verificatore mancanti: cap3/);
  assert.throws(() => R.decideRound({ findings: [], caps: null }), /cap3, cap2, cap1, cap0/);
  assert.deepEqual(R.missingCaps(CAPS), []);
  assert.deepEqual(R.missingCaps({ cap3: 5, cap2: 4, cap1: 1 }), ['cap0']);
  assert.equal(R.capKeyOf(3), 'cap3');
  assert.equal(R.capKeyOf(2), 'cap2');
  assert.equal(R.capKeyOf(1), 'cap1');
  assert.equal(R.capKeyOf(0), 'cap0');
  assert.equal(R.countKeyOf(3), 'count3');
  assert.deepEqual(R.normalizeCaps({ cap3: 99, cap2: -1 }, CAPS), { cap3: 10, cap2: 0, cap1: 1, cap0: 0 });
  assert.deepEqual(R.normalizeCounts({ count3: '2' }), { count3: 2, count2: 0, count1: 0, count0: 0 });
});

test('sentinella: i nomi dei bilanci sono gli stessi nella regola, nelle tabelle, nella cache e nella dashboard', () => {
  assert.deepEqual(R.CAP_KEYS, ['cap3', 'cap2', 'cap1', 'cap0']);
  assert.deepEqual(T.VERIFIER_CAP_KEYS, R.CAP_KEYS, 'feedbackTransitions.js e verifierRound.js: una lista sola');
  for (const k of R.CAP_KEYS) {
    assert.equal(C.STORAGE_KEYS[`AUTOMATION_${k.toUpperCase()}`], `filo_automation_${k}`, `manca la chiave di cache di ${k}`);
  }
  // La dashboard: un campo per bilancio, con salva e messaggio, nello stesso ordine.
  const html = readFileSync(resolve(ROOT, 'src', 'pages', 'manage', 'manage.html'), 'utf8');
  const ordineHtml = [...html.matchAll(/id="mg(Cap\d)Block"/g)].map((m) => m[1].toLowerCase());
  assert.deepEqual(ordineHtml, R.CAP_KEYS, 'i blocchi della dashboard, dal livello più alto');
  for (const k of R.CAP_KEYS) {
    const K = k.replace('cap', 'Cap');
    for (const suffix of ['', 'Save', 'Msg']) assert.ok(html.includes(`id="mg${K}${suffix}"`), `manca mg${K}${suffix} in manage.html`);
  }
  const js = readFileSync(resolve(ROOT, 'src', 'pages', 'manage', 'manage.js'), 'utf8');
  const blocco = /const CAP_FIELDS = \{([\s\S]*?)\n  \};/.exec(js);
  assert.ok(blocco, 'CAP_FIELDS in manage.js');
  const chiavi = [...blocco[1].matchAll(/^\s*(cap\d):/gm)].map((m) => m[1]);
  assert.deepEqual(chiavi, R.CAP_KEYS, 'i campi guidati da CAP_FIELDS, nello stesso ordine');
  // Il blocco da non-owner è una lista scritta a mano fuori da CAP_FIELDS: un
  // campo che ci manca resta scrivibile a chiunque.
  const gate = /function applyAutoModeGate\(\) \{([\s\S]*?)\n  \}/.exec(js);
  assert.ok(gate, 'applyAutoModeGate in manage.js');
  for (const k of R.CAP_KEYS) {
    const K = k.replace('cap', 'Cap');
    assert.match(gate[1], new RegExp(`\\bmg${K}\\b`), `mg${K} manca dal blocco da non-owner`);
    assert.match(gate[1], new RegExp(`\\bmg${K}Save\\b`), `mg${K}Save manca dal blocco da non-owner`);
  }
  // Richiesta owner: le impostazioni della tab si modificano sempre, anche a
  // routine o automatica spente. Solo l'essere owner accende o spegne un controllo.
  const condizioni = [...gate[1].matchAll(/\.disabled\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(condizioni.length > 0, 'applyAutoModeGate non spegne più niente');
  for (const c of condizioni) assert.equal(c, '!isAdmin', `un controllo dipende da altro che l'essere owner: ${c}`);
});

test('le stampe del giro locale e delle routine dicono i quattro bilanci e i 2 messi da parte', async () => {
  const VL = await import('../../scripts/verify-local.mjs');
  const { verifierReplyText } = await import('../../scripts/dispatch.mjs');
  const finito = decide([f(2, 'i', 'non salva')], { count2: 4 });
  assert.equal(VL.bilanciResiduiText(finito.budgets), 'cap3: 5 giri residui su 5 · cap2: 0 giri residui su 4 · cap1: 1 giri residui su 1 · cap0: 0 giri residui su 0');
  assert.equal(VL.bilanciResiduiText(null), '');
  assert.match(VL.dueDaParteText(finito.derived), /^Bilancio delle correzioni di livello 2 finito: il rilievo interno di livello 2 rimasto entra nel feedback dei rimasti\. Il lavoro non si ferma\.$/);
  assert.equal(VL.dueDaParteText([f(1, 'i', 'x'), f(2, 'e', 'y')]), '', 'un 1 messo da parte o un 2 esterno non sono il caso');
  // La coda della fase 2 in locale: quattro bilanci, e la riga sui 2 quando ci sono.
  const fix = decide([f(3, 'i', 'perde i dati'), f(2, 'i', 'a')], { count2: 4 });
  const coda = VL.codaText({ findings: fix.fix, derived: fix.derived, external: [], budgets: fix.budgets, branch: 'claude/x', instructions: 'CODA' });
  assert.match(coda, /Bilanci: cap3: 4 giri residui su 5 · cap2: 0 giri residui su 4 · cap1: 1 giri residui su 1 · cap0: 0 giri residui su 0/);
  // La risposta del server stampata dalle routine: pass coi 2 usciti a priorità 2, e i quattro bilanci.
  const pass = verifierReplyText({ outcome: 'pass', derived: [{ level: 2, sede: 'i', text: 'non salva', priority: 2, num: '#7.1' }], budgets: finito.budgets });
  assert.match(pass, /#7\.1, priorità 2, rimasti del giro: 1 rilievo \(\[2i\]\)/);
  assert.match(pass, /Bilancio delle correzioni di livello 2 finito: il rilievo interno di livello 2 rimasto è entrato nel feedback dei rimasti/);
  assert.match(pass, /Bilanci: cap3: 5 giri residui su 5 · cap2: 0 giri residui su 4 · cap1: 1 giri residui su 1 · cap0: 0 giri residui su 0/);
  const stop = verifierReplyText({ outcome: 'stop', motivo: 'loop', blocking: [f(3, 'i', 'perde i dati')], sospesi: [], derived: [], budgets: decide([f(3, 'i', 'x')], { count3: 5 }).budgets });
  assert.match(stop, /un 3 a bilancio esaurito, o un 3\/2 che chiede una decisione/);
  assert.match(stop, /Bilanci: cap3: 0 giri residui su 5/);
  const fase2 = verifierReplyText({ outcome: 'fix', phase2: { findings: [f(1, 'i', 'bordo')], derived: [{ level: 2, sede: 'i', text: 'a', priority: 2, num: '#7.2' }], budgets: finito.budgets, instructions: 'FASE 2' } });
  assert.match(fase2, /Bilancio delle correzioni di livello 2 finito/);
  assert.ok(fase2.indexOf('Bilancio delle correzioni di livello 2 finito') < fase2.indexOf('FASE 2'), 'prima delle istruzioni');
});

test('il compito della verifica locale dice dove stanno le decisioni dell\'owner, e che valgono come specifica', async () => {
  const { buildVerifierBrief } = await import('../../scripts/verify-local.mjs');
  const brief = buildVerifierBrief({ request: 'fai X', branch: 'claude/x', recipe: '', history: [], scope: 'pieno' });
  assert.match(brief, /DECISIONI DELL’OWNER: in un giro locale non c’è la conversazione del feedback/);
  assert.match(brief, /valgono come specifica insieme a lei/);
  assert.ok(brief.indexOf('DECISIONI DELL’OWNER') > brief.indexOf('COSA ERA STATO CHIESTO'), 'subito dopo la richiesta');
});
