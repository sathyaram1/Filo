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

const {
  applyVerifierVerdict,
  applyFixed,
  applySecaudit,
  buildPayload,
  readRoleInstructions,
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
} = await import('../../scripts/dispatch.mjs');
const { readRole } = await import('../../scripts/lib/routine-role.mjs');

// (Qui vivevano i test di classifyReview, chooseBucket e reconcileState: la
// scelta del lavoro è del server dal ridisegno — SPEC-RIDISEGNO-MAX.md §1 — e
// le sue regole sono testate in filo-security, functions/test/routine-select.)

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

test('ciclo completo: fail→fix→fail→fix→fail = il contatore arriva a 3', () => {
  let s = defaultState('A', 'worker/A');
  s = applyVerifierVerdict(s, 'fail', '1');
  s = applyFixed(s);
  s = applyVerifierVerdict(s, 'fail', '2');
  s = applyFixed(s);
  s = applyVerifierVerdict(s, 'fail', '3');
  assert.equal(s.loopCount, 3, 'è il numero che il server confronta col tetto');
});

test('applySecaudit: marca secauditDone e il verdetto', () => {
  const passed = applyVerifierVerdict(defaultState('A', 'worker/A'), 'pass');
  const sa = applySecaudit(passed, 'pass');
  assert.equal(sa.secauditDone, true);
  assert.equal(sa.secauditVerdict, 'pass');
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

test('cleanup STATE_DIR temporanea', () => {
  rmSync(TMP, { recursive: true, force: true });
  assert.ok(!existsSync(TMP));
});
