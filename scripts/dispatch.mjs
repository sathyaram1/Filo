// dispatch.mjs — il dispatcher DETERMINISTICO (non-LLM) delle routine.
//
// PERCHÉ ESISTE
//   L'orchestratore decide solo SE continuare il loop, non QUALE lavoro fare:
//   il "quale" lo sceglie il SERVER (canale autenticato, ROUTINE-AUTH-SPEC.md)
//   e QUESTO script lo traduce in una consegna eseguibile, senza mai leggere
//   testi liberi — così la scelta non è pilotabile via prompt-injection. Il
//   worker (general-purpose) lancia `node scripts/dispatch.mjs --ticket <b>`,
//   riceve un JSON { role, payload, claim, instructions } e DIVENTA
//   quel ruolo.
//
// CONTRATTO (era in ROUTINES.md, abolito col ridisegno SPEC-RIDISEGNO-MAX.md;
// è documentazione dello script, quindi vive qui):
//   - Il lavoro arriva SOLO col biglietto: `routine-channel.mjs work` consegna
//     la busta { role, id, num, branch, payload } e dispatch la VALIDA
//     (checkEnvelope: ruolo conosciuto, ramo presente per i ruoli dell'iter,
//     feedback non vuoto) — mezza busta è peggio di nessuna busta. Senza
//     biglietto: GUASTO, nessun cammino alternativo.
//   - DUE CASI DI LAVORAZIONE, due testi: `new-work` è il primo passaggio,
//     `fixer` è il riallineamento del ramo dopo un conflitto di fusione. I
//     rilievi di una verifica NON passano più di qui: li corregge chi li ha
//     scritti, con le istruzioni che il server gli stampa dopo la critica.
//     Il server accompagna OGNI riallineamento con una critica sua (conflitto,
//     o unit rossi sulla fusione): non è un rilievo, è il perché del rebase.
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
//     riallinea a ogni busta ricevuta: il ramo dalla busta, i punti fermi dal posizionamento.
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
// USO (la stessa lista, per chi la chiede dal terminale: `--help`)
//   node scripts/dispatch.mjs --ticket <biglietto>     # traduce la busta del server
//   node scripts/dispatch.mjs --preflight               # prontezza (prima del setup)
//   node scripts/dispatch.mjs --record-verifier <id> "<critica coi livelli>" [--domanda <file.json>] [--ticket <b>]
//   node scripts/dispatch.mjs --record-pulizia <id> [--ticket <b>]
//   node scripts/dispatch.mjs --record-fixed <id> "<report>" [--frase "…"] [--domanda <file.json>] [--ticket <b>]
//   node scripts/dispatch.mjs --record-secaudit <id> <pass|fail> --nota <file.md> [--ticket <b>]
//   node scripts/dispatch.mjs --clear-state <id>
//
//   Nei --record-* le opzioni valgono in ogni posizione (leggiOpzioniRegistrazione). Il biglietto
//   si rilegge dal promemoria (.claude/routine-ticket.json); `--ticket` è la scorta se è perso.
//   Un argomento NON riconosciuto è un errore d'uso (exit 1) senza effetti
//   collaterali: il promemoria si cancella solo all'avvio dichiarato di un giro
//   locale senza biglietto, mai davanti a un argomento storpiato.
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
import { basename, dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  prepareBranch, newWorkBranch, withCheckpoint,
  lastCheckpoint, clearRejects, headSha, currentBranch,
  guardTransition, escalationNote,
  writeExpectation, clearExpectation, stateDir,
  lavoroVivo, testoLavoroVivo, USCITA_LAVORO_VIVO,
} from './lib/branch-integrity.mjs';
import { writeRole, clearRole, readRole, readMarker } from './lib/routine-role.mjs';
import { fileRiscritti, fusioniCheCitano, numeroFeedback } from './lib/su-main.mjs';
import {
  baseDelConfronto, controllaCasiDellaPulizia, controllaProveTolte, controllaPulizia, numeraRilievi, puliziaDelPass, rigaNumerata,
  ROSSO_ATTESO_CHIUSO, testoPuliziaFuoriNumero,
} from './lib/prove-tolte.mjs';
import { espandiInclusioni } from './lib/role-text.mjs';
import { installa as installaCecita } from './lib/orchestratore-cieco.mjs';
import { accendi as accendiClone, cloneDelGiro, preparaIntestazione, preparaPerIlGiro, rilancia } from './lib/worker-nel-clone.mjs';
import { VERIFIER_SCOPE_FILE, verifierScope, unaRiga, perimetroNote as perimetroNoteBase } from './lib/verifier-scope.mjs';
import {
  readTicket as readRoutineTicket, writeTicket as writeRoutineTicket, clearTicket as clearRoutineTicket, looksLikeTicket,
  leggiBigliettoAMano, leggiMarcatoreBiglietto, bigliettoFinito,
} from './lib/routine-ticket.mjs';
import { startBeat, stopBeat } from './lib/routine-beat.mjs';
import { TOOLS_ROOT, pinTools, pinnedRepoRoot, pinnedOrigin, absolutizeRecipe, absolutizeOutput } from './lib/tools-pin.mjs';
import { strumentiIndietro } from './lib/strumenti-vecchi.mjs';
import { dirtyTreeLines, dirtyTreeText, statoDirectory, statoIllegibileText } from './lib/dirty-tree.mjs';
import { codiceCambiatoDallAvvio, testoCodiceCambiato } from './lib/codice-fermo.mjs';
import { MAX_LIVELLO_BYTES, SEGNALA_TOLTA, leggiTestoLivello } from './lib/livelli.mjs';
import { MAX_CRITIQUE_BYTES, criticaTroppoLunga } from './lib/tetto-critica.mjs';
import { scaricaPayload, immaginiSenzaByte, STAMPA_MAX, STAMPA_TETTO, fileRuolo, rimandoAlRuolo, scriviRuolo } from './lib/consegna-file.mjs';
import { sembraOpzioneNelReport } from './lib/argomenti.mjs';
import { assicuraStoria, TETTO_STORIA_MS } from './lib/unit-sulla-fusione.mjs';
import { cloneDentroIlRepo } from './lib/git-server.mjs';

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
// tentativi del loop. Leggibile SENZA credenziali
// (le regole lo aprono in lettura, la scrittura resta all'owner) — vedi
// fetchRoutineConfig per il perché.
const ROUTINES_DOC = 'config/routines';

// I bilanci dei giri di correzione, uno per livello (feedback #561: cap3 per
// i rilievi di livello 3, cap2 per i 2, cap1, cap0) li CONSUMA il SERVER quando
// registra la critica, coi numeri che l'owner scrive in config/routines: qui
// non esistono, nemmeno come riferimento (fino al 2026-09-16 c'era una copia
// del default con un paracadute 5/2/0, e un numero che nessuno applica è un
// numero che mente). I bilanci residui si stampano come arrivano nella
// risposta del server (verifierReplyText).

// Le regole del giro (feedback #561): il parser della critica coi livelli e
// la decisione su cosa si corregge. Dagli
// STRUMENTI, per la stessa ragione dei dati qui sopra. Il paracadute è un
// parser minimo: senza il modulo la critica arriva comunque al server, che ha
// la sua copia delle regole e decide lui.
export const VERIFIER_ROUND = (() => {
  try {
    const req = createRequire(import.meta.url);
    req(resolve(TOOLS_ROOT, 'src', 'shared', 'verifierRound.js'));
    if (globalThis.SN_VERIFIER_ROUND && typeof globalThis.SN_VERIFIER_ROUND.parseFindings === 'function') return globalThis.SN_VERIFIER_ROUND;
  } catch (_) { /* checkout senza il modulo: paracadute */ }
  return {
    parseFindings(text) {
      const findings = [];
      for (const line of String(text || '').split('\n')) {
        const m = /^\s*\[\s*([0-3])\s*([ievIEV])\s*(\?)?\s*\]\s*(.+)$/.exec(line);
        if (m) findings.push({ level: Number(m[1]), sede: m[2].toLowerCase(), text: m[4].trim(), decision: m[3] === '?' });
      }
      return { summary: '', findings, rifiutati: [] };
    },
    formatFinding(f) { return `- [${f.level}${f.sede === 'e' || f.sede === 'v' ? f.sede : 'i'}${f.decision ? '?' : ''}] ${f.text}`; },
    formatFindings(list) { return (list || []).map((f) => this.formatFinding(f)).join('\n'); },
    primaFrase(text) { return String(text || '').split('\n')[0].trim().slice(0, 120); },
    groupLabel(g) { return g.tipo; },
  };
})();

/**
 * Legge le impostazioni che l'owner detta alle routine dalla tab Automazioni.
 *
 * PERCHÉ NON È PIÙ UNA LETTURA "BEST-EFFORT" (2026-08-13)
 *   Stavano in `config/automation`, leggibile solo con un bearer admin, e la
 *   lettura era best-effort: senza credenziale si ricadeva sui default **senza
 *   dirlo**. Ma nelle macchine delle routine quella credenziale non c'è mai
 *   (è la causa del registro worker sempre vuoto, feedback #451): quindi
 *   nessuna di quelle impostazioni ha MAI raggiunto una routine cloud. In dashboard sembravano attivi, nei fatti non lo erano.
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
 * @returns {Promise<{enabled?:boolean}>}
 * @throws {Error} con `faultKind` se il documento non è leggibile.
 */
async function fetchRoutineConfig() {
  const fa = await import('./lib/firestore-auth.mjs');
  // `FILO_ROUTINE_CONFIG_URL`: da dove si legge l'interruttore. Esiste per i
  // controlli, che devono poter esercitare il giro intero senza rete — non è
  // un segreto e non cambia niente in produzione, dove non è impostata.
  const url = process.env.FILO_ROUTINE_CONFIG_URL
    || `${fa.FIRESTORE_BASE}/${ROUTINES_DOC}?key=${fa.FIREBASE_API_KEY}`;
  // Lo stesso documento lo rileggevano dispatch e verify-local a ogni
  // invocazione, decine di volte per sessione. La copia vale un minuto: oltre,
  // un interruttore che l'owner ha appena spento potrebbe non essere ancora
  // arrivato, e qui «spento» deve voler dire spento (#680).
  const copia = await import('./lib/config-routine-copia.mjs');
  const attiva = copia.copiaAttiva(process.env);
  const pronta = attiva ? copia.campiDaCopia(url) : null;
  if (pronta) return parseRoutineConfig(pronta.fields);
  const read = async () => {
    const res = await fetch(url);
    // Mai scritto (404) = «l'owner non ha mai toccato niente»: default, e vale
    // la pena ricordarselo come qualsiasi altra risposta.
    if (res.status === 404) { if (attiva) copia.salvaCampiInCopia(url, {}); return {}; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const fields = (json && json.fields) || {};
    if (attiva) copia.salvaCampiInCopia(url, fields);
    return parseRoutineConfig(fields);
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
    verifierVerdict: null,
    verifierCritique: '',
    // Il commit su cui ciascun esito è stato dato: un esito vale per il
    // contenuto esaminato, non per il nome del ramo (feedback #485).
    verifierSha: '',
    secauditDone: false,
    secauditVerdict: null,
    secauditSha: '',
  };
}

// (Qui vivevano classifyReview, reconcileState e chooseBucket: il "vecchio
// cervello" che leggeva la coda e sceglieva il lavoro da questa macchina. È
// stato smontato col ridisegno (SPEC-RIDISEGNO-MAX.md §1): il lavoro arriva
// SOLO dal server col biglietto, e la copia viva di quelle regole è
// filo-security/functions/src/routine/select.js.)

// ─── Transizioni di stato (pure) ──────────────────────────────────────────────

// Gli esiti che il SERVER può dare a una critica (feedback #561): `pass` (nessun
// rilievo da correggere: si prosegue), `fix` (c'è da correggere), `stop` (un
// rilievo di livello 3/2 non correggibile: decide l'owner). Non
// esiste più il verdetto a tre valori scelto dal verificatore: lui registra i
// rilievi coi livelli, l'esito lo calcola il server dai bilanci. I vecchi
// `pass|migliorabile|fail` sulla riga di comando vengono RIFIUTATI: ignorarli
// in silenzio faceva registrare una promozione a chi credeva di bocciare
// (feedback #565), e una ricetta non aggiornata è meglio che si fermi.
export const VERIFIER_OUTCOMES = ['pass', 'fix', 'stop'];
export { MAX_CRITIQUE_BYTES };
// E un pavimento, lo stesso dello strumento locale: una verifica di due parole
// non è una verifica, e vale in tutti e due i sensi. Senza rilievi l'esito
// calcolato è «superata», quindi una critica vuota è una PROMOZIONE, non una
// bocciatura: il pavimento è l'unica cosa che impedisce di promuovere senza
// aver scritto niente (feedback #565).
export const MIN_CRITIQUE_CHARS = 80;
export const LEGACY_VERDICT_WORDS = ['pass', 'migliorabile', 'fail'];

/**
 * Lo specchio locale dell'esito che il server ha calcolato sulla critica.
 * `pass` → verificato; `fix` → giro di correzione aperto; `stop` → fermato.
 * La critica si
 * conserva com'è stata scritta (coi livelli), per il fogliettino locale.
 */
export function applyVerifierVerdict(state, outcome, critique = '', sha = '') {
  const s = { ...defaultState(state?.id, state?.branch), ...(state || {}) };
  // Un esito vale per il CONTENUTO esaminato, non per il nome del ramo: lo sha
  // del commit provato viaggia col verdetto e resta scritto qui accanto
  // (feedback #485). Senza, «verificato» è una firma su una cartella, e basta
  // sostituire il foglio perché resti buona su un contenuto che nessuno ha
  // guardato — chi lavora ha per costruzione il permesso di spingere sul
  // proprio ramo, quindi la finestra si apre da sé.
  if (String(sha || '')) s.verifierSha = String(sha);
  // Una critica nuova apre un giro nuovo: la pulizia di quello prima non ne è la base.
  s.puliziaSha = '';
  s.pulizieDopo = [];
  if (outcome === 'pass') s.verifierVerdict = 'pass';
  else if (outcome === 'fix') s.verifierVerdict = 'fix-pending';
  else if (outcome === 'stop') s.verifierVerdict = 'stop';
  else s.verifierVerdict = String(outcome || '') || null;
  if (typeof critique === 'string' && critique.trim()) s.verifierCritique = critique.trim();
  else if (outcome === 'pass') s.verifierCritique = '';
  return s;
}

/** La correzione è consegnata: si torna in coda per un'altra verifica. */
export function applyFixed(state) {
  const s = { ...defaultState(state?.id, state?.branch), ...(state || {}) };
  s.verifierVerdict = null;
  s.verifierCritique = '';
  s.verifierSha = '';
  s.puliziaSha = '';
  s.pulizieDopo = [];
  s.secauditDone = false;
  s.secauditVerdict = null;
  // Gli sha degli esiti se ne vanno con gli esiti: una correzione è contenuto
  // nuovo, e tenerli vorrebbe dire lasciare in giro la firma di un controllo
  // fatto su un'altra versione (feedback #485).
  s.secauditSha = '';
  return s;
}

/**
 * Il commit da cui chi verifica non deve aver cambiato codice prima della critica, '' se non si controlla. PURA.
 * È la punta consegnata a QUESTO biglietto: un punto fermo locale può essere di un giro passato da un'altra cartella
 * (D-207). Dopo una critica data in questo biglietto il codice si muove di diritto.
 */
export function avvioDellaCritica(state) {
  const avvio = state && state.avvio && typeof state.avvio === 'object' ? String(state.avvio.sha || '') : '';
  if (avvio) return state.criticaNelGiro ? '' : avvio;
  // Uno stato senza `avvio` l'ha posizionato una versione che non lo scriveva.
  return state?.verifierSha ? '' : (lastCheckpoint(state) || '');
}

/**
 * La pulizia dopo la critica: le prove dei rilievi messi da parte tolte PRIMA di correggere. PURA.
 * `controllo` è l'esito di controllaPulizia; da `puliziaSha` parte il confronto di --record-fixed. Una pulizia dopo
 * le correzioni non sposta la base: va in `pulizieDopo`, e la consegna non rilancia ciò che ha tolto.
 */
export function applyPulizia(state, controllo) {
  const s = { ...defaultState(state?.id, state?.branch), ...(state || {}) };
  if (s.verifierVerdict === 'pass') {
    return { ok: false, message: 'dopo una verifica superata la pulizia non si registra: basta il commit che toglie solo le prove, e il rilascio del biglietto la sigilla. Un riallineamento confronta da lì.' };
  }
  if (s.verifierVerdict !== 'fix-pending' || !s.verifierSha) {
    return { ok: false, message: 'nessun giro di correzione aperto: la pulizia si registra subito dopo una critica a cui il server ha risposto «c\'è da correggere», prima di ogni correzione.' };
  }
  const md = s.messiDaParteGiro && s.messiDaParteGiro.sha === s.verifierSha ? s.messiDaParteGiro : null;
  if (!md || !(Number(md.n) > 0)) {
    return { ok: false, message: 'la risposta del server a questa critica non ha messo da parte nessun rilievo: non c\'è niente da pulire. Una prova del giro si toglie solo verde, insieme alla prova durevole che la sostituisce.' };
  }
  if (!controllo || !controllo.ok) return { ok: false, message: `pulizia non registrata: ${(controllo && controllo.motivo) || 'non so cosa è stato tolto.'}` };
  const fuori = testoPuliziaFuoriNumero(controllo, md.numeri);
  if (fuori) return { ok: false, message: fuori };
  if (controllo.dopo) s.pulizieDopo = [...(Array.isArray(s.pulizieDopo) ? s.pulizieDopo : []).filter((x) => x !== controllo.sha), controllo.sha];
  else s.puliziaSha = controllo.sha;
  return { ok: true, state: s, files: controllo.files };
}

/**
 * Il secaudit ha prodotto un verdetto L4. `saltato` è il terzo esito, e non
 * lo dà il ruolo: lo scrive il server quando l'owner, letto il fail, decide
 * di andare avanti (contratto dei livelli, 2026-09-13). Vale come un pass
 * ovunque si guardi il verdetto, ma resta scritto com'è: è una decisione
 * dell'owner, e la copia locale non deve travestirla da controllo superato.
 */
export function applySecaudit(state, verdict, sha = '') {
  const s = { ...defaultState(state?.id, state?.branch), ...(state || {}) };
  s.secauditDone = true;
  s.secauditVerdict = secauditPassato(verdict) ? verdict : 'fail';
  // Lo sha del commit CONTROLLATO, come per la verifica funzionale: era
  // l'ultimo dei due esiti ragionati a non portarselo dietro, e un «passato»
  // legato al solo nome del ramo resta buono anche quando il contenuto cambia
  // sotto (feedback #485).
  if (String(sha || '')) s.secauditSha = String(sha);
  return s;
}

/** Il verdetto L4 lascia passare? `pass` e `saltato` (dall'owner) sì. PURA. */
export function secauditPassato(verdict) {
  return verdict === 'pass' || verdict === 'saltato';
}

// ─── I livelli L3 e L4 (contratto del 2026-09-13) ─────────────────────────────
//
// La NOTA del controllo di sicurezza (cosa ha controllato e cosa ha trovato: il pentagono, `livelli.l4`) arriva da
// un file (`--nota`): markdown di più righe, che sulla riga di comando finirebbe spezzato. Un trade-off per l'owner
// non è più una segnalazione in markdown (L3) ma una domanda in JSON (`--domanda`, #1790).

// La lettura del file (intera, mai tosata, col tetto del server) sta in lib/livelli.mjs. Ri-esportata da qui per chi
// la importava da dispatch.
export { MAX_LIVELLO_BYTES, leggiTestoLivello };
export const SECAUDIT_VERDICTS = ['pass', 'fail'];

// Si tolgono tutte PRIMA di leggere comando, identificativo e testo, come il biglietto: rimasta fra i
// posizionali, la frase finiva nel report e il suo nome faceva da identificativo (#879).
export const OPZIONI_REGISTRAZIONE = {
  // Il server non compone più domande da un markdown (#1790): si riconosce per dire cosa scrivere al suo posto.
  '--segnala': { tipo: 'tolta', comandi: ['--record-verifier', '--record-fixed'] },
  // La domanda per l'owner nel formato di SPEC-DOMANDE §3.1: per chi verifica una per rilievo col `?` (un elenco JSON).
  '--domanda': { tipo: 'file', forma: ' <file.json>', comandi: ['--record-verifier', '--record-fixed'] },
  '--nota': { tipo: 'file', comandi: ['--record-secaudit'] },
  '--frase': { tipo: 'testo', comandi: ['--record-fixed'], manca: 'la riga per chi ha segnalato' },
  // Perché il correttore è stato chiamato (SPEC-RIDISEGNO-LAVORO.md §3, regola 4): senza, la consegna non parte.
  '--motivo': { tipo: 'testo', comandi: ['--record-fixed'], manca: 'il motivo della correzione ("conflitto: <file>", "prove rosse: <prove>", "ripresa" o "altro: <testo>")' },
  '--ferma': { tipo: 'bandiera', comandi: ['--record-fixed'] },
  // La sessione accesa per UN feedback (SPEC-RIDISEGNO-LAVORO.md § 2): riceve il ruolo della sessione, non dell'orchestratore.
  '--feedback': { tipo: 'testo', comandi: ['--preflight'], manca: 'il numero del feedback' },
};
const FORMA_OPZIONE = { file: ' <file.md>', testo: ' "…"', bandiera: '' };

/**
 * Anche come `--opzione=valore`, la forma del canale. PURA. `error`: valore mancante o storto, opzione
 * ripetuta, o un'opzione che il comando non legge.
 * @returns {{ args: string[], valori: Record<string, string|true>, error: string }}
 */
export function leggiOpzioniRegistrazione(list) {
  const lista = Array.isArray(list) ? list.map((a) => String(a ?? '')) : [];
  const args = [];
  const valori = {};
  const no = (error) => ({ args: lista, valori: {}, error });
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    const nome = Object.keys(OPZIONI_REGISTRAZIONE).find((n) => a === n || a.startsWith(`${n}=`));
    if (!nome) { args.push(a); continue; }
    const { tipo, manca, forma } = OPZIONI_REGISTRAZIONE[nome];
    if (tipo === 'tolta') return no(SEGNALA_TOLTA);
    if (tipo === 'bandiera') {
      if (a !== nome) return no(`${nome} non vuole un valore: non ho consegnato niente.`);
      valori[nome] = true;
      continue;
    }
    if (nome in valori) return no(`${nome} va passato una volta sola: non ho consegnato niente.`);
    const v = a === nome ? lista[++i] : a.slice(nome.length + 1);
    if (tipo === 'file') {
      const file = String(v ?? '').trim();
      const estensione = (/\.\w+(?=>)/.exec(forma || '') || ['.md'])[0];
      if (!file || SEMBRA_OPZIONE(file)) return no(`${nome} vuole il percorso di un file subito dopo di sé (un ${estensione} scritto prima): non ho consegnato niente.`);
      valori[nome] = file;
    } else {
      // Un'opzione al posto della frase vuol dire frase dimenticata: presa per frase, il comando o
      // l'identificativo sparivano dalla riga.
      if (v === undefined || sembraOpzioneNelReport(v)) return no(`${nome} vuole ${manca} dopo di sé — non ho consegnato niente.`);
      valori[nome] = v;
    }
  }
  const comando = args[0];
  for (const nome of Object.keys(valori)) {
    const { comandi } = OPZIONI_REGISTRAZIONE[nome];
    if (comandi.includes(comando)) continue;
    const qui = Object.entries(OPZIONI_REGISTRAZIONE).filter(([, o]) => o.comandi.includes(comando) && o.tipo !== 'tolta')
      .map(([n, o]) => `${n}${o.forma || FORMA_OPZIONE[o.tipo]}`);
    return no(String(comando || '').startsWith('--record-')
      ? `${nome} non vale con ${comando}: ${qui.length ? `qui ci sono solo ${qui.join(', ')}` : 'qui non ci sono opzioni'}. Niente è stato toccato.`
      : `${nome} vale solo con ${comandi.join(' e ')}. Niente è stato toccato.`);
  }
  return { args, valori, error: '' };
}

/**
 * Il payload della consegna «corretto», con la domanda se c'è. `sha`: la punta della cartella, che il registro del
 * ramo confronta con quella che troverà dopo (#1148; senza, il server segna il buco). PURA.
 */
export function fixedPayload({ report, frase, branch, ferma, sha, domanda, motivo, riallineamento } = {}) {
  const p = { report: String(report || ''), userNote: String(frase || ''), branch: String(branch || '') };
  if (domanda && typeof domanda === 'object') p.domanda = domanda;
  if (ferma === true) p.stop = true;
  if (/^[0-9a-f]{40}$/.test(String(sha || ''))) p.sha = String(sha);
  if (motivo && typeof motivo === 'object' && motivo.tipo) p.motivo = motivo;
  // Il confronto fatto qui è un'indicazione: il server rifà il suo prima di decidere se serve un giro nuovo.
  if (riallineamento && typeof riallineamento === 'object') p.riallineamento = riallineamento;
  return p;
}

/** `--motivo` del correttore letto con la regola condivisa; senza il modulo (paracadute) passa com'è. PURA. */
export function leggiMotivo(testo) {
  if (typeof VERIFIER_ROUND.leggiMotivoCorrettore === 'function') return VERIFIER_ROUND.leggiMotivoCorrettore(testo);
  const t = String(testo || '').trim();
  return t ? { ok: true, motivo: { tipo: 'altro', testo: t } } : { ok: false, errore: 'Manca il motivo della correzione: --motivo "…".' };
}

/**
 * Il motivo di una consegna `fixed`: obbligatorio solo per il correttore (regola 4), come sul server; per gli altri ruoli,
 * se c'è, vale la stessa forma. `siFerma`: una domanda che blocca, che sul server vale da motivo. PURA.
 */
export function motivoDellaConsegna(testo, ruolo, { siFerma = false } = {}) {
  if (testo === undefined && (ruolo !== 'fixer' || siFerma)) return { ok: true, motivo: null };
  return leggiMotivo(testo);
}

/**
 * Cosa dice il confronto della punta verificata con quella riallineata, accanto al motivo del correttore: la riga da
 * stampare e il campo per il server. `confronto`: l'uscita di fileRiscritti, o null fuori da un riallineamento. PURA.
 */
export function esitoRiallineamento(confronto, motivo) {
  if (!confronto) return { riallineamento: null, riga: '' };
  if (!confronto.ok) {
    return { riallineamento: { fileRiscritti: null, giro: 'pieno' }, riga: `Non riesco a confrontare la punta verificata con questa (${confronto.errore}): il server deciderà da sé, nel dubbio con una verifica intera.` };
  }
  const regola = typeof VERIFIER_ROUND.giroDopoRiallineamento === 'function' ? VERIFIER_ROUND.giroDopoRiallineamento : null;
  if (!regola) return { riallineamento: { fileRiscritti: confronto.file, fileInConflitto: confronto.conflitti || [], giro: 'pieno' }, riga: '' };
  // I conflitti dichiarati contano quanto quelli che dice git: un conflitto in un file di codice chiede la verifica.
  const dichiarati = motivo && Array.isArray(motivo.file) ? motivo.file : [];
  const conflitti = [...new Set([...(confronto.conflitti || []), ...dichiarati])];
  const { giro, codice } = regola(confronto.file, { conflitti });
  const elenco = (l) => `${l.slice(0, 5).join(', ')}${l.length > 5 ? ', …' : ''}`;
  const toccati = [...new Set([...confronto.file, ...conflitti])];
  const righe = [giro === 'nessuno'
    ? `Riallineamento pulito${toccati.length ? ` (toccati solo file di servizio: ${elenco(toccati)})` : ''}: per la regola non serve un giro nuovo di verifica, bastano le prove del server.`
    : `Il riallineamento tocca ${codice.length === 1 ? 'un file di codice' : `${codice.length} file di codice`} (${elenco(codice)}): serve la verifica intera.`];
  const taciuti = motivo && motivo.tipo === 'conflitto' ? (confronto.conflitti || []).filter((f) => !dichiarati.includes(f)) : [];
  if (taciuti.length) righe.push(`Git trova in conflitto anche ${elenco(taciuti)}, che il motivo non nomina: il server confronta da sé, e nel report va cosa hai toccato lì.`);
  return { riallineamento: { fileRiscritti: confronto.file, fileInConflitto: confronto.conflitti || [], giro }, riga: righe.join(' ') };
}

/**
 * Le domande di `--domanda <file.json>`: una, o un elenco (chi verifica ne scrive una per rilievo col `?`), ognuna
 * controllata come la controlla il server. → { ok, domande } | { ok:false, errore }
 */
export async function leggiDomandeDaFile(file, { elenco = false } = {}) {
  let testo = '';
  try { testo = readFileSync(resolve(file), 'utf8'); } catch (e) {
    return { ok: false, errore: `Non leggo ${file} (${e.code || e.message}): non ho consegnato niente.` };
  }
  let grezzo;
  try { grezzo = JSON.parse(testo); } catch (e) {
    return { ok: false, errore: `JSON malformato in ${file}: ${String(e?.message || e).slice(0, 200)}. Non ho consegnato niente.` };
  }
  if (Array.isArray(grezzo) && !elenco) return { ok: false, errore: `${file} ha un elenco di domande: qui ne va una sola. Non ho consegnato niente.` };
  const lista = Array.isArray(grezzo) ? grezzo : [grezzo];
  if (!lista.length) return { ok: false, errore: `${file} ha un elenco vuoto: ogni rilievo col «?» porta la sua domanda. Non ho consegnato niente.` };
  const { leggiDomandaJson } = await import('./domanda.mjs');
  const domande = [];
  for (let i = 0; i < lista.length; i++) {
    const letta = leggiDomandaJson(JSON.stringify(lista[i]), { conOrigine: false });
    if (letta.errore) return { ok: false, errore: `${lista.length > 1 ? `domanda ${i + 1} di ${file}: ` : ''}${letta.errore}` };
    domande.push(letta.domanda);
  }
  return { ok: true, domande };
}

/**
 * Ogni rilievo col `?` prende la sua domanda, nell'ordine della critica (#1790): il server la adotta com'è. Un rilievo
 * senza domanda, o una domanda senza rilievo, ferma prima del server col numero del rilievo. PURA.
 * → { ok, findings } | { ok:false, errore }
 */
export function rilieviConDomanda(findings, domande) {
  const lista = Array.isArray(findings) ? findings.map((f) => ({ ...f })) : [];
  const conSegno = lista.map((f, i) => ({ f, n: i + 1 })).filter((x) => x.f.decision);
  const d = Array.isArray(domande) ? domande : [];
  const riga = (x) => `[${x.f.level}${x.f.sede}?] ${VERIFIER_ROUND.primaFrase(x.f.text, 80)}`;
  if (conSegno.length > d.length) {
    const senza = conSegno.slice(d.length);
    return { ok: false, errore: `${senza.length === 1 ? `il rilievo ${senza[0].n}` : `i rilievi ${senza.map((x) => x.n).join(', ')}`} col «?» `
      + `${senza.length === 1 ? 'non ha' : 'non hanno'} la sua domanda (${senza.map(riga).join('; ')}). Ogni rilievo che chiede una decisione porta la domanda in JSON `
      + 'con almeno due opzioni: con un rilievo «?» il file ha la domanda, con più rilievi un elenco, uno per rilievo nell\'ordine della critica. Non ho registrato niente.' };
  }
  if (d.length > conSegno.length) {
    return { ok: false, errore: `${d.length} ${d.length === 1 ? 'domanda' : 'domande'} per ${conSegno.length} ${conSegno.length === 1 ? 'rilievo' : 'rilievi'} col «?»: `
      + 'una domanda accompagna un rilievo che chiede una decisione. Segna col «?» il rilievo che la domanda decide, o togli la domanda. Non ho registrato niente.' };
  }
  conSegno.forEach((x, k) => { lista[x.n - 1].domanda = d[k]; });
  return { ok: true, findings: lista };
}

/** Lo sha intero della punta della cartella, '' se git non risponde. */
function puntaDellaCartella() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

/**
 * `--ferma` da solo non ferma niente: è la domanda che blocca a fermare il lavoro, e
 * senza l'owner non saprebbe cosa decidere. Ritorna la frase che ferma, o ''. PURA.
 */
export function fermaSenzaDomanda(ferma, domanda) {
  if (!ferma || String(domanda || '').trim()) return '';
  return [
    '--ferma da solo non ferma niente: è la domanda che blocca (--domanda <file.json>) a fermare il lavoro, e non ho consegnato niente.',
    'Fermarsi chiama l\'owner, e senza la domanda non saprebbe cosa decidere: scrivila in JSON (titolo, almeno due opzioni con pro e contro, consiglio), poi rilancia con --domanda (--ferma puoi toglierlo).',
  ].join('\n');
}

/**
 * Il payload del verdetto L4, con la nota se c'è. PURA.
 *
 * Porta lo `sha` del commit CONTROLLATO, come il verdetto della verifica
 * funzionale: senza, l'esito è legato al solo nome del ramo — una firma su
 * «il documento nella cartella X» invece che su quella esatta versione — e
 * resta buono anche dopo che il contenuto è stato sostituito (feedback #485).
 * Il campo c'è sempre: un verdetto senza il commit controllato non si
 * distingue da uno dato su un contenuto qualunque.
 */
export function secauditPayload({ verdict, branch, testo, sha } = {}) {
  const p = { verdict: String(verdict || ''), branch: String(branch || ''), sha: String(sha || '') };
  if (String(testo || '').trim()) p.testo = String(testo).trim();
  return p;
}

/**
 * Un `pass` senza nota non si consegna: il server lo respingerebbe, e prima
 * ancora un «passato» senza cosa è stato guardato non si distingue da un
 * controllo mai fatto. Ritorna la frase che ferma, '' se si può consegnare.
 * Su `fail` la nota resta dovuta (è quello che l'owner legge per decidere),
 * ma senza il server mette una frase standard: non si ferma qui. PURA.
 */
export function secauditSenzaNota(verdict, testo) {
  if (verdict !== 'pass' || String(testo || '').trim()) return '';
  return [
    'Un «pass» senza nota non si registra: il server lo respinge, e un controllo passato senza dire cosa è stato guardato non si distingue da un controllo mai fatto.',
    'Scrivi un file .md con cosa hai controllato (i pattern cercati, le parti del diff lette) e cosa hai trovato, in breve e senza nomi di file o funzioni: è quello che l\'owner legge cliccando il pentagono in dashboard.',
    'Poi rilancia: node scripts/dispatch.mjs --record-secaudit <id> pass --nota <file.md>',
  ].join('\n');
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
  // Ogni caso riceve solo il suo testo: il riallineamento dopo un conflitto
  // (fixer) non si porta dietro le istruzioni del primo passaggio.
  fixer: 'resolver-rebase.md',
  'new-work': 'resolver.md',
  resolver: 'resolver.md',
  // «Gestisci la risposta» (#1152): un ruolo solo per ogni risposta, qualunque cosa chieda l'owner.
  risposta: 'risposta.md',
  // «Gestisci la domanda» (#1790): ogni domanda per l'owner passa da qui alla nascita, prima di arrivargli.
  smistamento: 'smistamento.md',
  halt: 'halt.md',
};
// Un halt che non è un guasto ha il suo testo: rilasciare con `--guasto` fermerebbe le routine per niente (#1796).
const HALT_KIND_FILE = {
  strumenti_vecchi: 'halt-strumenti-vecchi.md',
};
// Il correttore ha due casi (payload.case), e la ripresa dopo la risposta
// dell'owner non è un rebase: un caso sconosciuto vale il riallineamento.
const FIXER_CASE_FILE = {
  riallineamento: ROLE_FILE.fixer,
  ripresa: 'resolver-ripresa.md',
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
// Riempita dalla guardia quando NON ha potuto guardare (niente remoto, rete
// assente): finisce nei log, così un controllo saltato non somiglia a un
// controllo passato.
let nonVerificato = '';

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
    try {
      g(['merge', '--ff-only', `origin/${MAIN_BRANCH}`]);
    } catch (_) {
      return `il checkout non si allinea a '${MAIN_BRANCH}' con un avanzamento pulito: gli strumenti fissati sarebbero già vecchi (${viaDiFuga})`;
    }
    if (g(['rev-parse', 'HEAD']) !== la) {
      return `il checkout non si è allineato a '${MAIN_BRANCH}': gli strumenti fissati sarebbero già vecchi (${viaDiFuga})`;
    }
  } catch (e) {
    // Niente git, nessun remoto, rete assente: qui si fallisce APERTI, perché
    // questo controllo esiste per accorgersi di una deriva, non per essere il
    // punto in cui un giro muore perché il fetch non è passato.
    //
    // Ma NON in silenzio: fallire aperti senza dirlo equivale a non avere la
    // guardia. Con un remoto chiamato in un altro modo il controllo saltava e
    // il giro fissava strumenti vecchi con un tranquillo "prontezza OK". Chi
    // legge i log deve poter distinguere "verificato" da "non ho potuto
    // guardare".
    nonVerificato = String((e && e.message) || e).split('\n')[0].slice(0, 120);
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

/**
 * L'avvertenza di serie: quando lo stesso lavoro ha già collezionato più
 * bocciature, chi riparte deve saperlo PRIMA di mettersi al lavoro. PURA.
 *
 * Non basta l'istruzione generica "causa non sintomo" nel file di ruolo: a
 * ogni giro il lavorante riparte con un contesto fresco in cui "il problema"
 * è l'ultima critica, e rispetto a quella la causa la trova davvero. Quello
 * che non può vedere da solo è la SERIE — tre bocciature con lo stesso danno
 * da porte diverse — perché nessuno gliela mette davanti. Questa nota
 * gliela mette davanti (caso #502: sei giri per un difetto da due).
 *
 * @param {string} role     ruolo del lavorante
 * @param {Array}  history  critiche dei giri passati (dal server)
 * @returns {string} '' se non c'è niente da dire
 */
export function serialAwarenessNote(role, history, dropped = 0) {
  const n = Array.isArray(history) ? history.length : 0;
  if (n < 2) return '';
  // Le critiche più vecchie tolte dalla serie (tetto del server): dirlo, o chi
  // legge crede che i giri mancanti non siano mai esistiti e non può
  // ri-provarne le porte (verifica del giro 9 su #561).
  const d = Number(dropped) || 0;
  const tolte = d > 0
    ? [`${d === 1 ? 'Una critica più vecchia NON è' : `${d} critiche più vecchie NON sono`} nel fascicolo (la serie tiene solo le ultime): le porte di quei giri non si possono ri-provare da qui, e non vanno date per chiuse.`, '']
    : [];
  // Solo chi verifica: è lui che vede la serie e che poi corregge. Al
  // riallineamento dopo un conflitto la serie non serve, e un'avvertenza che
  // ordina di curare la causa contraddirebbe il suo testo.
  if (role === 'verifier') {
    return [
      `## ⚠️ Avvertenza di serie: sei al giro ${n + d + 1} di verifica su questo lavoro`,
      '',
      ...tolte,
      'Le critiche dei giri passati sono in `payload.history` (dalla più vecchia).',
      'Se raccontano lo stesso danno da porte diverse, non limitarti a cercare la',
      'porta successiva: elenca nella STESSA critica tutte quelle che trovi, così',
      'la prossima correzione le chiude insieme invece che una per giro.',
    ].join('\n');
  }
  return '';
}

// ─── Lavori server (SPEC-DOMANDE.md §7, mappa #1159 §1.5) ─────────────────────

const LAVORO_SERVER_FILE = '_lavoro-server.md';

/** Dove sta il clone di filo-security di un lavoro server: fuori dal checkout di Filo. PURA (legge l'ambiente). */
export function cartellaCloneServer(env = process.env) {
  return resolve(String(env.FILO_SERVER_CLONE || '').trim() || join(homedir(), 'filo-security'));
}

export { cloneDentroIlRepo };

/**
 * Una routine con più repository parte dalla cartella sopra i cloni (#1761): lì i passi dell'orchestratore senza
 * percorso (git, setup) cadrebbero fuori da Filo. → la riga che lo manda nella radice, o '' se ci sta già. PURA.
 */
export function rigaCartellaDiPartenza(cwd, root) {
  if (!String(cwd || '').trim() || cloneDentroIlRepo(cwd, root)) return '';
  const radice = String(resolve(root)).split('\\').join('/');
  return `La sessione è partita da ${cwd}, fuori dal checkout di Filo. Prima di ogni altro passo, in una chiamata da sola: cd "${radice}". I passi qui sotto partono da lì.`;
}

/** Le istruzioni del lavoro server, coi percorsi veri del clone e dello strumento delle credenziali. */
export function testoLavoroServer({ clone, canale = resolve(TOOLS_ROOT, 'scripts', 'routine-channel.mjs') } = {}) {
  const f = resolve(ROLES_DIR, LAVORO_SERVER_FILE);
  if (!existsSync(f)) return '';
  const avanti = (p) => String(p).split('\\').join('/');
  return readFileSync(f, 'utf8').split('<CLONE>').join(avanti(clone)).split('<CANALE>').join(avanti(canale));
}

// L'ambito della verifica (payload.scope) sceglie il testo: lib/verifier-scope.mjs.
export { verifierScope };
export function perimetroNote(scope, perimetro) {
  return perimetroNoteBase(scope, perimetro, (l) => VERIFIER_ROUND.formatFindings(l));
}

export function readRoleInstructions(role, { scope, caso } = {}) {
  const name = role === 'verifier' ? VERIFIER_SCOPE_FILE[verifierScope(scope).scope]
    : role === 'fixer' ? (Object.hasOwn(FIXER_CASE_FILE, String(caso || '')) ? FIXER_CASE_FILE[String(caso)] : ROLE_FILE.fixer)
      : role === 'halt' && Object.hasOwn(HALT_KIND_FILE, String(caso || '')) ? HALT_KIND_FILE[String(caso)]
        : ROLE_FILE[role];
  if (!name) return '';
  const f = resolve(ROLES_DIR, name);
  const base = existsSync(f) ? espandiInclusioni(readFileSync(f, 'utf8'), ROLES_DIR) : '';
  if (!base || !RUOLI_LAVORABILI.includes(role)) return absolutizeRecipe(base, TOOLS_ROOT, ROOT);
  const c = resolve(ROLES_DIR, WORKER_CONTRACT_FILE);
  // Il contratto ha pezzi in comune con halt (la domanda di fine sessione): si espande come i ruoli.
  const contract = existsSync(c) ? espandiInclusioni(readFileSync(c, 'utf8'), ROLES_DIR) : '';
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
 *   - fixer    (caso `riallineamento`): il feedback, per capire le intenzioni
 *              in conflitto, e il perché scritto dal server (`critique`): un
 *              conflitto, o gli unit rossi sulla fusione con il loro elenco (#929).
 *   - new-work (resolver, caso `primo-passaggio`): il feedback decifrato.
 *
 * @param {object} bucket  bucket costruito dalla busta del server
 * @param {object} ctx     { diff?, feedback? } dati già raccolti dal chiamante
 */
// Le decisioni dell'owner fanno parte della richiesta per chi verifica, risolve
// e corregge: il server le mette nel payload, e qui non si perdono per strada.
function conDecisioni(ctx) {
  return Array.isArray(ctx && ctx.decisioni) && ctx.decisioni.length ? { decisioni: ctx.decisioni } : {};
}
// Le schermate della segnalazione e delle risposte (#900): le apre il server, `scaricaPayload` le scrive su file.
function conImmagini(ctx) {
  return Array.isArray(ctx && ctx.immagini) && ctx.immagini.length ? { immagini: ctx.immagini } : {};
}

// Perché un diff vuoto è vuoto davvero: senza questa riga il controllo non lo distingue da un calcolo fallito (#740).
// Con un diff del server da giudicare non dice «nessuna modifica»: farebbe passare il server senza leggerlo (#1418).
function testoDiffVuoto({ commitPropri = null } = {}, diffServer = '') {
  const perche = commitPropri === 0
    ? 'il ramo non ha commit propri rispetto a main'
    : `il ramo ${commitPropri > 0 ? `ha ${commitPropri} commit propri, ma ` : ''}ha lo stesso contenuto della sua base comune con main (modifiche che si annullano a vicenda)`;
  if (diffServer) return `Il diff dell'app è vuoto davvero, ma è vuoto solo lui: ${perche}. Il diff del server (diffServerFile) porta le modifiche del lavoro e resta da giudicare intero, come dice il paragrafo «Lavoro server»: il diff dell'app vuoto non fa passare il controllo.`;
  return commitPropri === 0 ? `Il diff è vuoto davvero: ${perche}, quindi non porta nessuna modifica.` : `Il diff è vuoto davvero: ${perche}.`;
}

// Il piano che una sessione precedente ha scritto per questo lavoro (SPEC-RIDISEGNO-LAVORO.md § 2): chi riprende
// riparte da lì. Lo conserva e lo rimanda il server.
function conPiano(ctx) {
  return typeof ctx.piano === 'string' && ctx.piano.trim() ? { piano: ctx.piano } : {};
}

/**
 * Le fusioni su main che citano il feedback, dopo la sua nascita (regola 5): quelle che il server ha già trovato, o
 * quelle che dice git qui. `propria`: la fusione del suo stesso lavoro, cioè un feedback riaperto dall'owner.
 */
function suMainDi(bucket, ctx) {
  const num = numeroFeedback(bucket && bucket.num);
  if (Array.isArray(ctx && ctx.suMain)) return segnaProprie(ctx.suMain, num);
  if (!num) return [];
  try {
    const nato = Date.parse((ctx && ctx.feedback && ctx.feedback.createdAt) || '') || 0;
    return segnaProprie(fusioniCheCitano(ROOT, num, { dopo: nato }), num);
  } catch (_) {
    return [];
  }
}

/** Segna `propria` la fusione del lavoro stesso del feedback («merge-gate: #N …»). PURA. */
export function segnaProprie(fusioni, num) {
  const n = numeroFeedback(num);
  const propria = new RegExp(`^merge-gate: #${n.replace('.', '\\.')}\\b(?!\\.\\d)`);
  return (Array.isArray(fusioni) ? fusioni : []).map((f) => (n && propria.test(String(f.oggetto || '')) ? { ...f, propria: true } : f));
}

export function buildPayload(bucket, ctx = {}) {
  switch (bucket.role) {
    case 'secaudit': {
      const server = ctx.diffServer && typeof ctx.diffServer === 'object' ? {
        diffServer: String(ctx.diffServer.diff || ''),
        diffServerBase: ctx.diffServer.base || null,
        diffServerHead: String(ctx.diffServer.head || ''),
      } : {};
      // NESSUN campo del feedback: solo branch + diff, con la base e la punta su cui è calcolato.
      return {
        branch: bucket.branch, diff: ctx.diff || '', id: bucket.id, num: bucket.num,
        ...(ctx.diffBase && ctx.diffBase.sha ? {
          diffBase: ctx.diffBase,
          ...(ctx.diffHead ? { diffHead: ctx.diffHead, diffComando: `git diff ${ctx.diffBase.sha}...${ctx.diffHead}` } : {}),
        } : {}),
        ...server,
        ...(ctx.diffVuoto ? { diffVuoto: testoDiffVuoto(ctx.diffVuoto, server.diffServer) } : {}),
      };
    }
    case 'verifier':
      // Sintomo (feedback) + branch, MAI il diff né il report del risolutore.
      // Lo STORICO delle critiche dei giri passati invece sì (è linguaggio
      // sintomo, scritto dai verificatori precedenti, non il racconto di chi
      // ha risolto): senza, ogni giro trova UNA porta e la serie non converge.
      return {
        branch: bucket.branch, id: bucket.id, num: bucket.num,
        feedback: ctx.feedback || null,
        ...conDecisioni(ctx),
        ...conImmagini(ctx),
        history: Array.isArray(ctx.history) ? ctx.history : [],
        historyDropped: Number(ctx.historyDropped) || 0,
        scope: verifierScope(ctx.scope).scope,
        ...(ctx.perimetro && typeof ctx.perimetro === 'object' ? { perimetro: ctx.perimetro } : {}),
      };
    case 'fixer': {
      // La ripresa dopo la risposta dell'owner: il lavoro si era fermato su una
      // domanda, e chi riprende riceve domanda, risposta, i rilievi fermi e
      // la serie delle critiche (il lavoro può essere a metà di un giro).
      const rip = ctx.ripresa && typeof ctx.ripresa === 'object' ? ctx.ripresa : null;
      if (rip) {
        return {
          case: 'ripresa', branch: bucket.branch, id: bucket.id, num: bucket.num,
          feedback: ctx.feedback || null, ripresa: rip, ...conDecisioni(ctx), ...conImmagini(ctx), ...conPiano(ctx),
          history: Array.isArray(ctx.history) ? ctx.history : [],
          historyDropped: Number(ctx.historyDropped) || 0,
        };
      }
      // Riallineamento del ramo: il lavoro era già verificato, quindi niente serie. Il perché lo scrive il server
      // (conflitto, o unit rossi sulla fusione con l'elenco dei test, #929): senza, chi riallinea non sa perché la fusione
      // si è fermata. Quei test non li corregge lui (#1204).
      return {
        case: 'riallineamento',
        branch: bucket.branch,
        id: bucket.id,
        num: bucket.num,
        feedback: ctx.feedback || null,
        ...(typeof ctx.critique === 'string' && ctx.critique.trim() ? { critique: ctx.critique } : {}),
        ...conDecisioni(ctx),
        ...conImmagini(ctx),
      };
    }
    case 'new-work': {
      const out = { case: 'primo-passaggio', id: bucket.id, num: bucket.num, feedback: ctx.feedback || null, ...conDecisioni(ctx), ...conImmagini(ctx) };
      // Chi lo ha preceduto aveva chiesto prima di avere un ramo, e l'owner ha
      // risposto: la domanda e la risposta viaggiano col lavoro, o si richiede.
      if (ctx.ripresa && typeof ctx.ripresa === 'object') out.ripresa = ctx.ripresa;
      return { ...out, ...conPiano(ctx), ...(Array.isArray(ctx.suMain) && ctx.suMain.length ? { suMain: ctx.suMain } : {}) };
    }
    case 'risposta': {
      const { role: _ruolo, ...resto } = (ctx && ctx.risposta) || {};
      return { ...resto, case: 'risposta', num: bucket.num || '' };
    }
    case 'smistamento': {
      const { role: _ruolo, ...resto } = (ctx && ctx.smistamento) || {};
      return { ...resto, case: 'smistamento', num: bucket.num || '' };
    }
    case 'halt':
      // Guasto: nessun lavoro, solo il motivo per cui non si può lavorare.
      return { kind: bucket.kind || 'transient', message: bucket.message || '' };
    default:
      return {};
  }
}

// ─── git (best-effort, come negli altri script di routine) ────────────────────

function tryGit(args) {
  try { return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; }
}

/**
 * Il diff del ramo contro il main di GitHub, con la base e la punta su cui è calcolato: chi lo ricalcola usa
 * quelle. Un diff che git non sa calcolare esce con `ok: false` e il motivo, mai come diff vuoto (#740); uno vuoto
 * esce solo se il contenuto del ramo è davvero quello della base comune, e lo dichiara in `vuoto`.
 * @returns {{ok:true, diff:string, base:{ref:string, sha:string}, head:string, vuoto?:{commitPropri:number|null}}
 *   | {ok:false, motivo:string, diff:'', base:object|null, head:string}}
 */
export function diffForBranch(branch, root = ROOT, { main = MAIN_BRANCH, passi } = {}) {
  // Il diff non si ripulisce: gli spazi in fondo all'ultima riga fanno parte del ramo.
  const git = (args, { grezzo = false } = {}) => {
    try {
      const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30, timeout: TETTO_STORIA_MS });
      return { ok: true, out: grezzo ? out : out.trim() };
    } catch (e) {
      return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message || e) };
    }
  };
  const primaRiga = (s) => String(s || '').split(/\r?\n/).find((r) => r.trim()) || '';
  const guasto = (motivo, base = null, head = '') => ({ ok: false, motivo, diff: '', base, head });
  if (!branch) return guasto('nessun ramo di cui calcolare il diff');
  // La base è il main REMOTO: quello locale, nel clone delle routine, è indietro di decine di versioni e gonfia il
  // diff di modifiche già fuse. Il refspec è esplicito perché in un clone a ramo singolo `fetch origin main` non
  // crea origin/main; e niente ripiego sul main locale, che è proprio la base sbagliata.
  const f = git(['fetch', '--quiet', 'origin', `+refs/heads/${main}:refs/remotes/origin/${main}`]);
  const baseSha = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${main}^{commit}`]);
  if (!baseSha.ok) {
    return guasto(`non ho origin/${main} da usare come base${f.ok ? '' : `, e scaricarlo non riesce (${primaRiga(f.out)})`}`);
  }
  // Senza download riuscito si usa l'ultimo origin/main scaricato: più vecchio, il diff può solo crescere.
  if (!f.ok) process.stderr.write(`[dispatch] origin/${main} non si aggiorna (${primaRiga(f.out)}): diff calcolato sull'ultima copia scaricata\n`);
  const base = { ref: `origin/${main}`, sha: baseSha.out };
  // Il ramo può esistere solo su origin (worker/* pushato ma non in locale).
  const ref = [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]
    .find((r) => git(['rev-parse', '--verify', '--quiet', r]).ok);
  const headSha = ref ? git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) : { ok: false };
  if (!headSha.ok) return guasto(`il ramo ${branch} non c'è, né qui né fra quelli scaricati da origin`, base);
  const head = headSha.out;
  // Un clone poco profondo non ha la base comune: si scarica la storia che manca, come per la fusione di prova.
  const storia = assicuraStoria({ git, mainSha: base.sha, punta: head, main, ...(passi ? { passi } : {}) });
  if (storia.errore) return guasto(storia.errore, base, head);
  const comune = git(['merge-base', base.sha, head]);
  if (!comune.ok) return guasto(`ramo e origin/${main} non hanno una base comune`, base, head);
  // Fra gli sha, non fra i nomi: il diff è esattamente quello del comando che il payload dichiara.
  const r = git(['diff', `${base.sha}...${head}`], { grezzo: true });
  if (!r.ok) return guasto(`git diff non riesce (${primaRiga(r.out)})`, base, head);
  if (r.out) return { ok: true, diff: r.out, base, head };
  // Vuoto vale solo se l'albero del ramo è quello della base comune: è la prova che non passa dal testo del diff.
  const albero = (sha) => git(['rev-parse', '--verify', '--quiet', `${sha}^{tree}`]);
  const [a, b] = [albero(comune.out.split('\n')[0]), albero(head)];
  if (!a.ok || !b.ok || a.out !== b.out) return guasto('il diff è uscito vuoto ma il ramo cambia dei file rispetto alla base comune con main', base, head);
  const propri = git(['rev-list', '--count', `${base.sha}..${head}`]);
  return { ok: true, diff: '', base, head, vuoto: { commitPropri: propri.ok ? Number(propri.out) : null } };
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
 * Un guasto non si traveste da "giornata tranquilla": è già costato
 * un'ondata di lavoro fantasma.
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
/**
 * Il motivo di un rifiuto del server, per chi lo legge a schermo: il codice e,
 * se il server l'ha detta, la frase («malformed: critica vuota …»). Prima
 * arrivava il solo codice e «leggi il motivo» era un invito a leggere niente
 * (verifica del giro 4 su #561). PURA.
 */
export function motivoRifiuto(r) {
  const reason = String((r && r.reason) || '');
  const detail = String((r && r.detail) || '').trim();
  return detail ? `${reason}: ${detail}` : reason;
}

async function deliverToChannel(intent, data) {
  const ticket = readRoutineTicket(ROOT);
  // Senza biglietto il server non viene nemmeno chiamato: dirlo con le parole
  // di un server giù ha già mandato un worker a diagnosticare per mezz'ora un
  // guasto di rete che non esisteva (25 agosto, verifica di #444).
  if (!ticket) {
    process.stderr.write('[dispatch] nessun biglietto trovato (né promemoria né --ticket): il server NON è stato chiamato\n');
    return { outcome: 'absent', reason: 'biglietto non trovato' };
  }
  try {
    const ch = await import('./routine-channel.mjs');
    const r = await ch.deliver(ticket, intent, data);
    if (r.outcome === 'fault') {
      process.stderr.write(`[dispatch] canale non raggiungibile (${r.reason}): la decisione NON è stata registrata\n`);
    } else if (r.outcome === 'refused') {
      process.stderr.write(`[dispatch] consegna RIFIUTATA dal server (${motivoRifiuto(r)}): non ripiego, la decisione non viene registrata\n`);
    }
    return r;
  } catch (e) {
    process.stderr.write(`[dispatch] canale non utilizzabile (${e?.message || e}): la decisione NON è stata registrata\n`);
    return { outcome: 'fault', reason: String(e?.message || e) };
  }
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
 * proteggere su questo branch.
 */
function sealTransition(state, by) {
  const sealed = clearRejects(withCheckpoint(state, headSha(ROOT), by));
  writeState(sealed);
  clearExpectation(ROOT);
  return sealed;
}

/**
 * La critica del verificatore, registrata sul server (feedback #561).
 *
 * Il testo si legge col formato dei livelli (`[2i] …`, una riga per rilievo,
 * `[1?]` = chiede una decisione dell'owner; le righe prima del primo rilievo
 * sono il riassunto). Al server arrivano i rilievi STRUTTURATI, il riassunto,
 * la critica intera e il commit su cui è stata fatta la prova: il pass vale
 * per quel commit. L'ESITO lo calcola il server e torna nella risposta, che
 * si stampa intera: non sta da nessun'altra parte.
 */
async function recordVerifier(id, critiqueText, domande = []) {
  const guard = guardIdentity(id);
  if (!guard.ok) return { rejected: true, rebase: !!guard.rebase, altrove: !!guard.altrove && !guard.escalated, message: guard.message };
  // Un livello fra parentesi quadre che non apre una riga («Rilievo [2]: …»)
  // non è un rilievo, e mandarlo così faceva passare un [2] in silenzio: si
  // ferma qui, prima del server, con la riga da sistemare.
  const brutte = typeof VERIFIER_ROUND.unparsedLevelLines === 'function' ? VERIFIER_ROUND.unparsedLevelLines(critiqueText) : [];
  if (brutte.length) {
    // Un rifiuto di FORMATO, non della guardia d'identità: il testo di quella
    // («la directory non corrisponde al branch») mandava il verificatore a
    // controllare ramo e cartella invece della riga (verifica del giro 4).
    return { rejected: true, formatRejected: true, message: `critica non registrata: rilievi non riconosciuti. Le parentesi quadre con dentro un livello sono SEMPRE un rilievo, dovunque stiano nella riga: nel riassunto e nei passi un livello si cita a parole («il livello 2»), mai «[2i]». Il livello, fra 0 e 3, va a inizio riga seguito dalla sede — «i» se tocca a questo lavoro, «v» se è di un altro lavoro ma sta in un file che il ramo modifica già, «e» se è un altro lavoro — e dal testo del rilievo, una riga per rilievo («[2i] testo», «[1e?] testo», anche «- [2i]», «1. [2i]», «### [2i]»). Righe da sistemare:\n  ${brutte.join('\n  ')}` };
  }
  // Stesso tetto del server, detto QUI prima del viaggio e col numero: mai un
  // taglio silenzioso (CLAUDE.md § Limiti).
  const troppo = criticaTroppoLunga(critiqueText);
  if (troppo) return { rejected: true, formatRejected: true, message: `critica non registrata: ${troppo}` };
  // Il pass vale per il commit dichiarato qui sotto. Se nella directory ci sono
  // file non registrati (di solito le spec temporanee della verifica), il
  // salvataggio automatico li committerà DOPO la registrazione, la punta si
  // sposterà e il cancello dirà «la verifica vale per un altro commit» (#256:
  // le spec tolte tredici secondi dopo il pass, e il lavoro fermo due giorni).
  // Si rifiuta PRIMA, con l'elenco: si pulisce e si riprova.
  const stato = statoDirectory(ROOT);
  if (!stato.ok) {
    return { rejected: true, formatRejected: true, message: statoIllegibileText(stato.motivo) };
  }
  if (stato.lines.length) {
    return { rejected: true, formatRejected: true, message: dirtyTreeText(stato.lines) };
  }
  const avvio = avvioDellaCritica(guard.state);
  if (avvio) {
    const fermo = codiceCambiatoDallAvvio(avvio, ROOT);
    if (fermo.cambiati.length) return { rejected: true, formatRejected: true, message: testoCodiceCambiato(fermo.cambiati, avvio) };
  }
  const parsed = VERIFIER_ROUND.parseFindings(critiqueText);
  const conDomande = rilieviConDomanda(parsed.findings, domande);
  if (!conDomande.ok) return { rejected: true, formatRejected: true, message: `critica non registrata: ${conDomande.errore}` };
  const base = { ...defaultState(id, ''), ...(guard.state || {}), id };

  // PRIMA il server, POI lo stato locale. L'ordine non è un dettaglio: lo stato
  // locale finisce su git, e se lo si scrivesse prima, una critica RIFIUTATA
  // lascerebbe scritto "verificato" da una parte e niente dall'altra — con i
  // due cammini che divergono nella direzione più permissiva, che è
  // esattamente quella da cui questa spec viene a togliere l'autorità.
  // Il testo parte con gli a capo veri (una barra-n scritta come a capo vale
  // come a capo): è quello che il server conserva per il verificatore dopo.
  const critiqueNorm = typeof VERIFIER_ROUND.normalizeCritique === 'function' ? VERIFIER_ROUND.normalizeCritique(critiqueText) : String(critiqueText || '');
  // Il commit PROVATO: va al server col verdetto e resta scritto nello stato
  // locale accanto all'esito. Uno solo, letto una volta: leggerlo due volte
  // vorrebbe dire poter mandare al server uno sha e scriverne un altro qui.
  const shaProvato = headSha(ROOT) || '';
  const sent = await deliverToChannel('verdict', {
    // Ogni rilievo col «?» porta la sua domanda (#1790): il server la adotta com'è, e non ne compone.
    findings: conDomande.findings,
    summary: parsed.summary,
    // Intero, non tosato: il server legge i rilievi dal TESTO e li confronta
    // con l'elenco (verifica del giro 6 su #561); un testo mozzato a 4000
    // caratteri perdeva i rilievi in coda e la consegna veniva respinta come
    // «elenco che non combacia». Tosa lui, per la storia, dopo aver letto.
    critique: critiqueNorm.trim(),
    branch: base.branch || '',
    sha: shaProvato,
  });
  if (sent.outcome === 'refused') {
    return { rejected: true, fromChannel: true, message: `critica non accettata (${motivoRifiuto(sent)})` };
  }
  if (sent.outcome === 'absent') {
    // Biglietto introvabile ≠ server giù: sono due frasi diverse perché sono
    // due rimedi diversi (ripassare il biglietto vs fermarsi).
    return { rejected: true, ticketMissing: true, message: 'critica non registrata: nessun biglietto trovato' };
  }

  if (sent.outcome !== 'ok') {
    // Il server non risponde. Non c'è più una seconda strada su cui posare la
    // critica: dirlo è l'unica cosa onesta, perché una critica che nessuno ha
    // registrato ma che il ramo dà per data è peggio di una mancante.
    return { rejected: true, serverDown: true, message: `critica non registrata: il server non risponde (${sent.reason})` };
  }
  const reply = numeraRisposta(sent.reply && typeof sent.reply === 'object' ? sent.reply : {}, parsed.findings);
  // Un «ok» senza esito non è un pass: l'esito lo calcola il server, e se non
  // l'ha detto nessuno l'ha calcolato. Darlo per superato stampava «rilascia
  // il biglietto» anche con un rilievo di livello 2 nella critica (verifica
  // del giro 3 su questo lavoro).
  const outcome = VERIFIER_OUTCOMES.includes(reply.outcome) ? reply.outcome : 'non comunicato';
  const next = applyVerifierVerdict(base, outcome, critiqueText, shaProvato);
  next.id = id;
  // I rilievi messi da parte su QUESTO commit, col loro posto nella critica: la pulizia toglie solo le loro prove.
  const daParte = derivatiAperti(reply.phase2 ? reply.phase2.derived : reply.derived);
  next.messiDaParteGiro = outcome === 'fix'
    ? { sha: shaProvato, n: daParte.reduce((k, d) => k + d.rilievi.length, 0), numeri: daParte.flatMap((d) => d.rilievi.map((f) => f.n)).filter(Number.isInteger), avvio: avvio || '' }
    : null;
  next.criticaNelGiro = true;
  sealTransition(next, `verifier:${outcome}`);
  next.reply = reply;
  return next;
}

/**
 * La risposta del server alla critica, come si stampa a schermo. PURA.
 * Quando c'è da correggere stampa i rilievi, quelli messi da parte, i bilanci
 * residui e la coda che arriva dal server; senza, l'esito e basta.
 */
// I file che il salvataggio automatico committerebbe DOPO la registrazione
// della critica, e il rifiuto con l'elenco: stanno in lib/dirty-tree.mjs,
// perché la stessa regola vale sulla strada locale (verify-local critica).
// Ri-esportati da qui per chi li importava da dispatch.
export { dirtyTreeLines, dirtyTreeText, statoDirectory, statoIllegibileText };

// Il testo della fase 2 lo scrive l'owner e può non nominarla: la regola che
// ferma la dice lo strumento, o chi corregge non la scopre mai.
export const FERMA_NOTE = [
  'Se un rilievo non si può correggere senza una decisione dell\'owner (un trade-off vero, una scelta di',
  'prodotto), scrivi la domanda in JSON (titolo, almeno due opzioni con pro e contro, consiglio) e consegna',
  'quello che hai fatto:',
  '  node scripts/dispatch.mjs --record-fixed <id> "<report>" --domanda <file.json>',
  'Una domanda che blocca FERMA il lavoro: non torna in verifica, aspetta l\'owner, e riprende da lì quando ha',
  'risposto. Senza domanda torna in coda per un\'altra verifica. Un difetto non è una domanda.',
].join('\n');

/**
 * I feedback derivati aperti dal server per questo giro, uno per feedback: il
 * numero, la priorità, il tipo del gruppo (derivedGroups) e i rilievi che
 * contiene. Il server manda un rilievo per voce, e quelli di un feedback
 * accorpato portano lo stesso numero; qui si rimettono insieme. Accetta anche
 * voci già raggruppate (`findings`) e la forma di un server vecchio (un
 * oggetto solo, col numero). PURA.
 */
export function derivatiAperti(derived) {
  const list = Array.isArray(derived) ? derived : (derived && derived.num ? [derived] : []);
  const voci = [];
  const perNumero = new Map();
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const rilievi = Array.isArray(f.findings) ? f.findings.filter((x) => x && typeof x === 'object') : [f];
    const num = String(f.num || '').trim();
    const priorita = Number.isFinite(Number(f.priority)) ? Number(f.priority) : (Number.isFinite(Number(f.level)) ? Number(f.level) : null);
    const gia = num ? perNumero.get(num) : null;
    if (gia) {
      gia.rilievi.push(...rilievi);
      if (priorita != null && (gia.priority == null || priorita > gia.priority)) gia.priority = priorita;
      continue;
    }
    const primo = rilievi[0] || {};
    const tipo = ['esterno', 'decisione', 'rimasti'].includes(f.tipo) ? f.tipo
      : primo.sede === 'e' ? 'esterno' : primo.decision === true ? 'decisione' : 'rimasti';
    const voce = { rilievi, num, priority: priorita, tipo, esterno: tipo === 'esterno', frase: frase(primo) };
    voci.push(voce);
    if (num) perNumero.set(num, voce);
  }
  return voci;
}

function frase(f) {
  return VERIFIER_ROUND.primaFrase ? VERIFIER_ROUND.primaFrase(f && f.text) : String((f && f.text) || '').split('\n')[0];
}

function derivatiRighe(list) {
  if (!list.length) return '  (nessuno)';
  return list.map((d) => {
    const gruppo = { tipo: d.tipo, priority: d.priority, decision: d.rilievi.some((f) => f.decision === true), findings: d.rilievi };
    const dove = `feedback ${d.num || '(numero non comunicato)'}${d.priority != null ? `, priorità ${d.priority}, ${VERIFIER_ROUND.groupLabel(gruppo)}` : ''}`;
    const conTesto = d.rilievi.filter((f) => f.text);
    return conTesto.length ? `${conTesto.map((f) => rigaNumerata(f, VERIFIER_ROUND.formatFinding)).join('\n')}\n  → ${dove}` : `- ${dove}`;
  }).join('\n');
}

/**
 * La risposta del server coi rilievi numerati come nella critica mandata (`n`, da 1): il server li rimanda col
 * testo, e il numero è quello che le prove del giro portano nel nome. PURA.
 */
export function numeraRisposta(reply, critica) {
  const r = { ...(reply || {}) };
  const numera = (l) => (Array.isArray(l) ? numeraRilievi(critica, l) : l);
  if (r.phase2 && typeof r.phase2 === 'object') r.phase2 = { ...r.phase2, findings: numera(r.phase2.findings), derived: numera(r.phase2.derived) };
  for (const k of ['derived', 'blocking', 'sospesi']) if (Array.isArray(r[k])) r[k] = numera(r[k]);
  return r;
}

export function verifierReplyText(reply, id = '<id>') {
  const r = reply && typeof reply === 'object' ? reply : {};
  const fmt = (list) => (Array.isArray(list) && list.length ? list.map((f) => rigaNumerata(f, VERIFIER_ROUND.formatFinding)).join('\n') : '  (nessuno)');
  const b = (r.phase2 && r.phase2.budgets) || r.budgets;
  // I bilanci come li manda il server, nell'ordine dei livelli: uno che il
  // server non manda (un server vecchio) non si inventa.
  const capKeys = Array.isArray(VERIFIER_ROUND.CAP_KEYS) ? VERIFIER_ROUND.CAP_KEYS : ['cap3', 'cap2', 'cap1', 'cap0'];
  const budgets = b && typeof b === 'object'
    ? capKeys.map((k) => (b[k] ? `${k}: ${b[k].left} giri residui su ${b[k].cap}` : null)).filter(Boolean).join(' · ')
    : '';
  const derivati = derivatiAperti(r.phase2 ? r.phase2.derived : r.derived);
  // La domanda con «blocca»: false (#1577) non ferma il giro: va detto, o chi verifica crede di aspettare l'owner.
  const provvRiga = typeof r.domandaProvvisoria === 'string' && r.domandaProvvisoria
    ? `La domanda ${r.domandaProvvisoria} non ferma il lavoro: vale la consigliata finché l'owner non risponde.` : null;
  // I 2 interni messi da parte: il bilancio dei 2 è finito, e a differenza dei
  // 3 non fermano il lavoro; il server li ha già messi nel feedback dei rimasti.
  const dueDaParte = derivati.filter((d) => d.tipo === 'rimasti')
    .reduce((n, d) => n + d.rilievi.filter((f) => Number(f.level) === 2 && (f.sede || 'i') === 'i').length, 0);
  const dueRiga = dueDaParte
    ? `Bilancio delle correzioni di livello 2 finito: ${dueDaParte === 1 ? 'il rilievo interno di livello 2 rimasto è entrato' : `i ${dueDaParte} rilievi interni di livello 2 rimasti sono entrati`} nel feedback dei rimasti (elencato sopra). Il lavoro non si ferma.`
    : null;
  // Un rilievo diventato un feedback suo non lascia una prova rossa nel ramo:
  // il testo vive nel feedback, e la cartella del giro si svuota invece di
  // crescere. Le righe sono pronte da spuntare, col numero di ciascuno.
  const daTogliere = derivati.flatMap((d) => d.rilievi.map((f) => `  · ${Number.isInteger(f.n) ? `le prove con r${f.n} nel nome` : 'nessuna prova (il rilievo non si ritrova nella critica)'}, per ${d.num || '(numero non comunicato)'}: ${frase(f)}`)).join('\n');
  if (r.outcome === 'fix' && r.phase2) {
    return [
      '══ RISPOSTA DEL SERVER: c\'è da correggere ══',
      provvRiga,
      'Rilievi interni da correggere in questo giro (con la loro famiglia: le altre porte della stessa causa):',
      fmt(r.phase2.findings),
      'Feedback derivati aperti dal server (esterni e messi da parte: non li correggi tu):',
      derivatiRighe(derivati),
      derivati.length ? 'Prove del giro da TOGLIERE adesso, PRIMA di ogni correzione, in un commit che toglie solo queste (quelle dei rilievi esterni sono già uscite col commit della critica: se non ci sono più, vai avanti). Una prova che porta anche il numero di un rilievo da correggere resta: le si toglie solo il caso di questi, e il suo caso resta rosso (la registrazione la rilancia, e anche quelle che usano un aiuto a cui hai tolto righe).' : null,
      derivati.length ? daTogliere : null,
      derivati.length ? `  Se ne hai tolte, poi \`git add -A && git commit -m "pulizia del giro"\` e \`node scripts/dispatch.mjs --record-pulizia ${id}\`: da quel commit parte il confronto della consegna.` : null,
      'Una prova del giro ancora rossa non si toglie e non si cambia mai: la consegna la rilancia com\'era e si ferma. Si toglie solo verde, insieme alla prova durevole che la sostituisce.',
      ROSSO_ATTESO_CHIUSO,
      dueRiga,
      budgets ? `Bilanci: ${budgets}` : null,
      '',
      String(r.phase2.instructions || ''),
      '',
      FERMA_NOTE,
      '',
      'A giro chiuso, rilascia il biglietto.',
    ].filter((l) => l !== null).join('\n');
  }
  if (r.outcome === 'stop') {
    // Fermo per la domanda allegata, o per un rilievo che decide l'owner:
    // in tutti e due i casi i rilievi non bloccanti restano davanti a chi riprende.
    const perSegnalazione = r.motivo === 'segnalazione' || r.motivo === 'domanda';
    const sospesi = Array.isArray(r.sospesi) ? r.sospesi : [];
    return [
      '══ RISPOSTA DEL SERVER: il lavoro si ferma ══',
      provvRiga,
      perSegnalazione
        ? 'La domanda è consegnata all\'owner: il lavoro aspetta la sua risposta, poi riprende da qui.'
        : 'Rilievi interni che non si possono correggere da soli (un 3 a bilancio esaurito, o un 3/2 che chiede una decisione): decide l\'owner.',
      perSegnalazione ? null : fmt(r.blocking),
      sospesi.length ? `Rilievi interni che restano davanti a chi riprende dopo la risposta:\n${fmt(sospesi)}` : null,
      derivati.length ? `Feedback derivati aperti dal server (esterni: escono comunque):\n${derivatiRighe(derivati)}` : null,
      budgets ? `Bilanci: ${budgets}` : null,
      'Non c\'è niente da correggere adesso: rilascia il biglietto.',
    ].filter((l) => l !== null).join('\n');
  }
  if (r.outcome === 'pass') {
    return [
      '══ RISPOSTA DEL SERVER: verifica superata ══',
      provvRiga,
      derivati.length ? `Rilievi non corretti, diventati feedback derivati (esterni e domande uno per rilievo, gli altri insieme nel feedback dei rimasti):\n${derivatiRighe(derivati)}` : 'Nessun rilievo da mettere da parte.',
      dueRiga,
      budgets ? `Bilanci: ${budgets}` : null,
      derivati.length ? 'Prove del giro da TOGLIERE adesso, prima di rilasciare il biglietto:' : null,
      derivati.length ? daTogliere : null,
      // Toglierle è un commit, e un commit dopo il verdetto lo farebbe decadere:
      // qui è tollerato, e dirlo serve a non lasciarle rosse per paura. Solo
      // TOGLIERE però: una riga aggiunta dopo il verdetto lo fa decadere.
      derivati.length ? '  Poi `git add -A && git commit`, e spingi: quel commit non fa decadere il verdetto, finché lì si TOGLIE' : null,
      derivati.length ? '  e non si aggiunge niente. Una prova che copre anche un caso ancora aperto non si cancella: toglile il caso' : null,
      derivati.length ? '  che se ne va, e lascia il resto.' : null,
      'Il lavoro prosegue verso il controllo di sicurezza: rilascia il biglietto.',
    ].filter((l) => l !== null).join('\n');
  }
  // Il server ha accettato la critica ma non ha detto l'esito: non è un pass,
  // e non lo si inventa qui.
  return [
    '══ RISPOSTA DEL SERVER: critica registrata, esito non comunicato ══',
    'Il server ha accettato la critica ma non ha detto se il lavoro passa, si corregge o si ferma (server vecchio?).',
    'L\'esito vero sta in dashboard, nella chat del feedback: leggilo lì prima di rilasciare il biglietto.',
  ].join('\n');
}
/**
 * Cosa si stampa a consegna accettata: il lavoro si è fermato, o torna in
 * verifica. `conDomanda` = la consegna portava una domanda (o il
 * vecchio --ferma), quindi DOVEVA fermarsi. PURA.
 */
export function fixedReplyText(id, reply, conDomanda = false) {
  const fermato = reply && reply.outcome === 'stop';
  if (fermato) return `stato ${id}: lavoro FERMATO, in attesa dell'owner (la domanda è consegnata). Rilascia il biglietto.`;
  // «blocca»: false (#1577): la domanda è aperta e la correzione va in verifica con la consigliata.
  if (reply && reply.outcome === 'provvisoria') return `stato ${id}: consegnato, torna in coda per la verifica. La domanda ${reply.domanda || ''} non ferma il lavoro: vale la consigliata finché l'owner non risponde.`;
  // Un server che non ferma su una domanda che blocca rimette in coda: dirlo, o chi ha chiesto crede di essersi fermato.
  if (conDomanda) return `stato ${id}: ATTENZIONE, la consegna portava una domanda ma il server non ha fermato il lavoro: è tornato in coda per la verifica. La domanda è consegnata lo stesso.`;
  return `stato ${id}: consegnato, torna in coda per la verifica`;
}
async function recordFixed(id, report = '', frase = '', ferma = false, domanda = null, motivo = null) {
  const guard = guardIdentity(id);
  if (!guard.ok) return { rejected: true, rebase: !!guard.rebase, altrove: !!guard.altrove && !guard.escalated, message: guard.message };
  // La consegna vale per un commit, come la critica (stessa regola, stessa
  // fonte: lib/dirty-tree.mjs). Con modifiche non salvate il server segnerebbe
  // «corretto» su una correzione che non sta in nessun commit, e la verifica
  // dopo proverebbe il ramo senza di essa: un giro sprecato. In locale
  // «verify-local.mjs corretto» la respinge già; qui si respinge allo stesso
  // modo, PRIMA del server e con l'elenco.
  const stato = statoDirectory(ROOT);
  if (!stato.ok) {
    return { rejected: true, formatRejected: true, message: statoIllegibileText(stato.motivo, 'consegna') };
  }
  if (stato.lines.length) {
    return { rejected: true, formatRejected: true, message: dirtyTreeText(stato.lines, 'consegna') };
  }
  // Stessa guardia di «verify-local.mjs corretto»: una prova del giro cancellata ancora rossa è
  // una porta aperta che la verifica dopo non rilancerebbe più (#679).
  const shaCritica = String(guard.state?.verifierSha || '');
  // Dopo un «pass» la pulizia non si registra: senza questa base il riallineamento rilancia le prove dei
  // rilievi diventati feedback, rosse per costruzione, e non si consegna mai (#880).
  const puliziaPass = guard.state?.verifierVerdict === 'pass' ? puliziaDelPass(shaCritica, guard.state?.checkpoints, ROOT) : '';
  const baseTolte = baseDelConfronto(shaCritica, guard.state?.puliziaSha || puliziaPass, ROOT);
  if (puliziaPass && baseTolte === puliziaPass) {
    process.stderr.write(`Dopo la verifica superata le prove del giro tolte in ${puliziaPass.slice(0, 8)} sono la pulizia: il confronto parte da lì.\n`);
  }
  if (baseTolte && baseTolte !== headSha(ROOT)) {
    const md = guard.state?.messiDaParteGiro && guard.state.messiDaParteGiro.sha === shaCritica ? guard.state.messiDaParteGiro : null;
    const tolte = controllaProveTolte({
      shaPrima: baseTolte, root: ROOT,
      conPulizia: baseTolte !== shaCritica,
      messi: md ? Number(md.n) || 0 : 0,
      shaCritica,
      // Il numero nel nome dice quali rosse sono di un rilievo messo da parte: quelle escono con la pulizia (#747).
      numeri: md && Array.isArray(md.numeri) ? md.numeri : undefined,
      avvio: md ? md.avvio || '' : '',
      pulizieDopo: guard.state?.pulizieDopo,
      comando: `node scripts/dispatch.mjs --record-pulizia ${id}`,
      log: (m) => process.stderr.write(`${m}\n`),
    });
    if (tolte.ferma) return { rejected: true, formatRejected: true, message: tolte.testo };
    if (tolte.testo) process.stderr.write(`${tolte.testo}\n`);
  }
  const next = applyFixed({ ...(guard.state || defaultState(id, '')), id });
  next.id = id;

  // Il server prima dello stato locale: vedi il commento in recordVerifier.
  // Due testi, due destinatari: il report lo cifra il server per l'owner, la
  // frase resta leggibile per chi ha mandato il feedback (spec §8).
  // La domanda viaggia nello stesso payload: il server la apre e la lega al lavoro.
  // In un riallineamento dispatch ha scritto nel marcatore la punta ricevuta: si confronta la modifica del ramo di
  // allora con quella di adesso (regola 3), e lo si dice prima che decida il server.
  const marcatore = readMarker(ROOT);
  const confronto = marcatore && marcatore.role === 'fixer' && marcatore.dal ? fileRiscritti(ROOT, { prima: marcatore.dal }) : null;
  const esito = esitoRiallineamento(confronto, motivo);
  if (esito.riga) process.stderr.write(`${esito.riga}\n`);
  // Il server rifà il confronto sulla punta presa da GitHub: se non c'è ancora (si spinge al rilascio) sceglie il giro pieno.
  if (confronto && process.env.FILO_ROUTINE && process.env.FILO_ROUTINE !== '0') {
    try {
      const ch = await import('./routine-channel.mjs');
      const spinta = ch.pushRamoCorrente(ROOT);
      if (!spinta.ok) process.stderr.write(`Il ramo non è partito prima della consegna (${spinta.reason}): il server rifarà la verifica intera.\n`);
    } catch (e) {
      process.stderr.write(`Il ramo non è partito prima della consegna (${e?.message || e}): il server rifarà la verifica intera.\n`);
    }
  }
  const sent = await deliverToChannel('fixed', fixedPayload({
    report, frase, branch: next.branch || '', ferma, sha: puntaDellaCartella(), domanda, motivo, riallineamento: esito.riallineamento,
  }));
  if (sent.outcome === 'refused') {
    return { rejected: true, fromChannel: true, message: `consegna non accettata (${motivoRifiuto(sent)})` };
  }
  if (sent.outcome === 'absent') {
    return { rejected: true, ticketMissing: true, message: 'consegna non registrata: nessun biglietto trovato' };
  }

  if (sent.outcome !== 'ok') {
    return { rejected: true, serverDown: true, message: `consegna non registrata: il server non risponde (${sent.reason})` };
  }
  // Il marcatore locale del ruolo dice chi sta consegnando; il server lo sa
  // dal biglietto, ed è lui che ha accettato o rifiutato.
  const reply = sent.reply && typeof sent.reply === 'object' ? sent.reply : {};
  if (reply.outcome === 'stop') next.verifierVerdict = 'stop';
  sealTransition(next, `${readRole(ROOT) || 'fixer'}:${reply.outcome === 'stop' ? 'ferma' : 'consegna'}`);
  next.reply = reply;
  return next;
}
async function recordPulizia(id) {
  const guard = guardIdentity(id);
  if (!guard.ok) return { rejected: true, message: guard.message };
  const stato = statoDirectory(ROOT);
  if (!stato.ok) return { rejected: true, formatRejected: true, message: statoIllegibileText(stato.motivo) };
  if (stato.lines.length) return { rejected: true, formatRejected: true, message: dirtyTreeText(stato.lines, 'pulizia') };
  const st = { ...(guard.state || defaultState(id, '')), id };
  const avvio = st.messiDaParteGiro && st.messiDaParteGiro.sha === st.verifierSha ? st.messiDaParteGiro.avvio : '';
  const controllo = st.verifierSha ? controllaPulizia({
    shaCritica: st.verifierSha, root: ROOT, avvio, base: baseDelConfronto(st.verifierSha, st.puliziaSha, ROOT), pulizieDopo: st.pulizieDopo,
  }) : null;
  const r = applyPulizia(st, controllo);
  if (!r.ok) return { rejected: true, formatRejected: true, message: r.message };
  const numeri = Array.isArray(st.messiDaParteGiro?.numeri) ? st.messiDaParteGiro.numeri : undefined;
  const casi = controllaCasiDellaPulizia({
    shaCritica: controllo.prima || st.verifierSha, sha: controllo.sha, root: ROOT, messi: numeri, dopo: !!controllo.dopo,
    log: (m) => process.stderr.write(`${m}\n`),
  });
  if (casi.ferma) return { rejected: true, formatRejected: true, message: casi.testo };
  // Un punto fermo sul commit della pulizia: un ripristino non deve riportare il ramo alla critica.
  sealTransition(r.state, 'pulizia');
  return { ...r.state, files: r.files, sha: controllo.sha, dopo: !!controllo.dopo };
}
async function recordSecaudit(id, verdict, testo = '') {
  const guard = guardIdentity(id);
  if (!guard.ok) return { rejected: true, rebase: !!guard.rebase, altrove: !!guard.altrove && !guard.escalated, message: guard.message };
  // Un pass senza nota si ferma QUI, prima del server (che comunque lo
  // respingerebbe): la riga di comando lo controlla già, questa è la guardia
  // per chi chiama la funzione da un altro strumento.
  const ferma = secauditSenzaNota(verdict, testo);
  if (ferma) return { rejected: true, formatRejected: true, message: ferma };
  // Il verdetto vale per il commit che il controllo ha letto (stessa regola,
  // stessa fonte della critica e della consegna: lib/dirty-tree.mjs). Era
  // l'unico dei tre a non guardare la directory: con file fuori dai commit il
  // salvataggio automatico li committa DOPO la registrazione, la punta si
  // sposta, e quello che verrebbe fuso contiene righe mai controllate
  // (feedback #485).
  const stato = statoDirectory(ROOT);
  if (!stato.ok) {
    return { rejected: true, formatRejected: true, message: statoIllegibileText(stato.motivo, 'verdetto') };
  }
  if (stato.lines.length) {
    return { rejected: true, formatRejected: true, message: dirtyTreeText(stato.lines, 'verdetto') };
  }
  const shaControllato = headSha(ROOT) || '';
  const next = applySecaudit({ ...(guard.state || defaultState(id, '')), id }, verdict, shaControllato);
  next.id = id;

  // Il server prima dello stato locale: vedi il commento in recordVerifier.
  // La nota (L4) va nel payload: il server la cifra in `livelli.l4`, anche su
  // pass, così il pentagono in dashboard ha qualcosa da mostrare.
  const sent = await deliverToChannel('secaudit', secauditPayload({ verdict, branch: next.branch || '', testo, sha: shaControllato }));
  if (sent.outcome === 'refused') {
    return { rejected: true, fromChannel: true, message: `verdetto non accettato (${motivoRifiuto(sent)})` };
  }
  if (sent.outcome === 'absent') {
    return { rejected: true, ticketMissing: true, message: 'verdetto non registrato: nessun biglietto trovato' };
  }
  if (sent.outcome !== 'ok') {
    // Simmetria con recordVerifier/recordFixed, che qui mancava: sigillare lo
    // stato locale con un verdetto che il server non ha mai ricevuto è la
    // divergenza permissiva che questa spec toglie — e il cancello di fusione
    // legge il verdetto REGISTRATO, quindi un secaudit "sigillato ma non
    // consegnato" bloccherebbe comunque la fusione, solo più tardi e senza dire
    // perché.
    return { rejected: true, serverDown: true, message: `verdetto non registrato: il server non risponde (${sent.reason})` };
  }

  sealTransition(next, `secaudit:${verdict}`);
  // Su fail il server porta già in `design`; su pass la fusione e la chiusura
  // le porta il server, dopo gli unit sulla fusione (#1207).
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
// Il rebase del ramo assegnato non è una deriva: un invito solo, finirlo e rilanciare, mai «fermati».
export function rebaseRejectionText(message) {
  return [
    `[dispatch] NON REGISTRATO: ${message}`,
    'Sei sul ramo giusto, a metà del rebase: finiscilo (risolvi i file in conflitto, `git add`,',
    '`git rebase --continue`), controlla che la cartella sia tornata sul ramo, poi rilancia lo stesso comando.',
  ].join('\n');
}

/** Il lavoro committato in un altro worktree (#772.1) si porta qui e si rilancia: non è un guasto. PURA. */
export function lavoroAltroveText(message) {
  return [
    `[dispatch] NON REGISTRATO: ${message}.`,
    'Non è un guasto: fai come dice il motivo, poi rilancia lo stesso comando.',
  ].join('\n');
}

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
 * Il server non risponde: rete giù o 5xx, DOPO i ritentativi automatici del
 * canale. Prima questo caso usciva incorniciato da channelRejectionText — "il
 * server ha guardato e ha detto no" sopra un server che non aveva risposto
 * affatto — e con exit 4, mentre il contratto dei worker documenta da sempre
 * exit 3 per il canale non raggiungibile. Testo e codice ora dicono la stessa
 * cosa del contratto. PURA (testata in tests/unit/dispatch.test.mjs).
 */
export function serverDownText(message) {
  return [
    `[dispatch] CANALE NON RAGGIUNGIBILE: ${message}`,
    'La decisione NON è stata registrata da nessuna parte. Lo script ha già',
    'ritentato da solo prima di arrendersi: non ritentare a mano in loop, fermati.',
    'Il lavoro riprende quando il canale torna.',
  ].join('\n');
}

/**
 * Il biglietto non si trova: né nel promemoria né passato con `--ticket`. Terza
 * voce accanto a rejectionText e channelRejectionText, perché è un terzo caso:
 * non un rifiuto del server, non un server giù — il server non è stato proprio
 * chiamato. Il 25 agosto questo caso usciva travestito da "il server non
 * risponde" E da "RIFIUTATO dal server" nella stessa schermata, due diagnosi
 * false in una: il worker ha inseguito un guasto di rete inesistente e un'ora
 * di verifica è andata persa. PURA (testata in tests/unit/dispatch.test.mjs).
 */
export function ticketMissingText(message) {
  return [
    `[dispatch] NESSUN BIGLIETTO: ${message}`,
    'Il server NON è stato chiamato: senza biglietto la consegna non si può nemmeno',
    'chiedere. Il promemoria (.claude/routine-ticket.json) non c\'è: se hai ancora il',
    'codice del biglietto (è nelle istruzioni con cui sei partito), ripeti questo',
    'comando aggiungendo `--ticket <codice>`. Se non ce l\'hai, rilascia e fermati.',
  ].join('\n');
}

// La forma di un biglietto la decide una regola sola, condivisa col canale: un flag finito al
// posto del codice non deve poter sovrascrivere il promemoria.
export { looksLikeTicket };

/**
 * Toglie il biglietto passato a mano da una lista di argomenti, con la regola del canale
 * (leggiBigliettoAMano). PURA.
 * @returns {{ args: string[], ticket: string, error: boolean, errore?: string }} `error` = biglietto a mano
 *   mancante, storto o doppio (il chiamante esce con un errore d'uso).
 */
export function stripTicketArg(list) {
  const r = leggiBigliettoAMano(list);
  if (r.errore) return { args: Array.isArray(list) ? [...list] : [], ticket: '', error: true, errore: r.errore };
  return { args: r.args, ticket: r.ticket, error: false };
}

/**
 * La schermata di `--help`. Esiste perché un worker l'ha chiesta davvero — e la
 * versione di allora, che non la conosceva, ha risposto trattandolo da giro
 * nuovo senza biglietto e cancellandogli il promemoria. Chi chiede aiuto deve
 * ricevere aiuto, senza effetti collaterali. PURA.
 */
/** «Sembra un'opzione?» — stessa regola di scripts/lib/argomenti.mjs. PURA. */
const SEMBRA_OPZIONE = (a) => {
  const s = String(a ?? '');
  return s.length > 1 && ['-', '‐', '‑', '‒', '–', '—', '−'].includes(s[0]) && !/^[0-9]/.test(s.slice(1));
};

/** Un'opzione rimasta al posto dell'identificativo: lo stato locale finiva sotto il suo nome (#879). PURA. */
function idCheSembraOpzione(id, ammesse) {
  return `Argomento non capito al posto dell'identificativo: ${id} — non ho registrato niente. Qui le opzioni sono ${ammesse}, in qualunque posizione; poi vengono l'identificativo e il resto.`;
}

export function usageText() {
  return [
    'Uso: node scripts/dispatch.mjs <comando>',
    '',
    '  --ticket <biglietto>   avvia il giro: ritira il lavoro dal server, scrive il',
    '                         promemoria del biglietto e avvia il battito',
    '  (nessun argomento)     giro locale, senza server (sceglie il bucket qui)',
    '  --preflight            prontezza del giro, PRIMA del setup (orchestratore)',
    '  --linea-principale     dopo ogni worker, prima del biglietto (orchestratore): la cartella',
    '                         torna su main, perché il prossimo worker parta con i suoi agenti',
    '  --record-verifier <id> "<critica>" [--domanda <file.json>] [--ticket <b>]   una riga per rilievo,',
    '                         con livello e sede davanti ([2i] …, [1v] …, [2e] …; [1i?] = chiede una decisione,',
    '                         e porta la sua domanda: --domanda con una, o un elenco nell\'ordine dei rilievi col «?»);',
    '                         le quadre col livello dentro sono SEMPRE un rilievo: nel',
    '                         riassunto il livello si cita a parole («il livello 2»);',
    '                         l\'esito lo calcola il server e lo stampa qui: LEGGILO',
    '  --record-pulizia  <id> [--ticket <b>]   dopo una critica che manda a correggere e mette rilievi',
    '                         da parte: registra il commit che toglie SOLO le loro prove del giro, dopo aver',
    '                         rilanciato quelle a cui ha tolto un caso o un aiuto (un caso rosso resta rosso);',
    '                         più tardi, per una prova dimenticata, il commit è l\'ultimo e da solo',
    '  --record-fixed    <id> "<report>" [--frase "…"] [--domanda <file.json>] [--ticket <b>]',
    '                         il report non è facoltativo: da qui esce un esito, e l’owner legge questo',
    '  --record-secaudit <id> <pass|fail> --nota <file.md> [--ticket <b>]',
    '                         la nota dice cosa hai controllato e cosa hai trovato;',
    '                         su pass è obbligatoria (senza, il verdetto non parte)',
    '',
    '  --domanda <file.json>  un trade-off vero o una scelta di design trovati lavorando: NON',
    '                         deciderlo, chiedilo (SPEC-DOMANDE §3.1: titolo fino a 10 parole,',
    '                         contesto, problema, almeno due opzioni con pro e contro, consiglio,',
    '                         notePerAgenti). Una domanda che blocca FERMA il lavoro: aspetta',
    '                         l\'owner, e riprende da lì quando ha risposto. Un difetto non è una domanda',
    '  --ferma                accettato per chi lo scrive ancora: non serve, è la domanda',
    '                         che ferma il lavoro; da solo non consegna niente',
    '  --clear-state     <id> rimuove la copia locale dello stato',
    '  --help                 questa schermata',
    '',
    'Nei --record-* le opzioni (--frase, --domanda, --nota, --ferma, --ticket) valgono in ogni',
    'posizione, anche come `--opzione=valore`, come nel canale; quello che resta, in ordine, è',
    'comando, identificativo e testo.',
    'Il biglietto si rilegge da solo dal promemoria (.claude/routine-ticket.json): `--ticket`',
    '(o `--biglietto`) serve solo se il promemoria è perso.',
    '',
    'Exit: 0 ok · 1 uso sbagliato (niente è stato toccato) · 2 niente da fare',
    '      3 guasto · 4 rifiutato dal server (leggere il motivo, non aggirare)',
    '      5 lavoro vivo nella cartella (--ticket, --linea-principale): un altro worker lavora ancora qui,',
    '        e niente è stato toccato; il messaggio dice chi (biglietto, processi, ultimo commit)',
  ].join('\n');
}

/**
 * Emette un GUASTO: nessun lavoro consegnato, e il worker lo dice
 * all'orchestratore con la terza parola del vocabolario (`guasto`), che ferma
 * il giro senza travestirlo da giornata tranquilla.
 */
// `vivo`: un altro lavora nella cartella, e i suoi marcatori (ruolo compreso) non si toccano (#1480).
function emitHalt(kind, message, { vivo = false } = {}) {
  process.stderr.write(`[dispatch] ${vivo ? 'LAVORO VIVO' : `GUASTO (${kind})`}: ${message}\n`);
  emit({ role: 'halt', kind, message, ...(vivo ? { lavoroVivo: true } : {}) }, {});
  return { exit: vivo ? USCITA_LAVORO_VIVO : 3 };
}

/** Il motivo di un errore imprevisto, da ricopiare dentro `--guasto "…"`: una riga, senza virgolette né `$`. PURA. */
export function motivoFatale(e) {
  const testo = unaRiga((e && e.message) || e || 'errore senza messaggio').replace(/\\/g, '/').replace(/["`$]/g, "'").slice(0, 300);
  return `errore imprevisto di dispatch: ${testo}`;
}

/** Il testo del guasto quando nemmeno quello di halt si compone (il pezzo condiviso che manca può mancare anche lì). PURA. */
export function istruzioniGuastoDiRiserva(motivo, canale = resolve(TOOLS_ROOT, 'scripts', 'routine-channel.mjs')) {
  const c = String(canale).split('\\').join('/');
  return [
    '# Ruolo: halt, guasto: non si può lavorare',
    '',
    'Dispatch si è fermato per un errore che non aveva previsto (`message` nel payload) e non è riuscito a comporre il testo del guasto. Non c\'è niente da eseguire. Registra due cose, in quest\'ordine, col biglietto con cui sei partito:',
    '',
    `- la domanda di fine sessione dell'owner: \`node "${c}" domanda --biglietto <biglietto>\` la stampa insieme al comando per rispondere, col testo da stdin fra due righe \`FINE\`; se non arriva (exit diverso da 0), vai avanti;`,
    `- il guasto, nel rilascio: \`node "${c}" release <biglietto> --role halt --guasto "${motivo}"\`.`,
    '',
    'Poi termina la sessione senza ritentare: con una causa fissa i tentativi morirebbero in fila.',
  ].join('\n');
}

/** Un errore imprevisto esce come il guasto dichiarato, con domanda di fine sessione e rilascio (#1205.1). */
function emitFatale(e) {
  process.stderr.write(`[dispatch] errore fatale: ${(e && e.message) || e}\n`);
  const motivo = motivoFatale(e);
  try { return emitHalt('transient', motivo); } catch (e2) {
    process.stderr.write(`[dispatch] nemmeno il testo del guasto si compone (${(e2 && e2.message) || e2}): stampo quello di riserva\n`);
  }
  try { clearRole(ROOT); } catch (_) { /* il marcatore resta: conta di più che il guasto arrivi */ }
  const out = { role: 'halt', payload: { kind: 'transient', message: motivo }, claim: null, instructions: istruzioniGuastoDiRiserva(motivo) };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
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
  // ripiega su un altro lavoro: travestire un giro cieco da lavoro è già
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
  };
  if (bucket.id) {
    // Lo stato locale resta il ripiego quando il server non risponde: si
    // allinea a ciò che il server ha appena detto, così le due copie non
    // divergono in silenzio.
    const prev = readState(bucket.id) || defaultState(bucket.id, bucket.branch);
    bucket.state = { ...prev, id: bucket.id, branch: bucket.branch || prev.branch || '' };
    // La critica che accompagna la busta NON si passa a nessuno: i rilievi li
    // corregge chi li ha scritti, e al riallineamento direbbe il contrario.
  }
  // La busta si passa COM'È: incartarla in un altro oggetto ha già fatto
  // arrivare al lavoratore un pacchetto vuoto, con il giro che usciva
  // dicendo che era tutto a posto.
  return finalizeBucket(bucket, w);
}

// Fra un worker e l'altro la cartella torna sulla linea principale: la sessione legge agenti (e il loro sforzo),
// impostazioni e copioni dei ganci dalla cartella, e quello che un worker ci ha lasciato (un ramo, un file in .claude)
// non deve arrivare al prossimo. Scarta le modifiche non salvate (il lavoro di un worker morto si butta): solo nelle routine.
export function tornaAllaLineaPrincipale() {
  if (process.env.FILO_ROUTINE !== '1') {
    return { ok: false, uso: true, message: 'solo nelle routine (FILO_ROUTINE=1): scarta le modifiche non salvate della cartella' };
  }
  const vivo = lavoroVivo(ROOT);
  if (vivo.vivo) return { ok: false, vivo: true, message: testoLavoroVivo(vivo, `riportato la cartella su ${MAIN_BRANCH}`) };
  clearExpectation(ROOT);
  tryGit(['fetch', 'origin', MAIN_BRANCH]);
  const rif = tryGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${MAIN_BRANCH}`]).ok ? `origin/${MAIN_BRANCH}` : MAIN_BRANCH;
  const co = tryGit(['checkout', '-f', '-B', MAIN_BRANCH, rif]);
  if (!co.ok || currentBranch(ROOT) !== MAIN_BRANCH) {
    return { ok: false, message: `la cartella non torna su ${MAIN_BRANCH}: ${co.out.slice(0, 200)}` };
  }
  // I file nuovi in .claude (impostazioni, agenti, skill, ganci) li legge la sessione; i marcatori ignorati restano (#1182).
  const pulita = tryGit(['clean', '-fdq', '--', '.claude']);
  if (!pulita.ok) return { ok: false, message: `.claude non torna com'è su ${MAIN_BRANCH}: ${pulita.out.slice(0, 200)}` };
  return { ok: true, head: headSha(ROOT) };
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
  // Il ramo lo dice il BIGLIETTO: lo stato locale è un residuo di questa
  // macchina e può descrivere un tentativo precedente. Con la precedenza
  // invertita, uno stato vecchio posizionava il lavoratore sul ramo di un
  // giro passato ignorando quello assegnato dal server (#507, seconda porta).
  const branch = isNew ? newWorkBranch(bucket.id) : (bucket.branch || prev?.branch || '');
  if (!branch) return { ok: false, kind: 'permanent', message: `nessun branch assegnato per ${bucket.id}` };
  // Il resto l'ha guardato il giro prima di scrivere i marcatori; qui resta un battito acceso nel frattempo da un altro.
  const vivo = lavoroVivo(ROOT, { mio: readRoutineTicket(ROOT), cosa: ['battito'] });
  if (vivo.vivo) return { ok: false, kind: 'transient', vivo: true, message: testoLavoroVivo(vivo, `posizionato la cartella su ${branch}`) };

  // Un punto fermo registrato per un ALTRO ramo non deve guidare il ripristino
  // di questo: lo sha esiste nel repo, quindi prepareBranch lo prenderebbe per
  // buono e riporterebbe il ramo al contenuto di un tentativo diverso.
  const checkpoint = (!isNew && prev?.branch === branch) ? lastCheckpoint(prev) : null;

  const res = prepareBranch({
    root: ROOT,
    branch,
    create: isNew,
    // Un lavoro nuovo nasce SEMPRE dalla linea principale: le basi feature/N
    // erano il Modello B dei sotto-feedback, abolito (SPEC-RIDISEGNO-MAX.md §1).
    base: '',
    mainBranch: MAIN_BRANCH,
    checkpoint,
  });
  if (!res.ok) return res;
  const parcheggio = res.discarded ? `; i commit locali restano su ${res.discarded}` : '';
  if (res.rewritten) {
    process.stderr.write(`[dispatch] ${branch}: il ramo su origin è stato riscritto (un riallineamento): si riparte dalla sua punta ${String(res.head).slice(0, 12)}, non dal punto fermo locale ${String(res.rewritten).slice(0, 12)}${parcheggio}\n`);
  } else if (res.superato) {
    process.stderr.write(`[dispatch] ${branch}: lo stato locale di questa cartella era di un giro passato (punto fermo ${String(res.superato).slice(0, 12)}, più vecchio della punta pubblicata): si parte dalla punta ${String(res.head).slice(0, 12)} e lo stato vecchio si scarta${parcheggio}\n`);
  } else if (res.discarded) {
    process.stderr.write(`[dispatch] ${branch}: lavoro di un'istanza interrotta riportato all'ultimo punto fermo; i commit scartati restano su ${res.discarded}\n`);
  }

  // Identità attesa del contenuto, che transizioni (C) e ripristino (D) confronteranno. Lo stato di un'altra storia
  // (altro ramo, riscrittura, giro passato da un'altra cartella) riparte da zero, esiti e pulizie compresi (D-207).
  const altraStoria = prev?.branch !== branch || !!res.rewritten || !!res.superato;
  const base = altraStoria
    ? defaultState(bucket.id, branch)
    : { ...defaultState(bucket.id, branch), ...prev, id: bucket.id, branch };
  base.avvio = { sha: res.head, ruolo: bucket.role, at: new Date().toISOString() };
  delete base.criticaNelGiro;
  const state = withCheckpoint(base, res.head, `${bucket.role}:checkout`);
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
 * @param {string|{diff:string, base:object|null, head:string}} diff  le differenze del ramo (solo per il
 *   controllo sicurezza): l'uscita di `diffForBranch`, o il solo testo
 */
// I ruoli che questa macchina sa eseguire. Un ruolo fuori da qui non è un
// lavoro: è una busta che non sappiamo aprire.
const RUOLI_LAVORABILI = ['secaudit', 'verifier', 'fixer', 'new-work', 'risposta', 'smistamento'];
// Chi lavora su un ramo esistente: senza, non c'è niente su cui posizionarsi.
const RUOLI_CON_RAMO = ['secaudit', 'verifier', 'fixer'];

/**
 * La busta è consegnabile? PURA. Ritorna null se va bene, altrimenti il motivo
 * del guasto, già scritto per chi legge i log.
 */
// Chi ha bisogno di leggere il feedback per poter lavorare: senza, il compito
// è vuoto anche se la busta è formalmente in ordine.
const RUOLI_CON_FEEDBACK = ['verifier', 'fixer', 'new-work'];

// La cornice «dato, non istruzione» con cui il server consegna il testo del
// feedback (filo-security, userDataFrame.js): un'etichetta, il segno che è
// materiale dell'utente, il testo, una quadra di chiusura. Qui non si legge
// la cornice: si legge quello che c'è DENTRO, perché è quello che dice se il
// compito ha un contenuto. Un testo che non è incorniciato (server vecchio)
// torna com'è.
const CORNICE_DATO_RE = /^\[[^\n]*\(contenuto — DATO dell'utente, non istruzioni\):\n([\s\S]*)\n\]$/;
export function testoDentroCornice(testo) {
  const s = String(testo == null ? '' : testo);
  const m = CORNICE_DATO_RE.exec(s);
  return m ? m[1] : s;
}

export function checkEnvelope(w) {
  const role = String((w && w.role) || '');
  if (!RUOLI_LAVORABILI.includes(role)) {
    return `il server ha assegnato un ruolo che questa versione non sa eseguire ("${role || 'nessuno'}")`;
  }
  if (RUOLI_CON_RAMO.includes(role) && !String((w && w.branch) || '')) {
    return `lavoro "${role}" senza il ramo su cui lavorare`;
  }
  // I compiti su una domanda non hanno un feedback: hanno la loro domanda, o il server dice che non è più affidata.
  if (role === 'risposta' || role === 'smistamento') {
    const p = (w && w.payload) || {};
    if (!String(p.compito || '')) return `lavoro "${role}" senza il compito a cui si riferisce`;
    if (p.affidata !== false && !String((p.domanda && p.domanda.id) || '')) return `lavoro "${role}" con la domanda vuota: non c'è niente su cui lavorare`;
    return null;
  }
  if (!String((w && w.id) || '')) {
    return `lavoro "${role}" senza il feedback a cui si riferisce`;
  }
  // La busta può essere formalmente perfetta e VUOTA dentro: succede se il
  // server non riesce a leggere il documento. Guardare solo ruolo, ramo e
  // indirizzo lascerebbe passare un compito senza compito — la stessa forma di
  // guasto silenzioso di prima, entrata dalla porta del server invece che da
  // quella di casa.
  if (RUOLI_CON_FEEDBACK.includes(role)) {
    // Il testo arriva dentro la cornice del server: una cornice attorno a
    // niente è ancora niente.
    const testo = testoDentroCornice(((w && w.payload && w.payload.feedback) || {}).text).trim();
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
  if (role === 'secaudit') {
    // Un lavoro server porta anche il diff del server: lo scarica il server, perché qui il clone non c'è (#1159 fase 2).
    const server = payload && payload.diffServer && typeof payload.diffServer === 'object' ? { diffServer: payload.diffServer } : {};
    if (diff && typeof diff === 'object') {
      return { diff: diff.diff || '', diffBase: diff.base || null, diffHead: diff.head || '', ...(diff.vuoto ? { diffVuoto: diff.vuoto } : {}), ...server };
    }
    return { diff, ...server };
  }
  // La risposta arriva com'è: domanda, feedback nominati e registro li ha già scelti il server per questo ruolo.
  if (role === 'risposta') return { risposta: payload || {} };
  // Lo smistamento lo stesso: domanda, feedback d'origine e registro li ha scelti il server.
  if (role === 'smistamento') return { smistamento: payload || {} };
  if (role === 'verifier' || role === 'fixer' || role === 'new-work') {
    // Il feedback arriva GIÀ DECIFRATO dal server. Non c'è nessun ripiego che
    // se lo vada a rileggere: il ripiego sarebbe la chiave, ed è proprio ciò
    // che da qui è stato tolto. Lo storico delle critiche viaggia accanto al
    // feedback per chi lo riceve (solo il verifier); un server vecchio non lo
    // manda e qui arriva semplicemente vuoto.
    return {
      feedback: (payload && payload.feedback) || null,
      decisioni: Array.isArray(payload && payload.decisioni) ? payload.decisioni : [],
      immagini: Array.isArray(payload && payload.immagini) ? payload.immagini : [],
      history: Array.isArray(payload && payload.history) ? payload.history : [],
      // Quante critiche più vecchie il server ha tolto dalla serie: si stampa
      // nell'avvertenza, così i giri mancanti non passano per inesistenti.
      historyDropped: Number(payload && payload.historyDropped) || 0,
      // La ripresa dopo la risposta dell'owner (solo per chi riprende: il
      // server non la manda a chi verifica).
      ripresa: payload && payload.ripresa && typeof payload.ripresa === 'object' ? payload.ripresa : null,
      ...(role === 'fixer' && typeof (payload && payload.critique) === 'string' ? { critique: payload.critique } : {}),
      ...(role === 'verifier' ? { scope: payload && payload.scope, perimetro: (payload && payload.perimetro) || null } : {}),
      // SPEC-RIDISEGNO-LAVORO.md: il piano di chi c'era prima, le fusioni su main che il server ha trovato, e per chi
      // riallinea lo sha che aveva passato la verifica (la base del confronto alla consegna).
      ...(role !== 'verifier' && typeof (payload && payload.piano) === 'string' ? { piano: payload.piano } : {}),
      ...(role === 'new-work' && Array.isArray(payload && payload.suMain) ? { suMain: payload.suMain } : {}),
      ...(role === 'fixer' && /^[0-9a-f]{40}$/i.test(String((payload && payload.shaVerificato) || '')) ? { shaVerificato: payload.shaVerificato } : {}),
      // Il lavoro tocca anche filo-security (busta del server, #1159): le istruzioni del clone si accodano al ruolo.
      ...(payload && payload.lavoroServer && typeof payload.lavoroServer === 'object' ? { lavoroServer: payload.lavoroServer } : {}),
    };
  }
  return {};
}

async function finalizeBucket(bucket, fromServer) {
  // Il ruolo `idle` non esiste più (SPEC-RIDISEGNO-MAX.md §12): coda vuota o
  // interruttore spento sono un exit 2 alla richiesta di biglietto, PRIMA che
  // un worker venga spawnato. Qui arrivano solo buste con un lavoro dentro.

  // Un lavoro server clona filo-security: dentro il checkout di Filo l'hook di salvataggio lo pubblicherebbe (#1159).
  if (fromServer && fromServer.payload && fromServer.payload.lavoroServer && cloneDentroIlRepo(cartellaCloneServer(), ROOT)) {
    return emitHalt('permanent', `il clone di filo-security (${cartellaCloneServer()}) cadrebbe dentro il checkout di Filo (${ROOT}), che si pubblica: imposta FILO_SERVER_CLONE fuori dal repo`);
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
  if (bucket.id) {
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
        // feedback e per nessun altro, e mettersi a fare altro tenendoselo in
        // mano lascerebbe il semaforo preso su un lavoro che nessuno sta
        // facendo — con il giro che esce dicendo che è andato tutto bene.
        return emitHalt('permanent', pos.message);
      }
      return emitHalt('transient', pos.message, { vivo: !!pos.vivo });
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
  // Anche chi riprende un lavoro fermo dopo la risposta dell'owner lo dichiara:
  // il feedback è tornato `todo`, e senza questo passaggio la dashboard direbbe
  // «in coda» per tutta la lavorazione.
  const ripresa = !!(fromServer && fromServer.payload && fromServer.payload.ripresa);
  if (bucket.id && (bucket.role === 'new-work' || (bucket.role === 'fixer' && ripresa))) {
    await deliverToChannel('status', { status: 'working', branch: bucket.branch || '' });
  }

  // Raccogli il contesto specifico del ruolo (rispettando l'isolamento).
  let diff = '';
  if (bucket.role === 'secaudit') {
    diff = diffForBranch(bucket.branch);
    // Un diff che non si calcola non arriva al controllo come se fosse vuoto: darebbe il via libera su niente (#740).
    if (!diff.ok) return emitHalt('transient', `il diff del ramo ${bucket.branch} non si calcola: ${diff.motivo}`);
  }
  const ctx = serverCtx(bucket, fromServer, diff);

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
  const ambito = bucket.role === 'verifier' ? verifierScope(ctx && ctx.scope) : { scope: '', sconosciuto: false };
  // `dal`: per chi verifica un riallineamento il commit verificato; per chi riallinea la base del confronto alla consegna
  // (SPEC-RIDISEGNO-LAVORO.md §3, regola 3): lo sha verificato se il server lo manda, sennò la punta che riceve.
  const riallinea = bucket.role === 'fixer' && !(ctx && ctx.ripresa && typeof ctx.ripresa === 'object');
  if (bucket.role === 'halt') { if (!bucket.lavoroVivo) clearRole(ROOT); }
  else writeRole(ROOT, bucket.role, { dal: ambito.scope === 'riallineamento' ? ctx?.perimetro?.shaVerificato : riallinea ? (ctx?.shaVerificato || puntaDellaCartella()) : '' });
  const pieno = buildPayload(bucket, bucket.role === 'new-work' ? { ...ctx, suMain: suMainDi(bucket, ctx) } : ctx);
  // L'avvertenza di serie si ACCODA alle istruzioni, non vive solo nel
  // payload: un dato in più si può non guardare, un'istruzione no.
  if (ambito.sconosciuto) process.stderr.write(`[dispatch] ambito di verifica sconosciuto («${unaRiga(ctx.scope).slice(0, 40)}»): consegno la verifica piena\n`);
  // Nei giri stretti la serie non si consegna: inviterebbe alla ricerca larga
  // che il testo del ruolo dice di non rifare.
  const serial = ambito.scope && ambito.scope !== 'pieno'
    ? perimetroNote(ambito.scope, ctx && ctx.perimetro)
    : serialAwarenessNote(bucket.role, ctx && ctx.history, ctx && ctx.historyDropped);
  const base = readRoleInstructions(bucket.role, { scope: ambito.scope, caso: pieno && pieno.case });
  const server = ctx && ctx.lavoroServer ? testoLavoroServer({ clone: cartellaCloneServer() }).trim() : '';
  const corpo = server || serial ? [base.replace(/\s+$/, ''), server, serial].filter(Boolean).join('\n\n') : base;
  const cartella = preparaIntestazione(ROOT);
  const instructions = cartella ? `${cartella}\n\n${corpo}` : corpo;
  const stampaCon = (payload, istr = instructions, file = '') => ({
    role: bucket.role, payload, claim: bucket.id || null, instructions: istr, ...(file ? { istruzioniFile: file } : {}),
  });
  // Si misura la stampa vera, ruolo e rientri compresi: il testo del ruolo cambia da ruolo a ruolo.
  const misuraCon = (istr, file) => (p) => JSON.stringify(stampaCon(p, istr, file), null, 2).length + 1;
  const scarica = (misura) => scaricaPayload(pieno, { root: ROOT, sempre: ['diff', 'diffServer'], max: STAMPA_MAX, misura });
  let payload = pieno;
  let istr = instructions;
  let fileIstr = '';
  try {
    payload = scarica(misuraCon(instructions));
    // Un ruolo lungo con un payload già tutto fuori (un verificatore di un lavoro server) passerebbe la soglia
    // dell'harness: esce il ruolo, intero, e il payload si riscarica attorno al rimando.
    if (misuraCon(instructions)(payload) > STAMPA_TETTO) {
      const f = fileRuolo(ROOT);
      const rimando = rimandoAlRuolo(instructions, f);
      payload = scarica(misuraCon(rimando, f));
      scriviRuolo(f, instructions);
      [istr, fileIstr] = [rimando, f];
    }
  } catch (e) {
    // Meglio una stampa lunga che un pezzo perso: il payload resta intero, e si dice perché. Le immagini
    // no: megabyte di base64 in stampa non li legge nessuno, la voce porta il motivo.
    process.stderr.write(`[dispatch] non riesco a scrivere i pezzi grossi del payload in file (${e.message}): restano nella stampa\n`);
    payload = immaginiSenzaByte(pieno, e.message);
  }
  const out = stampaCon(payload, istr, fileIstr);
  lastEmitted = { role: bucket.role, num: bucket.num || '' };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const isMainModule = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  // Anche i comandi nei testi stampati (i nostri e quelli del server) portano alla copia fissata (#763).
  absolutizeOutput(ROOT);
  // Il biglietto a mano si toglie PRIMA di tutto, con la regola del canale: l'ordine non conta (davanti
  // a un --record-* finiva «argomento non riconosciuto», #724.1, #545) e un codice storto o doppio si ferma qui.
  const mano = stripTicketArg(process.argv.slice(2));
  if (mano.error) { console.error(`${mano.errore} Niente è stato toccato.`); process.exit(1); }
  // Con la stessa regola le opzioni dei --record-* (#879); chi chiede aiuto lo riceve comunque.
  const reg = leggiOpzioniRegistrazione(mano.args);
  const argv = reg.args;
  const opz = reg.valori;
  const bigliettoAMano = mano.ticket;
  const flag = argv[0];
  if (reg.error && flag !== '--help' && flag !== '-h') { console.error(reg.error); process.exit(1); }
  if (bigliettoAMano && (flag === '--preflight' || flag === '--clear-state' || flag === '--linea-principale')) {
    console.error(`--ticket non vale con ${flag}: lì un biglietto non serve. Niente è stato toccato.`);
    process.exit(1);
  }

  // Nei `--record-*` il biglietto a mano è la scorta del promemoria perso; viaggia nell'ambiente, dove
  // readTicket lo trova per primo.
  const conBiglietto = (args) => {
    if (bigliettoAMano) process.env.FILO_ROUTINE_TICKET = bigliettoAMano;
    // RIARMA il battito, comunque sia arrivato il biglietto: il processo
    // staccato avviato all'inizio del giro in cloud non sopravvive a lungo (il
    // beatAt specchiato sui feedback si ferma sempre a pochi secondi dal
    // biglietto), e ogni --record-* è un momento in cui il biglietto è in mano
    // per costruzione. startBeat è idempotente: se il battito è vivo non fa
    // niente.
    const vivo = process.env.FILO_ROUTINE_TICKET || readRoutineTicket(ROOT);
    if (vivo) startBeat(ROOT, vivo);
    return args;
  };
  // I quattro esiti di un --record-* respinto: biglietto introvabile (esci 1:
  // si rimedia ripassando il codice), canale non raggiungibile (3, come da
  // contratto dei worker), rifiuto del server (4), guardia d'identità (3).
  // Quattro testi diversi perché quattro rimedi diversi.
  const esciRespinto = (s) => {
    if (s.ticketMissing) { console.error(ticketMissingText(s.message)); process.exit(1); }
    // Critica scritta male: si sistema la riga e si rilancia (esci 1, come un
    // errore d'uso). Il server non è stato chiamato e niente è stato scritto.
    if (s.formatRejected) { console.error(`[dispatch] ${s.message}\nNiente è stato registrato: sistema le righe e rilancia lo stesso comando.`); process.exit(1); }
    if (s.rebase) { console.error(rebaseRejectionText(s.message)); process.exit(1); }
    if (s.altrove) { console.error(lavoroAltroveText(s.message)); process.exit(1); }
    if (s.serverDown) { console.error(serverDownText(s.message)); process.exit(3); }
    console.error(s.fromChannel ? channelRejectionText(s.message) : rejectionText(s.message));
    process.exit(s.fromChannel ? 4 : 3);
  };

  // Da quando il giro ha preso il biglietto, un errore imprevisto esce come guasto (emitFatale).
  let giroDelBiglietto = false;
  try {
    if (flag === '--record-verifier') {
      const [, id, ...rest] = conBiglietto(argv);
      if (!id) { console.error('Uso: --record-verifier <id> "<critica: una riga per rilievo, con livello e sede davanti: [2i] …>"'); process.exit(1); }
      if (SEMBRA_OPZIONE(id)) { console.error(idCheSembraOpzione(id, '--segnala <file.md>')); process.exit(1); }
      // La parola del vecchio verdetto (pass|migliorabile|fail) NON si tollera
      // più: veniva buttata via in silenzio, e senza rilievi la verifica
      // risulta superata — chi scriveva `fail` per bocciare registrava una
      // PROMOZIONE. Tollerarla solo quando è da sola non bastava: il caso
      // peggiore è proprio quello in cui il motivo c'è, perché chi scrive
      // verdetto E perché è sicuro di aver bocciato (feedback #565).
      if (rest.length && LEGACY_VERDICT_WORDS.includes(rest[0])) {
        console.error(`«${rest[0]}» non è più un verdetto: non ho registrato niente.`);
        console.error('L\'esito non lo scegli tu, lo calcolano i livelli dei rilievi: senza rilievi la verifica risulta SUPERATA, quindi questa riga registrerebbe una promozione.');
        console.error('Togli quella parola e scrivi i rilievi, uno per riga, con livello e sede davanti: «[2i] il pulsante Salva non salva col titolo vuoto», coi passi per rifarlo.');
        process.exit(1);
      }
      // Qui la critica è UN testo, e non ci sono opzioni: una parola con due
      // trattini finiva incollata dentro alla critica — che poi non si
      // modifica più, e che l'owner legge nella chat del feedback (#565).
      const intrusa = rest.find((a) => SEMBRA_OPZIONE(a));
      if (intrusa) {
        console.error(`Argomento non capito: ${intrusa} — non ho registrato niente. Qui la critica è un testo solo, fra virgolette: opzioni non ce ne sono.`);
        process.exit(1);
      }
      // In UN pezzo solo: unendo i pezzi con uno spazio, un rilievo che sta nel
      // secondo non apre più una riga, smette di essere un rilievo, e la
      // bocciatura diventa una promozione (feedback #565).
      if (rest.length > 1) {
        console.error(`Ho ricevuto ${rest.length} pezzi invece di uno: non ho registrato niente. La critica va fra virgolette, tutta in un pezzo solo — probabilmente ne manca una.`);
        console.error(`Primo pezzo: "${String(rest[0]).slice(0, 60)}…" · secondo: "${String(rest[1]).slice(0, 60)}…"`);
        process.exit(1);
      }
      // Il pavimento al motivo, uguale nei due sensi: copre insieme la critica
      // vuota (l'identificativo e basta) e quella di due parole.
      const critica = rest.join(' ').trim();
      if (critica.length < MIN_CRITIQUE_CHARS) {
        console.error(`Critica troppo corta (${critica.length} caratteri, il minimo è ${MIN_CRITIQUE_CHARS}): non ho registrato niente.`);
        console.error('Vale anche quando promuovi: senza rilievi la verifica risulta superata, e una promozione senza motivo non dice a nessuno cosa hai provato.');
        process.exit(1);
      }
      // Le domande si leggono qui, a critica già buona: un file assente ferma con la frase giusta, e niente parte a metà.
      const lette = opz['--domanda'] ? await leggiDomandeDaFile(opz['--domanda'], { elenco: true }) : { ok: true, domande: [] };
      if (!lette.ok) { console.error(lette.errore); process.exit(1); }
      const s = await recordVerifier(id, critica, lette.domande);
      if (s.rejected) esciRespinto(s);
      console.log(`stato ${id}: esito=${VERIFIER_OUTCOMES.includes(s.reply?.outcome) ? s.reply.outcome : 'non comunicato'}`);
      console.log(verifierReplyText(s.reply, id));
      process.exit(0);
    } else if (flag === '--record-fixed') {
      const ferma = opz['--ferma'] === true;
      const [, id, ...rest] = conBiglietto(argv);
      if (!id) { console.error('Uso: --record-fixed <id> "report" [--motivo "…" (obbligatorio per il correttore)] [--frase "…"] [--domanda <file.json>]'); process.exit(1); }
      if (SEMBRA_OPZIONE(id)) { console.error(idCheSembraOpzione(id, '--motivo "…", --frase "…", --domanda <file.json> e --ferma')); process.exit(1); }
      const senza = fermaSenzaDomanda(ferma, opz['--domanda']);
      if (senza) { console.error(senza); process.exit(1); }
      // La frase è la riga in chiaro per chi ha mandato il feedback; il resto è il report per l'owner,
      // che il server cifra.
      const frase = typeof opz['--frase'] === 'string' ? opz['--frase'] : '';
      const report = rest.join(' ');
      // Un'altra cosa coi trattini davanti finirebbe sepolta nel report cifrato (#565).
      const altra = rest.find((a) => sembraOpzioneNelReport(a));
      if (altra) {
        console.error(`Argomento non capito: ${altra} — non ho consegnato niente. Qui ci sono solo --motivo "…", --frase "…", --domanda <file.json> e --ferma; il resto è il report, un testo solo fra virgolette.`);
        process.exit(1);
      }
      // Anche di qui esce un esito — il lavoro torna in coda a un'altra
      // verifica — e un esito senza motivo non vale: stesso pavimento della
      // critica, per la stessa ragione (feedback #565).
      if (report.trim().length < MIN_CRITIQUE_CHARS) {
        console.error(`Report della correzione troppo corto (${report.trim().length} caratteri, il minimo è ${MIN_CRITIQUE_CHARS}): non ho consegnato niente.`);
        console.error('Scrivi cosa hai corretto e cosa hai lasciato stare: è quello che l\'owner legge, e non si riscrive più.');
        process.exit(1);
      }
      const letta = opz['--domanda'] ? await leggiDomandeDaFile(opz['--domanda']) : { ok: true, domande: [] };
      if (!letta.ok) { console.error(letta.errore); process.exit(1); }
      const domanda = letta.domande[0] || null;
      // Senza motivo il biglietto del correttore non si chiude (SPEC-RIDISEGNO-LAVORO.md §3, regola 4).
      const siFerma = !!(domanda && domanda.blocca !== false);
      const motivo = motivoDellaConsegna(opz['--motivo'], readMarker(ROOT)?.role, { siFerma });
      if (!motivo.ok) { console.error(`${motivo.errore} Non ho consegnato niente.`); process.exit(1); }
      const s = await recordFixed(id, report, frase, ferma, domanda, motivo.motivo);
      if (s.rejected) esciRespinto(s);
      console.log(fixedReplyText(id, s.reply, ferma || !!domanda));
      process.exit(0);
    } else if (flag === '--record-pulizia') {
      const [, id, ...avanzo] = conBiglietto(argv);
      if (!id || SEMBRA_OPZIONE(id)) { console.error('Uso: --record-pulizia <id>'); process.exit(1); }
      if (avanzo.length) {
        console.error(`Argomento non capito: ${avanzo[0]} — non ho registrato niente. Qui ci va solo l'identificativo: cosa hai tolto lo dice il commit.`);
        process.exit(1);
      }
      const s = await recordPulizia(id);
      if (s.rejected) esciRespinto(s);
      const quante = s.files.length === 1 ? '1 prova toccata' : `${s.files.length} prove toccate`;
      console.log(s.dopo
        ? `stato ${id}: pulizia dopo le correzioni registrata su ${String(s.sha).slice(0, 8)} (${quante}). La consegna non le rilancia più com'erano: di quelle a cui ha tolto un caso rilancia quello che resta, e ogni altra prova del giro tolta o cambiata dalla pulizia di prima, se com'era è ancora rossa, la ferma.`
        : `stato ${id}: pulizia registrata su ${String(s.puliziaSha).slice(0, 8)} (${s.files.length === 1 ? '1 prova tolta' : `${s.files.length} prove tolte`}). Da qui parte il confronto della consegna: ogni prova del giro tolta o cambiata dopo, o che usa un file di supporto cambiato, se com'era è ancora rossa, la ferma.`);
      console.log(s.files.map((f) => `  · ${f}`).join('\n'));
      process.exit(0);
    } else if (flag === '--record-secaudit') {
      const [, id, verdict, ...avanzo] = conBiglietto(argv);
      if (id && SEMBRA_OPZIONE(id)) { console.error(idCheSembraOpzione(id, '--nota <file.md>')); process.exit(1); }
      if (!id || !SECAUDIT_VERDICTS.includes(verdict)) { console.error('Uso: --record-secaudit <id> <pass|fail> --nota <file.md>'); process.exit(1); }
      // Qui non c'è altro da dire: un argomento in più veniva ignorato in
      // silenzio e il verdetto partiva lo stesso (feedback #565).
      if (avanzo.length) {
        console.error(`Argomento non capito: ${avanzo[0]} — non ho registrato niente. Qui ci vanno solo l'identificativo, pass|fail e --nota <file.md>.`);
        process.exit(1);
      }
      const testo = opz['--nota'] ? leggiTestoLivello(opz['--nota'], 'nota') : { ok: true, testo: '' };
      if (!testo.ok) { console.error(testo.message); process.exit(1); }
      // Un pass senza nota si ferma PRIMA di consegnare, con cosa scrivere.
      const ferma = secauditSenzaNota(verdict, testo.testo);
      if (ferma) { console.error(ferma); process.exit(1); }
      const s = await recordSecaudit(id, verdict, testo.testo);
      if (s.rejected) esciRespinto(s);
      console.log(`stato ${id}: secaudit=${s.secauditVerdict}`);
      process.exit(0);
    } else if (flag === '--help' || flag === '-h') {
      // Chi chiede aiuto riceve aiuto. La versione che non conosceva `--help`
      // lo trattava da giro nuovo senza biglietto e gli cancellava il
      // promemoria: è il comando che ha perso il verdetto di #444.
      console.log(usageText());
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
      const perFeedback = opz['--feedback'] === undefined ? '' : numeroFeedback(opz['--feedback']);
      if (opz['--feedback'] !== undefined && !perFeedback) {
        console.error(`--feedback vuole un numero di feedback (1680, #1680 o 1680.2), non "${String(opz['--feedback']).slice(0, 30)}". Niente è stato toccato.`);
        process.exit(1);
      }
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
          const dirRuoli = resolve(tools, 'routines', 'roles');
          const f = resolve(dirRuoli, perFeedback ? 'sessione.md' : 'orchestrator.md');
          // Anche qui i richiami ai pezzi condivisi si espandono: letto grezzo,
          // un richiamo arrivava all'orchestratore come una riga di commento
          // vuota, al posto delle regole che doveva portare.
          const letto = existsSync(f) ? espandiInclusioni(readFileSync(f, 'utf8'), dirRuoli) : '';
          const brief = perFeedback ? letto.split('<numero-del-feedback>').join(perFeedback) : letto;
          const da = pinnedOrigin(tools);
          console.log(`[dispatch] prontezza OK. Strumenti fissati${da ? ` da ${da}` : ''}.`);
          if (nonVerificato) {
            process.stderr.write(
              `[dispatch] ATTENZIONE: non ho potuto controllare che il progetto fosse aggiornato `
              + `(${nonVerificato}). Gli strumenti fissati potrebbero essere già vecchi.\n`);
          }
          // Chi ha passato il preflight è l'orchestratore: da qui la sua sessione non riceve il testo dei worker
          // (lib/orchestratore-cieco.mjs). Senza gancio il giro non parte: meglio un giro saltato che uno che vede.
          // Solo in cloud: sulla macchina dell'owner le impostazioni utente valgono per tutte le sue sessioni.
          // Anche la sessione di un feedback tiene la parola d'ordine: cieca come l'orchestratore, lancia il worker (#1680 giro 1).
          const cieco = process.env.CLAUDE_CODE_REMOTE === 'true'
            ? installaCecita({ sessione: process.env.CLAUDE_CODE_SESSION_ID || '', clone: cartellaCloneServer() })
            : { ok: true, saltato: true };
          if (cieco.saltato) console.error('[dispatch] ATTENZIONE: fuori dal cloud il gancio dell\'orchestratore cieco non si installa; resta quello dei worker (chiudono con FATTO).');
          if (!cieco.ok) {
            console.error(`[dispatch] GUASTO (transient): gancio dell'orchestratore cieco non installato in ${cieco.file} (${cieco.why})`);
            process.exit(3);
          }
          // Stessa porta del gancio: in cloud ogni worker lavora in un clone suo, fuori da questa cartella (#1182).
          if (!cieco.saltato) {
            const acceso = accendiClone(tools);
            if (!acceso.ok) {
              console.error(`[dispatch] GUASTO (transient): clone dei worker non acceso in ${tools} (${acceso.why})`);
              process.exit(3);
            }
          }
          const partenza = rigaCartellaDiPartenza(process.cwd(), ROOT);
          if (partenza) console.log(`\n${partenza}`);
          console.log('Le tue istruzioni:\n');
          console.log(absolutizeRecipe(brief, tools, ROOT)
            || `(routines/roles/${perFeedback ? 'sessione' : 'orchestrator'}.md mancante: segnala il guasto e fermati)`);
          process.exit(0);
        }
        if (r.kind === 'off') console.log(`[dispatch] SPENTO: ${r.message}`);
        else console.error(`[dispatch] GUASTO (${r.kind}): ${r.message}`);
        process.exit(preflightExitCode(r));
      }).catch((e) => { console.error(`[dispatch] GUASTO (transient): ${e?.message || e}`); process.exit(3); });
    } else if (flag === '--linea-principale') {
      const r = tornaAllaLineaPrincipale();
      if (r.vivo) {
        console.error(`[dispatch] LAVORO VIVO: ${r.message}\nChiudi il giro senza rilasciare niente: chi lavora qui consegna e rilascia da sé.`);
        process.exit(USCITA_LAVORO_VIVO);
      }
      if (!r.ok) {
        console.error(`[dispatch] ${r.uso ? '' : 'GUASTO (transient): '}${r.message}`);
        process.exit(r.uso ? 1 : 3);
      }
      console.log(`[dispatch] cartella sulla linea principale (${String(r.head).slice(0, 9)}): il prossimo worker parte con gli agenti di ${MAIN_BRANCH}.`);
      process.exit(0);
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
      // Due sole forme legittime arrivano qui: NESSUN argomento (giro locale)
      // o `--ticket <codice>` (giro col server). Tutto il resto — un flag
      // storpiato, un `--ticket` senza codice — esce con un errore d'uso e NON
      // tocca niente. Prima questa porta era anche quella degli argomenti
      // sconosciuti: un `--help` battuto a metà lavoro veniva letto come "giro
      // nuovo senza biglietto" e cancellava il promemoria — il verdetto di
      // un'ora di verifica (#444) non si è più potuto registrare.
      // Il codice ha già la FORMA di un biglietto (stripTicketArg, in cima): un flag finito al posto del
      // codice (`--foo`, `-h`) qui sovrascriveva il promemoria del giro in corso.
      const ticket = bigliettoAMano;
      const estranei = argv;
      if (estranei.length) {
        console.error(`[dispatch] argomento non riconosciuto: ${estranei[0]} (vedi --help). Niente è stato toccato: promemoria e battito restano come sono.`);
        process.exit(1);
      }
      // Il biglietto viene messo dove chi consegna lo ritrova da solo: le
      // consegne le fanno script diversi, in momenti diversi, e pretendere che
      // il lavoratore se lo ricordi ogni volta è la scommessa già persa sulla
      // provenienza dei feedback. Un giro DICHIARATO senza biglietto cancella
      // il marcatore, o quello del giro prima sopravvivrebbe a questo.
      giroDelBiglietto = true;
      // Nel giro acceso dal preflight il worker non lavora qui ma nel suo clone: lo stesso comando riparte da lì,
      // e lì vanno promemoria e battito. Senza clone si ferma: la cartella della sessione resta fuori (#1182).
      const giro = ticket ? cloneDelGiro(ROOT) : null;
      if (giro) {
        const c = preparaPerIlGiro(ROOT, giro);
        if (!c.ok) {
          console.error(`[dispatch] GUASTO: il clone del worker non è pronto (${c.why}). Nella cartella della sessione non si lavora: dichiaralo come guasto (gruppo «guasto: clone git»).`);
          process.exit(1);
        }
        process.exit(rilancia(c.strumenti, 'dispatch.mjs', ['--ticket', ticket]));
      }
      // Prima di ogni marcatore: biglietto, battito e ruolo di chi lavora ancora qui restano i suoi (#1480).
      // Chi rilancia dispatch col biglietto che la cartella ha già è lo stesso worker: i processi lì sono i suoi.
      const marcatore = ticket ? leggiMarcatoreBiglietto(ROOT) : null;
      const giaSua = !!(marcatore && String(marcatore.ticket || '') === ticket && !bigliettoFinito(marcatore));
      if (ticket && !giaSua) {
        const vivo = lavoroVivo(ROOT, { mio: ticket });
        if (vivo.vivo) process.exit(emitHalt('transient', testoLavoroVivo(vivo, 'preso la cartella per il tuo lavoro'), { vivo: true }).exit);
      }
      if (ticket) writeRoutineTicket(ROOT, ticket); else clearRoutineTicket(ROOT);
      // E col biglietto parte il BATTITO, qui e non nelle ricette: il semaforo
      // cade dopo un'ora di silenzio (era mezz'ora quando è nato il battito) e
      // una lavorazione lunga (finish:check più le prove del giro) lo supera
      // — la suite completa, che lo superava sempre, dal 2026-09-15 gira solo
      // in GitHub Actions a ogni fusione su main, mai nelle routine —
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
        process.exit(emitFatale(e).exit);
      });
    }
  } catch (e) {
    if (giroDelBiglietto) process.exit(emitFatale(e).exit);
    console.error('[dispatch] errore:', e.message);
    process.exit(1);
  }
}
