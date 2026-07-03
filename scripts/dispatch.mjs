// dispatch.mjs — il dispatcher DETERMINISTICO (non-LLM) delle routine.
//
// PERCHÉ ESISTE
//   Nel ridisegno 2026-06-27 l'orchestratore decide solo SE continuare il loop,
//   non QUALE ruolo lanciare. Il "quale" lo decide QUESTO script, leggendo solo
//   lo STATO (mai testi liberi), così la scelta non è pilotabile via prompt-
//   injection. Il worker (general-purpose) lancia `node scripts/dispatch.mjs`,
//   riceve un JSON { role, payload, claim, loopCount, instructions } e DIVENTA
//   quel ruolo.
//
// PRECEDENZA DEI BUCKET (dallo stato, mai dal testo del feedback):
//   1. branch passato dal verifier ma senza secaudit            → secaudit
//   2. feedback `review` con branch, non ancora verificato      → verifier
//   3. branch con FAIL del verifier in attesa (loop < 3)        → fixer
//      └─ se loop ≥ 3 → blocca con motivo `loop` (no fixer)
//   4. c'è un todo (vincitore di next-feedback)                 → new-work
//   5. niente                                                   → prober (audit)
//
// STATO PER BRANCH (routines/state/<id>.json):
//   { id, branch, loopCount, verifierVerdict: 'pass'|'fail'|null,
//     verifierCritique, secauditDone, secauditVerdict }
//   I ruoli lo aggiornano via i sotto-comandi --record-*. Vive su git (come i
//   claim): ogni iterazione del loop è un worker fresco, quindi lo stato DEVE
//   essere persistito. La chiave è l'id Firestore (random) → nessun segnale di
//   hill-climbing.
//
// USO
//   node scripts/dispatch.mjs                          # sceglie e stampa il JSON
//   node scripts/dispatch.mjs --record-verifier <id> <pass|fail> ["critica"]
//   node scripts/dispatch.mjs --record-fixed <id>
//   node scripts/dispatch.mjs --record-secaudit <id> <pass|fail>
//   node scripts/dispatch.mjs --clear-state <id>
//
//   Exit 0 → JSON su stdout (c'è lavoro). Exit 2 → niente da fare. Exit 1 → errore.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : resolve(__dirname, '..');
// Lo stato vive accanto ai claim, sotto feedback-triage/state/ (override per i test).
const STATE_DIR = process.env.FILO_DISPATCH_STATE_DIR
  ? resolve(process.env.FILO_DISPATCH_STATE_DIR)
  : resolve(ROOT, 'feedback-triage', 'state');
const ROLES_DIR = resolve(ROOT, 'routines', 'roles');
const MAIN_BRANCH = process.env.FILO_MAIN_BRANCH || 'main';

// Quante FAIL consecutive del verifier prima di bloccare con motivo `loop`.
// Precedenza: override d'ambiente FILO_LOOP_CAP > valore scelto dall'owner nella
// tab Automazioni (doc Firestore config/automation, campo `loopCap`) > default 3.
// Range [1, 10], allineato a SN_CONST.AUTOMATION. `LOOP_CAP` qui sotto è solo il
// fallback sincrono (env o 3) usato come default dei param delle funzioni pure;
// il valore EFFETTIVO si risolve in run() con resolveLoopCap (include il remoto).
const LOOP_CAP_MIN = 1;
const LOOP_CAP_MAX = 10;
const LOOP_CAP_DEFAULT = 3;
const LOOP_CAP = (() => {
  const n = Number(process.env.FILO_LOOP_CAP);
  return Number.isFinite(n) && n > 0 ? Math.min(LOOP_CAP_MAX, Math.max(LOOP_CAP_MIN, Math.round(n))) : LOOP_CAP_DEFAULT;
})();

/**
 * Risolve il cap EFFETTIVO data la precedenza env > remoto > default, con clamp
 * nel range valido. Funzione pura (testata in tests/unit/dispatch.test.mjs).
 * @param {{ envRaw?: string|number, remote?: number|null }} src
 */
export function resolveLoopCap({ envRaw, remote } = {}) {
  const clamp = (n) => Math.min(LOOP_CAP_MAX, Math.max(LOOP_CAP_MIN, Math.round(n)));
  const env = Number(envRaw);
  if (Number.isFinite(env) && env > 0) return clamp(env);
  const rem = Number(remote);
  if (Number.isFinite(rem) && rem > 0) return clamp(rem);
  return LOOP_CAP_DEFAULT;
}

/**
 * Legge config/automation.loopCap da Firestore in modo BEST-EFFORT: serve un
 * bearer admin (il doc è admin-only), che si ricava da service account o refresh
 * token dell'owner. Se manca la credenziale o la rete fallisce, ritorna null
 * (→ si ricade sul default): non deve MAI bloccare il dispatch.
 */
async function fetchRemoteLoopCap() {
  try {
    const fa = await import('./lib/firestore-auth.mjs');
    let bearer = null;
    try {
      const sa = fa.loadServiceAccount();
      if (sa) bearer = await fa.mintAccessTokenFromSA(sa);
    } catch (_) { /* prova il refresh token */ }
    if (!bearer) {
      const rt = fa.findAdminRefreshToken();
      if (rt) { try { bearer = await fa.mintIdToken(rt); } catch (_) {} }
    }
    if (!bearer) return null; // nessuna credenziale → default
    const url = `${fa.FIRESTORE_BASE}/config/automation?key=${fa.FIREBASE_API_KEY}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
    if (!res.ok) return null;
    const json = await res.json();
    const f = json && json.fields && json.fields.loopCap;
    if (!f) return null;
    if (f.integerValue != null) return Number(f.integerValue);
    if (f.doubleValue != null) return Number(f.doubleValue);
    return null;
  } catch (_) {
    return null;
  }
}

// ─── Logica pura (esportata, testata in tests/unit/dispatch.test.mjs) ─────────

/** Stato di default per un branch in `review` senza file di stato. */
export function defaultState(id, branch) {
  return {
    id,
    branch: branch || '',
    loopCount: 0,
    verifierVerdict: null,
    verifierCritique: '',
    secauditDone: false,
    secauditVerdict: null,
  };
}

/**
 * Classifica un singolo feedback in `review` (con branch) in base al suo stato.
 * Ritorna il nome del ruolo che gli compete, oppure null se non c'è nulla da
 * fare per dispatch (es. secaudit già fatto: tocca al gate dell'orchestratore).
 *
 *   verifierVerdict null              → 'verifier'   (mai verificato, o ri-coda dopo fix)
 *   'pass' && !secauditDone           → 'secaudit'   (passato verifier, attende L4)
 *   'pass' && secauditDone            → null         (gate in mano all'orchestratore)
 *   'fail' && loopCount  < cap        → 'fixer'
 *   'fail' && loopCount >= cap        → 'blocked-loop'
 */
export function classifyReview(state, loopCap = LOOP_CAP) {
  const s = state || {};
  const v = s.verifierVerdict ?? null;
  if (v === null) return 'verifier';
  if (v === 'pass') return s.secauditDone ? null : 'secaudit';
  if (v === 'fail') return (Number(s.loopCount) || 0) >= loopCap ? 'blocked-loop' : 'fixer';
  return null;
}

// Rango di precedenza tra i ruoli "review" (più alto = scelto prima).
const REVIEW_RANK = { secaudit: 4, verifier: 3, fixer: 2, 'blocked-loop': 1 };

/**
 * Sceglie il bucket dato uno snapshot dello STATO. Funzione pura.
 *
 * @param {{ reviews: Array<{id,num,branch,state}>, todoWinner: {id,num}|null }} snapshot
 * @returns {{ role: string, id?: string, num?: string, branch?: string,
 *             loopCount?: number, state?: object }}
 *   role ∈ secaudit | verifier | fixer | blocked-loop | new-work | prober
 */
export function chooseBucket(snapshot, loopCap = LOOP_CAP) {
  const reviews = Array.isArray(snapshot?.reviews) ? snapshot.reviews : [];

  // Classifica ogni review e tieni il candidato col rango più alto.
  let best = null;
  for (const r of reviews) {
    const role = classifyReview(r.state, loopCap);
    if (!role) continue;
    const rank = REVIEW_RANK[role] || 0;
    if (!best || rank > best.rank) {
      best = { role, rank, id: r.id, num: r.num, branch: r.branch, state: r.state, loopCount: Number(r.state?.loopCount) || 0 };
    }
  }
  if (best) {
    const { rank, ...bucket } = best;
    return bucket;
  }

  // Nessun lavoro su branch in review → lavoro nuovo, poi audit.
  if (snapshot?.todoWinner?.id) {
    return { role: 'new-work', id: snapshot.todoWinner.id, num: snapshot.todoWinner.num || '' };
  }
  return { role: 'prober' };
}

// ─── Transizioni di stato (pure) ──────────────────────────────────────────────

/** Il verifier ha prodotto un verdetto. FAIL incrementa il contatore loop. */
export function applyVerifierVerdict(state, verdict, critique = '') {
  const s = { ...defaultState(state?.id, state?.branch), ...(state || {}) };
  if (verdict === 'pass') {
    s.verifierVerdict = 'pass';
  } else {
    s.verifierVerdict = 'fail';
    s.loopCount = (Number(s.loopCount) || 0) + 1;
    if (typeof critique === 'string' && critique.trim()) s.verifierCritique = critique.trim().slice(0, 4000);
  }
  return s;
}

/** Il fixer ha corretto: si ri-mette in coda per il verifier (loop invariato). */
export function applyFixed(state) {
  const s = { ...defaultState(state?.id, state?.branch), ...(state || {}) };
  s.verifierVerdict = null;
  s.verifierCritique = '';
  s.secauditDone = false;
  s.secauditVerdict = null;
  return s;
}

/** Il secaudit ha prodotto un verdetto L4. */
export function applySecaudit(state, verdict) {
  const s = { ...defaultState(state?.id, state?.branch), ...(state || {}) };
  s.secauditDone = true;
  s.secauditVerdict = verdict === 'pass' ? 'pass' : 'fail';
  return s;
}

// ─── Stato su disco ───────────────────────────────────────────────────────────

function stateFile(id) {
  return resolve(STATE_DIR, `${id}.json`);
}

export function readState(id) {
  const f = stateFile(id);
  if (!existsSync(f)) return null;
  try {
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (_) {
    return null;
  }
}

export function writeState(state) {
  if (!state || !state.id) throw new Error('writeState: stato senza id');
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFile(state.id), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function clearState(id) {
  const f = stateFile(id);
  if (existsSync(f)) rmSync(f, { force: true });
}

// ─── Payload per-ruolo + inlining del file-ruolo ──────────────────────────────

const ROLE_FILE = {
  secaudit: 'secaudit.md',
  verifier: 'verifier.md',
  fixer: 'fixer.md',
  'new-work': 'new-work.md',
  prober: 'prober.md',
};

export function readRoleInstructions(role) {
  const name = ROLE_FILE[role];
  if (!name) return '';
  const f = resolve(ROLES_DIR, name);
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

/**
 * Costruisce il payload che il worker riceve, rispettando l'ISOLAMENTO:
 *   - secaudit: SOLO il diff, MAI il feedback (isolamento strutturale).
 *   - verifier: il feedback (sintomo), MAI il diff (isolamento comportamentale).
 *   - fixer:    il feedback + la critica del verifier.
 *   - new-work: il feedback completo decifrato.
 *   - prober:   niente.
 *
 * @param {object} bucket  output di chooseBucket
 * @param {object} ctx     { diff?, feedback? } dati già raccolti dal chiamante
 */
export function buildPayload(bucket, ctx = {}) {
  switch (bucket.role) {
    case 'secaudit':
      // NESSUN campo del feedback: solo branch + diff.
      return { branch: bucket.branch, diff: ctx.diff || '', id: bucket.id, num: bucket.num };
    case 'verifier':
      // Sintomo (feedback) + branch, MAI il diff né il report del risolutore.
      return { branch: bucket.branch, id: bucket.id, num: bucket.num, feedback: ctx.feedback || null };
    case 'fixer':
      return {
        branch: bucket.branch,
        id: bucket.id,
        num: bucket.num,
        feedback: ctx.feedback || null,
        verifierCritique: bucket.state?.verifierCritique || '',
        loopCount: bucket.loopCount || 0,
      };
    case 'new-work':
      return { id: bucket.id, num: bucket.num, feedback: ctx.feedback || null };
    case 'prober':
    default:
      return {};
  }
}

// ─── git (best-effort, come negli altri script di routine) ────────────────────

function tryGit(args) {
  try { return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; }
}

function diffForBranch(branch) {
  if (!branch) return '';
  const r = tryGit(['diff', `${MAIN_BRANCH}...${branch}`]);
  return r.ok ? r.out : '';
}

// ─── Snapshot dello stato (parte di rete, thin) ───────────────────────────────

/**
 * Costruisce lo snapshot per chooseBucket:
 *   - reviews: feedback con status decifrato == 'review' e campo branch, con il
 *     loro file di stato locale.
 *   - todoWinner: { id, num } del vincitore todo (via next-feedback), o null.
 *
 * Decifra SOLO lo `status` dei candidati (per partizionare) — non il corpo:
 * il corpo lo decifra il chiamante solo per il feedback effettivamente scelto.
 */
async function buildSnapshot() {
  // Carica crypto (IIFE su globalThis) per decryptFeedbackFields.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  try {
    if (!globalThis.SN_FEEDBACK_PUBKEY) require(resolve(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
    if (!globalThis.SN_FEEDBACK_CRYPTO) require(resolve(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
  } catch (_) { /* best-effort */ }

  const { fetchOpenCandidates } = await import('./next-feedback.mjs');
  const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
  const C = globalThis.SN_FEEDBACK_CRYPTO;

  const raw = await fetchOpenCandidates();

  // Partiziona i 'review' con branch. Decifra solo lo status.
  const reviews = [];
  for (const fb of raw) {
    let status = fb.status;
    if (C?.isEncrypted?.(status)) {
      try { status = (await decryptFeedbackFields({ _id: fb._id, status })).status; }
      catch (_) { status = null; }
    }
    // Macchina a stati: l'iter di revisione vive in `revision_capability`
    // (aspetta il verifier) e `revision_security` (aspetta il secaudit).
    // `review` è il nome RITIRATO: accettato finché lo storico non è migrato.
    if (['revision_capability', 'revision_security', 'review'].includes(status)
        && typeof fb.branch === 'string' && fb.branch) {
      reviews.push({ id: fb._id, num: fb.num || fb.seq || '', branch: fb.branch, state: readState(fb._id), status });
    }
  }

  // Vincitore todo: riusa next-feedback (exit 0 = JSON vincitore, 2 = vuoto).
  let todoWinner = null;
  try {
    const out = execFileSync('node', [resolve(ROOT, 'scripts', 'next-feedback.mjs')], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const winner = JSON.parse(out);
    todoWinner = { id: winner._id, num: winner.num || winner.seq || '', _full: winner };
  } catch (_) {
    todoWinner = null; // exit !=0 → coda vuota o errore: trattato come "nessun todo"
  }

  return { reviews, todoWinner };
}

// ─── Sotto-comandi --record-* (li chiamano i ruoli) ──────────────────────────

function recordVerifier(id, verdict, critique) {
  const next = applyVerifierVerdict({ ...defaultState(id, ''), ...(readState(id) || {}), id }, verdict, critique);
  next.id = id;
  writeState(next);
  return next;
}
function recordFixed(id) {
  const next = applyFixed({ ...(readState(id) || defaultState(id, '')), id });
  next.id = id;
  writeState(next);
  return next;
}
function recordSecaudit(id, verdict) {
  const next = applySecaudit({ ...(readState(id) || defaultState(id, '')), id }, verdict);
  next.id = id;
  writeState(next);
  return next;
}

// ─── run() — il comando di default ────────────────────────────────────────────

export async function run() {
  const snapshot = await buildSnapshot();
  // Cap EFFETTIVO: env > config/automation (scelto dall'owner) > default.
  const cap = resolveLoopCap({ envRaw: process.env.FILO_LOOP_CAP, remote: await fetchRemoteLoopCap() });
  const bucket = chooseBucket(snapshot, cap);

  // blocked-loop: dispatch stesso accoda `design` con motivo loop (spec §5:
  // il fix fallito 3× è uno dei sotto-casi di design — decide l'owner), pulisce
  // lo stato, e ri-sceglie il prossimo bucket (non c'è un worker per questo).
  if (bucket.role === 'blocked-loop') {
    // Il motivo `loop` viaggia sia nel testo della nota (leggibile dall'owner,
    // con l'ultima critica del verifier come chiede la spec) sia come campo
    // strutturato `--reason loop` → `statusReason` sul doc (sottotesto in
    // dashboard).
    const note = `Fix fermato dopo ${bucket.loopCount} verifiche fallite (loop). Ultima critica: ${bucket.state?.verifierCritique || '—'}`;
    try {
      execFileSync('node', [resolve(ROOT, 'scripts', 'queue-triage.mjs'), bucket.id, 'design', note, '--branch', bucket.branch, '--reason', 'loop'],
        { cwd: ROOT, encoding: 'utf8', stdio: 'ignore' });
    } catch (_) { /* la nota resta in coda al prossimo giro */ }
    clearState(bucket.id);
    // Ricostruisci lo snapshot senza questo feedback e ri-scegli.
    const next = { reviews: snapshot.reviews.filter((r) => r.id !== bucket.id), todoWinner: snapshot.todoWinner };
    return finalizeBucket(chooseBucket(next, cap), next, cap);
  }

  return finalizeBucket(bucket, snapshot, cap);
}

// Raccoglie il payload (diff/feedback), fa il claim per i bucket feedback-bound,
// e stampa il JSON. Ritorna { exit }. `cap` è il loop cap effettivo (per le
// ri-scelte dopo un claim già preso).
async function finalizeBucket(bucket, snapshot, cap = LOOP_CAP) {
  if (bucket.role === 'prober') {
    emit(bucket, {});
    return { exit: 0 };
  }

  // Claim per i bucket legati a un feedback (mai per prober).
  if (bucket.id) {
    const { acquire } = await import('./claim-feedback.mjs');
    const res = acquire(bucket.id, { num: bucket.num });
    if (res.status === 'taken') {
      // Già in lavorazione da un'altra routine: escludilo e ri-scegli.
      const next = { reviews: snapshot.reviews.filter((r) => r.id !== bucket.id), todoWinner: snapshot.todoWinner?.id === bucket.id ? null : snapshot.todoWinner };
      return finalizeBucket(chooseBucket(next, cap), next, cap);
    }
    // Macchina a stati (spec §6): il claim su git è il lock PRIMARIO; lo status
    // `working` è il suo riflesso persistito per la dashboard. Solo per la
    // presa in carico di un lavoro nuovo (todo→working): i bucket dell'iter di
    // revisione hanno già il loro status revision_*.
    if (bucket.role === 'new-work') {
      try {
        execFileSync('node', [resolve(ROOT, 'scripts', 'queue-triage.mjs'), bucket.id, 'working', ''],
          { cwd: ROOT, encoding: 'utf8', stdio: 'ignore' });
      } catch (_) { /* best-effort: il lock vero è il claim */ }
    }
  }

  // Raccogli il contesto specifico del ruolo (rispettando l'isolamento).
  const ctx = {};
  if (bucket.role === 'secaudit') {
    ctx.diff = diffForBranch(bucket.branch);
  } else if (bucket.role === 'verifier' || bucket.role === 'fixer') {
    ctx.feedback = await decryptOne(bucket.id);
  } else if (bucket.role === 'new-work') {
    ctx.feedback = snapshot.todoWinner?._full || (await decryptOne(bucket.id));
  }

  emit(bucket, ctx);
  return { exit: 0 };
}

// Decifra il corpo completo di UN feedback (per verifier/fixer/new-work).
async function decryptOne(id) {
  try {
    const { fetchOpenCandidates } = await import('./next-feedback.mjs');
    const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
    const raw = await fetchOpenCandidates();
    const doc = raw.find((d) => d._id === id);
    return doc ? await decryptFeedbackFields(doc) : null;
  } catch (_) {
    return null;
  }
}

function emit(bucket, ctx) {
  const payload = buildPayload(bucket, ctx);
  const out = {
    role: bucket.role,
    payload,
    claim: bucket.id || null,
    loopCount: bucket.loopCount || 0,
    instructions: readRoleInstructions(bucket.role),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const isMainModule = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const argv = process.argv.slice(2);
  const flag = argv[0];

  try {
    if (flag === '--record-verifier') {
      const [, id, verdict, ...rest] = argv;
      if (!id || !['pass', 'fail'].includes(verdict)) { console.error('Uso: --record-verifier <id> <pass|fail> ["critica"]'); process.exit(1); }
      const s = recordVerifier(id, verdict, rest.join(' '));
      console.log(`stato ${id}: verifier=${s.verifierVerdict} loop=${s.loopCount}`);
      process.exit(0);
    } else if (flag === '--record-fixed') {
      const id = argv[1];
      if (!id) { console.error('Uso: --record-fixed <id>'); process.exit(1); }
      const s = recordFixed(id);
      console.log(`stato ${id}: ri-messo in coda verifier (loop=${s.loopCount})`);
      process.exit(0);
    } else if (flag === '--record-secaudit') {
      const [, id, verdict] = argv;
      if (!id || !['pass', 'fail'].includes(verdict)) { console.error('Uso: --record-secaudit <id> <pass|fail>'); process.exit(1); }
      const s = recordSecaudit(id, verdict);
      console.log(`stato ${id}: secaudit=${s.secauditVerdict}`);
      process.exit(0);
    } else if (flag === '--clear-state') {
      const id = argv[1];
      if (!id) { console.error('Uso: --clear-state <id>'); process.exit(1); }
      clearState(id);
      console.log(`stato ${id}: rimosso`);
      process.exit(0);
    } else {
      // Default: sceglie il bucket e stampa il JSON.
      run().then((r) => process.exit(r?.exit ?? 0)).catch((e) => {
        process.stderr.write(`[dispatch] errore fatale: ${e.message}\n`);
        process.exit(1);
      });
    }
  } catch (e) {
    console.error('[dispatch] errore:', e.message);
    process.exit(1);
  }
}
