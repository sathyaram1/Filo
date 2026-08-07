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
//   0. secaudit FAIL mai scalato a `design`                     → design (inline)
//   1. branch passato dal verifier ma senza secaudit            → secaudit
//   2. feedback `review` con branch, non ancora verificato      → verifier
//   3. branch con FAIL del verifier in attesa (loop < 3)        → fixer
//      └─ se loop ≥ 3 → blocca con motivo `loop` (no fixer)
//   4. c'è un todo (vincitore di next-feedback)                 → new-work
//   5. niente                                                   → prober (audit)
//
// ROBUSTEZZA (2026-07-11, feedback owner sui #310+): un guasto transitorio nella
// lettura dello stato (rete Firestore, next-feedback morto) NON deve far
// "sembrare vuota" una coda piena: si ritenta più volte prima di ripiegare su
// prober. Il prober resta il fallback finale (scelta owner: meglio un audit di
// un giro a vuoto), ma solo dopo aver provato davvero a trovare lavoro. Inoltre
// lo stato locale viene RICONCILIATO con lo status persistito (vedi
// reconcileState): un file di stato stantio non incaglia più il feedback.
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
//   node scripts/dispatch.mjs --preflight               # prontezza (prima del setup)
//   node scripts/dispatch.mjs --record-verifier <id> <pass|fail> ["critica"]
//   node scripts/dispatch.mjs --record-fixed <id> ["report"]
//   node scripts/dispatch.mjs --record-secaudit <id> <pass|fail>
//   node scripts/dispatch.mjs --clear-state <id>
//
//   Exit 0 → JSON su stdout (c'è lavoro). Exit 2 → niente da fare. Exit 1 → errore.
//   Exit 3 → GUASTO: non si può lavorare in sicurezza (vedi ROUTINE-BRANCH-INTEGRITY.md §E).
//
// INTEGRITÀ DEL RAMO (2026-08-07, ROUTINE-BRANCH-INTEGRITY.md)
//   dispatch non si limita più a DIRE su quale branch lavorare: ci mette lui
//   l'istanza (prepareBranch), con nomi unici per tentativo, fail-closed, e
//   ripristinando il branch all'ultimo punto fermo se l'istanza precedente è
//   stata interrotta. Ogni --record-* ricalcola l'identità della directory e
//   RIFIUTA la transizione se non corrisponde al branch assegnato.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareBranch, newWorkBranch, preferredBase, checkDelivery, withCheckpoint,
  lastCheckpoint, bumpRejects, clearRejects, headSha, currentBranch,
  writeExpectation, clearExpectation, stateDir,
} from './lib/branch-integrity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : resolve(__dirname, '..');
// Lo stato vive accanto ai claim, sotto feedback-triage/state/ (override per i test).
const STATE_DIR = stateDir(ROOT);
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
 * Ricava SILENZIOSAMENTE un bearer admin (service account o refresh token
 * dell'owner) senza stampare nulla né uscire dal processo — diversamente da
 * `firestore-auth.acquireBearer`, che logga ed esce se manca la credenziale.
 * Ritorna { fa, bearer } (bearer null se nessuna credenziale/errore). Best-
 * effort: non deve MAI far fallire il dispatch. Riusato dalla lettura del loop
 * cap e dalla scrittura del log dei worker.
 */
async function acquireBearerSilent() {
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
  return { fa, bearer };
}

/**
 * Legge config/automation.loopCap da Firestore in modo BEST-EFFORT: serve un
 * bearer admin (il doc è admin-only), che si ricava da service account o refresh
 * token dell'owner. Se manca la credenziale o la rete fallisce, ritorna null
 * (→ si ricade sul default): non deve MAI bloccare il dispatch.
 */
async function fetchRemoteLoopCap() {
  try {
    const { fa, bearer } = await acquireBearerSilent();
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

// Encoder minimale JS → valore Firestore REST (solo i tipi che ci servono).
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, vv] of Object.entries(v)) fields[k] = toFsValue(vv);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

/**
 * Registra un worker appena spawnato nel log (config/automation.workerLog).
 * BEST-EFFORT: un guasto (nessuna credenziale, rete giù, Firestore lento) NON
 * deve mai far fallire né rallentare oltre soglia il dispatch — il log è pura
 * osservabilità per la dashboard dell'owner. Legge il log corrente, accoda
 * { role, startedAt, num } e ri-scrive cappato a WORKER_LOG_CAP. Timeout duro
 * così una rete impiccata non tiene in vita il processo del worker.
 * NB: i worker delle routine girano UNO alla volta (l'orchestratore ne spawna
 * uno per giro), quindi il read-modify-write qui è privo di corse.
 */
async function recordWorkerSpawn(bucket, timeoutMs = 4000) {
  try {
    const entry = {
      role: String(bucket?.role || ''),
      startedAt: new Date().toISOString(),
      num: bucket?.num != null ? String(bucket.num) : '',
    };
    if (!entry.role) return;
    const work = (async () => {
      const { fa, bearer } = await acquireBearerSilent();
      if (!bearer) return; // nessuna credenziale admin → niente log (best-effort)
      const auth = { Authorization: `Bearer ${bearer}` };
      // Leggi il log corrente (best-effort: 404/mancante ⇒ lista vuota).
      let current = [];
      try {
        const getUrl = `${fa.FIRESTORE_BASE}/config/automation?key=${fa.FIREBASE_API_KEY}`;
        const res = await fetch(getUrl, { headers: auth });
        if (res.ok) {
          const json = await res.json();
          const arr = json?.fields?.workerLog?.arrayValue?.values;
          if (Array.isArray(arr)) {
            current = arr.map((v) => {
              const f = v?.mapValue?.fields || {};
              return {
                role: f.role?.stringValue || '',
                startedAt: f.startedAt?.stringValue || '',
                num: f.num?.stringValue || '',
              };
            });
          }
        }
      } catch (_) { /* niente log precedente → riparti da vuoto */ }
      const next = appendWorkerLog(current, entry, WORKER_LOG_CAP);
      // PATCH solo il campo workerLog (updateMask): non tocca enabled/loopCap.
      const patchUrl = `${fa.FIRESTORE_BASE}/config/automation?updateMask.fieldPaths=workerLog&key=${fa.FIREBASE_API_KEY}`;
      await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ fields: { workerLog: toFsValue(next) } }),
      });
    })();
    let timer;
    const guard = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    await Promise.race([work, guard]);
    clearTimeout(timer);
  } catch (_) {
    // best-effort assoluto: qualunque errore è silenzioso.
  }
}

// Quante voci del log dei worker conservare (le più recenti). Deve restare
// allineato a SN_CONST.AUTOMATION.WORKER_LOG_CAP (src/shared/constants.js): il
// log vive come campo del doc config/automation, cappato per non gonfiarlo.
const WORKER_LOG_CAP = 200;

// ─── Logica pura (esportata, testata in tests/unit/dispatch.test.mjs) ─────────

/**
 * Accoda una voce al log dei worker e tiene solo le `cap` PIÙ RECENTI. Pura
 * (testata in tests/unit/dispatch.test.mjs). Le voci arrivano in ordine
 * cronologico (append in coda); il cap taglia le più vecchie dalla testa, così
 * il documento non cresce all'infinito. Ignora voci malformate.
 */
export function appendWorkerLog(entries, entry, cap = WORKER_LOG_CAP) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
  if (entry && typeof entry === 'object' && entry.role) list.push(entry);
  const n = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : WORKER_LOG_CAP;
  return list.length > n ? list.slice(list.length - n) : list;
}

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
 *   'pass' && secauditDone && 'fail'  → 'blocked-secaudit' (bocciato ma mai scalato)
 *   'pass' && secauditDone            → null         (gate in mano all'orchestratore)
 *   'fail' && loopCount  < cap        → 'fixer'
 *   'fail' && loopCount >= cap        → 'blocked-loop'
 */
export function classifyReview(state, loopCap = LOOP_CAP) {
  const s = state || {};
  const v = s.verifierVerdict ?? null;
  if (v === null) return 'verifier';
  if (v === 'pass') {
    if (!s.secauditDone) return 'secaudit';
    // Rete di sicurezza: dopo un FAIL del secaudit il ruolo deve scalare a
    // `design` (decide l'owner), ma se il worker se lo dimentica il feedback
    // resterebbe incagliato PER SEMPRE (nessun ruolo lo riprenderebbe: è il
    // caso reale del #289.9, fermo dal 2026-07-07). Lo scala dispatch stesso.
    return s.secauditVerdict === 'fail' ? 'blocked-secaudit' : null;
  }
  if (v === 'fail') return (Number(s.loopCount) || 0) >= loopCap ? 'blocked-loop' : 'fixer';
  return null;
}

/**
 * Riconcilia il file di stato locale con lo STATUS persistito su Firestore (la
 * verità che vede l'owner in dashboard). Caso reale (#289.9): il secaudit
 * boccia, un fixer rilavora il branch e ri-accoda `revision_capability`, ma
 * dimentica `--record-fixed` → lo stato dice ancora "verificato e bocciato" e
 * dispatch salterebbe il feedback per sempre, mentre la dashboard mostra
 * "in attesa di un verificatore". Se lo status dice che il feedback aspetta il
 * verifier ma lo stato è rimasto a un ciclo GIÀ CONCLUSO (secaudit fatto), si
 * riparte come dopo un fix registrato: verdetti azzerati, loopCount conservato.
 * Pura e idempotente: il reset non va persistito, ogni run lo ricalcola.
 * NB: status `revision_capability` + stato {pass, secauditDone:false} NON è
 * divergenza, è il normale lag della coda triage (verifier appena passato):
 * lo stato è più avanti dello status e comanda lui → 'secaudit'.
 */
export function reconcileState(state, status) {
  if (!state) return state;
  if (status === 'revision_capability' && state.verifierVerdict === 'pass' && state.secauditDone) {
    return applyFixed(state);
  }
  return state;
}

// Rango di precedenza tra i ruoli "review" (più alto = scelto prima).
// `blocked-*` sono escalation gestite INLINE da dispatch (nessun worker):
// costano zero, quindi si sbrigano per prime.
const REVIEW_RANK = { 'blocked-secaudit': 5, secaudit: 4, verifier: 3, fixer: 2, 'blocked-loop': 1 };

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

// ─── Persistenza su git del file di stato (mirror di claim-feedback.mjs) ──────
//
// I record-* scrivono il file di stato con writeState (fs), ma NON lo committano:
// prima si affidavano all'hook di auto-commit. Quell'hook però scatta SOLO su
// Edit|Write|NotebookEdit, MAI su Bash (vedi .claude/settings.local.json). Un
// verifier/secaudit è di sola lettura: non fa alcun Edit/Write, lancia
// `--record-*` via Bash, e la sua scrittura resta NON committata → il primo
// `git reset`/rebase la cancella. Risultato: il verdetto va perso e dispatch
// re-instrada all'infinito lo STESSO feedback al verifier (incident #289,
// 2026-07-11: due verifier PASS di fila mai persistiti). Quindi ogni record-*
// committa e pusha il PROPRIO file di stato su origin/main, esattamente come i
// claim (che infatti atterrano puliti su main). Best-effort: un guasto git non
// deve mai far fallire il record (lo stato locale resta scritto comunque).
// Nota: `tryGit` è definita più sotto (§ git) e riusata qui.
export function persistStateToGit(id, message) {
  // Nei test la STATE_DIR è sovrascritta (FILO_DISPATCH_STATE_DIR): lì non si
  // tocca git — lo stato è un file temporaneo, non il repo reale.
  if (process.env.FILO_DISPATCH_STATE_DIR) return;
  const rel = relative(ROOT, stateFile(id)).split(sep).join('/');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!tryGit(['add', '--', rel]).ok) return;
    // Niente in stage per questo file → già allineato, nulla da pushare.
    if (tryGit(['diff', '--cached', '--quiet', '--', rel]).ok) return;
    if (!tryGit(['commit', '-q', '-m', message, '--', rel]).ok) return;
    // Push ff-only su origin/main, come i claim. Se rifiutato, main è avanzato:
    // riconcilio con un rebase (tocca solo questo file → nessun conflitto) e
    // ritento. Se il rebase fallisce, abortisco e mollo: il commit locale resta.
    if (tryGit(['push', 'origin', `HEAD:${MAIN_BRANCH}`]).ok) return;
    if (!tryGit(['pull', '--rebase', 'origin', MAIN_BRANCH]).ok) { tryGit(['rebase', '--abort']); return; }
  }
}

// ─── Payload per-ruolo + inlining del file-ruolo ──────────────────────────────

const ROLE_FILE = {
  secaudit: 'secaudit.md',
  verifier: 'verifier.md',
  fixer: 'fixer.md',
  'new-work': 'new-work.md',
  prober: 'prober.md',
  halt: 'halt.md',
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
    case 'halt':
      // Guasto: nessun lavoro, solo il motivo per cui non si può lavorare.
      return { kind: bucket.kind || 'transient', message: bucket.message || '' };
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
  // La base del confronto DEVE essere lo stato REMOTO di main. In cloud il clone
  // è shallow e il ref locale `main` non viene mai aggiornato (l'orchestratore fa
  // `pull --rebase origin main` sul branch driver `claude/*`, non fa avanzare il
  // ref `main`), quindi un `git diff main...branch` userebbe un main vecchio di
  // decine di versioni: il diff si gonfia con modifiche GIÀ in main e fa scattare
  // falsi positivi L5/secaudit (file sensibili "toccati" che in realtà erano già
  // su main). merge-gate.mjs infatti fetcha origin e confronta con origin/target;
  // qui allineiamo la stessa logica per il diff che alimenta il secaudit.
  tryGit(['fetch', 'origin', MAIN_BRANCH]);
  const base = tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${MAIN_BRANCH}`]).ok
    ? `origin/${MAIN_BRANCH}`
    : MAIN_BRANCH;
  // Il branch può esistere solo su origin (worker/* pushato ma non in locale).
  const ref = tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok
    ? branch
    : (tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]).ok
        ? `origin/${branch}`
        : branch);
  const r = tryGit(['diff', `${base}...${ref}`]);
  return r.ok ? r.out : '';
}

// ─── Retry (esportato, testato in tests/unit/dispatch.test.mjs) ───────────────

/**
 * Ritenta `fn` fino a `attempts` volte con backoff lineare. Un guasto
 * transitorio (rete verso Firestore, sottoprocesso morto) non deve far
 * "sembrare vuota" una coda piena: prima dei #310+ un singolo errore
 * inghiottito bastava a saltare decine di todo e mandare il giro in audit.
 * Dopo l'ultimo tentativo rilancia l'errore: decide il CHIAMANTE il fallback.
 */
export async function withRetry(fn, label = 'operazione', { attempts = 3, baseDelayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      process.stderr.write(`[dispatch] ${label} fallita (tentativo ${i}/${attempts}): ${e?.message || e}\n`);
      if (i < attempts) await new Promise((r) => setTimeout(r, baseDelayMs * i));
    }
  }
  throw lastErr;
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
  const { decryptFeedbackFields, PLACEHOLDER } = await import('./lib/decrypt-feedback-fields.mjs');
  const C = globalThis.SN_FEEDBACK_CRYPTO;

  // Retry: un errore transitorio qui azzererebbe reviews E todo insieme,
  // mandando il giro in prober con la coda piena (il pattern dei #310+).
  const raw = await withRetry(() => fetchOpenCandidates(), 'fetch dei feedback aperti');

  // Pulizia appunti orfani: un file di stato il cui feedback non è più aperto
  // (chiuso/archiviato) è spazzatura che può solo generare divergenze (vedi
  // reconcileState). Il feedback su Firestore NON viene toccato.
  if (raw.length) {
    try {
      const openIds = new Set(raw.map((fb) => fb._id));
      for (const f of readdirSync(STATE_DIR)) {
        if (!f.endsWith('.json')) continue;
        const id = f.slice(0, -'.json'.length);
        if (!openIds.has(id)) clearState(id);
      }
    } catch (_) { /* STATE_DIR assente: niente da pulire */ }
  }

  // Partiziona i 'review' con branch. Decifra solo lo status.
  const reviews = [];
  let unreadable = 0;
  for (const fb of raw) {
    let status = fb.status;
    if (C?.isEncrypted?.(status)) {
      try { status = (await decryptFeedbackFields({ _id: fb._id, status })).status; }
      catch (_) { status = null; }
      if (status === PLACEHOLDER) { unreadable++; status = null; }
    }
    // Macchina a stati: l'iter di revisione vive in `revision_capability`
    // (aspetta il verifier) e `revision_security` (aspetta il secaudit).
    // `review` è il nome RITIRATO: accettato finché lo storico non è migrato.
    if (['revision_capability', 'revision_security', 'review'].includes(status)
        && typeof fb.branch === 'string' && fb.branch) {
      reviews.push({ id: fb._id, num: fb.num || fb.seq || '', branch: fb.branch, state: reconcileState(readState(fb._id), status), status });
    }
  }
  if (unreadable) {
    process.stderr.write(`[dispatch] ATTENZIONE: ${unreadable} status non decifrabili (chiave privata assente o rotta?): la coda può sembrare vuota per errore, non perché lo sia\n`);
  }

  // Vincitore todo: riusa next-feedback (exit 0 = JSON vincitore, 2 = vuoto).
  // Retry sugli errori VERI (exit 1, crash): senza, un guasto momentaneo
  // scarta l'intera coda todo. Exit 2 = coda davvero vuota → nessun retry.
  let todoWinner = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = execFileSync('node', [resolve(ROOT, 'scripts', 'next-feedback.mjs')], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
      const winner = JSON.parse(out);
      todoWinner = { id: winner._id, num: winner.num || winner.seq || '', _full: winner };
      break;
    } catch (e) {
      if (e?.status === 2) break; // coda todo legittimamente vuota
      process.stderr.write(`[dispatch] next-feedback fallito (tentativo ${attempt}/3): ${e?.message || e}\n`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  return { reviews, todoWinner };
}

// ─── Sotto-comandi --record-* (li chiamano i ruoli) ──────────────────────────

// Riflesso della macchina a stati (best-effort): l'esito del verifier muove lo
// status persistito, così la dashboard vede l'iter avanzare senza aspettare i
// report dei ruoli. Il lock/iter vero resta nei file di stato locali.
function queueStatus(id, status, note = '', reason = '') {
  try {
    const args = [resolve(ROOT, 'scripts', 'queue-triage.mjs'), id, status, note];
    if (reason) args.push('--reason', reason);
    execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', stdio: 'ignore' });
  } catch (_) { /* best-effort */ }
}

/**
 * Nota per la chat del feedback con l'esito del verifier. PURA (testata in
 * tests/unit/dispatch.test.mjs). Prima l'esito viveva SOLO nel file di stato su
 * git e l'owner non lo vedeva mai in dashboard: ora ogni verdetto (pass e fail)
 * finisce nelle note, così la conversazione del feedback racconta l'intero iter.
 */
export function verifierNoteText(verdict, critique = '') {
  // Il ruolo scrive la critica come "PASS — …"/"FAIL — …": il prefisso è
  // ridondante col nostro incipit, toglilo (resta solo la sostanza).
  const c = String(critique || '').trim().replace(/^(PASS|FAIL)\s*[—–:\-]\s*/i, '').slice(0, 4000);
  if (verdict === 'pass') {
    return c ? `Controllo funzionalità superato. ${c}` : 'Controllo funzionalità superato.';
  }
  return c ? `Controllo funzionalità NON superato: ${c}` : 'Controllo funzionalità NON superato.';
}

function recordVerifier(id, verdict, critique) {
  const next = applyVerifierVerdict({ ...defaultState(id, ''), ...(readState(id) || {}), id }, verdict, critique);
  next.id = id;
  writeState(next);
  persistStateToGit(id, `feedback: verifier ${verdict} ${id}`);
  // PASS → aspetta l'audit di sicurezza; FAIL → resta/torna in verifica fix
  // (il caso 3° FAIL → design lo gestisce il giro dopo: chooseBucket →
  // blocked-loop). Idempotente se lo status è già quello. La nota con l'esito
  // va nella chat del feedback (apply-triage la appende come turno, senza
  // sovrascrivere lo storico).
  queueStatus(id, verdict === 'pass' ? 'revision_security' : 'revision_capability',
    verifierNoteText(verdict, critique));
  return next;
}
function recordFixed(id, report = '') {
  const next = applyFixed({ ...(readState(id) || defaultState(id, '')), id });
  next.id = id;
  writeState(next);
  persistStateToGit(id, `feedback: fixed ${id}`);
  // Fix ri-applicato → torna in attesa della verifica comportamentale. Il
  // report del fixer (cosa ha corretto e come) va nella chat del feedback,
  // come per verifier e new-work: senza, la correzione è invisibile all'owner.
  queueStatus(id, 'revision_capability', String(report || ''));
  return next;
}
function recordSecaudit(id, verdict) {
  const next = applySecaudit({ ...(readState(id) || defaultState(id, '')), id }, verdict);
  next.id = id;
  writeState(next);
  persistStateToGit(id, `feedback: secaudit ${verdict} ${id}`);
  return next;
}

// ─── run() — il comando di default ────────────────────────────────────────────

export async function run() {
  let snapshot;
  try {
    snapshot = await buildSnapshot();
  } catch (e) {
    // Lo stato è illeggibile anche dopo i retry. Per scelta dell'owner NON ci
    // si ferma (un giro a vuoto non risolve nulla): si ripiega sull'audit,
    // lasciando in stderr la traccia del guasto vero per il debugging.
    process.stderr.write(`[dispatch] stato illeggibile anche dopo i retry (${e?.message || e}) → fallback prober\n`);
    const proberBucket = { role: 'prober' };
    emit(proberBucket, {});
    await recordWorkerSpawn(proberBucket);
    return { exit: 0 };
  }
  // Cap EFFETTIVO: env > config/automation (scelto dall'owner) > default.
  const cap = resolveLoopCap({ envRaw: process.env.FILO_LOOP_CAP, remote: await fetchRemoteLoopCap() });
  let bucket = chooseBucket(snapshot, cap);

  // Escalation gestite inline da dispatch (nessun worker da spawnare): accodano
  // `design` (decide l'owner), puliscono lo stato e si ri-sceglie. In loop:
  // possono essercene più d'una in attesa nello stesso snapshot.
  //   - blocked-loop: fix fallito `cap` volte (spec §5). Motivo `loop` sia nella
  //     nota (con l'ultima critica del verifier) sia come `--reason` strutturato
  //     → `statusReason` sul doc (sottotesto in dashboard).
  //   - blocked-secaudit: il controllo di sicurezza ha bocciato ma il worker
  //     non ha scalato a `design` come da recipe → lo fa dispatch (senza, il
  //     feedback resta incagliato per sempre).
  let guard = 0;
  while ((bucket.role === 'blocked-loop' || bucket.role === 'blocked-secaudit') && guard++ < 50) {
    const isLoop = bucket.role === 'blocked-loop';
    const note = isLoop
      ? `Fix fermato dopo ${bucket.loopCount} verifiche fallite (loop). Ultima critica: ${bucket.state?.verifierCritique || '—'}`
      : 'Il controllo di sicurezza ha bocciato questa modifica e la pratica era rimasta in sospeso senza che nessuno la portasse alla tua attenzione: serve una tua decisione su come procedere.';
    try {
      execFileSync('node', [resolve(ROOT, 'scripts', 'queue-triage.mjs'), bucket.id, 'design', note, '--branch', bucket.branch || '', '--reason', isLoop ? 'loop' : 'secaudit'],
        { cwd: ROOT, encoding: 'utf8', stdio: 'ignore' });
    } catch (_) { /* la nota resta in coda al prossimo giro */ }
    clearState(bucket.id);
    // Ricostruisci lo snapshot senza questo feedback e ri-scegli.
    snapshot = { reviews: snapshot.reviews.filter((r) => r.id !== bucket.id), todoWinner: snapshot.todoWinner };
    bucket = chooseBucket(snapshot, cap);
  }

  return finalizeBucket(bucket, snapshot, cap);
}

// Raccoglie il payload (diff/feedback), fa il claim per i bucket feedback-bound,
// e stampa il JSON. Ritorna { exit }. `cap` è il loop cap effettivo (per le
// ri-scelte dopo un claim già preso).
async function finalizeBucket(bucket, snapshot, cap = LOOP_CAP) {
  if (bucket.role === 'prober') {
    emit(bucket, {});
    // Log del worker spawnato (best-effort): stdout è già stato scritto, quindi
    // l'orchestratore ha già il suo JSON; qui aspettiamo solo la scrittura del
    // log (cappata da un timeout) prima che il processo esca.
    await recordWorkerSpawn(bucket);
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
  await recordWorkerSpawn(bucket);
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
      const [, id, ...rest] = argv;
      if (!id) { console.error('Uso: --record-fixed <id> ["report"]'); process.exit(1); }
      const s = recordFixed(id, rest.join(' '));
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
      persistStateToGit(id, `feedback: clear-state ${id}`);
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
