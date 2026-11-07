// I bilanci, uno per livello (2026-09-23): finito il suo, un rilievo paga col più alto aperto
// sotto (D88, #744); un 3 senza più bilanci ferma, un 2 esce nel feedback dei rimasti; i quattro
// nomi sono gli stessi nella regola, nelle tabelle e in dashboard.

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

// Bilanci tutti finiti dal livello indicato in giù: il caso in cui un rilievo non può più pagare.
const FINITI = { 3: { count3: 5, count2: 4, count1: 1 }, 2: { count2: 4, count1: 1 }, 1: { count1: 1 } };

test('un 3 interno paga il bilancio dei 3; finiti il suo e quelli sotto ferma il lavoro, con gli altri interni sospesi', () => {
  const d = decide([f(3, 'i', 'perde i dati')]);
  assert.equal(d.stop, false);
  assert.deepEqual(livelli(d.fix), ['3i']);
  assert.equal(d.consume, 'cap3');
  assert.equal(d.counts.count3, 1);
  assert.equal(d.budgets.cap3.left, 4);
  assert.equal(d.budgets.cap2.left, 4, 'il bilancio dei 2 non si muove');

  const fermo = decide([f(3, 'i', 'perde i dati'), f(1, 'i', 'bordo')], FINITI[3]);
  assert.equal(fermo.stop, true);
  assert.deepEqual(livelli(fermo.blocking), ['3i']);
  assert.deepEqual(livelli(fermo.sospesi), ['1i']);
  assert.deepEqual(fermo.fix, []);
  assert.deepEqual(fermo.derived, [], 'fermandosi non si mette da parte niente');
  assert.equal(fermo.consume, null, 'fermarsi non paga');
  assert.equal(decide([f(3, 'i', 'x')], {}, { cap3: 0, cap2: 0, cap1: 0, cap0: 0 }).stop, true, 'tutti a zero: il primo 3 ferma subito');
});

// D88 (#744): un rilievo di livello X col bilancio di X finito paga col più alto
// ancora aperto sotto X, anche se nient'altro fa partire il giro.
test('D88: un 3 a bilancio dei 3 finito non ferma finché c\'è un bilancio sotto: paga cap2, poi cap1, poi cap0', () => {
  const caps = { ...CAPS, cap0: 1 };
  const due = decide([f(3, 'i', 'perde i dati')], { count3: 5 }, caps);
  assert.equal(due.stop, false);
  assert.deepEqual(livelli(due.fix), ['3i']);
  assert.equal(due.consume, 'cap2');
  assert.deepEqual([due.counts.count3, due.counts.count2], [5, 1], 'cap3 resta al suo tetto');
  assert.equal(decide([f(3, 'i', 'x')], { count3: 5, count2: 4 }, caps).consume, 'cap1');
  assert.equal(decide([f(3, 'i', 'x')], { count3: 5, count2: 4, count1: 1 }, caps).consume, 'cap0');
  const fermo = decide([f(3, 'i', 'x')], { count3: 5, count2: 4, count1: 1, count0: 1 }, caps);
  assert.equal(fermo.stop, true, 'finiti tutti: il 3 ferma come prima');
});

test('D88: un 2 da solo col bilancio dei 2 finito entra nel giro pagando cap1, poi cap0; finiti tutti esce a priorità 1 e il giro passa', () => {
  const d = decide([f(2, 'i', 'non salva')], { count2: 4 });
  assert.equal(d.stop, false);
  assert.deepEqual(livelli(d.fix), ['2i'], 'nessun altro rilievo fa partire il giro, si corregge lo stesso');
  assert.deepEqual(d.derived, []);
  assert.equal(d.consume, 'cap1');
  assert.deepEqual([d.counts.count2, d.counts.count1], [4, 1], 'il 2 non va oltre il suo tetto: paga l\'1');
  assert.equal(d.budgets.cap1.left, 0);

  const zeroAperto = decide([f(2, 'i', 'non salva')], FINITI[2], { ...CAPS, cap0: 2 });
  assert.equal(zeroAperto.consume, 'cap0');
  assert.deepEqual(livelli(zeroAperto.fix), ['2i']);

  const finito = decide([f(2, 'i', 'non salva'), f(2, 'i', 'nemmeno la scorciatoia')], FINITI[2]);
  assert.equal(finito.stop, false, 'un 2 a bilanci finiti non ferma');
  assert.deepEqual(finito.blocking, []);
  assert.deepEqual(finito.fix, []);
  assert.deepEqual(finito.derived.map((x) => [x.level, x.sede, x.priority]), [[2, 'i', 1], [2, 'i', 1]]);
  assert.equal(finito.consume, null, 'niente corretto, niente pagato');
  assert.deepEqual([finito.counts.count2, finito.counts.count1], [4, 1]);
  const zero = decide([f(2, 'i', 'non salva')], {}, { ...CAPS, cap2: 0, cap1: 0 });
  assert.equal(zero.stop, false);
  assert.equal(zero.derived.length, 1);

  const nota = R.roundNote({ summary: 'il resto regge', findings: [f(2, 'i', 'non salva'), f(2, 'i', 'nemmeno la scorciatoia')], decision: finito });
  assert.match(nota, /Nessun rilievo interno da correggere adesso/);
  assert.match(nota, /I bilanci delle correzioni dei livelli 2, 1 e 0 sono finiti: i 2 rilievi interni di livello 2 rimasti non fermano il lavoro ed entrano nel feedback dei rimasti\./);
  assert.match(nota, /I 2 rilievi non corretti in questo giro escono insieme in un solo feedback derivato, a priorità 1/);
  assert.doesNotMatch(nota, /Il lavoro si ferma|Il giro lo paga/);
  const uno = R.roundNote({ summary: '', findings: [f(2, 'i', 'non salva')], decision: zero });
  assert.match(uno, /il rilievo interno di livello 2 rimasto non ferma il lavoro ed entra nel feedback dei rimasti\./);
  assert.match(uno, /Il rilievo non corretto in questo giro esce in un feedback derivato, a priorità 1: \[2i\] non salva/);
});

test('D88, il caso di #744: un 2 a bilancio finito e un 1 si correggono insieme, e il giro lo paga cap1 una volta sola', () => {
  const d = decide([f(2, 'i', 'non salva'), f(1, 'i', 'bordo storto')], { count2: 4 });
  assert.deepEqual(livelli(d.fix), ['2i', '1i'], 'nell\'ordine della critica');
  assert.deepEqual(d.derived, [], 'nessun feedback a parte per il 2');
  assert.equal(d.consume, 'cap1');
  assert.deepEqual([d.counts.count2, d.counts.count1, d.counts.count0], [4, 1, 0]);
  // Il giro dopo, con cap1 finito anche lui: escono tutti e due, il lavoro passa.
  const dopo = decide([f(2, 'i', 'non salva ancora'), f(1, 'i', 'bordo')], d.counts);
  assert.deepEqual(dopo.fix, []);
  assert.deepEqual(dopo.derived.map((x) => [x.level, x.priority]), [[2, 1], [1, 1]]);
  assert.equal(dopo.consume, null);
});

test('D88: il giro paga il bilancio più alto che i rilievi possono pagare, e chi non può pagare sale su un giro che parte', () => {
  // Il 3 finito paga cap2, il 2 col suo bilancio anche: un giro solo, da cap2.
  const insieme = decide([f(3, 'i', 'a'), f(2, 'i', 'b')], { count3: 5 });
  assert.equal(insieme.consume, 'cap2');
  assert.deepEqual([insieme.counts.count3, insieme.counts.count2], [5, 1]);
  // Un 1 e uno 0 senza più bilanci salgono sul giro del 2, come prima.
  const sale = decide([f(2, 'i', 'a'), f(1, 'i', 'b'), f(0, 'i', 'c')], { count1: 1 });
  assert.deepEqual(livelli(sale.fix), ['2i', '1i', '0i']);
  assert.equal(sale.consume, 'cap2');
  // Un vicino non paga e non fa partire niente, nemmeno con cap0 aperto.
  const vicino = decide([f(2, 'v', 'accanto')], {}, { ...CAPS, cap0: 1 });
  assert.deepEqual(vicino.fix, []);
  assert.deepEqual(livelli(vicino.derived), ['2v']);
  // Un 1 col ? resta fuori anche se il giro parte.
  const domanda = decide([f(2, 'i', 'non salva'), f(1, 'i', 'A o B?', true)], { count2: 4 });
  assert.deepEqual(livelli(domanda.fix), ['2i']);
  assert.deepEqual(domanda.derived.map((x) => [x.level, x.decision]), [[1, true]]);
});

test('D88: la nota del giro dice quale bilancio ha pagato quando non è quello del rilievo più grave', () => {
  const list = [f(2, 'i', 'Non salva.'), f(1, 'i', 'Bordo storto.')];
  const nota = R.roundNote({ summary: 'provato', findings: list, decision: decide(list, { count2: 4 }) });
  assert.match(nota, /La correzione riguarda tutti i rilievi; poi un'altra verifica ricontrolla\./);
  assert.match(nota, /Il giro lo paga il bilancio del livello 1: quello del livello 2 è finito\./);
  assert.doesNotMatch(nota, /feedback dei rimasti|non corretti in questo giro/);
  const tre = [f(3, 'i', 'perde i dati')];
  assert.match(R.roundNote({ findings: tre, decision: decide(tre, { count3: 5, count2: 4 }, { ...CAPS, cap1: 0, cap0: 1 }) }),
    /Il giro lo paga il bilancio del livello 0: quelli dei livelli da 3 a 1 sono finiti\./);
  // Chi paga col suo bilancio, o un 1 che sale sul giro di un 2: la riga non c'è.
  assert.doesNotMatch(R.roundNote({ findings: list, decision: decide(list) }), /Il giro lo paga/);
  const vicino = [f(1, 'i', 'qui'), f(3, 'v', 'accanto')];
  assert.doesNotMatch(R.roundNote({ findings: vicino, decision: decide(vicino) }), /Il giro lo paga/);
});

test('un 2 interno col ? difficile da disfare ferma: la decisione dell\'owner non dipende dal bilancio (#1202)', () => {
  const irr = { ...f(2, 'i', 'A o B, sui dati salvati?', true), irreversibile: true };
  const d = decide([irr], { count2: 4 });
  assert.equal(d.stop, true);
  assert.deepEqual(livelli(d.blocking), ['2i']);
  assert.match(R.roundNote({ summary: '', findings: [irr], decision: d }), /di livello 3 o su una scelta difficile da disfare/);
  // Senza il segno, a bilanci finiti il 2 col ? va da parte con la domanda, senza fermare.
  const q = decide([f(2, 'i', 'A o B?', true)], FINITI[2]);
  assert.equal(q.stop, false);
  assert.deepEqual(q.fix, []);
  assert.deepEqual(q.derived.map((x) => [x.priority, x.decision, x.inCorrezione === true]), [[1, true, false]], 'un 2 nasce a 1');
});

test('3 e 2 insieme: il giro si paga dal 3, e il 2 entra anche a bilanci finiti; finiti tutti il 3 ferma e il 2 resta sospeso', () => {
  const d = decide([f(2, 'i', 'non salva'), f(3, 'i', 'perde i dati')], FINITI[2]);
  assert.equal(d.stop, false);
  assert.deepEqual(livelli(d.fix), ['2i', '3i'], 'ordine della critica');
  assert.equal(d.consume, 'cap3');
  assert.equal(d.counts.count3, 1);
  assert.equal(d.counts.count2, 4, 'il 2 non paga: il giro è del 3');
  assert.deepEqual(d.derived, []);

  const fermo = decide([f(2, 'i', 'non salva'), f(3, 'i', 'perde i dati')], FINITI[3]);
  assert.equal(fermo.stop, true);
  assert.deepEqual(livelli(fermo.blocking), ['3i']);
  assert.deepEqual(livelli(fermo.sospesi), ['2i']);
});

test('gli 1 e gli 0: con un 2 corretto entrano; finiti i bilanci dal 2 in giù escono tutti', () => {
  const insieme = decide([f(2, 'i', 'a'), f(1, 'i', 'b'), f(0, 'i', 'c')]);
  assert.deepEqual(livelli(insieme.fix), ['2i', '1i', '0i']);
  assert.equal(insieme.consume, 'cap2');
  const tuttoFinito = decide([f(2, 'i', 'a'), f(1, 'i', 'b'), f(0, 'i', 'c')], FINITI[2]);
  assert.deepEqual(tuttoFinito.fix, []);
  assert.deepEqual(tuttoFinito.derived.map((x) => x.priority), [1, 1, 1], 'nascono a 1: li mette in lavoro l\'ordine (#2269)');
  assert.equal(tuttoFinito.consume, null);
  // Gli esterni come prima: fuori dal conto; a 3 solo il livello 3.
  const conEsterno = decide([f(2, 'e', 'altrove'), f(3, 'e', 'grave altrove')], FINITI[2]);
  assert.equal(conEsterno.stop, false);
  assert.deepEqual(conEsterno.external.map((x) => x.priority), [1, 3]);
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
  const finito = decide([f(2, 'i', 'non salva')], FINITI[2]);
  assert.equal(VL.bilanciResiduiText(finito.budgets), 'cap3: 5 giri residui su 5 · cap2: 0 giri residui su 4 · cap1: 0 giri residui su 1 · cap0: 0 giri residui su 0');
  assert.equal(VL.bilanciResiduiText(null), '');
  assert.match(VL.dueDaParteText(finito.derived), /^I bilanci delle correzioni dei livelli 2, 1 e 0 sono finiti: il rilievo interno di livello 2 rimasto non ferma il lavoro ed entra nel feedback dei rimasti\.$/);
  assert.equal(VL.dueDaParteText([f(1, 'i', 'x'), f(2, 'e', 'y')]), '', 'un 1 messo da parte o un 2 esterno non sono il caso');
  // La coda della fase 2 in locale: quattro bilanci.
  const fix = decide([f(3, 'i', 'perde i dati'), f(2, 'i', 'a')], { count2: 4 });
  const coda = VL.codaText({ findings: fix.fix, derived: fix.derived, external: [], budgets: fix.budgets, branch: 'claude/x', instructions: 'CODA' });
  assert.match(coda, /Bilanci: cap3: 4 giri residui su 5 · cap2: 0 giri residui su 4 · cap1: 1 giri residui su 1 · cap0: 0 giri residui su 0/);
  // La risposta del server stampata dalle routine: pass coi 2 usciti, e i quattro bilanci.
  const pass = verifierReplyText({ outcome: 'pass', derived: [{ level: 2, sede: 'i', text: 'non salva', priority: 2, num: '#7.1' }], budgets: finito.budgets });
  assert.match(pass, /#7\.1, priorità 2, rimasti del giro: 1 rilievo \(\[2i\]\)/);
  assert.match(pass, /I bilanci delle correzioni dei livelli 2, 1 e 0 sono finiti: il rilievo interno di livello 2 rimasto non ferma il lavoro/);
  assert.match(pass, /Bilanci: cap3: 5 giri residui su 5 · cap2: 0 giri residui su 4 · cap1: 0 giri residui su 1 · cap0: 0 giri residui su 0/);
  const stop = verifierReplyText({ outcome: 'stop', motivo: 'loop', blocking: [f(3, 'i', 'perde i dati')], sospesi: [], derived: [], budgets: decide([f(3, 'i', 'x')], FINITI[3]).budgets });
  assert.match(stop, /un 3 con finiti il suo bilancio e quelli dei livelli sotto, o una decisione su un 3 o su una scelta difficile da disfare/);
  assert.match(stop, /Bilanci: cap3: 0 giri residui su 5/);
  const fase2 = verifierReplyText({ outcome: 'fix', phase2: { findings: [f(1, 'i', 'bordo')], derived: [{ level: 2, sede: 'i', text: 'a', priority: 2, num: '#7.2' }], budgets: finito.budgets, instructions: 'FASE 2' } });
  assert.match(fase2, /I bilanci delle correzioni dei livelli 2, 1 e 0 sono finiti/);
  assert.ok(fase2.indexOf('I bilanci delle correzioni dei livelli') < fase2.indexOf('FASE 2'), 'prima delle istruzioni');
});

test('il compito della verifica locale dice dove stanno le decisioni dell\'owner, e che valgono come specifica', async () => {
  const { buildVerifierBrief } = await import('../../scripts/verify-local.mjs');
  const brief = buildVerifierBrief({ request: 'fai X', branch: 'claude/x', recipe: '', history: [], scope: 'pieno' });
  assert.match(brief, /DECISIONI DELL’OWNER: in un giro locale non c’è la conversazione del feedback/);
  assert.match(brief, /valgono come specifica insieme a lei/);
  assert.ok(brief.indexOf('DECISIONI DELL’OWNER') > brief.indexOf('COSA ERA STATO CHIESTO'), 'subito dopo la richiesta');
});
