// Unit test per la logica pura di scripts/dispatch.mjs (il dispatcher
// deterministico delle routine).
//
// COSA TESTIAMO (tutto puro, niente rete né Electron, gira in ms):
//   - applyVerifierVerdict / applyFixed / applySecaudit: transizioni di stato
//   - buildPayload: ISOLAMENTO (secaudit non vede il feedback; verifier non vede il diff)
//   - readState/writeState/clearState su una STATE_DIR temporanea
//   - preflight / interruttore master
//
// La SCELTA del lavoro non vive più qui: la fa il server col biglietto
// (SPEC-RIDISEGNO-MAX.md §1; la copia viva delle regole è
// filo-security/functions/src/routine/select.js, coi suoi test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

// STATE_DIR isolata PRIMA di importare il modulo (è letta a import-time).
const TMP = cartellaTemporanea('filo-dispatch-');
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
  fixedPayload,
  fermaSenzaSegnalazione,
  fixedReplyText,
  FERMA_NOTE,
  verifierScope,
  perimetroNote,
  serverCtx,
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

test('applyVerifierVerdict fix: lo specchio locale registra la critica coi livelli e il seguito del giro', () => {
  const s = applyVerifierVerdict(defaultState('A', 'worker/A'), 'fix', '[2] rotto qui');
  assert.equal(s.verifierVerdict, 'fix-pending');
  assert.equal(s.verifierCritique, '[2] rotto qui');
  assert.equal(applyVerifierVerdict(s, 'stop', '[2] ancora').verifierVerdict, 'stop');
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

test('verifierReplyText: la risposta del server si stampa intera; pass e stop dicono cosa fare', async () => {
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
  // Il testo della fase 2 è dell'owner e può tacerla: la regola che ferma la stampa lo strumento.
  assert.match(fix, /--record-fixed <id> "<report>" --segnala <file\.md>/);
  assert.ok(fix.indexOf('FERMA il lavoro') > fix.indexOf('FASE 2 — correggi'), 'dopo le istruzioni, non al loro posto');
  assert.match(verifierReplyText({ outcome: 'pass', derived: { num: '#42.1' } }), /#42\.1/);
  assert.match(verifierReplyText({ outcome: 'stop', blocking: [{ level: 3, text: 'grave' }] }), /si ferma[\s\S]*\[3\] grave/);
  // Un «ok» senza esito non è un pass: dirlo superato mandava a rilasciare il
  // biglietto anche con un rilievo di livello 2 nella critica (verifica del
  // giro 3 sul lavoro di lancio delle routine).
  assert.doesNotMatch(verifierReplyText(undefined), /verifica superata/);
  assert.match(verifierReplyText(undefined), /esito non comunicato/);
  assert.match(verifierReplyText({ ok: true }), /esito non comunicato/);
  assert.match(verifierReplyText({ outcome: 'pass' }), /verifica superata/);
});

test('applySecaudit: marca secauditDone e il verdetto', () => {
  const passed = applyVerifierVerdict(defaultState('A', 'worker/A'), 'pass');
  const sa = applySecaudit(passed, 'pass');
  assert.equal(sa.secauditDone, true);
  assert.equal(sa.secauditVerdict, 'pass');
});

// ─── Le parole dei vecchi verdetti si rifiutano, non si ignorano ─────────────

test('la parola del vecchio verdetto è tollerata sulla riga di comando, ma non decide niente', async () => {
  const { LEGACY_VERDICT_WORDS } = await import('../../scripts/dispatch.mjs');
  assert.deepEqual(LEGACY_VERDICT_WORDS, ['pass', 'migliorabile', 'fail']);
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

test('buildPayload fixer: il feedback, e nessuna critica da correggere', () => {
  const bucket = { role: 'fixer', id: 'A', num: '#1', branch: 'worker/A', state: { verifierCritique: 'rotto X' } };
  const p = buildPayload(bucket, { feedback: { text: 'lamentela' } });
  assert.equal(p.feedback.text, 'lamentela');
  assert.equal(p.verifierCritique, undefined, 'qui si riallinea un ramo, non si corregge');
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

test('buildPayload: lo storico delle critiche arriva a chi verifica, e a nessun altro', () => {
  const history = [
    { verdict: 'fail', critique: 'esce con lo zoom' },
    { verdict: 'fail', critique: 'esce col ridimensionamento' },
  ];
  const v = buildPayload({ role: 'verifier', id: 'A', num: '#1', branch: 'worker/A' }, { feedback: { text: 's' }, history });
  assert.deepEqual(v.history, history, 'il verifier vede le porte già trovate dai giri passati');
  assert.ok(!('loopCount' in v), 'chi verifica non deve sapere quanti giri sono passati o restano');
  const f = buildPayload({ role: 'fixer', id: 'A', num: '#1', branch: 'worker/A', serverCritique: 'ultima' }, { feedback: { text: 's' }, history });
  assert.equal(f.history, undefined, 'il riallineamento non corregge niente: la serie non gli serve');
});

test('buildPayload: senza storico dal server (o malformato) arriva un elenco vuoto', () => {
  const v = buildPayload({ role: 'verifier', id: 'A', branch: 'worker/A' }, { feedback: { text: 's' } });
  assert.deepEqual(v.history, [], 'un server vecchio non manda lo storico: elenco vuoto, non un buco');
  const f = buildPayload({ role: 'fixer', id: 'A', branch: 'worker/A' }, { feedback: { text: 's' }, history: 'non-un-array' });
  assert.equal(f.history, undefined);
});

test('serialAwarenessNote: scatta dalla SECONDA bocciatura, per chi corregge e chi verifica', () => {
  const due = [{ critique: 'a' }, { critique: 'b' }];
  assert.equal(serialAwarenessNote('verifier', []), '', 'primo giro: niente avvertenza');
  assert.equal(serialAwarenessNote('verifier', [{ critique: 'a' }]), '', 'una sola bocciatura non è una serie');
  assert.match(serialAwarenessNote('verifier', due), /stessa critica/i, 'il verifier deve elencare le porte tutte insieme');
  assert.equal(serialAwarenessNote('secaudit', due), '', 'il controllo di sicurezza non c\'entra con la serie');
  assert.equal(serialAwarenessNote('fixer', due), '', 'il riallineamento dopo un conflitto non corregge niente');
  assert.equal(serialAwarenessNote('verifier', null), '', 'storico assente ≠ guasto');
});

// ─── Stato su disco ───────────────────────────────────────────────────────────

test('writeState/readState/clearState: round-trip su STATE_DIR temporanea', () => {
  const s = applyVerifierVerdict(defaultState('DISK1', 'worker/DISK1'), 'fix', '[2] boom');
  writeState(s);
  const back = readState('DISK1');
  assert.equal(back.verifierVerdict, 'fix-pending');
  assert.equal(back.verifierCritique, '[2] boom');
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

test('parseRoutineConfig: legge interruttore ed esplorazione', () => {
  assert.deepEqual(parseRoutineConfig({
    enabled: { booleanValue: false },
    proberWhenIdle: { booleanValue: false },
  }), { enabled: false, proberWhenIdle: false });
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




// ─── Fermare il lavoro da una correzione (--ferma) ───────────────────────────

test('fixedPayload: stop viaggia solo se chiesto, e mai come valore falso', () => {
  assert.equal(fixedPayload({ report: 'r', ferma: true, segnalazione: 's' }).stop, true);
  assert.ok(!('stop' in fixedPayload({ report: 'r' })), 'una consegna normale non porta il campo');
  assert.ok(!('stop' in fixedPayload({ report: 'r', ferma: 'sì' })), 'solo il true vero ferma un lavoro');
});

test('--ferma senza segnalazione non parte: è la segnalazione che ferma, e senza chi decide non saprebbe cosa decidere', () => {
  assert.match(fermaSenzaSegnalazione(true, ''), /--segnala <file\.md> che ferma il lavoro/);
  assert.match(fermaSenzaSegnalazione(true, '   '), /non ho consegnato niente/);
  assert.equal(fermaSenzaSegnalazione(true, 'file.md'), '');
  assert.equal(fermaSenzaSegnalazione(false, ''), '');
});

test('fixedReplyText: il fermo lo conferma il server; una segnalazione non fermata si dice, non si dà per fatta', () => {
  assert.match(fixedReplyText('A', { outcome: 'stop' }, true), /FERMATO/);
  assert.match(fixedReplyText('A', { outcome: 'stop' }, false), /FERMATO/, 'il server ha fermato: si dice anche se qui non lo si aspettava');
  assert.match(fixedReplyText('A', {}, true), /ATTENZIONE/);
  assert.match(fixedReplyText('A', {}, true), /segnalazione/);
  assert.match(fixedReplyText('A', {}, false), /torna in coda/);
});

test('la nota che lo strumento stampa dopo la critica dice che la segnalazione ferma, senza --ferma', () => {
  assert.match(FERMA_NOTE, /--segnala <file\.md>/);
  assert.match(FERMA_NOTE, /FERMA il lavoro/);
  assert.doesNotMatch(FERMA_NOTE, /--ferma/);
});

test('CLI: --record-fixed --ferma senza --segnala si ferma prima del server, e dice che a fermare è --segnala', () => {
  const script = fileURLToPath(new URL('../../scripts/dispatch.mjs', import.meta.url));
  const report = 'Non si può correggere senza una decisione: le due strade hanno costi diversi e le spiego nel file.';
  let uscita = 0;
  let testo = '';
  try {
    execFileSync(process.execPath, [script, '--record-fixed', 'fid-x', report, '--ferma'], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, FILO_ROUTINE_TICKET: '' } });
  } catch (e) { uscita = e.status; testo = `${e.stdout || ''}${e.stderr || ''}`; }
  assert.equal(uscita, 1);
  assert.match(testo, /--segnala <file\.md> che ferma il lavoro/);
});

// ─── La ripresa dopo la risposta dell'owner ──────────────────────────────────

const RIPRESA = { motivo: 'decisione', ruolo: 'verifier', domanda: 'A o B?', risposta: 'B.', rilievi: [{ level: 2, text: 'non salva', decision: false }], at: '2026-09-23T08:00:00.000Z' };

test('buildPayload: il correttore che riprende riceve domanda, risposta, rilievi e la serie; il riallineamento resta com\'era', () => {
  const history = [{ verdict: 'critica', findings: [{ level: 2, text: 'non salva' }] }];
  const rip = buildPayload({ role: 'fixer', id: 'A', num: '#1', branch: 'worker/A' }, { feedback: { text: 's' }, history, ripresa: RIPRESA });
  assert.equal(rip.case, 'ripresa');
  assert.equal(rip.ripresa.risposta, 'B.');
  assert.deepEqual(rip.history, history, 'chi riprende a metà di un giro deve vedere le porte già trovate');
  const rb = buildPayload({ role: 'fixer', id: 'A', num: '#1', branch: 'worker/A' }, { feedback: { text: 's' }, history, ripresa: null });
  assert.equal(rb.case, 'riallineamento');
  assert.ok(!('ripresa' in rb));
  assert.ok(!('history' in rb));
});

test('buildPayload: chi risolve riceve la ripresa solo quando c\'è', () => {
  const con = buildPayload({ role: 'new-work', id: 'a', num: '7' }, { feedback: { text: 't' }, ripresa: RIPRESA });
  assert.equal(con.case, 'primo-passaggio');
  assert.equal(con.ripresa.domanda, 'A o B?');
  const senza = buildPayload({ role: 'new-work', id: 'a', num: '7' }, { feedback: { text: 't' } });
  assert.ok(!('ripresa' in senza));
});

test('serverCtx: la ripresa passa dalla busta del server a chi riprende, e un valore storto non passa', () => {
  const ok = serverCtx({ role: 'fixer' }, { payload: { feedback: { text: 't' }, ripresa: RIPRESA } });
  assert.deepEqual(ok.ripresa, RIPRESA);
  assert.equal(serverCtx({ role: 'new-work' }, { payload: { feedback: { text: 't' }, ripresa: 'sì' } }).ripresa, null);
  assert.equal(serverCtx({ role: 'fixer' }, { payload: { feedback: { text: 't' } } }).ripresa, null);
});

test('readRoleInstructions: il caso del correttore sceglie il testo (ripresa ≠ rebase), e un caso ignoto vale il rebase', () => {
  const dir = resolve(TMP, 'routines', 'roles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'resolver-rebase.md'), '# stai facendo un rebase\n');
  writeFileSync(resolve(dir, 'resolver-ripresa.md'), '# stai riprendendo un lavoro fermo\n');
  assert.match(readRoleInstructions('fixer', { caso: 'ripresa' }), /riprendendo un lavoro fermo/);
  assert.match(readRoleInstructions('fixer', { caso: 'riallineamento' }), /stai facendo un rebase/);
  assert.match(readRoleInstructions('fixer', {}), /stai facendo un rebase/);
  assert.match(readRoleInstructions('fixer', { caso: 'constructor' }), /stai facendo un rebase/);
});

test('il testo di ruolo della ripresa esiste nel repo e dice da dove si riparte', () => {
  const testo = readFileSync(fileURLToPath(new URL('../../routines/roles/resolver-ripresa.md', import.meta.url)), 'utf8');
  assert.match(testo, /payload\.ripresa/);
  assert.match(testo, /risposta/);
  assert.match(testo, /--record-fixed/);
  assert.match(testo, /includi: _segnala\.md/);
  const segnala = readFileSync(fileURLToPath(new URL('../../routines/roles/_segnala.md', import.meta.url)), 'utf8');
  assert.match(segnala, /FERMA il lavoro/);
});

// ─── L'ambito della verifica (pieno / riallineamento / chiusura) ─────────────

test('verifierScope: un valore sconosciuto vale pieno, e lo dice', () => {
  assert.deepEqual(verifierScope(undefined), { scope: 'pieno', sconosciuto: false });
  assert.deepEqual(verifierScope('pieno'), { scope: 'pieno', sconosciuto: false });
  assert.deepEqual(verifierScope('chiusura'), { scope: 'chiusura', sconosciuto: false });
  assert.deepEqual(verifierScope('riallineamento'), { scope: 'riallineamento', sconosciuto: false });
  assert.deepEqual(verifierScope('veloce'), { scope: 'pieno', sconosciuto: true });
  assert.deepEqual(verifierScope('constructor'), { scope: 'pieno', sconosciuto: true });
});

test('perimetroNote: il perimetro si legge come testo, non come JSON', () => {
  const c = perimetroNote('chiusura', { rilievi: [{ level: 2, text: 'Salva non salva' }, { level: 1, text: 'bordo freddo', decision: true }], shaPrima: 'abc1234' });
  assert.match(c, /\[2\] Salva non salva/);
  assert.match(c, /\[1\?\] bordo freddo/);
  assert.match(c, /git diff abc1234\.\.HEAD/);
  assert.ok(!c.includes('{'), 'niente JSON grezzo nel compito');
  const r = perimetroNote('riallineamento', { reportRebase: 'conflitto nelle schede\nsolo meccanico', shaVerificato: 'def5678' });
  assert.match(r, /> conflitto nelle schede\n> solo meccanico/);
  assert.match(r, /git diff def5678\.\.HEAD/);
  assert.equal(perimetroNote('pieno', { rilievi: [] }), '');
  // Lo sha finisce in un comando da copiare: uno storto non ci entra.
  assert.ok(!perimetroNote('chiusura', { shaPrima: 'abc; rm -rf .' }).includes('rm -rf'));
  assert.match(perimetroNote('chiusura', {}), /non comunicati/);
});

test('emit: il valore di scope sceglie il testo del ruolo e accoda il perimetro', () => {
  const dir = resolve(TMP, 'routines', 'roles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'verifier.md'), '# verifica piena\n');
  writeFileSync(resolve(dir, 'verifier-chiusura.md'), '# verifica di chiusura\n');
  writeFileSync(resolve(dir, 'verifier-riallineamento.md'), '# verifica dopo il riallineamento\n');
  const consegna = (payload) => {
    const bucket = { role: 'verifier', id: 'x', num: '#9', branch: 'worker/x' };
    let out = '';
    let err = '';
    const real = process.stdout.write;
    const realErr = process.stderr.write;
    process.stdout.write = (s) => { out += s; return true; };
    process.stderr.write = (s) => { err += s; return true; };
    try { emit(bucket, serverCtx(bucket, { payload })); } finally { process.stdout.write = real; process.stderr.write = realErr; }
    return { ...JSON.parse(out), err };
  };
  const storia = [{ critique: 'a' }, { critique: 'b' }];
  const pieno = consegna({ feedback: { text: 't' }, history: storia });
  assert.match(pieno.instructions, /# verifica piena/);
  assert.match(pieno.instructions, /Avvertenza di serie/);
  assert.equal(pieno.payload.scope, 'pieno');
  assert.ok(!('loopCount' in pieno), 'la busta non porta più il conto dei giri');

  const chiusura = consegna({ feedback: { text: 't' }, history: storia, scope: 'chiusura', perimetro: { rilievi: [{ level: 2, text: 'Salva non salva' }], shaPrima: 'abc1234' } });
  assert.match(chiusura.instructions, /# verifica di chiusura/);
  assert.match(chiusura.instructions, /Perimetro di questo giro[\s\S]*\[2\] Salva non salva/);
  assert.ok(!/Avvertenza di serie/.test(chiusura.instructions), 'il giro stretto non invita alla ricerca larga');
  assert.equal(chiusura.payload.scope, 'chiusura');

  const riall = consegna({ feedback: { text: 't' }, scope: 'riallineamento', perimetro: { reportRebase: 'conflitto nelle schede' } });
  assert.match(riall.instructions, /# verifica dopo il riallineamento/);
  assert.match(riall.instructions, /> conflitto nelle schede/);

  const storto = consegna({ feedback: { text: 't' }, scope: 'lampo', perimetro: { rilievi: [] } });
  assert.match(storto.instructions, /# verifica piena/, 'mai meno verifica per un valore storto');
  assert.ok(!/Perimetro di questo giro/.test(storto.instructions));
  assert.match(storto.err, /ambito di verifica sconosciuto/);
});

// ─── teardown ─────────────────────────────────────────────────────────────────

// ─── Ruolo unico resolver + contratto comune (SPEC-RIDISEGNO-MAX.md §12) ──────

test('buildPayload: ogni caso di lavorazione si dichiara, e combacia col testo che riceve', () => {
  const nw = buildPayload({ role: 'new-work', id: 'a', num: '7' }, { feedback: { text: 't' } });
  assert.equal(nw.case, 'primo-passaggio');
  const fx = buildPayload(
    { role: 'fixer', id: 'a', num: '7', branch: 'worker/a', serverCritique: 'si rompe X' },
    { feedback: { text: 't' } },
  );
  assert.equal(fx.case, 'riallineamento');
  assert.equal(fx.verifierCritique, undefined, 'la consegna non può dire il contrario del testo di ruolo');
});

test('readRoleInstructions: ai ruoli lavoranti viene ACCODATO il contratto comune', () => {
  // Prima il contratto viveva copiato byte-per-byte in fondo a ogni file-ruolo,
  // e le copie divergevano: ora è un file solo, accodato da dispatch.
  const dir = resolve(TMP, 'routines', 'roles');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'resolver.md'), '# ruolo resolver\ncorpo del ruolo\n');
  writeFileSync(resolve(dir, 'resolver-rebase.md'), '# ruolo rebase\n<!-- includi: _pezzo.md -->\n');
  writeFileSync(resolve(dir, '_pezzo.md'), 'pezzo condiviso\n');
  writeFileSync(resolve(dir, 'halt.md'), '# guasto\nfermati\n');
  writeFileSync(resolve(dir, '_contratto-worker.md'), '# Contratto comune dei worker\nregole\n');
  const nw = readRoleInstructions('new-work');
  assert.ok(nw.includes('# ruolo resolver'), 'new-work riceve le istruzioni del resolver');
  assert.ok(nw.includes('# Contratto comune dei worker'), 'col contratto accodato in fondo');
  const fx = readRoleInstructions('fixer');
  assert.ok(fx.includes('# ruolo rebase') && !fx.includes('# ruolo resolver'), 'fixer riceve SOLO il testo del suo caso');
  assert.ok(fx.includes('pezzo condiviso') && !fx.includes('includi:'), 'i pezzi condivisi vengono espansi');
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
  for (const f of ['orchestrator.md', 'resolver.md', 'resolver-rebase.md', '_criteri-verifica.md', '_segnala.md', 'verifier.md', 'secaudit.md', 'prober.md', 'halt.md', '_contratto-worker.md']) {
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

// Stessa ragione, altra superficie: i titoli dei test si stampano a schermo a
// OGNI esecuzione della suite, e la suite chi verifica la lancia per mestiere,
// prima di dare il pass. Un titolo che racconta il copione glielo mette davanti
// senza che lo cerchi.
//
// E il CORPO dei file non è un posto al riparo, come diceva la versione prima
// di questa: il file di uno strumento nomina il proprio file di prove, quindi
// da lì basta aprirlo e leggere la prima riga. Le formule stanno in
// `tests/helpers/formule-vietate.mjs`, che questa camminata non legge — se
// stessero qui, l'elenco sarebbe la frase che vieta (feedback #565).
test('nei file di prova non si anticipa il seguito del giro', async () => {
  const { readdirSync, readFileSync: read } = await import('node:fs');
  const { join } = await import('node:path');
  const { TITOLI, OVUNQUE } = await import('../helpers/formule-vietate.mjs');
  const TESTS = fileURLToPath(new URL('..', import.meta.url));
  const colpevoli = [];
  const cammina = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') cammina(p); continue; }
      if (!/\.(test|spec)\.mjs$/.test(e.name)) continue;
      read(p, 'utf8').split('\n').forEach((riga, i) => {
        const elenco = /^\s*(test|it)\(/.test(riga) ? TITOLI : OVUNQUE;
        if (elenco.some((r) => r.test(riga))) colpevoli.push(`${e.name}:${i + 1}: ${riga.trim().slice(0, 90)}`);
      });
    }
  };
  cammina(TESTS);
  assert.deepEqual(colpevoli, [], `righe da riscrivere (il seguito del giro non si anticipa):\n  ${colpevoli.join('\n  ')}`);
});

// Le istruzioni della correzione arrivano dal server DOPO la critica: se
// l'aiuto le anticipasse, chi verifica saprebbe come prosegue il giro prima
// ancora di scrivere i rilievi. `--help` lo legge chiunque, in qualsiasi
// momento: qui dentro non ci va (feedback #565).
test('usageText: elenca i comandi e nient\'altro', () => {
  const u = usageText().toLowerCase();
  for (const parola of ['fase 2', 'correggi', 'correzion', 'correttore']) {
    assert.ok(!u.includes(parola), `la schermata di aiuto non deve nominare "${parola}"`);
  }
});

// I tre casi CLI che prima cancellavano il promemoria, eseguiti per davvero:
// senza il fix questi assert sono rossi (il file sparisce).
test('CLI: --help, argomento sconosciuto e --ticket senza codice NON toccano il promemoria', async () => {
  const { spawnSync } = await import('node:child_process');
  const { writeTicket, ticketFile } = await import('../../scripts/lib/routine-ticket.mjs');
  const DISPATCH = fileURLToPath(new URL('../../scripts/dispatch.mjs', import.meta.url));
  const sandbox = cartellaTemporanea('filo-cli-');
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

// Verifica del 2026-09-08 su #565: registrare un esito senza motivo.
// Senza il fix questi assert sono rossi, e il peggiore è il primo: la parola
// con cui si BOCCIAVA veniva buttata via come vecchio verdetto, la critica
// arrivava vuota, e zero rilievi vale «verifica superata» — cioè una
// promozione, scritta da chi voleva bocciare.
test('CLI #565: un esito senza motivo non si registra (e «fail» da sola non promuove)', async () => {
  const { spawnSync } = await import('node:child_process');
  const DISPATCH = fileURLToPath(new URL('../../scripts/dispatch.mjs', import.meta.url));
  const sandbox = cartellaTemporanea('filo-motivo-');
  const statoDir = resolve(sandbox, 'stato');
  try {
    // La sandbox è un deposito vero: il controllo dei file fuori dai commit
    // pretende una risposta da git, e «non l'ho potuta avere» adesso è un
    // rifiuto, non un «è pulito» (verifica del giro 4 su «giri corti»). Qui si
    // provano i controlli sul TESTO della critica, quindi il deposito dev'essere
    // pulito e basta.
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: sandbox, stdio: 'ignore' });
    const env = {
      ...process.env,
      FILO_REPO_ROOT: sandbox,
      FILO_TOOLS_ROOT: sandbox,
      FILO_DISPATCH_STATE_DIR: statoDir,
      FILO_NO_BEAT: '1',
      FILO_ROUTINE_TICKET: 'biglietto-finto',
    };
    const lancia = (args) => spawnSync(process.execPath, [DISPATCH, ...args], { env, encoding: 'utf8' });
    const nienteScritto = (che) => assert.ok(!existsSync(statoDir) || !existsSync(resolve(statoDir, 'ID1.json')),
      `${che}: non deve restare niente registrato`);

    for (const parola of ['fail', 'pass', 'migliorabile']) {
      const r = lancia(['--record-verifier', 'ID1', parola]);
      assert.equal(r.status, 1, `«${parola}» da sola deve fermare`);
      assert.match(String(r.stderr), /non è più un verdetto/, `«${parola}»: va detto perché`);
      nienteScritto(parola);
      // E soprattutto col motivo scritto dopo: è il caso in cui chi scrive è
      // SICURO di aver bocciato, e prima la parola veniva inghiottita, la
      // critica arrivava senza rilievi e l'esito era «superata» (#565).
      const conMotivo = lancia(['--record-verifier', 'ID1', parola,
        'Il pulsante Salva non salva col titolo vuoto: aperta la pagina, lasciato vuoto il titolo, premuto Salva, e non succede niente.']);
      assert.equal(conMotivo.status, 1, `«${parola}» col motivo dopo deve fermare`);
      assert.match(String(conMotivo.stderr), /non è più un verdetto/);
      nienteScritto(`${parola} col motivo`);
    }
    // L'identificativo e basta: la critica è vuota, e vuota vuol dire pass.
    const nudo = lancia(['--record-verifier', 'ID1']);
    assert.equal(nudo.status, 1, 'senza critica non si registra un esito');
    nienteScritto('identificativo nudo');
    // Due parole non sono una verifica: stesso pavimento dello strumento locale.
    const corta = lancia(['--record-verifier', 'ID1', 'va bene']);
    assert.equal(corta.status, 1, 'una critica di due parole deve fermare');
    assert.match(String(corta.stderr), /troppo corta/);
    nienteScritto('critica corta');
    // Anche dalla consegna della correzione esce un esito: il report non è
    // facoltativo.
    const senzaReport = lancia(['--record-fixed', 'ID1']);
    assert.equal(senzaReport.status, 1, 'una correzione senza report deve fermare');
    assert.match(String(senzaReport.stderr), /troppo corto/);
    nienteScritto('correzione senza report');
    // Una critica vera passa i controlli e arriva al server (che qui non c'è:
    // l'esito non è più 1, ed è l'unico modo di dire che il pavimento non
    // sbarra anche la strada buona).
    const vera = lancia(['--record-verifier', 'ID1',
      'Provato ad aprire la pagina e a salvare con il titolo vuoto: funziona tutto, non ho trovato niente da segnalare.']);
    assert.notEqual(vera.status, 1, `una critica vera non è un errore d'uso: ${vera.stderr}`);
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
