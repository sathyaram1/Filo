// verify-local.mjs — la verifica avversariale, anche in sessione locale.
//
// PERCHÉ ESISTE
//   In cloud, prima che una modifica arrivi agli utenti, un'istanza DIVERSA da
//   quella che ha scritto il codice prova a romperla. Non vede il diff e non
//   legge il report di chi ha lavorato: vede solo cosa era stato chiesto, e
//   giudica se adesso l'utente ottiene quella cosa. È l'unico controllo che
//   trova i lavori "verdi ma sbagliati" — quelli in cui i test passano perché
//   li ha scritti chi ha anche scritto il bug.
//
//   In locale quel passaggio non esisteva: si lanciavano i test e si pubblicava.
//   I test però li scrive la stessa istanza che ha fatto il lavoro, quindi
//   condividono i suoi punti ciechi. Da qui in poi anche in locale si passa di
//   qui, e `npm run finish` non pubblica senza un esito positivo.
//
// IL GIRO (feedback #561)
//   Stessa struttura del giro in cloud. Chi verifica registra la CRITICA coi
//   livelli; questo strumento calcola l'esito dai livelli e dai tre bilanci
//   (le stesse regole del server, src/shared/verifierRound.js) e lo stampa.
//   Chiuso il giro serve un'altra verifica, fatta da un'altra istanza.
//
// COME SI USA
//
//   node scripts/verify-local.mjs start "<cosa aveva chiesto l'owner>"
//     Registra la richiesta di verifica per il ramo corrente e STAMPA il testo
//     da consegnare a un'istanza NUOVA. Quel testo contiene la richiesta e il
//     ramo, MAI il diff né il report: è l'isolamento che rende la verifica
//     avversariale invece di una rilettura compiacente. Dopo una correzione
//     si rilancia senza argomenti: riusa la richiesta registrata.
//
//   node scripts/verify-local.mjs critica "<una riga per rilievo, col livello davanti>"
//     Lo lancia l'istanza che ha verificato. Formato: `[2] testo`, `[1?]` =
//     chiede una decisione dell'owner; le righe prima del primo rilievo sono
//     il riassunto. Nessun rilievo = verifica superata. Stampa l'esito.
//     Le quadre col livello dentro sono SEMPRE un rilievo, dovunque stiano
//     nella riga: nel riassunto il livello si cita a parole («il livello 2»).
//
//   node scripts/verify-local.mjs corretto "<report della correzione>"
//     Lo lancia chi ha corretto: chiude il giro e chiede un'altra verifica
//     sul commit nuovo.
//
//   node scripts/verify-local.mjs status
//     Esito per il ramo corrente. Exit 0 = si può pubblicare.
//
//   Non ci sono scorciatoie: si promuove e si boccia dallo stesso comando, e
//   in tutti e due i casi il motivo si scrive (feedback #565).
//
// L'ESITO È LEGATO AL CONTENUTO, NON AL RAMO
//   Il verdetto vale per il commit su cui è stato dato. Se dopo il PASS si
//   tocca ancora il codice, il verdetto decade e va rifatto: altrimenti
//   basterebbe farsi approvare una versione e pubblicarne un'altra.
//   UNICA eccezione (#661): i marcatori di rosso atteso (`test.fail`) che chi
//   verifica scrive sulle prove del giro per i rilievi messi da parte. Lì
//   quello che gira non cambia, e il verdetto regge sul commit che li
//   aggiunge — a patto che in quel commit non cambi altro, e niente fuori da
//   `tests/verifica/`.
//
// DOVE VIVE
//   `.claude/verify-local.json`, effimero e gitignorato come gli altri
//   marcatori di sessione: riguarda questa macchina e questo momento.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirtyTreeText, statoDirectory, statoIllegibileText } from './lib/dirty-tree.mjs';
import { espandiInclusioni } from './lib/role-text.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : resolve(__dirname, '..');

// Le regole del giro: le stesse del server e degli strumenti delle routine
// (fonte unica). Lette dal progetto, accanto a questo file: in locale non c'è
// una copia fissata degli strumenti. I BILANCI (cap2/cap1/cap0) invece non
// stanno in nessun file: si leggono dal server (leggiBilanciDalServer).
const require = createRequire(import.meta.url);
require(resolve(__dirname, '..', 'src', 'shared', 'feedbackTransitions.js'));
require(resolve(__dirname, '..', 'src', 'shared', 'verifierRound.js'));
const ROUND = globalThis.SN_VERIFIER_ROUND;
const CAP_KEYS = (globalThis.SN_FB_TRANSITIONS && globalThis.SN_FB_TRANSITIONS.VERIFIER_CAP_KEYS) || ['cap2', 'cap1', 'cap0'];

// ─── I bilanci del giro si leggono dal server ────────────────────────────────
//
// Fino al 2026-09-16 questo script ragionava con un default scritto nel
// codice (5/2/0) mentre l'owner in dashboard aveva 10/1/0: i giri locali
// facevano i conti coi numeri sbagliati. Decisione dell'owner: i tre bilanci
// si leggono dal documento che la dashboard scrive (`config/routines`, campi
// cap2/cap1/cap0, Gestione → Automazioni), con l'identità dell'owner — lo
// stesso token admin degli altri script locali (FILO_ADMIN_REFRESH_TOKEN, in
// tests/agent/.env del checkout principale) — e NON c'è un ripiego: se il
// token manca, se la lettura fallisce o se il documento non ha i tre numeri,
// ci si ferma con un errore che dice cosa manca e dove si mette.
//
// `FILO_ROUTINE_CONFIG_URL` e `FILO_ADMIN_ID_TOKEN` esistono per i controlli
// (un server finto in ascolto in locale, un token già coniato): non sono un
// ripiego, in produzione non sono impostate e la lettura resta quella vera.
export const SENZA_TOKEN_MSG = 'Manca FILO_ADMIN_REFRESH_TOKEN: i bilanci del giro (cap2/cap1/cap0) si leggono dal server con l\'identità dell\'owner. '
  + 'Mettilo in tests/agent/.env del checkout principale (riga FILO_ADMIN_REFRESH_TOKEN=…, lo genera `node scripts/admin-login.mjs`) '
  + 'oppure esportalo nell\'ambiente. Senza, la verifica non parte: non c\'è un default.';

/** Il numero di un campo Firestore (integerValue/doubleValue/stringValue numerica), o NaN. PURA. */
export function numeroFirestore(campo) {
  if (!campo || typeof campo !== 'object') return NaN;
  const raw = campo.integerValue != null ? campo.integerValue
    : campo.doubleValue != null ? campo.doubleValue
      : campo.stringValue;
  if (raw === undefined || raw === null || String(raw).trim() === '') return NaN;
  return Number(raw);
}

/**
 * I tre bilanci come stanno nel documento del server. Lancia con un messaggio
 * che dice cosa manca; mai un numero al posto di quello dell'owner.
 * @returns {Promise<{cap2:number, cap1:number, cap0:number, fixInstructions:string}>}
 */
export async function leggiBilanciDalServer({ fetchImpl = fetch, env = process.env, trovaRefresh = null } = {}) {
  const fa = await import('./lib/firestore-auth.mjs');
  let idToken = String(env.FILO_ADMIN_ID_TOKEN || '').trim();
  if (!idToken) {
    const refresh = env.FILO_ADMIN_REFRESH_TOKEN || (trovaRefresh || fa.findAdminRefreshToken)();
    if (!refresh) throw new Error(SENZA_TOKEN_MSG);
    idToken = await fa.mintIdToken(refresh);
  }
  const url = env.FILO_ROUTINE_CONFIG_URL || `${fa.FIRESTORE_BASE}/config/routines?key=${fa.FIREBASE_API_KEY}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${idToken}` } });
  } catch (e) {
    throw new Error(`config/routines non letto dal server (rete): ${String((e && e.message) || e)}. Senza i bilanci la verifica non parte.`);
  }
  if (res.status === 404) {
    throw new Error('config/routines non esiste sul server: l\'owner deve salvare i tre bilanci in Gestione → Automazioni. Non c\'è un default.');
  }
  if (!res.ok) {
    const testo = await res.text().catch(() => '');
    throw new Error(`config/routines non letto dal server (HTTP ${res.status}): ${testo.slice(0, 200)}. Senza i bilanci la verifica non parte.`);
  }
  const json = await res.json();
  const fields = (json && json.fields) || {};
  const out = { fixInstructions: '' };
  const mancanti = [];
  for (const k of CAP_KEYS) {
    const n = numeroFirestore(fields[k]);
    if (Number.isFinite(n)) out[k] = n; else mancanti.push(k);
  }
  if (mancanti.length) {
    throw new Error(`config/routines sul server non ha ${mancanti.join(', ')}: l'owner li imposta in Gestione → Automazioni (un numero, 0 compreso), poi si riprova. Non c'è un default.`);
  }
  if (fields.fixInstructions && typeof fields.fixInstructions.stringValue === 'string') out.fixInstructions = fields.fixInstructions.stringValue;
  return out;
}

/** Una riga per chi guarda lo schermo. PURA. */
export function bilanciText(caps) {
  return `Bilanci del giro (dal server, config/routines): ${CAP_KEYS.map((k) => `${k} ${caps[k]}`).join(' · ')}`;
}

export function stateFile(root = ROOT) {
  return resolve(root, '.claude', 'verify-local.json');
}

// Tetto di una critica: lo stesso del server (12000 caratteri). Oltre, la
// registrazione è respinta con la spiegazione, mai tagliata in silenzio
// (CLAUDE.md § Limiti).
export const MAX_CRITIQUE_CHARS = 12000;
// E un pavimento: una verifica di due parole non è una verifica. Vale anche
// per il pass, che è la promozione (feedback #565).
export const MIN_CRITIQUE_CHARS = 80;

// La coda della risposta vive fuori dal repo, accanto a LOCAL.md: è roba di
// questa macchina, non del progetto.
export function codaFile(root = ROOT) {
  // «Sopra il repo» vuol dire sopra il checkout PRINCIPALE: un lavoro che sta
  // in una cartella di lavoro separata (`.claude/worktrees/<nome>`) ha come
  // cartella sopra quella dei worktree, e lì il file non c'è (verifica del
  // giro 9 su #561). La radice vera la dice git, come per il marcatore del
  // ruolo; senza git si ripiega sulla cartella sopra `root`.
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (common) return resolve(common, '..', '..', 'CODA-GIRO-LOCALE.md');
  } catch (_) { /* niente git: ripiego */ }
  return resolve(root, '..', 'CODA-GIRO-LOCALE.md');
}
export function leggiCoda(root = ROOT) {
  const f = codaFile(root);
  try { return existsSync(f) ? readFileSync(f, 'utf8').trim() : ''; } catch (_) { return ''; }
}

// ─── Logica pura (testata in tests/unit/verifyLocal.test.mjs) ────────────────

/**
 * La verifica registrata copre il contenuto che si sta per pubblicare?
 * Ritorna { ok, reason } — `reason` è già la frase da mostrare a chi pubblica.
 *
 * Casi di NO, tutti reali:
 *   - nessuno ha mai verificato questo ramo;
 *   - la verifica è avviata ma senza esito;
 *   - c'è un giro di correzione aperto, non ancora consegnato;
 *   - ha corretto: serve un'altra verifica sul commit nuovo;
 *   - qualcuno ha verificato e si è fermato (un 3/2 non correggibile);
 *   - qualcuno ha verificato e ha approvato, ma POI il codice è cambiato → il
 *     verdetto riguarda una versione che non è quella che uscirebbe.
 */
export function checkVerdict(entry, headSha, dirty = false, leggiDiff = null) {
  if (!entry || (!entry.verdict && !entry.request)) {
    return { ok: false, reason: 'nessuna verifica avviata per questo lavoro' };
  }
  if (!entry.verdict) {
    // Distinguere questo dal caso sopra evita mezz'ora persa a rilanciare
    // `start` quando il pezzo che manca è la critica di chi doveva verificare.
    return { ok: false, reason: 'verifica avviata ma senza esito: chi doveva verificare non ha ancora registrato la critica' };
  }
  if (entry.verdict === 'fix-pending') {
    return { ok: false, reason: 'c\'è un giro di correzione aperto su questo ramo: i rilievi non sono ancora stati consegnati (verify-local.mjs corretto)' };
  }
  if (entry.verdict === 'fixed') {
    return { ok: false, reason: 'la correzione è stata consegnata: serve un\'altra verifica sul contenuto nuovo (verify-local.mjs start)' };
  }
  if (entry.verdict !== 'pass') {
    return { ok: false, reason: `la verifica ha bocciato il lavoro: ${entry.critique || '(nessuna critica registrata)'}` };
  }
  if (!headSha || entry.sha !== headSha) {
    // Unica eccezione (#661): dopo la verifica sono cambiati solo i marcatori
    // di rosso atteso nelle prove del giro. Quello che gira è lo stesso, e il
    // verdetto riguarda quello. `leggiDiff` legge i due contenuti da git: chi
    // non lo passa (i controlli sulla sola logica) ha il cancello stretto di
    // sempre.
    const tol = (typeof leggiDiff === 'function' && entry.sha && headSha)
      ? soloMarcatori(leggiDiff(entry.sha, headSha))
      : null;
    if (!tol || !tol.ok) {
      const perche = tol && tol.motivo ? ` (${tol.motivo})` : '';
      return { ok: false, reason: `il codice è cambiato dopo la verifica: l’esito riguarda una versione diversa da quella che pubblicheresti${perche}` };
    }
    // Tollerato — ma le modifiche non salvate non stanno in nessuno dei due
    // commit, quindi il confronto non le ha viste: di quelle risponde il
    // controllo qui sotto, che è anche quello che dice la cosa vera.
    if (!dirty) {
      return {
        ok: true,
        tollerato: true,
        files: tol.files,
        reason: tol.files.length
          ? `verifica superata su ${String(entry.sha).slice(0, 8)}: dopo di lei nelle prove del giro sono cambiati solo i marcatori di rosso atteso (${tol.files.join(', ')}), e quello che gira è lo stesso`
          : `verifica superata su ${String(entry.sha).slice(0, 8)}: dopo di lei il contenuto non è cambiato`,
      };
    }
  }
  // Il confronto sopra guarda l'ULTIMO SALVATAGGIO, e le modifiche non ancora
  // salvate non lo spostano: senza questo, si può far approvare una versione,
  // modificare i file e vedersi dire ancora "verifica superata". È successo
  // davvero, su questo stesso lavoro.
  if (dirty) {
    return { ok: false, reason: 'ci sono modifiche non salvate: la verifica riguarda il codice com’era, non com’è adesso' };
  }
  return { ok: true, reason: 'verifica superata su questo contenuto' };
}

/**
 * Registra l'avvio di una verifica (nessun verdetto ancora). PURA.
 * I bilanci consumati e i rilievi messi da parte nei giri precedenti dello
 * stesso lavoro sopravvivono: sono del lavoro, non della singola verifica.
 */
export function withRequest(state, branch, { request, sha, at }) {
  const s = (state && typeof state === 'object') ? { ...state } : {};
  const prev = s[branch] || {};
  s[branch] = {
    request: String(request || ''),
    requestedSha: sha || '',
    requestedAt: at || new Date().toISOString(),
    counts: prev.counts || {},
    derived: Array.isArray(prev.derived) ? prev.derived : [],
    rounds: Array.isArray(prev.rounds) ? prev.rounds : [],
  };
  return s;
}

/**
 * Registra una critica sul contenuto `sha` e ne calcola l'esito coi bilanci
 * del lavoro. PURA. Ritorna { state, decision, outcome }:
 *   outcome 'pass' → verdict 'pass' (i rilievi rimasti si accodano a `derived`)
 *   outcome 'fix'  → verdict 'fix-pending' (con `pending`: i rilievi da correggere)
 *   outcome 'stop' → verdict 'fail'
 */
export function withCritique(state, branch, { critique, sha, at, caps, dirtyFiles = [] }) {
  // I bilanci arrivano dal server (leggiBilanciDalServer): qui non c'è un
  // default con cui rimpiazzarli, e mancarne uno è un errore di chi chiama.
  const mancanti = ROUND.missingCaps(caps);
  if (mancanti.length) throw new Error(`withCritique senza i bilanci ${mancanti.join(', ')}: si leggono dal server prima di calcolare l'esito`);
  const s = (state && typeof state === 'object') ? { ...state } : {};
  const prev = s[branch] || {};
  // Una critica vuota non è un pass: un pass senza una riga di riassunto non
  // dice cosa è stato provato, ed è più spesso un comando lanciato male che
  // una verifica (una bocciatura senza motivo è già rifiutata).
  if (!String(critique || '').trim()) {
    return { ok: false, state: s, reason: 'critica vuota: un pass senza una riga di riassunto non è una verifica. Scrivi cosa hai provato e cosa funziona, e i rilievi se ci sono.' };
  }
  // La critica vale per un commit. Con file non registrati (le spec
  // temporanee della verifica, tolte dalla shell) il salvataggio automatico
  // committa DOPO, la punta si sposta e la chiusura respinge il pass come dato
  // su un'altra versione: lo stesso caso di #256, sulla strada locale. Si
  // rifiuta PRIMA, con l'elenco, come sulla strada delle routine. Vale per
  // ogni esito, non solo per il pass: a correzione in sospeso, il commit della
  // pulizia passerebbe per una correzione.
  if (Array.isArray(dirtyFiles) && dirtyFiles.length) {
    return { ok: false, state: s, reason: dirtyTreeText(dirtyFiles) };
  }
  // La critica registrata non si modifica più, e un giro non si paga due volte
  // per un comando ripetuto: finché la correzione è in sospeso, prima si
  // consegna.
  if (prev.verdict === 'fix-pending' && prev.pending) {
    // La STESSA critica (stesso testo, stesso commit) rimandata dalla stessa
    // istanza: è la risposta persa (uscita troncata, terminale chiuso), e si
    // ridà la stessa risposta senza scrivere niente e senza ripagare il giro,
    // come già sul server (verifica del giro 10 su #561). Un testo diverso
    // resta una seconda critica, e viene respinto.
    if (ROUND.normalizeCritique(critique) === String(prev.critique || '') && String(sha || '') === String(prev.sha || '')) {
      const p = prev.pending;
      return {
        ok: true, state: s, replayed: true, outcome: 'fix',
        decision: { fix: p.findings || [], derived: Array.isArray(p.derived) ? p.derived : [], budgets: p.budgets || null, blocking: [] },
      };
    }
    return { ok: false, state: s, reason: 'critica già registrata su questo giro: non si modifica più, e un giro non si paga due volte. Prima chi corregge consegna (verify-local.mjs corretto "<report>"), poi si riparte con start. (Se ti serve rileggere la risposta, rimanda la stessa identica critica: viene ristampata senza pagare.)' };
  }
  // Consegnata la correzione, la verifica dopo la fa un'ALTRA istanza, e parte
  // da `start` (la porta del giro 1, vista dal lato locale).
  if (prev.verdict === 'fixed') {
    return { ok: false, state: s, reason: 'la correzione è stata consegnata: la verifica sul contenuto nuovo la fa un\'altra istanza, e parte da "verify-local.mjs start" (lo rilancia chi guida).' };
  }
  // Dopo un pass o uno stop la critica del giro è registrata: una seconda,
  // senza un nuovo `start`, è la stessa istanza che ci ripensa — e con un [2]
  // dentro trasformava un pass in «sta correggendo», pagando un giro (verifica
  // del giro 3 su #561; sul server la porta era già chiusa).
  if (prev.verdict === 'pass' || prev.verdict === 'fail') {
    return { ok: false, state: s, reason: `la critica di questo giro è già registrata (esito: ${prev.verdict === 'pass' ? 'superata' : 'fermato'}) e non si modifica più. La verifica dopo la fa un'altra istanza, e parte da "verify-local.mjs start" (lo rilancia chi guida).` };
  }
  // Un livello fra parentesi quadre che non apre una riga non è un rilievo, e
  // farlo finire nel riassunto trasformava un [2] in un pass silenzioso.
  const brutte = ROUND.unparsedLevelLines(critique);
  if (brutte.length) {
    return { ok: false, state: s, reason: `rilievi non riconosciuti. Le parentesi quadre con dentro un livello sono SEMPRE un rilievo, dovunque stiano nella riga: nel riassunto e nei passi un livello si cita a parole («il livello 2»), mai «[2]». Il livello, fra 0 e 3, va a inizio riga col testo del rilievo dopo, una riga per rilievo («[2] testo», anche «- [2]», «1. [2]», «### [2]»). Righe da sistemare:\n  ${brutte.join('\n  ')}` };
  }
  // Il testo si conserva con gli a capo veri (una barra-n scritta come a capo
  // vale come a capo): è quello che il verificatore dopo rilegge nel brief.
  // Tetto abbondante e niente taglio silenzioso: tagliata, una critica perdeva
  // proprio i rilievi, che stanno in coda (giro 8 su #561).
  const testo = ROUND.normalizeCritique(critique);
  if (testo.length > MAX_CRITIQUE_CHARS) {
    return { ok: false, state: s, reason: `critica troppo lunga: ${testo.length} caratteri, il massimo è ${MAX_CRITIQUE_CHARS}. Accorcia il riassunto, non i rilievi.` };
  }
  const parsed = ROUND.parseFindings(critique);
  const decision = ROUND.decideRound({ findings: parsed.findings, caps, counts: prev.counts || {} });
  const outcome = decision.stop ? 'stop' : decision.fix.length ? 'fix' : 'pass';
  const when = at || new Date().toISOString();
  const entry = {
    ...prev,
    critique: testo,
    findings: parsed.findings,
    sha: sha || '',
    at: when,
    counts: decision.counts,
    // Ogni giro tiene anche il TESTO della critica: è la storia che il
    // verificatore dopo riceve (le porte già trovate vanno ri-provate, e coi
    // soli livelli non saprebbe quali sono). Il report di chi corregge invece
    // non ci entra: quello il verificatore dopo non deve vederlo.
    rounds: (Array.isArray(prev.rounds) ? prev.rounds : []).concat([{
      at: when, found: parsed.findings.map((f) => f.level), fixed: decision.fix.map((f) => f.level),
      consumed: decision.consume, outcome, critique: testo,
    }]),
  };
  if (outcome === 'stop') {
    entry.verdict = 'fail';
    entry.critique = ROUND.formatFindings(decision.blocking);
    entry.pending = null;
    // Il lavoro si ferma e decide l'owner: i bilanci si azzerano, come sul
    // server. Lasciarli consumati faceva fermare di nuovo, al primo [2], il
    // lavoro rifatto dopo la decisione, senza nessun giro di correzione
    // possibile (verifica del giro 3 su #561). La storia dei giri resta.
    entry.counts = {};
  } else if (outcome === 'fix') {
    entry.verdict = 'fix-pending';
    // Anche i rilievi messi da parte e i bilanci del giro: servono a
    // ristampare la risposta tale e quale se si è persa.
    entry.pending = { findings: decision.fix, sha: sha || '', at: when, derived: decision.derived, budgets: decision.budgets };
    entry.derived = (Array.isArray(prev.derived) ? prev.derived : []).concat(decision.derived);
  } else {
    entry.verdict = 'pass';
    entry.pending = null;
    entry.derived = (Array.isArray(prev.derived) ? prev.derived : []).concat(decision.derived);
  }
  s[branch] = entry;
  return { ok: true, state: s, decision, outcome };
}

/**
 * La storia delle critiche per il verificatore dopo: il testo di ogni giro con
 * rilievi (mai il report di chi ha corretto), e come è andato. PURA.
 */
export function historyFromRounds(rounds) {
  return (Array.isArray(rounds) ? rounds : [])
    .filter((r) => r && Array.isArray(r.found) && r.found.length)
    .map((r) => ({
      critique: `${String(r.critique || '').trim() || `livelli ${r.found.join(', ')}`}\n(esito del giro: ${r.outcome || '?'})`,
    }));
}

/**
 * Chi ha corretto ha consegnato: il giro è chiuso. PURA. Ritorna
 * { ok, state, outcome }:
 *   outcome 'fixed' → c'è un commit nuovo: serve un'altra verifica;
 *   outcome 'pass'  → nessun commit nuovo e in sospeso solo rilievi 1/0: niente
 *                     da riverificare, i rilievi vanno nel report per l'owner;
 *   outcome 'stop'  → nessun commit nuovo e un 3/2 in sospeso: non correggibile,
 *                     decide l'owner (spec §4).
 * Rifiuta se non c'era niente in sospeso, o con modifiche non salvate: la
 * consegna vale per un commit, e la verifica dopo deve provare quello.
 */
export function withFixed(state, branch, { report, sha, at, dirty = false, dirtyFiles = [] }) {
  const s = (state && typeof state === 'object') ? { ...state } : {};
  const prev = s[branch] || {};
  if (prev.verdict !== 'fix-pending' || !prev.pending) {
    // Una consegna ripetuta dopo una consegna riuscita non è «senza critica»:
    // dirlo mandava a cercare una critica che c'era (verifica del giro 10).
    if (prev.verdict === 'fixed') {
      return { ok: false, reason: `la correzione è già stata consegnata su questo ramo (${String(prev.fixedSha || '').slice(0, 8) || 'commit non registrato'}): non c'è altro da consegnare. Serve un'altra verifica, di un'altra istanza (verify-local.mjs start, lo rilancia chi guida).` };
    }
    return { ok: false, reason: 'nessun giro aperto su questo ramo' };
  }
  // Stesso rifiuto della consegna in cloud, dalla stessa fonte: elenca i file
  // rimasti fuori e avverte che dopo un rm dalla shell il salvataggio
  // automatico non arriva da solo. Detto a metà («salva e rilancia») mandava ad
  // aspettare un salvataggio che non parte (verifica del giro 2 su questo
  // lavoro).
  const sporchi = Array.isArray(dirtyFiles) ? dirtyFiles : [];
  if (sporchi.length || dirty) {
    return { ok: false, reason: dirtyTreeText(sporchi, 'consegna') };
  }
  const when = at || new Date().toISOString();
  const rounds = Array.isArray(prev.rounds) ? prev.rounds.slice() : [];
  const pending = Array.isArray(prev.pending.findings) ? prev.pending.findings : [];
  const base = {
    ...prev,
    pending: null,
    fixedReport: String(report || '').slice(0, MAX_CRITIQUE_CHARS),
    fixedSha: sha || '',
    fixedAt: when,
  };
  // Nessun commit nuovo dopo la critica: niente è stato corretto, e non c'è
  // niente da riverificare. Conta una cosa sola, se c'è un commit nuovo o no.
  if (sha && prev.pending.sha && sha === prev.pending.sha) {
    if (rounds.length) rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], outcome: 'non corretto' };
    const gravi = pending.filter((f) => Number(f.level) >= 2);
    if (gravi.length) {
      // Anche qui il lavoro si ferma e decide l'owner: bilanci azzerati.
      s[branch] = { ...base, verdict: 'fail', critique: ROUND.formatFindings(gravi), rounds, counts: {} };
      return { ok: true, state: s, outcome: 'stop', blocking: gravi };
    }
    s[branch] = { ...base, verdict: 'pass', derived: (Array.isArray(prev.derived) ? prev.derived : []).concat(pending), rounds };
    return { ok: true, state: s, outcome: 'pass', derived: pending };
  }
  if (rounds.length) rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], outcome: 'corretto' };
  s[branch] = { ...base, verdict: 'fixed', rounds };
  return { ok: true, state: s, outcome: 'fixed' };
}

/**
 * La cartella dove restano le prove di un giro locale. PURA.
 *
 * In cloud la cartella si intitola al numero del feedback. In locale un numero
 * non c'è, e finché nessuno diceva quale usare le prove non venivano scritte da
 * nessuna parte: chi correggeva non aveva niente da rilanciare e il giro dopo
 * ripagava tutto — cioè proprio la cosa che le prove nel ramo tolgono (verifica
 * del giro 2 su questo lavoro). Il nome viene dal RAMO, perché è l'unica cosa
 * stabile per tutta la vita del lavoro: lo stesso ramo dà sempre la stessa
 * cartella, e i giri si ritrovano.
 */
export function cartellaProveGiro(branch) {
  const slug = String(branch || '')
    .replace(/^(claude|feature|fix)\//i, '')
    // «però» deve restare «pero», non «per»: una lettera accentata è una
    // lettera, e mangiarla cambia il nome della cartella.
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'giro';
  return `${PROVE_GIRO}locale-${slug}`;
}

// ─── Il verdetto non decade per i soli marcatori di rosso atteso (#661) ─────
//
// Quando il giro mette da parte un rilievo (bilancio esaurito) e dice «si può
// pubblicare», le prove del giro che riproducono quel rilievo restano rosse:
// la chiusura le rilancia e si ferma lì. Chi verifica le segna come rosso
// atteso (`test.fail`) e le committa — e quel commit sposta la punta del ramo
// DOPO il verdetto, che vale per il commit di prima. La chiusura respingeva
// («il codice è cambiato dopo la verifica») e serviva un giro intero in più,
// di un'altra istanza, per riverificare un ramo in cui era cambiata una riga
// di test. È successo due volte: il 10/09 sul ramo della suite locale e il
// 18/09 su quello del ripiego crediti (#629), dove il quarto giro è servito
// solo a questo.
//
// LA REGOLA: il verdetto regge su un commit successivo se quello che è
// cambiato non cambia niente di quello che GIRA, e sta tutto nelle prove del
// giro. Non si leggono le righe del diff una per una: si riducono i due
// contenuti a ciò che fa girare — via commenti, righe vuote e marcatori — e si
// confrontano. Così un marcatore aggiunto, tolto o riscritto passa, e una riga
// di codice cambiata dentro una prova del giro no. Il resto del cancello non
// si muove: una prova del giro rossa SENZA marcatore ferma la chiusura come
// prima, perché la chiusura quelle prove le lancia davvero.

/** Dove vivono le prove dei giri di verifica: l'unica cartella tollerata. */
export const PROVE_GIRO = 'tests/verifica/';

/** Il percorso sta fra le prove dei giri? PURA. */
export function dentroProveGiro(percorso) {
  const p = String(percorso ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
  return p.startsWith(PROVE_GIRO) && !p.split('/').includes('..');
}

// Un marcatore di rosso atteso, nelle due forme che Playwright accetta:
//   · modificatore dentro il corpo — `test.fail(true, 'motivo');`
//   · dichiarazione — `test.fail('titolo', async () => { … });`
// Il primo argomento distingue: una stringa è il TITOLO di una prova, quindi
// è la dichiarazione; tutto il resto (niente, una condizione, una funzione) è
// il modificatore. `test.skip` non è qui di proposito: non dice «questo è
// rosso e lo so», toglie la prova dal giro.
const MARCATORE = /^(?:await\s+)?test\s*\.\s*(?:fail|fixme)\s*\(/;
const MARCATORE_DICHIARAZIONE = /^test\s*\.\s*(?:fail|fixme)\s*\(\s*['"`]/;
const APRE_MARCATORE = /test\s*\.\s*(?:fail|fixme)\s*\(/;
// Quante righe al massimo può occupare un marcatore: un motivo lungo va a capo
// una volta o due, non otto.
const MAX_RIGHE_MARCATORE = 8;

/** Saldo delle tonde di una riga. */
function saldoTonde(riga) {
  let s = 0;
  for (const c of String(riga)) {
    if (c === '(') s += 1;
    else if (c === ')') s -= 1;
  }
  return s;
}

/**
 * L'ultima riga del marcatore che comincia a `i`, o -1 se quella riga non è un
 * marcatore intero. In quel caso vale come una riga qualunque e si confronta
 * com'è: meglio un verdetto che decade di uno che tollera una riga di codice
 * inghiottita da un marcatore scritto male.
 *
 * Una virgoletta dimenticata (`test.fail(true, 'motivo;`) lascia le tonde
 * aperte, e chiudono solo sul `});` che chiude la prova: senza i due paletti
 * qui sotto il marcatore si sarebbe mangiato il CORPO della prova, e due corpi
 * diversi sarebbero risultati uguali. Quindi una riga di continuazione è il
 * resto di un argomento e nient'altro: niente graffe, niente frecce, e niente
 * punto e virgola prima che le tonde si chiudano.
 */
function fineIstruzione(righe, i) {
  let saldo = 0;
  for (let j = i; j < righe.length && j - i < MAX_RIGHE_MARCATORE; j += 1) {
    const r = righe[j];
    if (j > i && (/[{}]/.test(r) || r.includes('=>'))) return -1;
    saldo += saldoTonde(r);
    if (saldo <= 0) return j;
    if (j > i && r.trim().endsWith(';')) return -1;
  }
  return -1;
}

/**
 * Riduce una prova del giro a ciò che FA GIRARE: via le righe vuote, via i
 * commenti, via i marcatori di rosso atteso. PURA.
 *
 * Righe vuote e commenti non cambiano cosa fa una prova, e chi segna un rosso
 * atteso quasi sempre scrive accanto anche il perché: se contassero, il giro
 * in più tornerebbe per una riga di commento. Una riga che diventa un commento
 * (`// expect(…)`) invece si vede eccome: quello che c'era prima sparisce dal
 * confronto e il verdetto decade, com'è giusto.
 */
export function corpoSenzaMarcatori(testo) {
  const righe = String(testo ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let blocco = false;
  for (let i = 0; i < righe.length; i += 1) {
    const riga = righe[i];
    const t = riga.trim();
    if (blocco) {
      const k = riga.indexOf('*/');
      if (k < 0) continue;
      blocco = false;
      // Codice dopo la chiusura del commento: la riga conta, e conta com'è.
      if (riga.slice(k + 2).trim()) out.push(riga);
      continue;
    }
    if (!t) continue;
    if (t.startsWith('//')) continue;
    if (t.startsWith('/*')) {
      const k = riga.indexOf('*/');
      if (k < 0) { blocco = true; continue; }
      if (riga.slice(k + 2).trim()) out.push(riga);
      continue;
    }
    if (MARCATORE_DICHIARAZIONE.test(t)) {
      // `test.fail('titolo', …)` e `test('titolo', …)` sono la stessa prova
      // con e senza marcatore: si confrontano nella forma senza.
      out.push(riga.replace(APRE_MARCATORE, 'test('));
      continue;
    }
    if (MARCATORE.test(t)) {
      const fine = fineIstruzione(righe, i);
      if (fine >= 0) { i = fine; continue; }
    }
    out.push(riga);
  }
  return out.join('\n');
}

/**
 * Le differenze fra il commit verificato e quello di adesso sono SOLO
 * marcatori di rosso atteso nelle prove del giro? PURA.
 *
 * `files`: `[{ path, prima, dopo }]` — il contenuto ai due commit, stringa
 * vuota dove il file non c'era (aggiunto o cancellato); `null` quando non si è
 * riuscito a leggere il diff, che NON è un via libera. Ritorna
 * `{ ok, motivo, files }`: `motivo` è già la frase da mostrare a chi pubblica.
 */
export function soloMarcatori(files) {
  if (!Array.isArray(files)) return { ok: false, motivo: 'non sono riuscito a leggere cosa è cambiato dopo la verifica', files: [] };
  const elenco = files.filter((f) => f && f.path);
  const fuori = elenco.filter((f) => !dentroProveGiro(f.path)).map((f) => f.path);
  if (fuori.length) {
    const primi = fuori.slice(0, 5).join(', ');
    return { ok: false, files: [], motivo: `fuori dalle prove del giro: ${primi}${fuori.length > 5 ? ` e altri ${fuori.length - 5}` : ''}` };
  }
  const veri = elenco.filter((f) => corpoSenzaMarcatori(f.prima) !== corpoSenzaMarcatori(f.dopo)).map((f) => f.path);
  if (veri.length) {
    const primi = veri.slice(0, 5).join(', ');
    return { ok: false, files: [], motivo: `nelle prove del giro non sono cambiati solo i marcatori di rosso atteso: ${primi}${veri.length > 5 ? ` e altri ${veri.length - 5}` : ''}` };
  }
  return { ok: true, motivo: '', files: elenco.map((f) => f.path) };
}

/**
 * Cosa fare delle prove del giro che restano rosse quando un rilievo è messo
 * da parte. PURA. Si stampa col pass, che è l'unico momento in cui chi
 * verifica ha in mano insieme i rilievi non corretti e un ramo da chiudere.
 *
 * Senza queste righe la strada la si trova da soli, e le due volte che è
 * successo (10/09 e 18/09, #629) è costata un giro intero: si segnavano i
 * rossi attesi DOPO il verdetto, il commit spostava la punta e la chiusura
 * respingeva. Adesso il verdetto regge su quel commit — ma solo se lì cambiano
 * i marcatori e nient'altro, e questo va detto a chi li scrive.
 */
export function testoRossiAttesi(branch) {
  const cartella = cartellaProveGiro(branch);
  return [
    'Le prove del giro che riproducono questi rilievi restano rosse, e la chiusura le rilancia.',
    `Segnale come rosso atteso in ${cartella}, una riga per rilievo.`,
    "  test.fail(true, '<il rilievo, in breve>');   (in testa al corpo della prova)",
    'Il commit che aggiunge i marcatori NON fa decadere questo verdetto, finché lì cambiano solo',
    'quelli. Qualunque altra riga, o un file fuori da quella cartella, lo fa decadere e serve un',
    'altro giro. Una prova rossa senza marcatore ferma la chiusura come prima.',
  ].join('\n');
}

/** La coda della risposta, in locale: stampata SOLO dopo la critica. PURA. */
export function codaText({ findings, derived, budgets, branch, instructions }) {
  const fmt = (l) => (Array.isArray(l) && l.length ? ROUND.formatFindings(l) : '  (nessuno)');
  const b = budgets && typeof budgets === 'object'
    ? ['cap2', 'cap1', 'cap0'].map((k) => (budgets[k] ? `${k}: ${budgets[k].left} giri residui su ${budgets[k].cap}` : null)).filter(Boolean).join(' · ')
    : '';
  // La coda non sta qui: arriva da quel file. Se manca, si dice dove doveva
  // essere e come si consegna, e basta.
  const testo = String(instructions || '').trim() || [
    'Coda non trovata (file CODA-GIRO-LOCALE.md nella cartella sopra il repo):',
    'chiedila a chi guida. In ogni caso si correggono SOLO i rilievi dell\'elenco qui sopra, e si consegna con',
    '  node scripts/verify-local.mjs corretto "<report della correzione>"',
  ].join('\n');
  // Le prove del giro le rilancia CHI CORREGGE, prima di consegnare: è la metà
  // che rende utile tenerle nel ramo. In cloud sta nelle istruzioni del ruolo;
  // qui la coda arriva da un file fuori dal repo, che non le nomina — quindi la
  // riga la mette lo strumento, che è la parte che vive nel repo.
  const cartella = cartellaProveGiro(branch);
  const righe = [
    '══ ESITO: c\'è da correggere ══',
    `Ramo: ${branch}.`,
    'Rilievi da correggere in questo giro:',
    fmt(findings),
    'Rilievi messi da parte (fuori da questo giro: finiscono nel report per l\'owner):',
    fmt(derived),
  ];
  if (b) righe.push(`Bilanci: ${b}`);
  righe.push(
    '',
    `Prima di consegnare rilancia le prove del giro (le tue e quelle dei giri prima): npx playwright test ${cartella}`,
    'Una che diventa rossa è una regressione della correzione. Se quella cartella non c\'è, non c\'era niente da rilanciare:',
    'guardala però, non fidarti del messaggio — «No tests found» arriva anche a cartella piena se il percorso è scritto in',
    'un\'altra forma (solo quello relativo alla radice del repo, con le barre normali, viene riconosciuto).',
    '',
    testo,
  );
  return righe.join('\n');
}

// ─── Riallineamento alla linea principale (caso #500) ───────────────────────
//
// Un ramo che resta indietro mentre aspetta verifica e approvazione finisce in
// conflitto di fusione, e quel conflitto salterebbe fuori solo DOPO i controlli
// o dopo l'approvazione dell'owner. Il riallineamento si fa QUI, all'inizio
// della verifica: così verifica e chiusura girano già sul contenuto allineato,
// e lo sha approvato è quello che si pubblica.

/**
 * Cosa fare col ramo prima di avviare la verifica. PURA.
 *
 * `ahead` non conta: i commit propri il rebase li riporta sopra da solo, e un
 * ramo solo avanti (behind = 0) non ha niente da riallineare. Ogni astensione
 * che nasconde un ramo indietro va DETTA: un salto silenzioso è
 * indistinguibile dal non avere il riallineamento.
 */
export function realignPlan({ fetchOk, dirty, behind, workBranch = true }) {
  // I rami protetti non li tocca nessun automatismo (regola del repo), e lì
  // non c'è niente da dire: su quei rami non si chiude nessun lavoro.
  if (!workBranch) return { action: 'skip', message: '' };
  if (!fetchOk) {
    return {
      action: 'skip',
      message: 'Non raggiungo origin, quindi non so se il ramo è rimasto indietro: se la chiusura poi si ferma per questo, riprova con la rete.',
    };
  }
  const n = Number(behind);
  if (!Number.isFinite(n) || n <= 0) return { action: 'skip', message: '' };
  if (dirty) {
    return {
      action: 'skip',
      message: `Il ramo è indietro di ${n} commit rispetto alla linea principale, ma ci sono modifiche non salvate: non lo tocco. Falle salvare e rilancia, così la verifica parte dal contenuto riallineato.`,
    };
  }
  return { action: 'rebase', message: '' };
}

/**
 * L'esito del rebase → cosa fare. PURA.
 *
 * `abort` significa: il repo torna ESATTAMENTE com'era. Un rebase lasciato a
 * metà blocca ogni comando git successivo, compreso il salvataggio automatico:
 * peggio del conflitto stesso.
 */
export function afterRebase({ ok, behind = 0, conflictFiles = [] }) {
  if (ok) {
    return {
      action: 'push',
      message: `Il ramo era indietro di ${behind} commit rispetto alla linea principale: l'ho riallineato e lo rispedisco. La verifica parte dal contenuto aggiornato.`,
    };
  }
  const files = (Array.isArray(conflictFiles) ? conflictFiles : []).filter(Boolean);
  return {
    action: 'abort',
    message: [
      'Il riallineamento alla linea principale va in conflitto. Ho annullato tutto: il ramo è rimasto com\'era.',
      'File in conflitto:',
      files.length ? files.map((f) => `  ${f}`).join('\n') : '  (non identificati)',
      'Risolvili a mano (git rebase origin/main, sistema i file, git rebase --continue) e poi rilancia questo comando.',
    ].join('\n'),
  };
}

// ─── Stato su disco ─────────────────────────────────────────────────────────

export function readState(root = ROOT) {
  const f = stateFile(root);
  if (!existsSync(f)) return {};
  try {
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return (o && typeof o === 'object') ? o : {};
  } catch (_) {
    return {};
  }
}

export function writeState(state, root = ROOT) {
  mkdirSync(resolve(root, '.claude'), { recursive: true });
  writeFileSync(stateFile(root), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ─── git ────────────────────────────────────────────────────────────────────

function git(args, root = ROOT) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  catch (_) { return ''; }
}

// Come `git`, ma distingue il successo dal fallimento e non lascia che il
// `fatal:` di un tentativo gestito finisca a schermo come se fosse un guasto.
function tryGit(args, root = ROOT) {
  try { return { ok: true, out: execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; }
}

// Inchiodato, non letto dall'ambiente: stessa regola della guardia di
// finish-local — un nome che si sposta con una variabile non protegge niente.
const MAIN = 'main';

/**
 * Riallinea il ramo corrente a origin/main. Ritorna false solo sul conflitto:
 * lì la verifica non deve nemmeno partire, verificherebbe un contenuto che non
 * si può fondere. Le decisioni sono nelle funzioni pure qui sopra; qui si
 * eseguono e basta.
 */
function realignBeforeStart(root = ROOT) {
  const branch = currentBranch(root);
  const workBranch = !!branch && branch !== 'HEAD' && !['main', 'master'].includes(branch.toLowerCase());
  const fetchOk = tryGit(['fetch', 'origin', MAIN], root).ok;
  const behind = fetchOk ? Number(tryGit(['rev-list', '--count', `HEAD..origin/${MAIN}`], root).out) : 0;
  const plan = realignPlan({ fetchOk, dirty: isDirty(root), behind, workBranch });
  if (plan.message) console.log(`${plan.message}\n`);
  if (plan.action !== 'rebase') return true;

  const reb = tryGit(['rebase', `origin/${MAIN}`], root);
  if (!reb.ok) {
    // I file in conflitto si leggono PRIMA dell'abort: dopo non esistono più.
    const files = tryGit(['diff', '--name-only', '--diff-filter=U'], root).out.split('\n').filter(Boolean);
    tryGit(['rebase', '--abort'], root);
    console.error(afterRebase({ ok: false, conflictFiles: files }).message);
    return false;
  }
  console.log(`${afterRebase({ ok: true, behind }).message}\n`);
  // Il rebase riscrive i commit: senza forza il push verrebbe rifiutato; la
  // "lease" evita di sovrascrivere lavoro che qualcun altro avesse spedito nel
  // frattempo sullo stesso ramo. La destinazione è nel refspec, per intero:
  // non la sceglie la configurazione locale di git (stessa forma di ogni altra
  // spedizione del repo).
  const push = tryGit(['push', '--force-with-lease', 'origin', `refs/heads/${branch}:refs/heads/${branch}`], root);
  if (!push.ok) {
    console.error(`Ramo riallineato qui, ma non riesco a rispedirlo su origin:\n${push.out.slice(0, 300)}`);
    console.error('La verifica può proseguire; prima di chiudere serve che il ramo arrivi su origin (di solito basta riprovare con la rete).');
  }
  return true;
}

export function currentBranch(root = ROOT) { return git(['rev-parse', '--abbrev-ref', 'HEAD'], root); }
export function headSha(root = ROOT) { return git(['rev-parse', 'HEAD'], root); }
/** Ci sono modifiche non salvate (anche solo nell'area di stage)? */
export function isDirty(root = ROOT) { return git(['status', '--porcelain'], root).length > 0; }

/** Esito per il ramo corrente: quello che legge chi pubblica. */
export function verdictForCurrentBranch(root = ROOT) {
  const branch = currentBranch(root);
  const entry = readState(root)[branch];
  return { branch, entry, ...checkVerdict(entry, headSha(root), isDirty(root), (base, head) => diffDopoLaVerifica(base, head, root)) };
}

/**
 * Cosa è cambiato fra il commit verificato e quello di adesso, contenuto
 * compreso: `[{ path, prima, dopo }]`, o `[]` se git non risponde.
 *
 * I NOMI si guardano per primi, e sono l'uscita a buon mercato: se anche un
 * solo file sta fuori dalle prove del giro non si legge niente, qualunque sia
 * la dimensione del diff.
 */
export function diffDopoLaVerifica(base, head, root = ROOT) {
  if (!base || !head || base === head) return null;
  const elenco = tryGit(['diff', '--name-only', '-z', `${base}`, `${head}`], root);
  // Git muto non è git contento: senza il diff non si tollera niente.
  if (!elenco.ok) return null;
  const paths = elenco.out.split('\0').map((p) => p.trim()).filter(Boolean);
  if (!paths.length || paths.some((p) => !dentroProveGiro(p))) {
    return paths.map((path) => ({ path, prima: '', dopo: '' }));
  }
  return paths.map((path) => ({
    path,
    prima: contenutoAl(base, path, root),
    dopo: contenutoAl(head, path, root),
  }));
}

/** Il contenuto di un file a un commit, stringa vuota se lì non c'era. */
function contenutoAl(sha, path, root = ROOT) {
  try {
    return execFileSync('git', ['show', `${sha}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) { return ''; }
}

// ─── Il testo consegnato all'istanza che verifica ───────────────────────────

/**
 * Costruisce il compito per l'istanza che verifica. Contiene la RICHIESTA e il
 * ramo; NON il diff, NON i file toccati, NON il report di chi ha lavorato.
 * PURA (testata): è il punto in cui l'isolamento o c'è o non c'è.
 */
export function buildVerifierBrief({ request, branch, recipe, history }) {
  const past = Array.isArray(history) && history.length
    ? ['', 'CRITICHE DEI GIRI PASSATI su questo stesso lavoro (dalla più vecchia): le porte già',
      'trovate vanno RI-PROVATE, non ri-scoperte come rilievi nuovi.',
      ...history.map((h, i) => `  ${i + 1}. ${String(h.critique || '').split('\n').join('\n     ')}`)]
    : [];
  return [
    'Sei la VERIFICA di un lavoro che ha fatto qualcun altro. Non conosci quel lavoro',
    'e non devi conoscerlo: il tuo giudizio vale proprio perché parti da fuori.',
    '',
    'REGOLA DURA DI ISOLAMENTO — non guardare COME è stato fatto:',
    `  · niente diff, niente log dei commit, niente elenco dei file toccati del ramo ${branch};`,
    '  · niente report o note di chi ha lavorato;',
    '  · niente test scritti insieme al lavoro come prova che funziona (li ha scritti',
    '    chi ha anche scritto l’eventuale bug: condividono i suoi punti ciechi).',
    'Puoi leggere il codice per capire come USARE la funzione, e scrivere test tuoi.',
    'Se sai già dove guardare perché hai visto la modifica, non sei più una verifica.',
    'UNICA eccezione: se stai per bocciare perché "la cosa non esiste", prima',
    'controlla di essere sull’albero giusto con i soli NOMI dei file toccati',
    `(\`git diff --stat main...${branch}\`). I nomi sì, il contenuto no: una`,
    'bocciatura per assenza data guardando la cartella sbagliata è già costata',
    'un’intera implementazione rifatta da capo.',
    '',
    'COSA ERA STATO CHIESTO (l’unica cosa che sai):',
    String(request || '').split('\n').map((l) => `  ${l}`).join('\n'),
    ...past,
    '',
    `RAMO DA PROVARE: ${branch} (è già quello su cui sei: non cambiarlo)`,
    '',
    'IL TUO COMPITO: prova a far fallire la cosa chiesta usandola davvero, come la',
    'userebbe l’owner. Non ti basta che i test passino: apri l’app e prova.',
    '',
    '',
    'LE TUE PROVE RESTANO NEL RAMO, e qui non c\'è un numero di feedback: la cartella',
    `del giro è \`${cartellaProveGiro(branch)}\` — dove la recipe qui sotto dice`,
    '`tests/verifica/<numero>/`, in locale si legge quella. Le spec si chiamano',
    '`giro<k>-<cosa>.spec.mjs`, si committano prima di registrare la critica e non si',
    'cancellano: sono la memoria del giro. Se ci sono già le prove dei giri passati,',
    'lanciale per prime; se la cartella non c\'è, non c\'era niente da rilanciare — ma',
    'guarda la cartella, non il messaggio: il comando risponde «No tests found» anche a',
    'cartella piena se il percorso è scritto in un\'altra forma (solo quello relativo alla',
    'radice del repo, con le barre normali, viene riconosciuto).',
    '',
    'QUANDO HAI FINITO registra la critica: una riga per rilievo, col livello davanti',
    '(3 sicurezza/dati/Filo inutilizzabile · 2 la cosa chiesta non si ottiene o cammino',
    'principale · 1 cosmetica/attrito fuori cammino · 0 situazione rara; `[1?]` = chiede una',
    'decisione dell’owner). Le righe prima del primo rilievo sono il riassunto di cosa',
    'funziona. Nessun rilievo = verifica superata.',
    'LE QUADRE COL LIVELLO DENTRO SONO SEMPRE UN RILIEVO, dovunque stiano nella riga:',
    'nel riassunto E NEI PASSI un livello si cita a parole («il livello 2»), mai',
    '«[2]», o la riga viene respinta. Il testo va in UN pezzo solo, fra virgolette.',
    '  node scripts/verify-local.mjs critica "funziona X e Y.',
    '  [2] il pulsante non salva se il titolo è vuoto: passi …',
    '  [0] con la finestra sotto i 300 pixel il menu esce dallo schermo"',
    'Poi SEGUI la risposta stampata dal comando: dice cosa succede adesso.',
    'Boccia per ciò che non si ottiene, non per differenze di gusto: un trade-off vero',
    'si segna con `?` e lo decide l’owner.',
    '',
    'DUE PASSI DELLA RICETTA QUI SOTTO IN LOCALE NON VALGONO, e sono gli ultimi che',
    'leggerai: la critica NON si registra con lo strumento delle routine (non c\'è un',
    'numero di pratica: si usa `verify-local.mjs critica`, qui sopra), e non c\'è nessun',
    'biglietto da rilasciare alla fine. Tutto il resto della ricetta vale.',
    '',
    '─── recipe della verifica (la stessa delle routine) ───',
    String(recipe || '(file-ruolo non trovato)'),
  ].join('\n');
}

export function readRecipe(root = ROOT) {
  const dir = resolve(root, 'routines', 'roles');
  const f = resolve(dir, 'verifier.md');
  return existsSync(f) ? espandiInclusioni(readFileSync(f, 'utf8'), dir) : '';
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);

  const USO = 'Comandi: start ["<richiesta>"] | critica "<rilievi coi livelli>" | corretto "<report>" | status';
  // L’aiuto si stampa e basta, DOVUNQUE stia nella riga. Chiedere aiuto a uno
  // strumento è il primo gesto di chi verifica, e qui era l’unico posto dove
  // al posto dell’aiuto partiva l’azione: `start --help` apriva il giro per
  // davvero e la parola «--help» prendeva il posto della richiesta — l’unica
  // cosa che chi verifica sa, e che non sta scritta da nessun’altra parte
  // (feedback #565).
  const chiedeAiuto = (a) => {
    let s = String(a ?? '').toLowerCase();
    while (s.length && '-‐‑‒–—−/'.includes(s[0])) s = s.slice(1);
    return s === 'h' || s === 'help' || s === 'aiuto' || s === '?';
  };
  if ([cmd, ...rest].some(chiedeAiuto)) {
    console.log(USO);
    console.log('Non ho toccato niente. Nessun comando accetta opzioni: il testo va fra virgolette, tutto in un pezzo solo.');
    process.exit(0);
  }

  // Qui nessun comando accetta opzioni: una parola con due trattini in coda
  // finiva DENTRO al testo della critica (o del report) e l'esito veniva
  // registrato lo stesso — un testo che non si modifica più, e che l'owner
  // legge nella chat del feedback (feedback #565).
  // STA PRIMA DI TUTTI E TRE I COMANDI, e non è un dettaglio: quando stava
  // dopo, `start` aveva già aperto il giro e per lui non scattava mai.
  if (['critica', 'corretto', 'start'].includes(cmd)) {
    const { sembraOpzione } = await import('./lib/argomenti.mjs');
    const opzione = rest.find((a) => sembraOpzione(a));
    if (opzione) {
      console.error(`Argomento non capito: ${opzione} — non ho toccato niente. Qui non ci sono opzioni: il testo va fra virgolette, tutto in un pezzo solo.`);
      process.exit(1);
    }
    // La forma con la barra («/frase»): la conchiglia di Git la trasforma in un
    // percorso vero prima di consegnarla, e la barra non si vede più. Qui il
    // testo è sempre prosa, e una prosa non comincia per barra né per «C:/».
    const percorso = rest.find((a) => {
      const s = String(a ?? '');
      const senzaDisco = /^[A-Za-z]:/.test(s) ? s.slice(2) : s;
      return senzaDisco.startsWith('/') || senzaDisco.startsWith('\\');
    });
    if (percorso) {
      console.error(`Argomento non capito: ${percorso} — non ho toccato niente. Se era un’opzione scritta con la barra, la conchiglia l’ha trasformata in un percorso: qui non ci sono opzioni, il testo va fra virgolette, tutto in un pezzo solo.`);
      process.exit(1);
    }
    // IL TESTO IN UN PEZZO SOLO, e non per pignoleria: unendo i pezzi con uno
    // spazio, un rilievo che sta nel secondo pezzo non apre più una riga —
    // smette di essere un rilievo, e una BOCCIATURA diventa una promozione,
    // col ramo che risulta pubblicabile. Basta una virgoletta dimenticata
    // (feedback #565).
    if (rest.length > 1) {
      console.error(`Ho ricevuto ${rest.length} pezzi invece di uno: non ho toccato niente.`);
      console.error('Il testo va fra virgolette, tutto in un pezzo solo — probabilmente ne manca una.');
      console.error(`Primo pezzo: "${String(rest[0]).slice(0, 60)}…" · secondo: "${String(rest[1]).slice(0, 60)}…"`);
      process.exit(1);
    }
  }

  const branch = currentBranch();
  const sha = headSha();

  // I bilanci veri, o ci si ferma qui: un errore evidente, nessun ripiego.
  const bilanciOStop = async () => {
    try {
      return await leggiBilanciDalServer();
    } catch (e) {
      console.error(`BILANCI DEL GIRO NON LETTI DAL SERVER — mi fermo, non ho toccato niente. ${String((e && e.message) || e)}`);
      process.exit(1);
    }
    return null;
  };

  if (cmd === 'start') {
    const prev = readState()[branch];
    // Dopo una correzione si riparte senza argomenti: la richiesta è la stessa.
    const request = rest.join(' ').trim() || (prev && prev.request) || '';
    if (!request) {
      console.error('Uso: node scripts/verify-local.mjs start "<cosa aveva chiesto l\'owner>"');
      console.error('Serve la richiesta ORIGINALE, non un riassunto di cosa hai fatto: la verifica');
      console.error('deve poter concludere "non è quello che era stato chiesto".');
      process.exit(1);
    }
    if (prev && prev.verdict === 'fix-pending') {
      console.error('C\'è una correzione in sospeso su questo ramo: prima chi corregge consegna');
      console.error('(node scripts/verify-local.mjs corretto "<report>"), poi si riparte.');
      process.exit(1);
    }
    // I bilanci si leggono già qui, PRIMA del lavoro: se il token manca o il
    // documento è incompleto, meglio saperlo adesso che dopo la verifica.
    const capsStart = await bilanciOStop();
    // Prima di consegnare il compito il ramo si riallinea alla linea
    // principale (caso #500): la verifica deve giudicare il contenuto che
    // verrà pubblicato. Sul conflitto ci si ferma qui, col ramo intatto.
    if (!realignBeforeStart()) process.exit(1);
    // Ramo e sha si rileggono: il riallineamento può averli riscritti, e il
    // verdetto deve legarsi al contenuto vero.
    const b = currentBranch();
    const state = withRequest(readState(), b, { request, sha: headSha() });
    writeState(state);
    console.log(buildVerifierBrief({ request, branch: b, recipe: readRecipe(), history: historyFromRounds(state[b].rounds) }));
    console.log(bilanciText(capsStart));
    process.exit(0);
  }

  // Le vecchie scorciatoie non esistono più (feedback #565): `pass "prova"`
  // registrava un'approvazione vera con una parola, e chi verifica prova i
  // sottocomandi per capire lo strumento — una volta è successo davvero.
  // Promuovere e bocciare passano dallo stesso comando, e il motivo si scrive.
  if (cmd === 'pass' || cmd === 'fail') {
    console.error('«pass» e «fail» non esistono più: non ho toccato niente.');
    console.error('Si registra sempre una critica, e il motivo si scrive in tutti e due i casi:');
    console.error('  node scripts/verify-local.mjs critica "<cosa hai provato e cosa funziona>"');
    console.error('Nessun rilievo = verifica superata. Per bocciare, una riga col livello davanti:');
    console.error('  «[2] il pulsante Salva non salva col titolo vuoto» (e i passi per rifarlo).');
    process.exit(1);
  }


  if (cmd === 'critica') {
    const text = rest.join(' ').trim();
    const prev = readState()[branch];
    if (!prev || !prev.request) {
      console.error(`Nessuna verifica avviata per '${branch}': prima serve "verify-local.mjs start".`);
      process.exit(1);
    }
    if (!text) {
      console.error('Una verifica senza riassunto non dice cosa hai provato: scrivi cosa funziona, e i rilievi se ci sono.');
      process.exit(1);
    }
    // Anche un'approvazione va motivata: senza, «ok» varrebbe come verifica.
    if (text.length < MIN_CRITIQUE_CHARS) {
      console.error(`Motivazione troppo corta (${text.length} caratteri, il minimo è ${MIN_CRITIQUE_CHARS}): non ho toccato niente.`);
      console.error('Scrivi cosa hai provato e cosa hai visto — vale sia quando promuovi sia quando bocci.');
      process.exit(1);
    }
    // Con una correzione in sospeso decide withCritique: la stessa identica
    // critica ristampa la risposta (persa), un'altra è respinta.
    const stato = statoDirectory(ROOT);
    if (!stato.ok) { console.error(statoIllegibileText(stato.motivo)); process.exit(1); }
    // I bilanci dal server, PRIMA di calcolare l'esito: nessun default.
    const caps = await bilanciOStop();
    const r = withCritique(readState(), branch, { critique: text, sha, caps, dirtyFiles: stato.lines });
    if (r.ok === false) { console.error(r.reason); process.exit(1); }
    if (!r.replayed) writeState(r.state);
    const e = r.state[branch];
    if (r.outcome === 'fix') {
      if (r.replayed) console.log('(critica già registrata su questo giro: ristampo la fase 2, il giro non si ripaga)');
      console.log(codaText({ findings: r.decision.fix, derived: r.decision.derived, budgets: r.decision.budgets, branch, instructions: leggiCoda() }));
    } else if (r.outcome === 'stop') {
      console.log(`══ ESITO: il lavoro si ferma ══\nRilievi di livello 3/2 che non si possono correggere da soli (bilancio esaurito, o chiedono una decisione): decide l'owner.\n${ROUND.formatFindings(r.decision.blocking)}`);
    } else {
      console.log(`══ ESITO: verifica superata per '${branch}' su ${sha.slice(0, 8)} ══`);
      if (e.derived && e.derived.length) {
        console.log(`Rilievi non corretti, da riportare nel report per l'owner:\n${ROUND.formatFindings(e.derived)}`);
        console.log(testoRossiAttesi(branch));
      }
      // «Si può pubblicare» solo se è vero adesso: il pass vale per l'ultimo
      // salvataggio, e con modifiche non salvate `status` (e la chiusura)
      // dicono di no. Dirlo qui evita di scoprirlo alla chiusura (verifica
      // del giro 10 su #561).
      if (isDirty()) {
        console.log(`Modifiche non salvate: il pass vale per ${sha.slice(0, 8)}, non per l'albero com'è adesso, e finché restano non si pubblica ("status" lo ripete). Se le salvi in un commit serve un'altra verifica; altrimenti scartale.`);
      } else {
        console.log('Si può pubblicare.');
      }
    }
    process.exit(0);
  }

  if (cmd === 'corretto') {
    const report = rest.join(' ').trim();
    // Anche di qui si esce con un verdetto (a rilievi minori, il lavoro
    // diventa pubblicabile): il motivo si scrive, con lo stesso minimo della
    // critica. Senza, promuovere costava una parola da questa porta e ottanta
    // caratteri dall'altra (feedback #565).
    if (report.length < MIN_CRITIQUE_CHARS) {
      console.error(`Report della correzione troppo corto (${report.length} caratteri, il minimo è ${MIN_CRITIQUE_CHARS}): non ho toccato niente.`);
      console.error('Scrivi cosa hai corretto e cosa hai lasciato stare: da qui esce un esito, e un esito senza motivo non vale.');
      process.exit(1);
    }
    const statoC = statoDirectory(ROOT);
    if (!statoC.ok) { console.error(statoIllegibileText(statoC.motivo, 'consegna')); process.exit(1); }
    const r = withFixed(readState(), branch, { report, sha, dirtyFiles: statoC.lines });
    if (!r.ok) { console.error(r.reason); process.exit(1); }
    writeState(r.state);
    if (r.outcome === 'stop') {
      console.log(`Nessun commit nuovo dopo la critica: i rilievi di livello 3/2 restano aperti e non si correggono da soli. Il lavoro si ferma: decide l'owner.\n${ROUND.formatFindings(r.blocking)}`);
      process.exit(0);
    }
    if (r.outcome === 'pass') {
      console.log(`Nessun commit nuovo dopo la critica: niente da riverificare. Verifica superata per '${branch}' su ${sha.slice(0, 8)}.`);
      console.log(`Rilievi non corretti, da riportare nel report per l'owner:\n${ROUND.formatFindings(r.derived)}`);
      // Stessa uscita, stesso consiglio: di qui esce un pass con rilievi
      // aperti esattamente come da «critica», e le prove del giro sono rosse
      // nello stesso modo.
      console.log(testoRossiAttesi(branch));
      process.exit(0);
    }
    console.log(`Correzione consegnata su '${branch}' (${sha.slice(0, 8)}). Serve un'altra verifica, di un'altra istanza:`);
    console.log('  node scripts/verify-local.mjs start');
    process.exit(0);
  }

  if (cmd === 'status' || !cmd) {
    // I bilanci veri, dal server: `status` è il modo di vederli senza aprire
    // un giro, e di scoprire subito se il token manca.
    console.log(bilanciText(await bilanciOStop()));
    const r = verdictForCurrentBranch();
    console.log(`${r.branch}: ${r.reason}`);
    // A correzione in sospeso si dice anche COSA c'è da correggere, e come
    // rileggere la fase 2 intera: senza, un'uscita persa non si recuperava.
    if (r.entry && r.entry.verdict === 'fix-pending' && r.entry.pending && Array.isArray(r.entry.pending.findings)) {
      console.log(`Rilievi da correggere:\n${ROUND.formatFindings(r.entry.pending.findings)}`);
      console.log('Per rileggere la fase 2 intera (istruzioni comprese) rimanda la stessa identica critica: viene ristampata senza pagare un altro giro.');
    }
    process.exit(r.ok ? 0 : 1);
  }

  console.error(USO);
  process.exit(1);
}
