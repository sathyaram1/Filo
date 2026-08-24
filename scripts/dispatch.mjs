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
//   node scripts/dispatch.mjs --record-verifier <id> <pass|migliorabile|fail> ["critica"]
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
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prepareBranch, newWorkBranch, withCheckpoint,
  lastCheckpoint, clearRejects, headSha, currentBranch,
  guardTransition, escalationNote,
  writeExpectation, clearExpectation, stateDir,
} from './lib/branch-integrity.mjs';
import { writeRole, clearRole } from './lib/routine-role.mjs';
import { readTicket as readRoutineTicket, writeTicket as writeRoutineTicket, clearTicket as clearRoutineTicket } from './lib/routine-ticket.mjs';
import { startBeat, stopBeat } from './lib/routine-beat.mjs';
import { TOOLS_ROOT, pinTools, pinnedRepoRoot, pinnedOrigin, absolutizeRecipe } from './lib/tools-pin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DUE radici, e tenerle separate è il punto (lib/tools-pin.mjs):
//   ROOT       il PROGETTO, dove si lavora e dove parla git;
//   TOOLS_ROOT gli STRUMENTI che stanno girando, che in cloud sono una copia
//              fuori dal progetto — perché il progetto, appena si apre il ramo
//              di un feedback, si porta dietro gli strumenti di QUEL ramo.
// Quando gli strumenti sono una copia fissata, il progetto lo dicono loro: non
// si chiede a nessuno di ricordarsi di passarlo.
const ROOT = process.env.FILO_REPO_ROOT
  ? resolve(process.env.FILO_REPO_ROOT)
  : (pinnedRepoRoot() || resolve(__dirname, '..'));
// Lo stato locale e' solo un ripiego: quello vero vive sul server. Sta fra i
const STATE_DIR = stateDir(ROOT);
// Le ricette dei ruoli seguono gli STRUMENTI, non il progetto: su un ramo
// vecchio anche le istruzioni sarebbero vecchie.
const ROLES_DIR = resolve(TOOLS_ROOT, 'routines', 'roles');
const MAIN_BRANCH = process.env.FILO_MAIN_BRANCH || 'main';

// Il documento che dice alle routine come devono comportarsi: acceso/spento,
// esplorazione a coda vuota, tentativi del loop. Leggibile SENZA credenziali
// (le regole lo aprono in lettura, la scrittura resta all'owner) — vedi
// fetchRoutineConfig per il perché.
const ROUTINES_DOC = 'config/routines';

// Quante bocciature del verifier prima di bloccare con motivo `loop` (failCap,
// SPEC-RIDISEGNO-MAX.md §13). Precedenza: override d'ambiente FILO_LOOP_CAP >
// valore scelto dall'owner nella tab Automazioni (doc Firestore config/routines,
// campo `failCap`; il legacy `loopCap` è un alias) > default dalla fonte unica.
// Range [1, 10], allineato a SN_CONST.AUTOMATION. Il tetto EFFETTIVO lo applica
// il SERVER quando registra i verdetti: qui resta solo resolveLoopCap, la
// regola di precedenza pura, per gli strumenti e per i test.
//
// I DEFAULT dei contatori (failCap/improvableCap) vivono con le transizioni
// promosse a dati (src/shared/feedbackTransitions.js): una sorgente sola,
// incorporata anche dal server al deploy. Se il checkout non ce l'ha ancora
// (clone vecchio), i letterali qui sotto sono il paracadute.
const LOOP_CAP_MIN = 1;
const LOOP_CAP_MAX = 10;
export const VERIFIER_CAPS = (() => {
  try {
    const req = createRequire(import.meta.url);
    // Dagli STRUMENTI, non dal progetto: è un dato che governa il giro (quante
    // bocciature si tollerano), e preso dal ramo di lavoro sarebbe di nuovo la
    // versione di giorni fa.
    req(resolve(TOOLS_ROOT, 'src', 'shared', 'feedbackTransitions.js'));
    const caps = globalThis.SN_FB_TRANSITIONS && globalThis.SN_FB_TRANSITIONS.VERIFIER_CAPS;
    if (caps && Number.isFinite(caps.failCap) && Number.isFinite(caps.improvableCap)) return caps;
  } catch (_) { /* checkout senza il file dei dati: si usa il paracadute */ }
  return { improvableCap: 3, failCap: 10 };
})();
const LOOP_CAP_DEFAULT = VERIFIER_CAPS.failCap;

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
    improvableCount: 0,
    verifierVerdict: null,
    verifierCritique: '',
    secauditDone: false,
    secauditVerdict: null,
  };
}

// (Qui vivevano classifyReview, reconcileState e chooseBucket: il "vecchio
// cervello" che leggeva la coda e sceglieva il lavoro da questa macchina. È
// stato smontato col ridisegno (SPEC-RIDISEGNO-MAX.md §1): il lavoro arriva
// SOLO dal server col biglietto, e la copia viva di quelle regole è
// filo-security/functions/src/routine/select.js.)

// ─── Transizioni di stato (pure) ──────────────────────────────────────────────

// I tre esiti della verifica (SPEC-RIDISEGNO-MAX.md §13): fail = la cosa
// chiesta non si ottiene; migliorabile = funziona, ma pattern/estetica/
// completezza. I contatori EFFETTIVI (e la promozione del migliorabile al giro
// N+1) li applica il SERVER quando registra il verdetto: questo stato locale è
// solo lo specchio di ripiego.
export const VERIFIER_VERDICTS = ['pass', 'migliorabile', 'fail'];

/**
 * Il verifier ha prodotto un verdetto. FAIL incrementa il contatore delle
 * bocciature; MIGLIORABILE il suo contatore separato (e instrada una correzione
 * come un fail, finché il server non lo promuove).
 */
export function applyVerifierVerdict(state, verdict, critique = '') {
  const s = { ...defaultState(state?.id, state?.branch), ...(state || {}) };
  if (verdict === 'pass') {
    s.verifierVerdict = 'pass';
  } else if (verdict === 'migliorabile') {
    s.verifierVerdict = 'migliorabile';
    s.improvableCount = (Number(s.improvableCount) || 0) + 1;
    if (typeof critique === 'string' && critique.trim()) s.verifierCritique = critique.trim().slice(0, 4000);
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

/**
 * Da dove viene il contenuto che sto per fissare: ramo e commit del checkout.
 * Non decide niente — si scrive accanto alla copia e finisce nelle istruzioni,
 * così una copia presa da un checkout non aggiornato si vede invece di dover
 * essere dedotta da un comportamento strano ore dopo.
 */
/**
 * Il checkout da cui si sta per fissare è quello giusto?
 *
 * La copia vale quanto il momento in cui viene presa: se il giro parte da un
 * checkout non aggiornato, fissa gli strumenti vecchi e il difetto torna con
 * un'altra causa — con l'aggravante che stavolta sembra tutto a posto.
 *
 * IL CONTROLLO NON SI APPENDE A `FILO_ROUTINE`, e non è un dettaglio: quella
 * variabile la esporta l'orchestratore seguendo le istruzioni che riceve DAL
 * PREFLIGHT, cioè dopo che questo controllo è già passato. Appesa lì, la
 * guardia avrebbe avuto i test verdi e non sarebbe scattata mai in produzione:
 * è la stessa forma di guasto che questo lavoro viene a chiudere.
 *
 * Il preflight è il portone d'ingresso di un giro di routine, quindi si guarda
 * sempre. Chi lo lancia per provare in locale, dove si sta su un ramo apposta,
 * lo dice: `FILO_PREFLIGHT_ANY_BRANCH=1`.
 *
 * @returns {string} '' se va bene, altrimenti il motivo per fermarsi
 */
function checkoutNonAdatto() {
  if (String(process.env.FILO_PREFLIGHT_ANY_BRANCH || '') === '1') return '';
  const g = (args) => execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const viaDiFuga = "se lo stai lanciando per provare, FILO_PREFLIGHT_ANY_BRANCH=1";
  try {
    // La CARTELLA PULITA si controlla per prima, prima ancora di guardare se il
    // commit è quello giusto. Sembra un dettaglio d'ordine e non lo è: un
    // progetto fermo a metà di un'operazione (un conflitto irrisolto, una
    // modifica non salvata) può stare esattamente sul commit giusto e avere i
    // file rotti. Controllandolo dopo, la copia si portava dentro i segni del
    // conflitto e la ricetta consegnata al giro arrivava corrotta.
    const sporco = g(['status', '--porcelain']);
    if (sporco) {
      const prima = sporco.split('\n')[0].trim();
      return `il checkout ha roba non salvata ("${prima}"…): gli strumenti fissati sarebbero quelli mezzo modificati (${viaDiFuga})`;
    }

    g(['fetch', '--quiet', 'origin', MAIN_BRANCH]);
    const qui = g(['rev-parse', 'HEAD']);
    const la = g(['rev-parse', `origin/${MAIN_BRANCH}`]);
    // Si confrontano i CONTENUTI, non i nomi: una testa staccata sulla punta
    // della linea principale ha esattamente i file giusti, e rifiutarla col
    // motivo "sei sul ramo sbagliato" sarebbe anche una bugia.
    if (qui === la) return '';

    const ramo = g(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (ramo !== MAIN_BRANCH) {
      return `il giro parte da '${ramo}', che non è '${MAIN_BRANCH}' aggiornato: gli strumenti fissati sarebbero quelli di quel ramo (${viaDiFuga})`;
    }

    // Indietro sulla linea principale: NON è un motivo per morire. La ricetta
    // dell'orchestratore prevede già di aggiornarsi, solo che lo fa due passi
    // dopo — cioè dopo che la copia è stata presa. Lo si fa adesso, che è il
    // momento giusto, e solo in avanti: se non basta un avanzamento pulito,
    // qui c'è qualcosa che deve vedere l'owner.
    const sporco = g(['status', '--porcelain']);
    if (sporco) {
      return `il checkout ha modifiche non salvate e non si può aggiornare prima di fissare gli strumenti (${viaDiFuga})`;
    }
    try {
      g(['merge', '--ff-only', `origin/${MAIN_BRANCH}`]);
    } catch (_) {
      return `il checkout non si allinea a '${MAIN_BRANCH}' con un avanzamento pulito: gli strumenti fissati sarebbero già vecchi (${viaDiFuga})`;
    }
    if (g(['rev-parse', 'HEAD']) !== la) {
      return `il checkout non si è allineato a '${MAIN_BRANCH}': gli strumenti fissati sarebbero già vecchi (${viaDiFuga})`;
    }
  } catch (_) {
    // Niente git, nessun remoto, rete assente: qui si fallisce APERTI. Questo
    // controllo esiste per accorgersi di una deriva, non per essere il punto in
    // cui un giro muore perché il fetch non è passato.
    return '';
  }
  return '';
}

function origineDelCheckout() {
  try {
    const ramo = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return `${ramo} ${sha}`;
  } catch (_) {
    return '';
  }
}

export function readRoleInstructions(role) {
  const name = ROLE_FILE[role];
  if (!name) return '';
  const f = resolve(ROLES_DIR, name);
  const base = existsSync(f) ? readFileSync(f, 'utf8') : '';
  if (!base || !RUOLI_LAVORABILI.includes(role)) return absolutizeRecipe(base, TOOLS_ROOT, ROOT);
  const c = resolve(ROLES_DIR, WORKER_CONTRACT_FILE);
  const contract = existsSync(c) ? readFileSync(c, 'utf8') : '';
  const testo = contract ? `${base.replace(/\s+$/, '')}\n\n${contract}` : base;
  // Le ricette dicono `node scripts/…`, che dalla cartella di lavoro porta agli
  // strumenti DEL RAMO. Quando gli strumenti sono la copia fissata, il percorso
  // va riscritto in assoluto qui, nel momento della consegna: è l'unico punto
  // che sa dove stanno davvero, e chi lavora non deve saperlo.
  return absolutizeRecipe(testo, TOOLS_ROOT, ROOT);
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
  // su main). Il cancello di fusione (sul server) confronta con il main VERO di
  // GitHub per lo stesso motivo; qui allineiamo la stessa logica per il diff
  // che alimenta il secaudit.
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

// (Qui viveva buildSnapshot: la lettura della coda da questa macchina, con la
// chiave che apriva tutti i feedback. È sparita con la chiave e col ridisegno:
// lo snapshot lo costruisce il server — functions/src/routine/queue.js — e la
// distinzione "coda vuota ≠ coda illeggibile" vive là, dove la coda si legge.)

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
  // Il ruolo scrive la critica come "PASS — …"/"MIGLIORABILE — …"/"FAIL — …":
  // il prefisso è ridondante col nostro incipit, toglilo (resta la sostanza).
  const c = String(critique || '').trim().replace(/^(PASS|MIGLIORABILE|FAIL)\s*[—–:\-]\s*/i, '').slice(0, 4000);
  if (verdict === 'pass') {
    return c ? `Controllo funzionalità superato. ${c}` : 'Controllo funzionalità superato.';
  }
  if (verdict === 'migliorabile') {
    return c ? `Verifica: funziona, ma migliorabile — ${c}` : 'Verifica: funziona, ma migliorabile.';
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
 * @param {any} [_unused] posto del vecchio builder dello snapshot (mai più letto qui)
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
 * legge. È il CONTRATTO documentato in routines/roles/orchestrator.md, e sta
 * qui — pura, testata —
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
  // La busta si passa COM'È: incartarla in un altro oggetto ha già fatto
  // arrivare al lavoratore un pacchetto vuoto, con il giro che usciva
  // dicendo che era tutto a posto.
  return finalizeBucket(bucket, w);
}

// Raccoglie il payload (diff/feedback) della busta del server e stampa il JSON.
// Ritorna { exit }.
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
    // Un lavoro nuovo nasce SEMPRE dalla linea principale: le basi feature/N
    // erano il Modello B dei sotto-feedback, abolito (SPEC-RIDISEGNO-MAX.md §1).
    base: '',
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

async function finalizeBucket(bucket, fromServer) {
  // Il ruolo `idle` non esiste più (SPEC-RIDISEGNO-MAX.md §12): coda vuota o
  // interruttore spento sono un exit 2 alla richiesta di biglietto, PRIMA che
  // un worker venga spawnato. Qui arrivano solo buste con un lavoro dentro.
  if (bucket.role === 'prober') {
    prepareForProber();
    emit(bucket, {});
    return { exit: 0 };
  }

  // Il semaforo è del SERVER: l'ha preso lui rilasciando il biglietto, e vale
  // per un feedback solo. Il lucchetto su git non esiste più — era il modo che
  // avevano macchine senza credenziali di mettersi d'accordo fra loro.
  //
  // A + D: la directory viene messa sul branch giusto PRIMA di consegnare, e il
  // lavoro di un'istanza interrotta viene riportato all'ultimo punto fermo.
  // FAIL CLOSED: se non riesce non si consegna niente.
  //
  // VIENE PRIMA della presa in carico, e non è un dettaglio d'ordine: il nome
  // del ramo di un lavoro nuovo lo decide QUI, quindi dichiarare `working` prima
  // vorrebbe dire dichiararlo senza ramo — ed è quello che succedeva. Il server
  // non scrive un ramo vuoto, così NESSUN lavoro in corso aveva un ramo scritto
  // sopra, e il recupero degli arenati — che guarda quando quel ramo si è mosso
  // l'ultima volta — non aveva niente da guardare: sfrattava sull'ora trascorsa
  // dalla presa in carico, cioè proprio la cosa che non doveva fare.
  //
  // Rovesciando l'ordine si guadagna anche un'altra cosa: se il posizionamento
  // fallisce, il feedback resta in coda invece di restare marchiato "in
  // lavorazione" da nessuno.
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
        // Non si ripiega su un altro lavoro: il biglietto vale per QUESTO
        // feedback e per nessun altro, e mettersi a esplorare tenendoselo in
        // mano lascerebbe il semaforo preso su un lavoro che nessuno sta
        // facendo — con il giro che esce dicendo che è andato tutto bene.
        return emitHalt('permanent', pos.message);
      }
      return emitHalt('transient', pos.message);
    }
  }

  // Il semaforo è del SERVER: l'ha preso lui rilasciando il biglietto, e vale
  // per un feedback solo. Il lucchetto su git non esiste più — era il modo che
  // avevano macchine senza credenziali di mettersi d'accordo fra loro.
  //
  // La presa in carico (`working`) la si dichiara al server COL RAMO: è il
  // riflesso che la dashboard mostra come "in lavorazione", ed è anche l'unico
  // momento in cui il server viene a sapere su quale ramo si sta lavorando —
  // prima lo scopriva solo alla consegna, cioè ore dopo, e per tutto quel tempo
  // il recupero degli arenati era cieco.
  if (bucket.id && bucket.role === 'new-work') {
    await deliverToChannel('status', { status: 'working', branch: bucket.branch || '' });
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
  // Un guasto (`halt`) non è un ruolo: si cancella il marcatore, altrimenti
  // quello del giro precedente sopravviverebbe a un giro che non ha lavorato e
  // finirebbe nella provenienza di un feedback altrui.
  if (bucket.role === 'halt') clearRole(ROOT);
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
      if (!id || !VERIFIER_VERDICTS.includes(verdict)) { console.error('Uso: --record-verifier <id> <pass|migliorabile|fail> ["critica"]'); process.exit(1); }
      const s = await recordVerifier(id, verdict, rest.join(' '));
      if (s.rejected) { console.error(s.fromChannel ? channelRejectionText(s.message) : rejectionText(s.message)); process.exit(s.fromChannel ? 4 : 3); }
      console.log(`stato ${id}: verifier=${s.verifierVerdict} loop=${s.loopCount} migliorabile=${Number(s.improvableCount) || 0}`);
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
      //
      // Su "si può lavorare" l'output CONSEGNA le istruzioni dell'orchestratore
      // (SPEC-RIDISEGNO-MAX.md §8): in cloud nessuno legge file di istruzioni
      // da sé — orchestratore ← preflight, worker ← dispatch. Il prompt salvato
      // della routine resta di due righe e non si tocca più quando si
      // ritoccano i ruoli.
      preflight().then((r) => {
        if (r.ok) {
          // GLI STRUMENTI SI FISSANO QUI, e qui soltanto: questo è l'unico
          // momento del giro in cui la cartella è ancora sulla versione
          // aggiornata, prima che qualunque ramo di lavoro venga aperto.
          // Da adesso in poi il giro esegue la copia, che nessun cambio di ramo
          // può riportare indietro (lib/tools-pin.mjs).
          const scomodo = checkoutNonAdatto();
          if (scomodo) {
            console.error(`[dispatch] GUASTO (transient): ${scomodo}`);
            process.exit(3);
          }
          const pin = pinTools(ROOT, { origine: origineDelCheckout() });
          if (!pin.ok) {
            // FERMA IL GIRO, non prosegue. Proseguire vorrebbe dire eseguire gli
            // strumenti del ramo di lavoro, cioè esattamente il guasto che
            // questa copia viene a togliere — e quel guasto non si vede: costa
            // un'ora di lavoro e la si scopre alla consegna rifiutata.
            console.error(`[dispatch] GUASTO (transient): strumenti non fissati (${pin.why})`);
            process.exit(3);
          }
          const tools = pin.dir;
          const f = resolve(tools, 'routines', 'roles', 'orchestrator.md');
          const brief = existsSync(f) ? readFileSync(f, 'utf8') : '';
          const da = pinnedOrigin(tools);
          console.log(`[dispatch] prontezza OK. Strumenti fissati${da ? ` da ${da}` : ''}.`);
          console.log('Le tue istruzioni:\n');
          console.log(absolutizeRecipe(brief, tools, ROOT)
            || '(routines/roles/orchestrator.md mancante: segnala il guasto e fermati)');
          process.exit(0);
        }
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
      // E col biglietto parte il BATTITO, qui e non nelle ricette: il semaforo
      // cade dopo 30 minuti di silenzio e la suite completa in cloud ne dura 37,
      // quindi senza battito ogni lavorazione lunga arriva alla consegna con un
      // biglietto morto (è già costato un giro intero: venti commit spinti e
      // nessun esito registrato). Chiederlo al prompt del lavoratore è la
      // scommessa già persa sulla firma dei feedback e sul biglietto delle
      // consegne: quello che deve succedere sempre lo fa lo strumento.
      if (ticket) {
        const b = startBeat(ROOT, ticket);
        if (!b.started && b.why !== 'already_live' && b.why !== 'disabled') {
          process.stderr.write(`[dispatch] battito non avviato (${b.why}): la lavorazione lunga rischia il semaforo\n`);
        }
      } else {
        stopBeat(ROOT);
      }
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
