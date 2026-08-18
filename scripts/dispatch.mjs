// dispatch.mjs — il dispatcher DETERMINISTICO (non-LLM) delle routine.
//
// PERCHÉ ESISTE
//   L'orchestratore decide solo SE continuare il loop, non QUALE lavoro fare:
//   il "quale" lo sceglie il SERVER (canale autenticato, ROUTINE-AUTH-SPEC.md)
//   e QUESTO script lo traduce in una consegna eseguibile, senza mai leggere
//   testi liberi — così la scelta non è pilotabile via prompt-injection. Il
//   worker (general-purpose) lancia `node scripts/dispatch.mjs --ticket <b>`,
//   riceve un JSON { role, payload, claim, loopCount, instructions } e DIVENTA
//   quel ruolo.
//
// CONTRATTO (era in ROUTINES.md, abolito col ridisegno SPEC-RIDISEGNO-MAX.md;
// è documentazione dello script, quindi vive qui):
//   - Il lavoro arriva SOLO col biglietto: `routine-channel.mjs work` consegna
//     la busta { role, id, num, branch, payload } e dispatch la VALIDA
//     (checkEnvelope: ruolo conosciuto, ramo presente per i ruoli dell'iter,
//     feedback non vuoto) — mezza busta è peggio di nessuna busta. Senza
//     biglietto: GUASTO, nessun cammino alternativo.
//   - RUOLO UNICO DI LAVORAZIONE (`resolver`): il server distingue ancora
//     `new-work` (primo passaggio) e `fixer` (correzione), ma il worker riceve
//     le stesse istruzioni (resolver.md) e il caso nel payload (`case`). I due
//     nomi restano nel protocollo del canale finché il server non li fonde.
//   - A ogni ruolo LAVORANTE viene ACCODATO il contratto comune
//     (routines/roles/_contratto-worker.md): il testo di ritorno del worker
//     non è un canale, tutto va registrato via script.
//   - PROVENIENZA (#443): la firma `routine:<ruolo>` di un feedback creato da
//     un'automazione la mette il SERVER leggendo il ruolo dal biglietto —
//     `--role` non si passa mai a mano. Il marcatore locale
//     (.claude/routine-role.json, effimero e gitignorato) resta solo come
//     traccia di chi gira in questa directory.
//   - STATO PER BRANCH (verdetti, contatore bocciature, esito sicurezza): lo
//     tiene il SERVER. Il file locale <stateDir>/<id>.json è un ripiego che si
//     riallinea a ogni busta ricevuta.
//   - INTERRUTTORE MASTER (`config/routines.enabled`): lo guarda il preflight
//     (prima del setup) e lo applica il server (niente biglietti nuovi da
//     spento). Un biglietto già emesso si porta a termine: il feedback in
//     corso finisce e viene consegnato, mai troncato (SPEC §6).
//
// INTEGRITÀ DEL RAMO (2026-08-07, ROUTINE-BRANCH-INTEGRITY.md)
//   dispatch non si limita a DIRE su quale branch lavorare: ci mette lui
//   l'istanza (prepareBranch), con nomi unici per tentativo, fail-closed, e
//   ripristinando il branch all'ultimo punto fermo se l'istanza precedente è
//   stata interrotta. Ogni --record-* ricalcola l'identità della directory e
//   RIFIUTA la transizione se non corrisponde al branch assegnato.
//
// USO
//   node scripts/dispatch.mjs --ticket <biglietto>     # traduce la busta del server
//   node scripts/dispatch.mjs --preflight               # prontezza (prima del setup)
//   node scripts/dispatch.mjs --record-verifier <id> <pass|fail> ["critica"]
//   node scripts/dispatch.mjs --record-fixed <id> ["report"] [--frase "…"]
//   node scripts/dispatch.mjs --record-secaudit <id> <pass|fail>
//   node scripts/dispatch.mjs --clear-state <id>
//
//   Exit 0 → JSON su stdout (c'è lavoro). Exit 2 → niente da fare. Exit 1 → errore.
//   Exit 3 → GUASTO: non si può lavorare in sicurezza (vedi ROUTINE-BRANCH-INTEGRITY.md §E).
//   Exit 4 (--record-*) → RIFIUTATO dal server: leggere il motivo, non aggirare.
//   `--preflight`: 0 = si lavora, e l'output CONTIENE le istruzioni
//   dell'orchestratore (routines/roles/orchestrator.md: in cloud nessuno legge
//   file di istruzioni da sé); 2 = routine spente (chiudi, non è un guasto);
//   3 = guasto. La mappatura è in `preflightExitCode`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareBranch, newWorkBranch, preferredBase, withCheckpoint,
  lastCheckpoint, clearRejects, headSha, currentBranch,
  guardTransition, escalationNote,
  writeExpectation, clearExpectation, stateDir,
} from './lib/branch-integrity.mjs';
import { writeRole, clearRole } from './lib/routine-role.mjs';
import { readTicket as readRoutineTicket, writeTicket as writeRoutineTicket, clearTicket as clearRoutineTicket } from './lib/routine-ticket.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : resolve(__dirname, '..');
// Lo stato locale e' solo un ripiego: quello vero vive sul server. Sta fra i
const STATE_DIR = stateDir(ROOT);
const ROLES_DIR = resolve(ROOT, 'routines', 'roles');
const MAIN_BRANCH = process.env.FILO_MAIN_BRANCH || 'main';

// Il documento che dice alle routine come devono comportarsi: acceso/spento,
// esplorazione a coda vuota, tentativi del loop. Leggibile SENZA credenziali
// (le regole lo aprono in lettura, la scrittura resta all'owner) — vedi
// fetchRoutineConfig per il perché.
const ROUTINES_DOC = 'config/routines';

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
 * Legge le impostazioni che l'owner detta alle routine dalla tab Automazioni.
 *
 * PERCHÉ NON È PIÙ UNA LETTURA "BEST-EFFORT" (2026-08-13)
 *   Stavano in `config/automation`, leggibile solo con un bearer admin, e la
 *   lettura era best-effort: senza credenziale si ricadeva sui default **senza
 *   dirlo**. Ma nelle macchine delle routine quella credenziale non c'è mai
 *   (è la causa del registro worker sempre vuoto, feedback #451): quindi né
 *   l'esplorazione a coda vuota né i tentativi del loop hanno MAI raggiunto una
 *   routine cloud. In dashboard sembravano attivi, nei fatti non lo erano.
 *
 *   Ora vivono in `config/routines`, che le regole rendono leggibile da chiunque
 *   e scrivibile solo dall'owner (dentro c'è solo come devono comportarsi le
 *   routine, niente di segreto). Si legge con la sola chiave pubblica: non c'è
 *   nessuna credenziale che possa mancare.
 *
 * FAIL CLOSED (scelta owner)
 *   Se il documento non si riesce a leggere — rete giù, Firestore in errore —
 *   la lettura FALLISCE dichiarandolo, e il giro si ferma. Un interruttore che
 *   in caso di dubbio lascia lavorare non è un interruttore: il prezzo è un giro
 *   saltato ogni tanto, il guadagno è che "spento" vuol dire spento.
 *   Documento mai scritto (404) NON è un dubbio: è "l'owner non ha mai toccato
 *   niente" ⇒ comportamento storico (routine accese, coi default).
 *
 * @returns {Promise<{enabled?:boolean, proberWhenIdle?:boolean, loopCap?:number}>}
 * @throws {Error} con `faultKind` se il documento non è leggibile.
 */
async function fetchRoutineConfig() {
  const fa = await import('./lib/firestore-auth.mjs');
  // `FILO_ROUTINE_CONFIG_URL`: da dove si legge l'interruttore. Esiste per i
  // controlli, che devono poter esercitare il giro intero senza rete — non è
  // un segreto e non cambia niente in produzione, dove non è impostata.
  const url = process.env.FILO_ROUTINE_CONFIG_URL
    || `${fa.FIRESTORE_BASE}/${ROUTINES_DOC}?key=${fa.FIREBASE_API_KEY}`;
  const read = async () => {
    const res = await fetch(url);
    if (res.status === 404) return {};            // mai scritto: default
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return parseRoutineConfig((json && json.fields) || {});
  };
  try {
    return await withRetry(read, `lettura di ${ROUTINES_DOC}`);
  } catch (e) {
    throw routineFault('transient', `impostazioni delle routine illeggibili (${e?.message || e}): non posso sapere se sono accese, quindi mi fermo`);
  }
}

/**
 * Traduce i campi Firestore del doc delle routine in valori JS. Pura (testata
 * in tests/unit/dispatch.test.mjs). Solo i `false` ESPLICITI spengono: campo
 * assente o di tipo sbagliato = comportamento storico.
 */
export function parseRoutineConfig(fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const out = {};
  if (f.enabled && typeof f.enabled.booleanValue === 'boolean') out.enabled = f.enabled.booleanValue;
  if (f.proberWhenIdle && f.proberWhenIdle.booleanValue === false) out.proberWhenIdle = false;
  const lc = f.loopCap;
  if (lc) {
    if (lc.integerValue != null) out.loopCap = Number(lc.integerValue);
    else if (lc.doubleValue != null) out.loopCap = Number(lc.doubleValue);
  }
  return out;
}

/**
 * L'interruttore master, risolto: `FILO_ROUTINES_ENABLED` (override locale, per
 * le prove e per le sessioni dell'owner) batte il valore remoto; assente
 * ovunque = acceso, che è il comportamento storico.
 * Pura (testata in tests/unit/dispatch.test.mjs).
 */
export function resolveRoutinesEnabled({ envRaw, remote } = {}) {
  const env = String(envRaw ?? '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(env)) return false;
  if (['1', 'true', 'on', 'yes'].includes(env)) return true;
  return remote !== false;
}

// Il log dei worker (`config/automation.workerLog`, tab Automazioni della
// dashboard) lo scrive il SERVER al rilascio di ogni biglietto (feedback #451):
// è l'unico che sa per certo che un worker sta partendo e con che ruolo, e le
// macchine delle routine non hanno credenziali Firestore. Qui non c'è più
// niente da scrivere.
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
 * @param {number} loopCap
 * @param {{ proberWhenIdle?: boolean }} opts
 *   `proberWhenIdle: false` (interruttore dell'owner, feedback #448): finito il
 *   lavoro vero il giro NON ripiega sull'esplorazione, si ferma con `idle`.
 *   Riguarda SOLO la coda vuota: il ripiego sul prober quando lo stato è
 *   illeggibile è un GUASTO travestito da audit e resta com'è (vedi run()).
 * @returns {{ role: string, id?: string, num?: string, branch?: string,
 *             loopCount?: number, state?: object }}
 *   role ∈ secaudit | verifier | fixer | blocked-loop | new-work | prober | idle
 */
export function chooseBucket(snapshot, loopCap = LOOP_CAP, opts = {}) {
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
  return { role: opts?.proberWhenIdle === false ? 'idle' : 'prober' };
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
  // new-work e fixer sono lo stesso mestiere con un punto di partenza diverso
  // (SPEC-RIDISEGNO-MAX.md §12): il server distingue ancora i due nomi nel
  // protocollo, il worker riceve UN ruolo (resolver) e il caso nel payload.
  fixer: 'resolver.md',
  'new-work': 'resolver.md',
  resolver: 'resolver.md',
  prober: 'prober.md',
  halt: 'halt.md',
};

// Il contratto comune dei worker (testo di ritorno non è un canale,
// rifiuto ≠ guasto): UNA copia, accodata qui a ogni ruolo lavorante — prima
// viveva duplicata byte-per-byte in fondo a ogni file-ruolo, e le copie
// divergevano.
const WORKER_CONTRACT_FILE = '_contratto-worker.md';

export function readRoleInstructions(role) {
  const name = ROLE_FILE[role];
  if (!name) return '';
  const f = resolve(ROLES_DIR, name);
  const base = existsSync(f) ? readFileSync(f, 'utf8') : '';
  if (!base || !RUOLI_LAVORABILI.includes(role)) return base;
  const c = resolve(ROLES_DIR, WORKER_CONTRACT_FILE);
  const contract = existsSync(c) ? readFileSync(c, 'utf8') : '';
  return contract ? `${base.replace(/\s+$/, '')}\n\n${contract}` : base;
}

/**
 * Costruisce il payload che il worker riceve, rispettando l'ISOLAMENTO:
 *   - secaudit: SOLO il diff, MAI il feedback (isolamento strutturale).
 *   - verifier: il feedback (sintomo), MAI il diff (isolamento comportamentale).
 *   - fixer    (resolver, caso `correzione`): feedback + critica del verifier.
 *   - new-work (resolver, caso `primo-passaggio`): il feedback decifrato.
 *   - prober:   niente.
 *
 * @param {object} bucket  bucket costruito dalla busta del server
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
        // È il resolver nel caso `correzione`: stesse istruzioni del primo
        // passaggio, ma parte dalla critica di chi ha bocciato.
        case: 'correzione',
        branch: bucket.branch,
        id: bucket.id,
        num: bucket.num,
        feedback: ctx.feedback || null,
        // La critica del SERVER viene prima di quella del fogliettino locale:
        // è il server che registra i verdetti, e il fogliettino sparirà con la
        // coda. Sta sul bucket e non nello stato perché lo stato viene
        // riscritto quando ci si posiziona sul ramo — ed è così che la critica
        // spariva senza che nessuno se ne accorgesse.
        verifierCritique: bucket.serverCritique || bucket.state?.verifierCritique || '',
        loopCount: bucket.loopCount || 0,
      };
    case 'new-work':
      return { case: 'primo-passaggio', id: bucket.id, num: bucket.num, feedback: ctx.feedback || null };
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
/**
 * Guasto dichiarato: "non posso lavorare in sicurezza". `kind`:
 *   - 'transient'  rete, quota, deposito irraggiungibile, coda illeggibile →
 *                  la sessione si chiude senza altri tentativi (ci riprova
 *                  l'orchestratore successivo fra 6h: nessuna logica di retry
 *                  da scrivere = nessuna logica di retry da sbagliare);
 *   - 'permanent'  il branch nello stato non esiste più → riprovare ogni 6h è
 *                  inutile: il feedback esce dal giro automatico (`design`).
 * Prima esisteva solo il fallback su prober, che traveste un guasto da
 * "giornata tranquilla" — ed è già costato un'ondata di lavoro fantasma.
 */
export function routineFault(kind, message) {
  const e = new Error(message);
  e.faultKind = kind === 'permanent' ? 'permanent' : 'transient';
  return e;
}

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
  let encrypted = 0;
  for (const fb of raw) {
    let status = fb.status;
    if (C?.isEncrypted?.(status)) {
      encrypted++;
      try { status = (await decryptFeedbackFields({ _id: fb._id, status })).status; }
      catch (_) { status = null; }
      if (status === PLACEHOLDER || status === null) { unreadable++; status = null; }
    }
    // Macchina a stati: l'iter di revisione vive in `revision_capability`
    // (aspetta il verifier) e `revision_security` (aspetta il secaudit).
    // `review` è il nome RITIRATO: accettato finché lo storico non è migrato.
    if (['revision_capability', 'revision_security', 'review'].includes(status)
        && typeof fb.branch === 'string' && fb.branch) {
      reviews.push({ id: fb._id, num: fb.num || fb.seq || '', branch: fb.branch, state: reconcileState(readState(fb._id), status), status });
    }
  }
  // Coda vuota ≠ coda illeggibile. Se NESSUNO degli status cifrati si decifra,
  // la chiave privata manca o è rotta: la coda piena "sembra vuota" e il giro
  // finisce in audit invece di lavorare (è la causa dell'ondata #310+). Non è
  // un risultato, è un GUASTO — passeggero, perché la chiave può tornare.
  // Un solo documento illeggibile fra molti resta un avviso: è corruzione di
  // quel doc, non un ambiente cieco, e fermare la flotta per sempre sarebbe peggio.
  if (encrypted && unreadable === encrypted) {
    throw routineFault('transient', `coda illeggibile: nessuno dei ${encrypted} status cifrati è decifrabile (chiave privata assente o rotta)`);
  }
  if (unreadable) {
    process.stderr.write(`[dispatch] ATTENZIONE: ${unreadable}/${encrypted} status non decifrabili: quei feedback sono invisibili a questo giro\n`);
  }

  // Vincitore todo: riusa next-feedback (exit 0 = JSON vincitore, 2 = vuoto,
  // 3 = coda ILLEGGIBILE). Retry sugli errori VERI (exit 1, crash): senza, un
  // guasto momentaneo scarta l'intera coda todo. Exit 2 = coda davvero vuota →
  // nessun retry. Exit 3 = guasto dichiarato → si propaga, non si ripiega.
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
      if (e?.status === 3) throw routineFault('transient', 'coda illeggibile: next-feedback non riesce a decifrare gli status (chiave privata assente o rotta)');
      process.stderr.write(`[dispatch] next-feedback fallito (tentativo ${attempt}/3): ${e?.message || e}\n`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  return { reviews, todoWinner };
}

// ─── Sotto-comandi --record-* (li chiamano i ruoli) ──────────────────────────

// (Qui viveva il ripiego sulla coda su git. È sparito con la coda: adesso o la
// decisione la registra il server, o non è stata registrata — e chi lavora lo
// sa, invece di credere che sia andata.)

/**
 * Consegna una decisione al canale del server (#477.2). È la strada
 * PRINCIPALE: il server legge il feedback dal biglietto, controlla ruolo, ramo
 * e macchina a stati sullo stato VERO, e scrive lui.
 *
 * Ritorna l'esito così com'è, perché la differenza fra i tre casi cambia cosa
 * si fa dopo:
 *   'ok'       → fatto, e NON si scrive anche sulla coda su git (sarebbe la
 *                stessa decisione due volte, con la seconda non controllata);
 *   'refused'  → il server ha guardato e ha detto no. Ci si FERMA, e si legge
 *                il motivo: era proprio scrivere lo stesso a dispetto del
 *                controllo il buco da cui nasce tutta questa spec;
 *   'fault'    → il server non risponde. Anche qui ci si ferma: non esiste più
 *                una seconda strada su cui posare la decisione, e dirlo ad alta
 *                voce è l'unica cosa onesta;
 *   'absent'   → nessun biglietto: non c'è un lavoro a cui riferire la consegna.
 */
async function deliverToChannel(intent, data) {
  const ticket = readRoutineTicket(ROOT);
  if (!ticket) return { outcome: 'absent' };
  try {
    const ch = await import('./routine-channel.mjs');
    const r = await ch.deliver(ticket, intent, data);
    if (r.outcome === 'fault') {
      process.stderr.write(`[dispatch] canale non raggiungibile (${r.reason}): la decisione NON è stata registrata\n`);
    } else if (r.outcome === 'refused') {
      process.stderr.write(`[dispatch] consegna RIFIUTATA dal server (${r.reason}): non ripiego, la decisione non viene registrata\n`);
    }
    return r;
  } catch (e) {
    process.stderr.write(`[dispatch] canale non utilizzabile (${e?.message || e}): la decisione NON è stata registrata\n`);
    return { outcome: 'fault', reason: String(e?.message || e) };
  }
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

/**
 * C — ogni scrittura nella macchina a stati RICALCOLA l'identità della directory
 * e rifiuta la transizione se non corrisponde al branch assegnato. Non chiede
 * all'istanza dove si trova: lo guarda.
 *
 * Un rifiuto lascia il feedback dov'era (nessuna scrittura di stato, nessuno
 * status accodato) e lo fa ripescare al giro dopo. Ma un ambiente che produce
 * disallineamenti a ripetizione non deve girare a vuoto all'infinito: al terzo
 * rifiuto il feedback va in `design`, come per i reset `working`→`todo`.
 *
 * La regola vive in `guardTransition` (branch-integrity.mjs), che è anche la
 * versione coperta dagli unit test: qui si attacca solo la consegna al canale.
 *
 * @returns {{ok:true, state:object|null}|{ok:false, message:string}}
 */
function guardIdentity(id) {
  return guardTransition(ROOT, id, {
    escalate: () => {
      deliverToChannel('status', { status: 'design', reason: 'loop', notes: escalationNote() })
        .catch(() => { /* se il server non risponde il feedback resta dov'è: lo ripesca il giro dopo */ });
    },
    clear: () => clearState(id),
  });
}

/**
 * Una transizione ACCETTATA lascia un punto fermo: l'identità del contenuto in
 * quel momento. È il valore a cui D riporta il branch dopo un'interruzione.
 * Rilascia anche l'identità attesa: dopo la consegna non c'è più niente da
 * proteggere su questo branch (ed è ciò che lascia lavorare il merge-gate).
 */
function sealTransition(state, by) {
  const sealed = clearRejects(withCheckpoint(state, headSha(ROOT), by));
  writeState(sealed);
  clearExpectation(ROOT);
  return sealed;
}

async function recordVerifier(id, verdict, critique) {
  const guard = guardIdentity(id);
  if (!guard.ok) return { rejected: true, message: guard.message };
  const next = applyVerifierVerdict({ ...defaultState(id, ''), ...(guard.state || {}), id }, verdict, critique);
  next.id = id;

  // PRIMA il server, POI lo stato locale. L'ordine non è un dettaglio: lo stato
  // locale finisce su git, e se lo si scrivesse prima, un verdetto RIFIUTATO
  // lascerebbe scritto "verificato" da una parte e niente dall'altra — con i
  // due cammini che divergono nella direzione più permissiva, che è
  // esattamente quella da cui questa spec viene a togliere l'autorità.
  const sent = await deliverToChannel('verdict', {
    verdict, critique: verifierNoteText(verdict, critique), branch: next.branch || '',
  });
  if (sent.outcome === 'refused') {
    return { rejected: true, fromChannel: true, message: `verdetto non accettato (${sent.reason})` };
  }

  if (sent.outcome !== 'ok') {
    // Il server non risponde. Non c'è più una seconda strada su cui posare il
    // verdetto: dirlo è l'unica cosa onesta, perché un verdetto che nessuno ha
    // registrato ma che il ramo dà per dato è peggio di un verdetto mancante.
    return { rejected: true, fromChannel: true, message: `verdetto non registrato: il server non risponde (${sent.reason})` };
  }
  sealTransition(next, `verifier:${verdict}`);
  return next;
}
async function recordFixed(id, report = '', frase = '') {
  const guard = guardIdentity(id);
  if (!guard.ok) return { rejected: true, message: guard.message };
  const next = applyFixed({ ...(guard.state || defaultState(id, '')), id });
  next.id = id;

  // Il server prima dello stato locale: vedi il commento in recordVerifier.
  // Due testi, due destinatari: il report lo cifra il server per l'owner, la
  // frase resta leggibile per chi ha mandato il feedback (spec §8).
  const sent = await deliverToChannel('fixed', { report: String(report || ''), userNote: String(frase || ''), branch: next.branch || '' });
  if (sent.outcome === 'refused') {
    return { rejected: true, fromChannel: true, message: `consegna non accettata (${sent.reason})` };
  }

  if (sent.outcome !== 'ok') {
    return { rejected: true, fromChannel: true, message: `consegna non registrata: il server non risponde (${sent.reason})` };
  }
  sealTransition(next, 'fixer:consegna');
  return next;
}
async function recordSecaudit(id, verdict) {
  const guard = guardIdentity(id);
  if (!guard.ok) return { rejected: true, message: guard.message };
  const next = applySecaudit({ ...(guard.state || defaultState(id, '')), id }, verdict);
  next.id = id;

  // Il server prima dello stato locale: vedi il commento in recordVerifier.
  const sent = await deliverToChannel('secaudit', { verdict, branch: next.branch || '' });
  if (sent.outcome === 'refused') {
    return { rejected: true, fromChannel: true, message: `verdetto non accettato (${sent.reason})` };
  }

  sealTransition(next, `secaudit:${verdict}`);
  // Senza canale non si accodava niente nemmeno prima: il passaggio a `done`
  // (o a `design` su bocciatura) lo fa il ruolo dopo il cancello di fusione.
  return next;
}

// ─── Prontezza (--preflight) ─────────────────────────────────────────────────

/**
 * Prontezza del giro, da eseguire PRIMA del setup dell'ambiente (npm install,
 * binario Electron ~102MB, scrot): se il giro non è in grado di lavorare, va
 * scoperto prima di aver pagato il setup.
 *
 * Non è un dispatch a vuoto: NON claima, NON emette un bucket, NON consegna
 * lavoro. Guarda solo se lo stato è leggibile — cioè le due cose che rendono
 * cieco il giro: la coda dei feedback irraggiungibile e la chiave privata
 * assente o rotta (l'ondata #310+).
 *
 * **Non è mai più severo di `run()`**, o fermerebbe giri che avrebbero
 * lavorato: si ferma solo sui guasti DICHIARATI (`faultKind`), quelli su cui
 * anche `run()` si ferma. Un guasto generico dopo i retry là ripiega
 * sull'audit, quindi qui è prontezza OK.
 *
 * PRIMA DI TUTTO guarda l'interruttore master: è il posto giusto per scoprire
 * che le routine sono spente, perché è l'unico che viene prima del setup. Un
 * giorno spento costa così quattro letture di un documento, non quattro
 * installazioni complete.
 *
 * @param {() => Promise<any>} [build] iniettabile per i test (default: snapshot vero)
 * @param {() => Promise<object>} [readConfig] iniettabile per i test
 * @returns {Promise<{ok:true}|{ok:false, kind:string, message:string}>}
 */
export async function preflight(_unused = null, readConfig = fetchRoutineConfig) {
  try {
    const cfg = await readConfig();
    if (!resolveRoutinesEnabled({ envRaw: process.env.FILO_ROUTINES_ENABLED, remote: cfg.enabled })) {
      return { ok: false, kind: 'off', message: 'le routine autonome sono spente dalla tab Automazioni' };
    }
  } catch (e) {
    if (e?.faultKind) return { ok: false, kind: e.faultKind, message: e.message };
    return { ok: false, kind: 'transient', message: `interruttore delle routine illeggibile: ${e?.message || e}` };
  }
  // Qui finisce ciò che questa macchina può ancora sapere da sola. "C'è
  // lavoro?" richiede di leggere la coda, e leggere la coda richiede la chiave
  // che apre tutti i feedback — che da qui è uscita. Quella domanda la fa
  // l'orchestratore al server (`routine-channel.mjs probe`), che è anche il
  // solo che ha la parola d'ordine per chiederlo.
  return { ok: true };
}

/**
 * L'esito della prontezza tradotto nel codice d'uscita che l'orchestratore
 * legge. È il CONTRATTO documentato in ROUTINES.md, e sta qui — pura, testata —
 * perché è la parte che si può sbagliare senza accorgersene: il ramo
 * `--preflight` è morto per mesi restituendo 1, che non è né "prosegui" né
 * "fermati", e nessuno se n'era accorto (feedback #452).
 *
 *   0 → pronto, prosegui col setup
 *   2 → routine spente dall'owner: chiudi la sessione, NON è un guasto
 *   3 → guasto: chiudi la sessione, ci riprova l'orchestratore dopo
 */
export function preflightExitCode(result) {
  if (result && result.ok) return 0;
  return result && result.kind === 'off' ? 2 : 3;
}

// ─── run() — il comando di default ────────────────────────────────────────────

/**
 * Testo per il worker quando la guardia d'identità RIFIUTA di scrivere un
 * verdetto (albero sbagliato, HEAD staccato, branch diverso da quello
 * assegnato). Il rifiuto è la cosa giusta — il verdetto non sarebbe attendibile
 * — ma va spiegato: senza, il worker vede solo un comando morto e non sa se
 * ritentare, se ha perso il lavoro, o cosa dire all'orchestratore.
 *
 * Esisteva solo come chiamata: i tre `--record-*` morivano con
 * `rejectionText is not defined` ed exit 1 invece del 3 previsto, quindi il
 * guasto si travestiva da errore d'uso. Stessa classe del `--preflight` mai
 * implementato, tre righe più sotto.
 */
export function rejectionText(message) {
  return [
    `[dispatch] GUASTO (identità): ${message}`,
    'Il verdetto NON è stato scritto: la directory non corrisponde al branch assegnato,',
    "quindi ciò che avresti giudicato non è ciò che verrebbe fuso. Non riscrivere lo stato",
    "a mano e non forzare il branch: riporta `guasto identita` all'orchestratore e fermati.",
  ].join('\n');
}

/**
 * Il rifiuto arriva dal SERVER, non dalla guardia sull'identità della directory.
 * Sono due cose diverse e vanno dette diverse: chi legge "la directory non
 * corrisponde al branch" quando il problema è il ruolo o la macchina a stati
 * insegue per mezz'ora il problema sbagliato.
 */
export function channelRejectionText(message) {
  return [
    `[dispatch] RIFIUTATO dal server: ${message}`,
    'La decisione NON è stata registrata da nessuna parte, e non va aggirata',
    'depositandola sulla coda su git: il server ha guardato ruolo, ramo e stato',
    "vero e ha detto no. Leggi il motivo, correggi se puoi, altrimenti fermati.",
  ].join('\n');
}

/**
 * Emette un GUASTO: nessun lavoro consegnato, e il worker lo dice
 * all'orchestratore con la terza parola del vocabolario (`guasto`), che ferma
 * il giro senza travestirlo da giornata tranquilla.
 */
function emitHalt(kind, message) {
  process.stderr.write(`[dispatch] GUASTO (${kind}): ${message}\n`);
  emit({ role: 'halt', kind, message }, {});
  return { exit: 3 };
}

export async function run() {
  // Niente controllo dell'interruttore master qui: lo guarda il preflight
  // (prima del setup) e lo applica il SERVER, che da spento non emette
  // biglietti nuovi. Un biglietto già in mano si porta a termine: il feedback
  // in corso finisce e viene consegnato, mai troncato (SPEC-RIDISEGNO-MAX.md
  // §6) — e un worker con un lavoro valido non deve morire perché il
  // documento di config è momentaneamente illeggibile.

  // ── Il lavoro lo sceglie il SERVER, col biglietto ──────────────────────────
  //
  // Il biglietto è legato a un feedback preciso, e ogni consegna fatta con
  // quel biglietto parla di QUEL feedback. Se qui si scegliesse per conto
  // proprio, si lavorerebbe una cosa e si consegnerebbe un'altra — e il
  // controllo del server, che è tutto il punto, direbbe sempre sì sul
  // feedback sbagliato.
  //
  // Senza biglietto non si sceglie niente: scegliere da qui vorrebbe dire
  // leggere la coda, e leggere la coda vuole la chiave che apre TUTTI i
  // feedback — chiave che non vive più su queste macchine
  // (ROUTINE-AUTH-SPEC.md). Ci si ferma con un guasto DICHIARATO, non si
  // ripiega sull'esplorazione: travestire un giro cieco da audit è già
  // costato un'ondata di lavoro fantasma.
  const ticket = readRoutineTicket(ROOT);
  if (!ticket) {
    return emitHalt('transient',
      'nessun biglietto: il lavoro lo sceglie il server, e senza biglietto questo giro non può sapere cosa fare');
  }

  let w;
  try {
    const ch = await import('./routine-channel.mjs');
    w = await ch.work(ticket);
  } catch (e) {
    return emitHalt('transient', `canale non utilizzabile: ${e?.message || e}`);
  }
  if (!w.ok) {
    // In dubbio ci si ferma: un biglietto che non apre il proprio lavoro non
    // è una giornata tranquilla, è un giro che non deve partire.
    return emitHalt('transient', `il canale non consegna il lavoro (${w.reason})`);
  }
  // La busta va guardata PRIMA di consegnarla. Un ruolo che qui non esiste
  // arriverebbe al lavoratore senza istruzioni e senza contenuto; un ruolo
  // dell'iter senza il suo ramo farebbe lavorare sull'albero sbagliato. In
  // entrambi i casi ci si ferma: consegnare mezza busta è peggio che non
  // consegnarne nessuna, perché sembra un giro riuscito.
  const bad = checkEnvelope(w);
  if (bad) return emitHalt('transient', bad);

  const bucket = {
    role: w.role,
    id: w.id || undefined,
    num: w.num || '',
    branch: w.branch || '',
    loopCount: Number(w.payload && w.payload.loopCount) || 0,
  };
  if (bucket.id) {
    // Lo stato locale resta il ripiego quando il server non risponde: si
    // allinea a ciò che il server ha appena detto, così le due copie non
    // divergono in silenzio.
    const prev = readState(bucket.id) || defaultState(bucket.id, bucket.branch);
    bucket.state = { ...prev, id: bucket.id, branch: bucket.branch || prev.branch || '' };
    // La critica di chi ha bocciato la tiene il SERVER: è lui che registra i
    // verdetti. Il fogliettino su git resta come tappabuchi finché esiste —
    // ma quando sparirà, se non si leggesse quella del server la correzione
    // partirebbe alla cieca senza che nessuno se ne accorga.
    //
    // Va tenuta sul bucket, NON nello stato: lo stato viene riscritto da capo
    // quando la cartella si posiziona sul ramo, e lì la critica del server si
    // perdeva in silenzio.
    if (w.payload && typeof w.payload.critique === 'string' && w.payload.critique) {
      bucket.serverCritique = w.payload.critique;
    }
  }
  const empty = { reviews: [], todoWinner: null };
  // La busta si passa COM'È: incartarla in un altro oggetto ha già fatto
  // arrivare al lavoratore un pacchetto vuoto, con il giro che usciva
  // dicendo che era tutto a posto.
  return finalizeBucket(bucket, empty, LOOP_CAP, {}, w);
}

// Raccoglie il payload (diff/feedback), fa il claim per i bucket feedback-bound,
// e stampa il JSON. Ritorna { exit }. `cap` è il loop cap effettivo (per le
// ri-scelte dopo un claim già preso).
// Il prober non lavora su un branch: la directory torna alla LINEA PRINCIPALE
// e l'identità attesa viene rilasciata. Senza, resteremmo sul branch del
// compito precedente e le modifiche del prober finirebbero là dentro, dove
// diventerebbero modifiche di QUEL lavoro nel diff che va al gate.
function prepareForProber() {
  clearExpectation(ROOT);
  const g = (args) => tryGit(args);
  g(['fetch', 'origin', MAIN_BRANCH]);
  if (currentBranch(ROOT) === MAIN_BRANCH) return;
  if (tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${MAIN_BRANCH}`]).ok) {
    g(['checkout', '-B', MAIN_BRANCH, `origin/${MAIN_BRANCH}`]);
  } else {
    g(['checkout', MAIN_BRANCH]);
  }
}

/**
 * A + D: posiziona la directory sul branch del bucket e registra nello stato
 * l'identità attesa del contenuto. FAIL CLOSED: se non riesce, il lavoro NON
 * viene consegnato.
 *
 * @returns {{ok:true, branch:string}|{ok:false, kind:string, message:string}}
 */
function positionOnBranch(bucket) {
  const isNew = bucket.role === 'new-work';
  const prev = readState(bucket.id);
  const branch = isNew ? newWorkBranch(bucket.id) : (prev?.branch || bucket.branch || '');
  if (!branch) return { ok: false, kind: 'permanent', message: `nessun branch assegnato per ${bucket.id}` };

  const res = prepareBranch({
    root: ROOT,
    branch,
    create: isNew,
    base: isNew ? preferredBase(bucket.num, MAIN_BRANCH) : '',
    mainBranch: MAIN_BRANCH,
    checkpoint: isNew ? null : lastCheckpoint(prev),
  });
  if (!res.ok) return res;
  if (res.discarded) {
    process.stderr.write(`[dispatch] ${branch}: lavoro di un'istanza interrotta riportato all'ultimo punto fermo; i commit scartati restano su ${res.discarded}\n`);
  }

  // Identità attesa del contenuto: è il valore che le transizioni (C) e il
  // ripristino (D) confronteranno.
  const state = withCheckpoint(
    { ...defaultState(bucket.id, branch), ...(prev || {}), id: bucket.id, branch },
    res.head, `${bucket.role}:checkout`,
  );
  writeState(state);
  // Esposta alla guardia fuori sessione (.claude/hooks/branch-guard.sh).
  writeExpectation(ROOT, { branch, id: bucket.id });
  bucket.branch = branch;
  bucket.state = state;
  return { ok: true, branch };
}

/**
 * Il contesto del ruolo, ricavato dalla busta del server. PURA (testata in
 * tests/unit/routineTicket.test.mjs).
 *
 * Vive fuori da `finalizeBucket` per una ragione precisa: qui è già passato due
 * volte lo stesso errore — il contenuto cercato un livello più su di dov'era,
 * e nessuno se n'è accorto perché il ripiego lo copriva e poi, tolto il
 * ripiego, il campo arrivava semplicemente nullo. Un giro che consegna un
 * pacchetto vuoto ed esce dicendo che è andato tutto bene è il modo peggiore di
 * rompersi. Estratta e pura, la cosa ha un test che la guarda.
 *
 * @param {{role:string, branch?:string}} bucket
 * @param {{payload?:object}|null} fromServer  la busta, COM'È
 * @param {string} diff  le differenze del ramo (solo per il controllo sicurezza)
 */
// I ruoli che questa macchina sa eseguire. Un ruolo fuori da qui non è un
// lavoro: è una busta che non sappiamo aprire.
const RUOLI_LAVORABILI = ['secaudit', 'verifier', 'fixer', 'new-work', 'prober'];
// Chi lavora su un ramo esistente: senza, non c'è niente su cui posizionarsi.
const RUOLI_CON_RAMO = ['secaudit', 'verifier', 'fixer'];

/**
 * La busta è consegnabile? PURA. Ritorna null se va bene, altrimenti il motivo
 * del guasto, già scritto per chi legge i log.
 */
// Chi ha bisogno di leggere il feedback per poter lavorare: senza, il compito
// è vuoto anche se la busta è formalmente in ordine.
const RUOLI_CON_FEEDBACK = ['verifier', 'fixer', 'new-work'];

export function checkEnvelope(w) {
  const role = String((w && w.role) || '');
  if (!RUOLI_LAVORABILI.includes(role)) {
    return `il server ha assegnato un ruolo che questa versione non sa eseguire ("${role || 'nessuno'}")`;
  }
  if (RUOLI_CON_RAMO.includes(role) && !String((w && w.branch) || '')) {
    return `lavoro "${role}" senza il ramo su cui lavorare`;
  }
  if (role !== 'prober' && !String((w && w.id) || '')) {
    return `lavoro "${role}" senza il feedback a cui si riferisce`;
  }
  // La busta può essere formalmente perfetta e VUOTA dentro: succede se il
  // server non riesce a leggere il documento. Guardare solo ruolo, ramo e
  // indirizzo lascerebbe passare un compito senza compito — la stessa forma di
  // guasto silenzioso di prima, entrata dalla porta del server invece che da
  // quella di casa.
  if (RUOLI_CON_FEEDBACK.includes(role)) {
    const testo = String(((w && w.payload && w.payload.feedback) || {}).text || '').trim();
    if (!testo) return `lavoro "${role}" con il feedback vuoto: non c'è niente su cui lavorare`;
  }
  return null;
}

export function serverCtx(bucket, fromServer, diff = '') {
  const role = bucket && bucket.role;
  const payload = (fromServer && fromServer.payload) || null;
  // Il controllo di sicurezza: il diff se lo calcola da git, che è pubblico e
  // non chiede nessuna chiave. Del feedback non riceve niente, e non è più una
  // consegna da rispettare — senza chiave, il testo cifrato per lui è un blob.
  if (role === 'secaudit') return { diff };
  if (role === 'verifier' || role === 'fixer' || role === 'new-work') {
    // Il feedback arriva GIÀ DECIFRATO dal server. Non c'è nessun ripiego che
    // se lo vada a rileggere: il ripiego sarebbe la chiave, ed è proprio ciò
    // che da qui è stato tolto.
    return { feedback: (payload && payload.feedback) || null };
  }
  return {};
}

async function finalizeBucket(bucket, snapshot, cap = LOOP_CAP, opts = {}, fromServer = null) {
  // Coda vuota con l'esplorazione spenta dall'owner (#448): non c'è niente da
  // fare, e non c'è niente da riparare. Nessun worker, nessun claim, nessun
  // ritorno alla linea principale: il giro finisce sereno con exit 0.
  if (bucket.role === 'idle') {
    emit(bucket, {});
    return { exit: 0 };
  }

  if (bucket.role === 'prober') {
    prepareForProber();
    emit(bucket, {});
    return { exit: 0 };
  }

  // Il semaforo è del SERVER: l'ha preso lui rilasciando il biglietto, e vale
  // per un feedback solo. Il lucchetto su git non esiste più — era il modo che
  // avevano macchine senza credenziali di mettersi d'accordo fra loro.
  //
  // La presa in carico (`working`) la si dichiara al server: è il riflesso che
  // la dashboard mostra come "in lavorazione".
  if (bucket.id && bucket.role === 'new-work') {
    await deliverToChannel('status', { status: 'working', branch: bucket.branch || '' });
  }

  // A + D: la directory viene messa sul branch giusto PRIMA di consegnare, e il
  // lavoro di un'istanza interrotta viene riportato all'ultimo punto fermo.
  // FAIL CLOSED: se non riesce non si consegna niente.
  if (bucket.id && bucket.role !== 'prober') {
    const pos = positionOnBranch(bucket);
    if (!pos.ok) {
      if (pos.kind === 'permanent') {
        // Riprovare ogni 6h all'infinito è inutile: il feedback esce dal giro
        // automatico e compare in dashboard, dove l'owner può decidere.
        await deliverToChannel('status', {
          status: 'design', reason: 'branch',
          notes: "La lavorazione automatica non può proseguire: il ramo di lavoro di questa modifica non esiste più, quindi non c'è nulla su cui continuare. Serve una tua decisione (rimetterlo in coda per rifarlo da capo, oppure archiviarlo).",
        });
        clearState(bucket.id);
        process.stderr.write(`[dispatch] ${bucket.id}: ${pos.message} → design\n`);
        if (fromServer) {
          // Col biglietto non si ripiega su un altro lavoro: il biglietto vale
          // per QUESTO feedback e per nessun altro, e mettersi a esplorare
          // tenendoselo in mano lascia il semaforo preso su un lavoro che
          // nessuno sta facendo — con il giro che esce dicendo che è andato
          // tutto bene.
          return emitHalt('permanent', pos.message);
        }
        const next = { reviews: snapshot.reviews.filter((r) => r.id !== bucket.id), todoWinner: snapshot.todoWinner?.id === bucket.id ? null : snapshot.todoWinner };
        return finalizeBucket(chooseBucket(next, cap), next, cap);
      }
      return emitHalt('transient', pos.message);
    }
  }

  // Raccogli il contesto specifico del ruolo (rispettando l'isolamento).
  const ctx = serverCtx(bucket, fromServer,
    bucket.role === 'secaudit' ? diffForBranch(bucket.branch) : '');

  emit(bucket, ctx);
  return { exit: 0 };
}

// (Qui viveva la decifratura del feedback su questa macchina. È stata tolta con
// la chiave: il testo arriva già in chiaro dal server, ritagliato al ruolo.)

// L'ultima scelta consegnata, per il confronto col canale del server (#477.1).
// La scrive `emit`, che è il punto unico in cui dispatch dichiara cosa ha
// scelto: legarla lì significa che il confronto non può parlare di un lavoro
// diverso da quello davvero consegnato.
let lastEmitted = null;
export function lastChoice() { return lastEmitted; }

export function emit(bucket, ctx) {
  // Chi sta per lavorare, scritto DA CHI LO SA (feedback #443): resta come
  // traccia locale di chi sta girando adesso in questa directory. La
  // provenienza di un feedback aperto da un'automazione NON dipende più da
  // questo file: la timbra il server dal biglietto, quando la consegna arriva
  // dal canale autenticato.
  // Un guasto (`halt`) e un giro a vuoto (`idle`) non sono ruoli: si cancella il
  // marcatore, altrimenti quello del giro precedente sopravviverebbe a un giro
  // che non ha lavorato e finirebbe nella provenienza di un feedback altrui.
  if (bucket.role === 'halt' || bucket.role === 'idle' || bucket.role === 'off') clearRole(ROOT);
  else writeRole(ROOT, bucket.role);
  const payload = buildPayload(bucket, ctx);
  const out = {
    role: bucket.role,
    payload,
    claim: bucket.id || null,
    loopCount: bucket.loopCount || 0,
    instructions: readRoleInstructions(bucket.role),
  };
  lastEmitted = { role: bucket.role, num: bucket.num || '' };
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
      const s = await recordVerifier(id, verdict, rest.join(' '));
      if (s.rejected) { console.error(s.fromChannel ? channelRejectionText(s.message) : rejectionText(s.message)); process.exit(s.fromChannel ? 4 : 3); }
      console.log(`stato ${id}: verifier=${s.verifierVerdict} loop=${s.loopCount}`);
      process.exit(0);
    } else if (flag === '--record-fixed') {
      const [, id, ...rest] = argv;
      if (!id) { console.error('Uso: --record-fixed <id> ["report"] [--frase "…"]'); process.exit(1); }
      // `--frase` è la riga in chiaro per chi ha mandato il feedback; tutto il
      // resto è il report per l'owner, che il server cifra.
      const fi = rest.indexOf('--frase');
      const frase = fi !== -1 ? (rest[fi + 1] || '') : '';
      const report = (fi !== -1 ? rest.slice(0, fi).concat(rest.slice(fi + 2)) : rest).join(' ');
      const s = await recordFixed(id, report, frase);
      if (s.rejected) { console.error(s.fromChannel ? channelRejectionText(s.message) : rejectionText(s.message)); process.exit(s.fromChannel ? 4 : 3); }
      console.log(`stato ${id}: ri-messo in coda verifier (loop=${s.loopCount})`);
      process.exit(0);
    } else if (flag === '--record-secaudit') {
      const [, id, verdict] = argv;
      if (!id || !['pass', 'fail'].includes(verdict)) { console.error('Uso: --record-secaudit <id> <pass|fail>'); process.exit(1); }
      const s = await recordSecaudit(id, verdict);
      if (s.rejected) { console.error(s.fromChannel ? channelRejectionText(s.message) : rejectionText(s.message)); process.exit(s.fromChannel ? 4 : 3); }
      console.log(`stato ${id}: secaudit=${s.secauditVerdict}`);
      process.exit(0);
    } else if (flag === '--preflight') {
      // Prontezza: gira PRIMA del setup dell'ambiente (npm install, binario
      // Electron ~102MB, scrot). Se il giro deve fermarsi, deve scoprirlo prima
      // di aver pagato il setup.
      preflight().then((r) => {
        if (r.ok) { console.log('[dispatch] prontezza OK'); process.exit(0); }
        if (r.kind === 'off') console.log(`[dispatch] SPENTO: ${r.message}`);
        else console.error(`[dispatch] GUASTO (${r.kind}): ${r.message}`);
        process.exit(preflightExitCode(r));
      }).catch((e) => { console.error(`[dispatch] GUASTO (transient): ${e?.message || e}`); process.exit(3); });
    } else if (flag === '--clear-state') {
      const id = argv[1];
      if (!id) { console.error('Uso: --clear-state <id>'); process.exit(1); }
      clearState(id);
      console.log(`stato ${id}: rimosso`);
      process.exit(0);
    } else {
      // Default: sceglie il bucket e stampa il JSON.
      //
      // `--ticket <biglietto>` (#477.2): con un biglietto il lavoro lo sceglie
      // il SERVER e le consegne passano di lì. Il biglietto viene messo dove
      // chi consegna lo ritrova da solo (vedi lib/routine-ticket.mjs): le
      // consegne le fanno script diversi in momenti diversi, e pretendere che
      // il lavoratore se lo ricordi ogni volta è la scommessa già persa sulla
      // provenienza dei feedback.
      const ti = argv.indexOf('--ticket');
      const ticket = ti !== -1 ? argv[ti + 1] : '';
      // Il biglietto viene messo dove chi consegna lo ritrova da solo: le
      // consegne le fanno script diversi, in momenti diversi, e pretendere che
      // il lavoratore se lo ricordi ogni volta è la scommessa già persa sulla
      // provenienza dei feedback. Un giro senza biglietto cancella il
      // marcatore, o quello del giro prima sopravvivrebbe a questo.
      if (ticket) writeRoutineTicket(ROOT, ticket); else clearRoutineTicket(ROOT);
      run().then((r) => {
        process.exit(r?.exit ?? 0);
      }).catch((e) => {
        process.stderr.write(`[dispatch] errore fatale: ${e.message}\n`);
        process.exit(1);
      });
    }
  } catch (e) {
    console.error('[dispatch] errore:', e.message);
    process.exit(1);
  }
}
