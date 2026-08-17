// Unit test per la logica pura di scripts/dispatch.mjs (il dispatcher
// deterministico delle routine).
//
// COSA TESTIAMO (tutto puro, niente rete né Electron, gira in ms):
//   - classifyReview: stato di un feedback `review` → ruolo
//   - chooseBucket: precedenza secaudit > verifier > fixer > new-work > prober
//   - applyVerifierVerdict / applyFixed / applySecaudit: transizioni di stato
//   - il contatore loop e il cap (3 FAIL → blocked-loop)
//   - buildPayload: ISOLAMENTO (secaudit non vede il feedback; verifier non vede il diff)
//   - readState/writeState/clearState su una STATE_DIR temporanea
//
// La parte di rete (buildSnapshot/fetchOpenCandidates) NON è testata qui: thin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// STATE_DIR isolata PRIMA di importare il modulo (è letta a import-time).
const TMP = mkdtempSync(resolve(tmpdir(), 'filo-dispatch-'));
process.env.FILO_DISPATCH_STATE_DIR = TMP;
// Anche la ROOT: emit() ci scrive il marcatore di ruolo (#443) e non deve
// sporcare il checkout vero durante i test.
process.env.FILO_REPO_ROOT = TMP;

const {
  classifyReview,
  chooseBucket,
  applyVerifierVerdict,
  applyFixed,
  applySecaudit,
  buildPayload,
  defaultState,
  readState,
  writeState,
  clearState,
  resolveLoopCap,
  verifierNoteText,
  reconcileState,
  withRetry,
  emit,
  preflight,
  preflightExitCode,
  parseRoutineConfig,
  resolveRoutinesEnabled,
  routineFault,
} = await import('../../scripts/dispatch.mjs');
const { readRole } = await import('../../scripts/lib/routine-role.mjs');

// ─── Helper ───────────────────────────────────────────────────────────────────

// review item per chooseBucket: { id, num, branch, state }
function review(id, state) {
  return { id, num: id, branch: `worker/${id}`, state };
}

// ─── classifyReview ───────────────────────────────────────────────────────────

test('classifyReview: nessuno stato o verdetto null → verifier', () => {
  assert.equal(classifyReview(null), 'verifier');
  assert.equal(classifyReview({ verifierVerdict: null }), 'verifier');
  assert.equal(classifyReview(defaultState('x', 'worker/x')), 'verifier');
});

test('classifyReview: verifier pass + secaudit non fatto → secaudit', () => {
  assert.equal(classifyReview({ verifierVerdict: 'pass', secauditDone: false }), 'secaudit');
});

test('classifyReview: verifier pass + secaudit fatto → null (tocca al gate)', () => {
  assert.equal(classifyReview({ verifierVerdict: 'pass', secauditDone: true }), null);
});

test('classifyReview: verifier fail sotto al cap → fixer', () => {
  assert.equal(classifyReview({ verifierVerdict: 'fail', loopCount: 1 }, 3), 'fixer');
  assert.equal(classifyReview({ verifierVerdict: 'fail', loopCount: 2 }, 3), 'fixer');
});

test('classifyReview: verifier fail al cap → blocked-loop', () => {
  assert.equal(classifyReview({ verifierVerdict: 'fail', loopCount: 3 }, 3), 'blocked-loop');
  assert.equal(classifyReview({ verifierVerdict: 'fail', loopCount: 5 }, 3), 'blocked-loop');
});

// ─── chooseBucket: precedenza ─────────────────────────────────────────────────

test('chooseBucket: snapshot vuoto → prober', () => {
  assert.equal(chooseBucket({ reviews: [], todoWinner: null }).role, 'prober');
  assert.equal(chooseBucket({}).role, 'prober');
});

// ─── Esplorazione automatica a coda vuota (interruttore owner, #448) ──────────

test('chooseBucket: coda vuota con esplorazione spenta → idle, non prober', () => {
  const opts = { proberWhenIdle: false };
  assert.equal(chooseBucket({ reviews: [], todoWinner: null }, undefined, opts).role, 'idle');
  assert.equal(chooseBucket({}, undefined, opts).role, 'idle');
});

test("l'interruttore spento NON tocca il lavoro vero", () => {
  // Ferma solo il ripiego a coda vuota: finché c'è da lavorare si lavora.
  const opts = { proberWhenIdle: false };
  assert.equal(
    chooseBucket({ reviews: [], todoWinner: { id: 'F1', num: '#5' } }, undefined, opts).role,
    'new-work',
  );
  assert.equal(
    chooseBucket({ reviews: [review('A', { verifierVerdict: null })], todoWinner: null }, undefined, opts).role,
    'verifier',
  );
});

test('solo un false esplicito spegne: assente o true → prober come sempre', () => {
  const empty = { reviews: [], todoWinner: null };
  assert.equal(chooseBucket(empty, undefined, {}).role, 'prober');
  assert.equal(chooseBucket(empty, undefined, { proberWhenIdle: true }).role, 'prober');
  assert.equal(chooseBucket(empty, undefined, { proberWhenIdle: undefined }).role, 'prober');
  assert.equal(chooseBucket(empty, undefined, { proberWhenIdle: null }).role, 'prober');
});

test('chooseBucket: solo todo → new-work col vincitore', () => {
  const b = chooseBucket({ reviews: [], todoWinner: { id: 'F1', num: '#5' } });
  assert.equal(b.role, 'new-work');
  assert.equal(b.id, 'F1');
  assert.equal(b.num, '#5');
});

test('chooseBucket: review da verificare batte un todo', () => {
  const b = chooseBucket({
    reviews: [review('A', { verifierVerdict: null })],
    todoWinner: { id: 'F1' },
  });
  assert.equal(b.role, 'verifier');
  assert.equal(b.id, 'A');
});

test('chooseBucket: secaudit batte verifier batte fixer', () => {
  const reviews = [
    review('FX', { verifierVerdict: 'fail', loopCount: 1 }), // fixer
    review('VF', { verifierVerdict: null }),                  // verifier
    review('SA', { verifierVerdict: 'pass', secauditDone: false }), // secaudit
  ];
  const b = chooseBucket({ reviews, todoWinner: { id: 'F1' } });
  assert.equal(b.role, 'secaudit');
  assert.equal(b.id, 'SA');
  assert.equal(b.branch, 'worker/SA');
});

test('chooseBucket: senza secaudit, verifier batte fixer', () => {
  const reviews = [
    review('FX', { verifierVerdict: 'fail', loopCount: 1 }),
    review('VF', { verifierVerdict: null }),
  ];
  assert.equal(chooseBucket({ reviews, todoWinner: null }).role, 'verifier');
});

test('chooseBucket: solo un fail sotto cap → fixer; passa la critica nello stato', () => {
  const b = chooseBucket({
    reviews: [review('FX', { verifierVerdict: 'fail', loopCount: 2, verifierCritique: 'si rompe X' })],
    todoWinner: null,
  });
  assert.equal(b.role, 'fixer');
  assert.equal(b.loopCount, 2);
  assert.equal(b.state.verifierCritique, 'si rompe X');
});

test('chooseBucket: fail al cap → blocked-loop (non fixer)', () => {
  const b = chooseBucket({
    reviews: [review('FX', { verifierVerdict: 'fail', loopCount: 3 })],
    todoWinner: { id: 'F1' },
  });
  assert.equal(b.role, 'blocked-loop');
  assert.equal(b.id, 'FX');
});

test('chooseBucket: review già passato secaudit non viene ridispatchato → resta il todo', () => {
  const b = chooseBucket({
    reviews: [review('DONE', { verifierVerdict: 'pass', secauditDone: true })],
    todoWinner: { id: 'F1' },
  });
  assert.equal(b.role, 'new-work');
  assert.equal(b.id, 'F1');
});

// ─── Transizioni di stato ─────────────────────────────────────────────────────

test('applyVerifierVerdict pass: imposta pass, loop invariato', () => {
  const s = applyVerifierVerdict(defaultState('A', 'worker/A'), 'pass');
  assert.equal(s.verifierVerdict, 'pass');
  assert.equal(s.loopCount, 0);
});

test('applyVerifierVerdict fail: incrementa il loop e salva la critica', () => {
  let s = applyVerifierVerdict(defaultState('A', 'worker/A'), 'fail', 'rotto qui');
  assert.equal(s.verifierVerdict, 'fail');
  assert.equal(s.loopCount, 1);
  assert.equal(s.verifierCritique, 'rotto qui');
  // secondo fail
  s = applyVerifierVerdict(s, 'fail', 'ancora rotto');
  assert.equal(s.loopCount, 2);
  assert.equal(s.verifierCritique, 'ancora rotto');
});

test('applyFixed: ri-mette in coda verifier ma conserva il loop', () => {
  const failed = applyVerifierVerdict(defaultState('A', 'worker/A'), 'fail', 'x');
  const fixed = applyFixed(failed);
  assert.equal(fixed.verifierVerdict, null);
  assert.equal(fixed.verifierCritique, '');
  assert.equal(fixed.loopCount, 1, 'il contatore loop NON si azzera col fix');
});

test('ciclo completo: fail→fix→fail→fix→fail = loop 3 → blocked-loop', () => {
  let s = defaultState('A', 'worker/A');
  s = applyVerifierVerdict(s, 'fail', '1');
  s = applyFixed(s);
  s = applyVerifierVerdict(s, 'fail', '2');
  s = applyFixed(s);
  s = applyVerifierVerdict(s, 'fail', '3');
  assert.equal(s.loopCount, 3);
  assert.equal(classifyReview(s, 3), 'blocked-loop');
});

test('applySecaudit: marca secauditDone e il verdetto', () => {
  const passed = applyVerifierVerdict(defaultState('A', 'worker/A'), 'pass');
  const sa = applySecaudit(passed, 'pass');
  assert.equal(sa.secauditDone, true);
  assert.equal(sa.secauditVerdict, 'pass');
  assert.equal(classifyReview(sa), null);
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

test('resolveLoopCap: niente env né remoto → default 3', () => {
  assert.equal(resolveLoopCap({}), 3);
  assert.equal(resolveLoopCap({ envRaw: undefined, remote: null }), 3);
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
  assert.equal(resolveLoopCap({ remote: 0 }), 3);   // 0 non valido → default
  assert.equal(resolveLoopCap({ envRaw: 50 }), 10);
  assert.equal(resolveLoopCap({ remote: 7.4 }), 7); // arrotonda a 7
});

test('resolveLoopCap: valori non numerici → default', () => {
  assert.equal(resolveLoopCap({ envRaw: 'abc', remote: 'xyz' }), 3);
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
});

// ─── blocked-secaudit: la bocciatura di sicurezza non incaglia più ────────────
// Caso reale #289.9 (2026-07-07 → 2026-07-11): secaudit FAIL registrato, il
// worker dimentica l'escalation a design, un fixer rilavora e ri-accoda
// revision_capability senza --record-fixed → il feedback restava invisibile a
// dispatch PER SEMPRE mentre la dashboard diceva "in attesa di un verificatore".

test('classifyReview: secaudit FAIL mai scalato → blocked-secaudit (non null)', () => {
  const s = { verifierVerdict: 'pass', secauditDone: true, secauditVerdict: 'fail' };
  assert.equal(classifyReview(s), 'blocked-secaudit');
});

test('classifyReview: secaudit PASS resta null (gate in mano all orchestratore)', () => {
  const s = { verifierVerdict: 'pass', secauditDone: true, secauditVerdict: 'pass' };
  assert.equal(classifyReview(s), null);
});

test('chooseBucket: blocked-secaudit batte anche il secaudit pendente', () => {
  const reviews = [
    review('SA', { verifierVerdict: 'pass', secauditDone: false }),
    review('ZOMBIE', { verifierVerdict: 'pass', secauditDone: true, secauditVerdict: 'fail' }),
  ];
  const b = chooseBucket({ reviews, todoWinner: { id: 'F1' } });
  assert.equal(b.role, 'blocked-secaudit');
  assert.equal(b.id, 'ZOMBIE');
});

// ─── reconcileState: stato stantio ↔ status persistito ───────────────────────

test('reconcileState: fixer ha rilavorato (status revision_capability) ma stato a ciclo concluso → riparte dal verifier', () => {
  const stale = { id: 'Z', branch: 'worker/Z', loopCount: 2, verifierVerdict: 'pass', secauditDone: true, secauditVerdict: 'fail' };
  const r = reconcileState(stale, 'revision_capability');
  assert.equal(classifyReview(r), 'verifier', 'deve tornare lavorabile dal verifier');
  assert.equal(r.loopCount, 2, 'il contatore loop si conserva (come applyFixed)');
  assert.equal(r.secauditDone, false);
});

test('reconcileState: verifier appena passato (lag della coda triage) NON è divergenza → resta secaudit', () => {
  const fresh = { id: 'A', branch: 'worker/A', loopCount: 0, verifierVerdict: 'pass', secauditDone: false, secauditVerdict: null };
  const r = reconcileState(fresh, 'revision_capability');
  assert.equal(classifyReview(r), 'secaudit', 'lo stato è più avanti dello status e comanda lui');
});

test('reconcileState: status revision_security + secaudit FAIL → invariato (tocca a blocked-secaudit)', () => {
  const s = { id: 'B', branch: 'worker/B', loopCount: 0, verifierVerdict: 'pass', secauditDone: true, secauditVerdict: 'fail' };
  assert.deepEqual(reconcileState(s, 'revision_security'), s);
  assert.equal(classifyReview(reconcileState(s, 'revision_security')), 'blocked-secaudit');
});

test('reconcileState: stato assente → assente (nessuna invenzione)', () => {
  assert.equal(reconcileState(null, 'revision_capability'), null);
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

// ─── appendWorkerLog: accoda + cap sulle più recenti ──────────────────────────





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

test('emit: un giro a vuoto (idle) non lascia una firma di lavoro', () => {
  silently(() => emit({ role: 'new-work', id: 'z' }, {}));
  assert.equal(readRole(TMP), 'new-work');
  // Nessun worker è partito: il marcatore del giro prima non deve sopravvivere,
  // o finirebbe nella provenienza del primo feedback aperto da qualcun altro.
  silently(() => emit({ role: 'idle' }, {}));
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

test('cleanup STATE_DIR temporanea', () => {
  rmSync(TMP, { recursive: true, force: true });
  assert.ok(!existsSync(TMP));
});
