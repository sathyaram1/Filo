// Unit test per la logica pura di scripts/dispatch.mjs (il dispatcher
// deterministico delle routine).
//
// COSA TESTIAMO (tutto puro, niente rete né Electron, gira in ms):
//   - applyVerifierVerdict / applyFixed / applySecaudit: transizioni di stato
//   - buildPayload: ISOLAMENTO (secaudit non vede il feedback; verifier non vede il diff)
//   - readState/writeState/clearState su una STATE_DIR temporanea
//   - preflight / interruttore master / resolveLoopCap
//
// La SCELTA del lavoro non vive più qui: la fa il server col biglietto
// (SPEC-RIDISEGNO-MAX.md §1; la copia viva delle regole è
// filo-security/functions/src/routine/select.js, coi suoi test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// STATE_DIR isolata PRIMA di importare il modulo (è letta a import-time).
const TMP = mkdtempSync(resolve(tmpdir(), 'filo-dispatch-'));
process.env.FILO_DISPATCH_STATE_DIR = TMP;
// Anche la ROOT: emit() ci scrive il marcatore di ruolo (#443) e non deve
// sporcare il checkout vero durante i test.
process.env.FILO_REPO_ROOT = TMP;
// E la radice degli STRUMENTI, che dal 2026-08-24 è una cosa diversa dalla
// radice del progetto: le ricette dei ruoli seguono gli strumenti, perché
// quelle del progetto sono quelle del ramo su cui si sta lavorando
// (scripts/lib/tools-pin.mjs). Qui le due coincidono, come in locale.
process.env.FILO_TOOLS_ROOT = TMP;

const {
  applyVerifierVerdict,
  applyFixed,
  applySecaudit,
  buildPayload,
  readRoleInstructions,
  serialAwarenessNote,
  defaultState,
  readState,
  writeState,
  clearState,
  resolveLoopCap,
  verifierNoteText,
  withRetry,
  emit,
  preflight,
  preflightExitCode,
  parseRoutineConfig,
  resolveRoutinesEnabled,
  routineFault,
  stripTicketArg,
  looksLikeTicket,
  ticketMissingText,
  serverDownText,
  usageText,
} = await import('../../scripts/dispatch.mjs');
const { readRole } = await import('../../scripts/lib/routine-role.mjs');

// (Qui vivevano i test di classifyReview, chooseBucket e reconcileState: la
// scelta del lavoro è del server dal ridisegno — SPEC-RIDISEGNO-MAX.md §1 — e
// le sue regole sono testate in filo-security, functions/test/routine-select.)

// ─── Transizioni di stato ─────────────────────────────────────────────────────

test('applyVerifierVerdict pass: imposta pass e svuota la critica', () => {
  const s = applyVerifierVerdict(defaultState('A', 'worker/A'), 'pass');
  assert.equal(s.verifierVerdict, 'pass');
  assert.equal(s.verifierCritique, '');
});

test('applyVerifierVerdict fix: lo specchio locale dice "il verificatore sta correggendo", con la critica coi livelli', () => {
  const s = applyVerifierVerdict(defaultState('A', 'worker/A'), 'fix', '[2] rotto qui');
  assert.equal(s.verifierVerdict, 'fix-pending');
  assert.equal(s.verifierCritique, '[2] rotto qui');
  assert.equal(applyVerifierVerdict(s, 'stop', '[2] ancora').verifierVerdict, 'blocked');
});

test('applyFixed: ri-mette in coda verifier e azzera la critica (i bilanci li tiene il server)', () => {
  const fixed = applyFixed(applyVerifierVerdict(defaultState('A', 'worker/A'), 'fix', '[2] x'));
  assert.equal(fixed.verifierVerdict, null);
  assert.equal(fixed.verifierCritique, '');
});

test('VERIFIER_ROUND: il parser della critica coi livelli arriva dagli strumenti (fonte unica)', async () => {
  const { VERIFIER_ROUND, VERIFIER_OUTCOMES } = await import('../../scripts/dispatch.mjs');
  const p = VERIFIER_ROUND.parseFindings('funziona\n[2] rotto\n[1?] gusto');
  assert.deepEqual(p.findings.map((f) => [f.level, f.decision]), [[2, false], [1, true]]);
  assert.deepEqual(VERIFIER_OUTCOMES, ['pass', 'fix', 'stop']);
});

test('verifierReplyText: la fase 2 del server si stampa intera; pass e stop dicono cosa fare', async () => {
  const { verifierReplyText } = await import('../../scripts/dispatch.mjs');
  const fix = verifierReplyText({
    outcome: 'fix',
    phase2: { findings: [{ level: 2, text: 'rotto' }], derived: [{ level: 0, text: 'raro' }], budgets: { cap2: { cap: 5, used: 1, left: 4 } }, instructions: 'FASE 2 — correggi' },
  });
  assert.match(fix, /c'è da correggere/);
  assert.match(fix, /\[2\] rotto/);
  assert.match(fix, /\[0\] raro/);
  assert.match(fix, /cap2: 4 giri residui su 5/);
  assert.match(fix, /FASE 2 — correggi/);
  assert.match(verifierReplyText({ outcome: 'pass', derived: { num: '#42.1' } }), /#42\.1/);
  assert.match(verifierReplyText({ outcome: 'stop', blocking: [{ level: 3, text: 'grave' }] }), /si ferma[\s\S]*\[3\] grave/);
  assert.match(verifierReplyText(undefined), /verifica superata/);
});

test('applySecaudit: marca secauditDone e il verdetto', () => {
  const passed = applyVerifierVerdict(defaultState('A', 'worker/A'), 'pass');
  const sa = applySecaudit(passed, 'pass');
  assert.equal(sa.secauditDone, true);
  assert.equal(sa.secauditVerdict, 'pass');
});

// ─── Il terzo esito: migliorabile (SPEC-RIDISEGNO-MAX.md §13) ────────────────

test('VERIFIER_VERDICTS: i tre esiti accettati da --record-verifier', async () => {
  const { VERIFIER_VERDICTS } = await import('../../scripts/dispatch.mjs');
  assert.deepEqual(VERIFIER_VERDICTS, ['pass', 'migliorabile', 'fail']);
});

test('applyVerifierVerdict migliorabile: contatore SEPARATO dal loop, critica salvata', () => {
  let s = applyVerifierVerdict(defaultState('A', 'worker/A'), 'migliorabile', 'manca la parità col menu');
  assert.equal(s.verifierVerdict, 'migliorabile');
  assert.equal(s.improvableCount, 1);
  assert.equal(s.loopCount, 0, 'un migliorabile NON è una bocciatura: il loop non si muove');
  assert.equal(s.verifierCritique, 'manca la parità col menu');
  // fail successivo: ciascun contatore conta il suo
  s = applyVerifierVerdict(s, 'fail', 'rotto');
  assert.equal(s.loopCount, 1);
  assert.equal(s.improvableCount, 1);
});

test('applyFixed conserva anche il contatore dei migliorabile', () => {
  const s = applyFixed(applyVerifierVerdict(defaultState('A', 'worker/A'), 'migliorabile', 'x'));
  assert.equal(s.improvableCount, 1, 'il server confronta questo numero con N: il fix non lo azzera');
  assert.equal(s.verifierVerdict, null);
});

// ─── buildPayload: ISOLAMENTO ─────────────────────────────────────────────────

test('buildPayload secaudit: vede il diff, MAI il feedback', () => {
  const bucket = { role: 'secaudit', id: 'A', num: '#1', branch: 'worker/A' };
  const p = buildPayload(bucket, { diff: 'diff --git ...', feedback: { text: 'SEGRETO' } });
  assert.equal(p.diff, 'diff --git ...');
  assert.equal(p.branch, 'worker/A');
  assert.equal(p.feedback, undefined, 'secaudit NON deve ricevere il feedback');
  assert.ok(!JSON.stringify(p).includes('SEGRETO'));
});

test('buildPayload verifier: vede il feedback (sintomo), MAI il diff', () => {
  const bucket = { role: 'verifier', id: 'A', num: '#1', branch: 'worker/A' };
  const p = buildPayload(bucket, { feedback: { text: 'non funziona' }, diff: 'DIFF' });
  assert.equal(p.feedback.text, 'non funziona');
  assert.equal(p.branch, 'worker/A');
  assert.equal(p.diff, undefined, 'verifier NON deve ricevere il diff');
  assert.ok(!JSON.stringify(p).includes('DIFF'));
});

test('buildPayload fixer: feedback + critica del verifier', () => {
  const bucket = { role: 'fixer', id: 'A', num: '#1', branch: 'worker/A', loopCount: 1, state: { verifierCritique: 'rotto X' } };
  const p = buildPayload(bucket, { feedback: { text: 'lamentela' } });
  assert.equal(p.feedback.text, 'lamentela');
  assert.equal(p.verifierCritique, 'rotto X');
  assert.equal(p.loopCount, 1);
});

test('buildPayload new-work: feedback completo', () => {
  const bucket = { role: 'new-work', id: 'F1', num: '#5' };
  const p = buildPayload(bucket, { feedback: { text: 'spec' } });
  assert.equal(p.feedback.text, 'spec');
  assert.equal(p.id, 'F1');
});

test('buildPayload prober: payload vuoto', () => {
  assert.deepEqual(buildPayload({ role: 'prober' }), {});
});

// ─── Lo storico delle critiche (caso #502: sei giri per un difetto da due) ────

test('buildPayload verifier e fixer: lo storico delle critiche arriva nel payload', () => {
  const history = [
    { verdict: 'fail', critique: 'esce con lo zoom' },
    { verdict: 'fail', critique: 'esce col ridimensionamento' },
  ];
  const v = buildPayload({ role: 'verifier', id: 'A', num: '#1', branch: 'worker/A', loopCount: 2 }, { feedback: { text: 's' }, history });
  assert.deepEqual(v.history, history, 'il verifier vede le porte già trovate dai giri passati');
  assert.equal(v.loopCount, 2, 'e sa a che giro è');
  const f = buildPayload({ role: 'fixer', id: 'A', num: '#1', branch: 'worker/A', serverCritique: 'ultima' }, { feedback: { text: 's' }, history });
  assert.deepEqual(f.history, history, 'chi corregge vede la SERIE, non solo l\'ultima critica');
  assert.equal(f.verifierCritique, 'ultima');
});

test('buildPayload: senza storico dal server (o malformato) arriva un elenco vuoto', () => {
  const v = buildPayload({ role: 'verifier', id: 'A', branch: 'worker/A' }, { feedback: { text: 's' } });
  assert.deepEqual(v.history, [], 'un server vecchio non manda lo storico: elenco vuoto, non un buco');
  const f = buildPayload({ role: 'fixer', id: 'A', branch: 'worker/A' }, { feedback: { text: 's' }, history: 'non-un-array' });
  assert.deepEqual(f.history, []);
});

test('serialAwarenessNote: scatta dalla SECONDA bocciatura, per chi corregge e chi verifica', () => {
  const due = [{ critique: 'a' }, { critique: 'b' }];
  assert.equal(serialAwarenessNote('fixer', []), '', 'primo passaggio: niente avvertenza');
  assert.equal(serialAwarenessNote('fixer', [{ critique: 'a' }]), '', 'una sola bocciatura non è una serie');
  assert.match(serialAwarenessNote('fixer', due), /inventario/, 'dalla seconda: inventario delle strade, non l\'ultima porta');
  assert.match(serialAwarenessNote('verifier', due), /stessa critica/i, 'il verifier deve elencare le porte tutte insieme');
  assert.equal(serialAwarenessNote('secaudit', due), '', 'il controllo di sicurezza non c\'entra con la serie');
  assert.equal(serialAwarenessNote('fixer', null), '', 'storico assente ≠ guasto');
});

// ─── Stato su disco ───────────────────────────────────────────────────────────

test('writeState/readState/clearState: round-trip su STATE_DIR temporanea', () => {
  const s = applyVerifierVerdict(defaultState('DISK1', 'worker/DISK1'), 'fail', 'boom');
  writeState(s);
  const back = readState('DISK1');
  assert.equal(back.verifierVerdict, 'fail');
  assert.equal(back.loopCount, 1);
  assert.equal(back.verifierCritique, 'boom');
  clearState('DISK1');
  assert.equal(readState('DISK1'), null);
});

test('readState: id inesistente → null', () => {
  assert.equal(readState('NOPE-NOPE'), null);
});

// I record-* persistono il file di stato su git da soli (l'hook di auto-commit
// scatta solo su Edit/Write, non su Bash): senza, un verifier di sola lettura
// perdeva il verdetto e dispatch re-instradava all'infinito lo stesso feedback.
// Sotto FILO_DISPATCH_STATE_DIR (test) la persistenza deve essere un NO-OP: mai
// toccare git col repo reale mentre gira la suite.

// ─── resolveLoopCap: precedenza env > remoto > default, con clamp ─────────────
// Il default è il failCap della fonte unica (feedbackTransitions.js,
// VERIFIER_CAPS.failCap = 10 — SPEC-RIDISEGNO-MAX.md §13): i documenti che
// dicevano "3" erano già stantii, e il numero non vive più nei prompt.

test('resolveLoopCap: niente env né remoto → default failCap (10)', () => {
  assert.equal(resolveLoopCap({}), 10);
  assert.equal(resolveLoopCap({ envRaw: undefined, remote: null }), 10);
});

test('resolveLoopCap: il valore remoto (scelto dall owner) si usa se manca l env', () => {
  assert.equal(resolveLoopCap({ remote: 5 }), 5);
  assert.equal(resolveLoopCap({ envRaw: '', remote: 7 }), 7);
});

test('resolveLoopCap: l env override vince sul remoto', () => {
  assert.equal(resolveLoopCap({ envRaw: '4', remote: 9 }), 4);
});

test('resolveLoopCap: clamp nel range [1, 10] sia env sia remoto', () => {
  assert.equal(resolveLoopCap({ remote: 99 }), 10);
  assert.equal(resolveLoopCap({ remote: 0 }), 10);  // 0 non valido → default
  assert.equal(resolveLoopCap({ envRaw: 50 }), 10);
  assert.equal(resolveLoopCap({ remote: 7.4 }), 7); // arrotonda a 7
});

test('resolveLoopCap: valori non numerici → default', () => {
  assert.equal(resolveLoopCap({ envRaw: 'abc', remote: 'xyz' }), 10);
});

// ─── verifierNoteText: l'esito del verifier nella chat del feedback ──────────

test('verifierNoteText: pass con critica → incipit + sostanza (senza prefisso PASS)', () => {
  const n = verifierNoteText('pass', "PASS — ho provato l'incolla immagine e arriva al destinatario");
  assert.match(n, /^Controllo funzionalità superato\./);
  assert.match(n, /incolla immagine/);
  assert.ok(!/PASS —/.test(n)); // il prefisso ridondante viene tolto
});

test('verifierNoteText: fail con critica → incipit NON superato + passi', () => {
  const n = verifierNoteText('fail', 'FAIL: il bottone resta disabilitato dopo il primo click');
  assert.match(n, /^Controllo funzionalità NON superato:/);
  assert.match(n, /bottone resta disabilitato/);
  assert.ok(!/FAIL:/.test(n));
});

test("verifierNoteText: senza critica → solo l'esito (mai nota vuota)", () => {
  assert.equal(verifierNoteText('pass'), 'Controllo funzionalità superato.');
  assert.equal(verifierNoteText('fail'), 'Controllo funzionalità NON superato.');
  assert.equal(verifierNoteText('migliorabile'), 'Verifica: funziona, ma migliorabile.');
});

test('verifierNoteText: migliorabile → incipit "funziona, ma migliorabile" (senza prefisso)', () => {
  const n = verifierNoteText('migliorabile', "MIGLIORABILE — l'evidenziazione non si vede sul tema scuro");
  assert.match(n, /^Verifica: funziona, ma migliorabile — /);
  assert.match(n, /tema scuro/);
  assert.ok(!/MIGLIORABILE —/.test(n)); // il prefisso ridondante viene tolto
});

// ─── withRetry: i guasti transitori non svuotano la coda ─────────────────────

test('withRetry: successo al terzo tentativo → ritorna il valore', async () => {
  let calls = 0;
  const out = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('rete giù');
    return 'ok';
  }, 'test', { attempts: 3, baseDelayMs: 1 });
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
});

test('withRetry: esauriti i tentativi → rilancia l ultimo errore', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw new Error('sempre giù'); }, 'test', { attempts: 3, baseDelayMs: 1 }),
    /sempre giù/,
  );
  assert.equal(calls, 3);
});

test('withRetry: nessun retry se il primo tentativo riesce', async () => {
  let calls = 0;
  const out = await withRetry(async () => { calls++; return 42; }, 'test', { attempts: 3, baseDelayMs: 1 });
  assert.equal(out, 42);
  assert.equal(calls, 1);
});

// ─── #443: la consegna del lavoro firma anche CHI lo sta facendo ─────────────
//
// La provenienza non può dipendere dal fatto che il worker si ricordi di
// dichiararsi (prima di questo, su decine di ritrovamenti uno solo risultava
// "esplorazione"). La scrive il dispatcher, che il ruolo lo sa per costruzione.
// Senza la scrittura, readRole torna '' e questi assert diventano rossi.

function silently(fn) {
  const real = process.stdout.write;
  process.stdout.write = () => true;
  try { return fn(); } finally { process.stdout.write = real; }
}

test('emit: consegnare un ruolo lo registra per chi accoderà feedback', () => {
  silently(() => emit({ role: 'prober' }, {}));
  assert.equal(readRole(TMP), 'prober');
  // Il giro successivo sovrascrive: un worker alla volta, un ruolo alla volta.
  silently(() => emit({ role: 'verifier', id: 'x', branch: 'worker/x' }, {}));
  assert.equal(readRole(TMP), 'verifier');
});

test('emit: un GUASTO cancella il marcatore invece di lasciare quello vecchio', () => {
  silently(() => emit({ role: 'new-work', id: 'y' }, {}));
  assert.equal(readRole(TMP), 'new-work');
  // `halt` non è un ruolo: nessun lavoro consegnato, nessuna firma da lasciare.
  silently(() => emit({ role: 'halt', kind: 'transient', message: 'coda illeggibile' }, {}));
  assert.equal(readRole(TMP), '');
});

test('emit: un giro che non lavora non lascia una firma di lavoro', () => {
  // I ruoli `idle`/`off` non esistono più (SPEC-RIDISEGNO-MAX.md §12: coda
  // vuota o interruttore spento = exit 2 alla richiesta di biglietto, prima
  // dello spawn): l'unico giro che non lavora è il guasto, e il marcatore del
  // giro prima non deve sopravvivergli — finirebbe nella provenienza del primo
  // feedback aperto da qualcun altro.
  silently(() => emit({ role: 'new-work', id: 'z' }, {}));
  assert.equal(readRole(TMP), 'new-work');
  silently(() => emit({ role: 'halt', kind: 'transient', message: 'canale giù' }, {}));
  assert.equal(readRole(TMP), '');
});

// ─── preflight ────────────────────────────────────────────────────────────────

// Le routine accese, iniettate: senza, la prontezza andrebbe a leggere davvero
// il documento su Firestore — e uno unit test non tocca la rete.
const routineAccese = async () => ({ enabled: true });

test('preflight: esiste ed è invocabile (il ramo --preflight non deve crashare)', async () => {
  // Regressione: `--preflight` chiamava un identificatore mai definito, quindi
  // il passo di prontezza di OGNI routine moriva con exit 1 ("preflight is not
  // defined") invece di dire prontezza OK o GUASTO.
  assert.equal(typeof preflight, 'function');
  assert.deepEqual(await preflight(async () => ({ reviews: [], todoWinner: null }), routineAccese), { ok: true });
});

test('preflight: un guasto sull\'interruttore → non pronto, col suo tipo', async () => {
  const r = await preflight(null, async () => { throw routineFault('transient', 'documento irraggiungibile'); });
  assert.deepEqual(r, { ok: false, kind: 'transient', message: 'documento irraggiungibile' });
});

test('preflight NON legge la coda: quella domanda vuole la chiave, che qui non c\'è più', async () => {
  // Invariante di #477.3. Se un giorno qualcuno rimettesse qui la lettura della
  // coda, si riporterebbe sulla macchina della routine la chiave che apre TUTTI
  // i feedback — cioè il difetto da cui la spec parte. Questo test diventa
  // rosso se succede.
  let toccata = false;
  const r = await preflight(async () => { toccata = true; return { reviews: [], todoWinner: null }; }, routineAccese);
  assert.deepEqual(r, { ok: true });
  assert.equal(toccata, false, 'la prontezza non deve andare a leggere la coda');
});

// ─── Interruttore master delle routine ───────────────────────────────────────

test('resolveRoutinesEnabled: assente ovunque → acceso (comportamento storico)', () => {
  assert.equal(resolveRoutinesEnabled({}), true);
  assert.equal(resolveRoutinesEnabled({ envRaw: '', remote: undefined }), true);
});

test('resolveRoutinesEnabled: solo un false esplicito spegne', () => {
  assert.equal(resolveRoutinesEnabled({ remote: false }), false);
  assert.equal(resolveRoutinesEnabled({ remote: true }), true);
});

test('resolveRoutinesEnabled: l\'override d\'ambiente batte il remoto', () => {
  assert.equal(resolveRoutinesEnabled({ envRaw: '0', remote: true }), false);
  assert.equal(resolveRoutinesEnabled({ envRaw: 'false', remote: true }), false);
  assert.equal(resolveRoutinesEnabled({ envRaw: '1', remote: false }), true);
  assert.equal(resolveRoutinesEnabled({ envRaw: 'sì?', remote: false }), false); // valore ignoto → decide il remoto
});

test('parseRoutineConfig: legge interruttore, esplorazione e cap', () => {
  assert.deepEqual(parseRoutineConfig({
    enabled: { booleanValue: false },
    proberWhenIdle: { booleanValue: false },
    loopCap: { integerValue: '5' },
  }), { enabled: false, proberWhenIdle: false, loopCap: 5 });
  // Documento vuoto (mai scritto) = nessuna decisione presa.
  assert.deepEqual(parseRoutineConfig({}), {});
  // proberWhenIdle: solo il false esplicito compare (true = storico).
  assert.deepEqual(parseRoutineConfig({ proberWhenIdle: { booleanValue: true } }), {});
});

test('preflight: routine spente → non pronto, con esito `off` (non un guasto)', async () => {
  const r = await preflight(
    async () => { throw new Error('non deve nemmeno arrivarci'); },
    async () => ({ enabled: false }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'off');
});

test('preflight: config illeggibile → non pronto (fail closed)', async () => {
  // In dubbio ci si ferma: se non so se sono spente, non lavoro. Il contrario
  // renderebbe l'interruttore ignorabile con un colpo di rete storta.
  const r = await preflight(
    async () => ({ reviews: [], todoWinner: null }),
    async () => { throw routineFault('transient', 'Firestore irraggiungibile'); },
  );
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'transient');
});

test('preflight: routine accese → pronto', async () => {
  const r = await preflight(null, async () => ({ enabled: true }));
  assert.deepEqual(r, { ok: true });
});

test('preflightExitCode: il contratto 0 / 2 / 3 dell\'orchestratore', () => {
  // Il ramo --preflight è morto per mesi uscendo con 1, che non è né "prosegui"
  // né "fermati" (#452): qui il contratto è inchiodato.
  assert.equal(preflightExitCode({ ok: true }), 0);
  assert.equal(preflightExitCode({ ok: false, kind: 'off', message: 'spente' }), 2);
  assert.equal(preflightExitCode({ ok: false, kind: 'transient', message: 'x' }), 3);
  assert.equal(preflightExitCode({ ok: false, kind: 'permanent', message: 'x' }), 3);
  // Qualunque esito produce SEMPRE uno dei tre codici, mai 1.
  for (const r of [null, undefined, {}, { ok: false }, { ok: false, kind: 'boh' }]) {
    assert.ok([0, 2, 3].includes(preflightExitCode(r)), `codice fuori contratto per ${JSON.stringify(r)}`);
  }
});

// ─── Voci del registro dei worker (#451) ─────────────────────────────────────




// ─── teardown ─────────────────────────────────────────────────────────────────

// ─── Ruolo unico resolver + contratto comune (SPEC-RIDISEGNO-MAX.md §12) ──────

test('buildPayload: new-work e fixer dichiarano il caso del resolver', () => {
  // Il server distingue ancora i due nomi nel protocollo; il worker riceve le
  // stesse istruzioni (resolver.md) e capisce da `case` da dove parte.
  const nw = buildPayload({ role: 'new-work', id: 'a', num: '7' }, { feedback: { text: 't' } });
  assert.equal(nw.case, 'primo-passaggio');
  const fx = buildPayload(
    { role: 'fixer', id: 'a', num: '7', branch: 'worker/a', serverCritique: 'si rompe X' },
    { feedback: { text: 't' } },
  );
  assert.equal(fx.case, 'correzione');
  assert.equal(fx.verifierCritique, 'si rompe X');
});

test('readRoleInstructions: ai ruoli lavoranti viene ACCODATO il contratto comune', () => {
  // Prima il contratto viveva copiato byte-per-byte in fondo a ogni file-ruolo,
  // e le copie divergevano: ora è un file solo, accodato da dispatch.
  const dir = resolve(TMP, 'routines', 'roles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'resolver.md'), '# ruolo resolver\ncorpo del ruolo\n');
  writeFileSync(resolve(dir, 'halt.md'), '# guasto\nfermati\n');
  writeFileSync(resolve(dir, '_contratto-worker.md'), '# Contratto comune dei worker\nregole\n');
  const nw = readRoleInstructions('new-work');
  assert.ok(nw.includes('# ruolo resolver'), 'new-work riceve le istruzioni del resolver');
  assert.ok(nw.includes('# Contratto comune dei worker'), 'col contratto accodato in fondo');
  const fx = readRoleInstructions('fixer');
  assert.ok(fx.includes('# ruolo resolver'), 'fixer riceve le STESSE istruzioni (caso nel payload)');
  assert.ok(fx.includes('# Contratto comune dei worker'));
  // Il guasto non è un ruolo lavorante: niente contratto.
  const halt = readRoleInstructions('halt');
  assert.ok(halt.includes('# guasto') && !halt.includes('Contratto comune'));
  // idle e off non esistono più: coda vuota o interruttore spento fermano il
  // giro PRIMA dello spawn (exit 2 alla richiesta di biglietto), quindi nessun
  // worker deve mai ricevere quelle istruzioni.
  assert.equal(readRoleInstructions('idle'), '');
  assert.equal(readRoleInstructions('off'), '');
});

test('i file-ruolo del repo esistono e non sono stub (orchestrator compreso)', () => {
  // Il preflight consegna orchestrator.md, dispatch consegna gli altri: un file
  // spostato o svuotato è un ruolo che parte senza istruzioni.
  const realDir = fileURLToPath(new URL('../../routines/roles/', import.meta.url));
  for (const f of ['orchestrator.md', 'resolver.md', 'verifier.md', 'secaudit.md', 'prober.md', 'halt.md', '_contratto-worker.md']) {
    const p = resolve(realDir, f);
    assert.ok(existsSync(p), `${f} deve esistere`);
    assert.ok(readFileSync(p, 'utf8').length > 300, `${f} non deve essere uno stub`);
  }
  for (const f of ['new-work.md', 'fixer.md', 'idle.md', 'off.md']) {
    assert.ok(!existsSync(resolve(realDir, f)), `${f} è abolito e non deve riapparire`);
  }
});

// ─── Il biglietto perso non deve più poter succedere (incidente #444) ─────────
//
// Il 25 agosto un `--help` battuto a metà lavoro è finito nella porta "giro
// nuovo senza biglietto", che ha cancellato il promemoria: il verdetto di
// un'ora di verifica non si è più potuto registrare. Questi test inchiodano le
// tre difese: argomenti sconosciuti inerti, `--help` vero, `--ticket` di
// scorta sui --record-*, e un messaggio che non accusa più il server.

// Un biglietto dalla forma vera: 43 caratteri base64url, come li genera il
// server (filo-security, functions/src/secrets.js).
const BIGLIETTO_FINTO = '_LM6-W_KSOnJLA0Pj4aUpvd3fM3FWxU3SGolsBKLGAI';

test('looksLikeTicket: accetta la forma vera (anche col trattino iniziale), rifiuta i flag', () => {
  assert.equal(looksLikeTicket(BIGLIETTO_FINTO), true);
  // base64url può cominciare con un trattino SINGOLO: un biglietto così è
  // legittimo (~1 su 64) e rifiutarlo butterebbe via il giro.
  assert.equal(looksLikeTicket('-' + BIGLIETTO_FINTO.slice(1)), true);
  assert.equal(looksLikeTicket('-h'), false, 'un flag corto non è un biglietto');
  assert.equal(looksLikeTicket('--foo'), false);
  assert.equal(looksLikeTicket('--record-verifier'), false, 'doppio trattino = flag, anche se lungo');
  assert.equal(looksLikeTicket(''), false);
  assert.equal(looksLikeTicket('con spazi e roba'), false);
});

test('stripTicketArg: estrae la coppia --ticket e lascia il resto', () => {
  const r = stripTicketArg(['--record-verifier', 'ID1', 'pass', 'critica', '--ticket', BIGLIETTO_FINTO]);
  assert.equal(r.ticket, BIGLIETTO_FINTO);
  assert.equal(r.error, false);
  assert.deepEqual(r.args, ['--record-verifier', 'ID1', 'pass', 'critica']);
});

test('stripTicketArg: senza flag non tocca niente', () => {
  const r = stripTicketArg(['--record-fixed', 'ID1', 'report']);
  assert.equal(r.ticket, '');
  assert.equal(r.error, false);
  assert.deepEqual(r.args, ['--record-fixed', 'ID1', 'report']);
});

test('stripTicketArg: flag senza codice, o con un flag al posto del codice, è un errore', () => {
  assert.equal(stripTicketArg(['--record-fixed', 'ID1', '--ticket']).error, true);
  assert.equal(stripTicketArg(['--record-fixed', 'ID1', '--ticket', '--frase']).error, true);
  assert.equal(stripTicketArg(['--record-fixed', 'ID1', '--ticket', '-h']).error, true);
});

test('serverDownText: dice che il canale è giù, senza travestirsi da rifiuto', () => {
  const t = serverDownText('verdetto non registrato: il server non risponde (network)');
  assert.ok(t.includes('NON RAGGIUNGIBILE'));
  assert.ok(!t.includes('RIFIUTATO'), 'un guasto di rete non deve vestire il testo del rifiuto');
  assert.ok(!t.includes('ha guardato'), 'niente "il server ha guardato": non ha visto niente');
});

test('ticketMissingText: indica il rimedio e NON accusa il server', () => {
  const t = ticketMissingText('verdetto non registrato: nessun biglietto trovato');
  assert.ok(t.includes('--ticket'), 'deve suggerire la scorta --ticket');
  assert.ok(t.includes('NON è stato chiamato'), 'deve dire che il server non è stato interpellato');
  assert.ok(!t.includes('non risponde'), 'niente diagnosi da server giù: era la frase che ha depistato il worker');
  assert.ok(!t.includes('RIFIUTATO'), 'niente diagnosi da rifiuto: il server non ha visto niente');
});

test('usageText: elenca tutti i comandi, compresa la scorta --ticket', () => {
  const u = usageText();
  for (const c of ['--ticket', '--preflight', '--record-verifier', '--record-fixed', '--record-secaudit', '--clear-state', '--help']) {
    assert.ok(u.includes(c), `la schermata di aiuto deve nominare ${c}`);
  }
});

// I tre casi CLI che prima cancellavano il promemoria, eseguiti per davvero:
// senza il fix questi assert sono rossi (il file sparisce).
test('CLI: --help, argomento sconosciuto e --ticket senza codice NON toccano il promemoria', async () => {
  const { spawnSync } = await import('node:child_process');
  const { writeTicket, ticketFile } = await import('../../scripts/lib/routine-ticket.mjs');
  const DISPATCH = fileURLToPath(new URL('../../scripts/dispatch.mjs', import.meta.url));
  const sandbox = mkdtempSync(resolve(tmpdir(), 'filo-cli-'));
  try {
    const env = {
      ...process.env,
      FILO_REPO_ROOT: sandbox,
      FILO_TOOLS_ROOT: sandbox,
      FILO_DISPATCH_STATE_DIR: resolve(sandbox, 'stato'),
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: '', // il promemoria su disco è l'oggetto del test
    };
    const lancia = (args) => spawnSync(process.execPath, [DISPATCH, ...args], { env, encoding: 'utf8' });

    writeTicket(sandbox, 'biglietto-vivo');
    assert.ok(existsSync(ticketFile(sandbox)));

    // `--help`: risponde con la schermata, exit 0, promemoria intatto.
    const aiuto = lancia(['--help']);
    assert.equal(aiuto.status, 0);
    assert.ok(String(aiuto.stdout).includes('--record-verifier'));
    assert.ok(existsSync(ticketFile(sandbox)), '--help non deve cancellare il promemoria');

    // Argomento sconosciuto: errore d\'uso, exit 1, promemoria intatto.
    const storpio = lancia(['--hlep']);
    assert.equal(storpio.status, 1);
    assert.ok(String(storpio.stderr).includes('non riconosciuto'));
    assert.ok(existsSync(ticketFile(sandbox)), 'un argomento storpiato non deve cancellare il promemoria');

    // `--ticket` senza codice: errore d\'uso, exit 1, promemoria intatto.
    const monco = lancia(['--ticket']);
    assert.equal(monco.status, 1);
    assert.ok(existsSync(ticketFile(sandbox)), 'un --ticket monco non deve cancellare il promemoria');
    assert.equal(readFileSync(ticketFile(sandbox), 'utf8').includes('biglietto-vivo'), true, 'il contenuto deve essere quello di prima');

    // Un flag al posto del codice (`--foo`, e anche `-h` a trattino singolo,
    // che è il caso trovato dalla verifica indipendente): errore d\'uso,
    // promemoria intatto.
    for (const finto of ['--foo', '-h']) {
      const flagComeCodice = lancia(['--ticket', finto]);
      assert.equal(flagComeCodice.status, 1, `--ticket ${finto} deve essere un errore d'uso`);
      assert.equal(readFileSync(ticketFile(sandbox), 'utf8').includes('biglietto-vivo'), true,
        `un flag (${finto}) scambiato per biglietto non deve sovrascrivere il promemoria`);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('#507: il ramo lo dice il biglietto, e le fini di giro sigillano', () => {
  const qui = fileURLToPath(new URL('.', import.meta.url));
  const dispatchSrc = readFileSync(resolve(qui, '..', '..', 'scripts', 'dispatch.mjs'), 'utf8');
  // Lo stato locale è un residuo di questa macchina: se torna a battere il ramo
  // del biglietto, un worker può essere posizionato sul ramo di un tentativo
  // precedente ignorando quello assegnato dal server.
  assert.match(dispatchSrc, /bucket\.branch \|\| prev\?\.branch/,
    'il ramo assegnato dal server deve vincere sullo stato locale');
  // Un punto fermo registrato per un ALTRO ramo non deve guidare il ripristino
  // di questo (lo sha esiste nel repo e passerebbe per buono).
  assert.match(dispatchSrc, /prev\?\.branch === branch\) \? lastCheckpoint\(prev\) : null/,
    'il checkpoint vale solo se appartiene al ramo su cui ci si posiziona');
  // Le due fini di giro che non sigillavano (#507): la consegna via canale e il
  // rilascio del biglietto. La logica è in branch-integrity (sealCurrentWork,
  // coperta dai suoi test): qui si controlla che le due strade la chiamino.
  const canaleSrc = readFileSync(resolve(qui, '..', '..', 'scripts', 'routine-channel.mjs'), 'utf8');
  assert.equal((canaleSrc.match(/sealCurrentWork\(/g) || []).length >= 2, true,
    'consegna e rilascio devono sigillare il punto fermo');
});

test('cleanup STATE_DIR temporanea', () => {
  rmSync(TMP, { recursive: true, force: true });
  assert.ok(!existsSync(TMP));
});
