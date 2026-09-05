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
// IL GIRO (feedback #561: «il verificatore corregge, un agente per giro»)
//   Stessa struttura del giro in cloud. Chi verifica registra la CRITICA coi
//   livelli; questo strumento calcola l'esito dai livelli e dai tre bilanci
//   (le stesse regole del server, src/shared/verifierRound.js) e, se c'è da
//   correggere, stampa SOLO ALLORA le istruzioni della fase 2. Chi ha
//   corretto consegna; poi serve un'altra verifica, di un'altra istanza.
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
//     il riassunto. Nessun rilievo = verifica superata. Stampa l'esito e, se
//     c'è da correggere, le istruzioni della fase 2.
//
//   node scripts/verify-local.mjs corretto "<report della correzione>"
//     Lo lancia chi ha corretto (lo stesso verificatore): chiude la fase 2 e
//     chiede un'altra verifica sul commit nuovo.
//
//   node scripts/verify-local.mjs status
//     Esito per il ramo corrente. Exit 0 = si può pubblicare.
//
//   (`pass "<testo>"` e `fail "<testo>"` restano come scorciatoie: nessun
//   rilievo, oppure un solo rilievo di livello 2.)
//
// L'ESITO È LEGATO AL CONTENUTO, NON AL RAMO
//   Il verdetto vale per il commit su cui è stato dato. Se dopo il PASS si
//   tocca ancora il codice, il verdetto decade e va rifatto: altrimenti
//   basterebbe farsi approvare una versione e pubblicarne un'altra.
//
// DOVE VIVE
//   `.claude/verify-local.json`, effimero e gitignorato come gli altri
//   marcatori di sessione: riguarda questa macchina e questo momento.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : resolve(__dirname, '..');

// Le regole del giro e i default dei bilanci: le stesse del server e degli
// strumenti delle routine (fonte unica). Lette dal progetto, accanto a questo
// file: in locale non c'è una copia fissata degli strumenti.
const require = createRequire(import.meta.url);
require(resolve(__dirname, '..', 'src', 'shared', 'feedbackTransitions.js'));
require(resolve(__dirname, '..', 'src', 'shared', 'verifierRound.js'));
const ROUND = globalThis.SN_VERIFIER_ROUND;
const CAPS = (globalThis.SN_FB_TRANSITIONS && globalThis.SN_FB_TRANSITIONS.VERIFIER_CAPS) || { cap2: 5, cap1: 2, cap0: 0 };

export function stateFile(root = ROOT) {
  return resolve(root, '.claude', 'verify-local.json');
}

// ─── Logica pura (testata in tests/unit/verifyLocal.test.mjs) ────────────────

/**
 * La verifica registrata copre il contenuto che si sta per pubblicare?
 * Ritorna { ok, reason } — `reason` è già la frase da mostrare a chi pubblica.
 *
 * Casi di NO, tutti reali:
 *   - nessuno ha mai verificato questo ramo;
 *   - la verifica è avviata ma senza esito;
 *   - il verificatore sta correggendo (fase 2) e non ha ancora consegnato;
 *   - ha corretto: serve un'altra verifica sul commit nuovo;
 *   - qualcuno ha verificato e si è fermato (un 3/2 non correggibile);
 *   - qualcuno ha verificato e ha approvato, ma POI il codice è cambiato → il
 *     verdetto riguarda una versione che non è quella che uscirebbe.
 */
export function checkVerdict(entry, headSha, dirty = false) {
  if (!entry || (!entry.verdict && !entry.request)) {
    return { ok: false, reason: 'nessuna verifica avviata per questo lavoro' };
  }
  if (!entry.verdict) {
    // Distinguere questo dal caso sopra evita mezz'ora persa a rilanciare
    // `start` quando il pezzo che manca è la critica di chi doveva verificare.
    return { ok: false, reason: 'verifica avviata ma senza esito: chi doveva verificare non ha ancora registrato la critica' };
  }
  if (entry.verdict === 'fix-pending') {
    return { ok: false, reason: 'il verificatore sta correggendo i suoi rilievi e non ha ancora consegnato (verify-local.mjs corretto)' };
  }
  if (entry.verdict === 'fixed') {
    return { ok: false, reason: 'il verificatore ha corretto: serve un\'altra verifica sul contenuto nuovo (verify-local.mjs start)' };
  }
  if (entry.verdict !== 'pass') {
    return { ok: false, reason: `la verifica ha bocciato il lavoro: ${entry.critique || '(nessuna critica registrata)'}` };
  }
  if (!headSha || entry.sha !== headSha) {
    return { ok: false, reason: 'il codice è cambiato dopo la verifica: l’esito riguarda una versione diversa da quella che pubblicheresti' };
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
export function withCritique(state, branch, { critique, sha, at, caps = CAPS }) {
  const s = (state && typeof state === 'object') ? { ...state } : {};
  const prev = s[branch] || {};
  // Una critica vuota non è un pass: un pass senza una riga di riassunto non
  // dice cosa è stato provato, ed è più spesso un comando lanciato male che
  // una verifica (una bocciatura senza motivo è già rifiutata).
  if (!String(critique || '').trim()) {
    return { ok: false, state: s, reason: 'critica vuota: un pass senza una riga di riassunto non è una verifica. Scrivi cosa hai provato e cosa funziona, e i rilievi se ci sono.' };
  }
  // La critica registrata non si modifica più, e un giro non si paga due volte
  // per un comando ripetuto: finché la correzione è in sospeso, prima si
  // consegna.
  if (prev.verdict === 'fix-pending' && prev.pending) {
    return { ok: false, state: s, reason: 'critica già registrata su questo giro: non si modifica più, e un giro non si paga due volte. Prima chi corregge consegna (verify-local.mjs corretto "<report>"), poi si riparte con start.' };
  }
  const parsed = ROUND.parseFindings(critique);
  const decision = ROUND.decideRound({ findings: parsed.findings, caps, counts: prev.counts || {} });
  const outcome = decision.stop ? 'stop' : decision.fix.length ? 'fix' : 'pass';
  const when = at || new Date().toISOString();
  const entry = {
    ...prev,
    critique: String(critique || '').slice(0, 4000),
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
      consumed: decision.consume, outcome, critique: String(critique || '').slice(0, 4000),
    }]),
  };
  if (outcome === 'stop') {
    entry.verdict = 'fail';
    entry.critique = ROUND.formatFindings(decision.blocking);
    entry.pending = null;
  } else if (outcome === 'fix') {
    entry.verdict = 'fix-pending';
    entry.pending = { findings: decision.fix, sha: sha || '', at: when };
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
 * Chi ha corretto ha consegnato: la fase 2 è chiusa. PURA. Ritorna
 * { ok, state, outcome }:
 *   outcome 'fixed' → c'è un commit nuovo: serve un'altra verifica;
 *   outcome 'pass'  → nessun commit nuovo e in sospeso solo rilievi 1/0: niente
 *                     da riverificare, i rilievi vanno nel report per l'owner;
 *   outcome 'stop'  → nessun commit nuovo e un 3/2 in sospeso: non correggibile,
 *                     decide l'owner (spec §4).
 * Rifiuta se non c'era niente in sospeso, o con modifiche non salvate: la
 * consegna vale per un commit, e la verifica dopo deve provare quello.
 */
export function withFixed(state, branch, { report, sha, at, dirty = false }) {
  const s = (state && typeof state === 'object') ? { ...state } : {};
  const prev = s[branch] || {};
  if (prev.verdict !== 'fix-pending' || !prev.pending) {
    return { ok: false, reason: 'nessuna correzione in sospeso su questo ramo: prima la critica (verify-local.mjs critica)' };
  }
  if (dirty) {
    return { ok: false, reason: 'ci sono modifiche non salvate: la consegna vale per un commit, e la verifica dopo deve provare quello. Salva e rilancia.' };
  }
  const when = at || new Date().toISOString();
  const rounds = Array.isArray(prev.rounds) ? prev.rounds.slice() : [];
  const pending = Array.isArray(prev.pending.findings) ? prev.pending.findings : [];
  const base = {
    ...prev,
    pending: null,
    fixedReport: String(report || '').slice(0, 4000),
    fixedSha: sha || '',
    fixedAt: when,
  };
  // Nessun commit nuovo dopo la critica: niente è stato corretto, e non c'è
  // niente da riverificare. Conta una cosa sola, se c'è un commit nuovo o no.
  if (sha && prev.pending.sha && sha === prev.pending.sha) {
    if (rounds.length) rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], outcome: 'non corretto' };
    const gravi = pending.filter((f) => Number(f.level) >= 2);
    if (gravi.length) {
      s[branch] = { ...base, verdict: 'fail', critique: ROUND.formatFindings(gravi), rounds };
      return { ok: true, state: s, outcome: 'stop', blocking: gravi };
    }
    s[branch] = { ...base, verdict: 'pass', derived: (Array.isArray(prev.derived) ? prev.derived : []).concat(pending), rounds };
    return { ok: true, state: s, outcome: 'pass', derived: pending };
  }
  if (rounds.length) rounds[rounds.length - 1] = { ...rounds[rounds.length - 1], outcome: 'corretto' };
  s[branch] = { ...base, verdict: 'fixed', rounds };
  return { ok: true, state: s, outcome: 'fixed' };
}

/** Registra un verdetto secco sul contenuto `sha` (scorciatoie pass/fail). PURA. */
export function withVerdict(state, branch, { verdict, critique, sha, at }) {
  const text = verdict === 'pass' ? String(critique || '') : `[2] ${String(critique || 'la cosa chiesta non si ottiene')}`;
  // Un fail secco deve FERMARE, qualunque sia il bilancio: è la bocciatura
  // senza appello di chi non entra nel giro delle correzioni.
  const caps = verdict === 'pass' ? CAPS : { cap2: 0, cap1: 0, cap0: 0 };
  // Un "pass" con dentro rilievi di livello alto non è un pass: vale il testo,
  // non la parola — è withCritique a decidere.
  return withCritique(state, branch, { critique: text, sha, at, caps }).state;
}

/** Il testo della fase 2 in locale: stampato SOLO dopo la critica. PURA. */
export function phase2Text({ findings, derived, budgets, branch }) {
  const fmt = (l) => (Array.isArray(l) && l.length ? ROUND.formatFindings(l) : '  (nessuno)');
  const b = budgets && typeof budgets === 'object'
    ? ['cap2', 'cap1', 'cap0'].map((k) => (budgets[k] ? `${k}: ${budgets[k].left} giri residui su ${budgets[k].cap}` : null)).filter(Boolean).join(' · ')
    : '';
  return [
    '══ ESITO: c\'è da correggere — FASE 2, adesso correggi tu ══',
    'Rilievi da correggere ADESSO (solo questi):',
    fmt(findings),
    'Rilievi messi da parte (NON li correggi: finiscono nel report per l\'owner):',
    fmt(derived),
    b ? `Bilanci: ${b}` : '',
    '',
    'La critica registrata non si modifica più. Correggi SOLO i rilievi dell\'elenco: niente gusto,',
    'niente aggiunte fuori elenco, niente rilievi nuovi. Correggi la causa, non il sintomo; se lo',
    'stesso danno rientra da più porte, chiudile tutte.',
    `Sei già sul ramo ${branch}: non cambiarlo. Valgono i minimi di verifica del repo (unit test per`,
    'la logica pura, spec Playwright mirato per UI e flussi); niente suite completa.',
    'Aggiorna nello stesso commit le fonti di verità che tocchi. Scrivi la tua riga di report per',
    'l\'owner (una riga di conferma, le scelte diverse dal chiesto col perché) e, se serve, la riga di',
    'changelog. Poi consegna:',
    '  node scripts/verify-local.mjs corretto "<report della correzione>"',
    'Dopo la consegna serve un\'ALTRA verifica, di un\'altra istanza: chi guida rilancia',
    '  node scripts/verify-local.mjs start',
    'Se un rilievo non riesci a correggerlo, consegna comunque ciò che hai corretto e dillo nel report.',
  ].filter((l, i) => l !== '' || i === 6).join('\n');
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
  return { branch, entry, ...checkVerdict(entry, headSha(root), isDirty(root)) };
}

// ─── Il testo consegnato all'istanza che verifica ───────────────────────────

/**
 * Costruisce il compito per l'istanza che verifica. Contiene la RICHIESTA e il
 * ramo; NON il diff, NON i file toccati, NON il report di chi ha lavorato.
 * PURA (testata): è il punto in cui l'isolamento o c'è o non c'è.
 *
 * Non contiene nemmeno la fase 2: chi verifica deve cercare come se il suo
 * lavoro finisse con la critica. Le istruzioni della correzione arrivano dopo,
 * dalla risposta a `critica`, e solo se c'è da correggere.
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
    'QUANDO HAI FINITO registra la critica: una riga per rilievo, col livello davanti',
    '(3 sicurezza/dati/Filo inutilizzabile · 2 la cosa chiesta non si ottiene o cammino',
    'principale · 1 cosmetica/attrito fuori cammino · 0 situazione rara; `[1?]` = chiede una',
    'decisione dell’owner). Le righe prima del primo rilievo sono il riassunto di cosa',
    'funziona. Nessun rilievo = verifica superata.',
    '  node scripts/verify-local.mjs critica "funziona X e Y.',
    '  [2] il pulsante non salva se il titolo è vuoto: passi …',
    '  [0] con la finestra sotto i 300 pixel il menu esce dallo schermo"',
    'Poi SEGUI la risposta stampata dal comando: dice cosa succede adesso.',
    'Boccia per ciò che non si ottiene, non per differenze di gusto: un trade-off vero',
    'si segna con `?` e lo decide l’owner.',
    '',
    '─── recipe della verifica (la stessa delle routine) ───',
    String(recipe || '(file-ruolo non trovato)'),
  ].join('\n');
}

export function readRecipe(root = ROOT) {
  const f = resolve(root, 'routines', 'roles', 'verifier.md');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const branch = currentBranch();
  const sha = headSha();

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
    process.exit(0);
  }

  if (cmd === 'critica' || cmd === 'pass' || cmd === 'fail') {
    const text = rest.join(' ').trim();
    const prev = readState()[branch];
    if (!prev || !prev.request) {
      console.error(`Nessuna verifica avviata per '${branch}': prima serve "verify-local.mjs start".`);
      process.exit(1);
    }
    if (!text) {
      console.error(cmd === 'fail'
        ? 'Una bocciatura senza motivo non è utile a nessuno: scrivi cosa non funziona.'
        : 'Una verifica senza riassunto non dice cosa hai provato: scrivi cosa funziona, e i rilievi se ci sono.');
      process.exit(1);
    }
    if (prev.verdict === 'fix-pending' && prev.pending) {
      console.error('Critica già registrata su questo giro: non si modifica più, e un giro non si paga due volte.');
      console.error('Prima chi corregge consegna (node scripts/verify-local.mjs corretto "<report>"), poi si riparte con start.');
      process.exit(1);
    }
    if (cmd !== 'critica') {
      writeState(withVerdict(readState(), branch, { verdict: cmd, critique: text, sha }));
      const e = readState()[branch];
      console.log(e.verdict === 'pass'
        ? `Verifica superata per '${branch}' su ${sha.slice(0, 8)}. Si può pubblicare.`
        : `Verifica NON superata per '${branch}'. Il lavoro torna a chi l'ha fatto.`);
      process.exit(0);
    }
    const r = withCritique(readState(), branch, { critique: text, sha });
    if (r.ok === false) { console.error(r.reason); process.exit(1); }
    writeState(r.state);
    const e = r.state[branch];
    if (r.outcome === 'fix') {
      console.log(phase2Text({ findings: r.decision.fix, derived: r.decision.derived, budgets: r.decision.budgets, branch }));
    } else if (r.outcome === 'stop') {
      console.log(`══ ESITO: il lavoro si ferma ══\nRilievi di livello 3/2 che non si possono correggere da soli (bilancio esaurito, o chiedono una decisione): decide l'owner.\n${ROUND.formatFindings(r.decision.blocking)}`);
    } else {
      console.log(`══ ESITO: verifica superata per '${branch}' su ${sha.slice(0, 8)} ══`);
      if (e.derived && e.derived.length) {
        console.log(`Rilievi non corretti, da riportare nel report per l'owner:\n${ROUND.formatFindings(e.derived)}`);
      }
      console.log('Si può pubblicare.');
    }
    process.exit(0);
  }

  if (cmd === 'corretto') {
    const report = rest.join(' ').trim();
    const r = withFixed(readState(), branch, { report, sha });
    if (!r.ok) { console.error(r.reason); process.exit(1); }
    writeState(r.state);
    console.log(`Correzione consegnata su '${branch}' (${sha.slice(0, 8)}). Serve un'altra verifica, di un'altra istanza:`);
    console.log('  node scripts/verify-local.mjs start');
    process.exit(0);
  }

  if (cmd === 'status' || !cmd) {
    const r = verdictForCurrentBranch();
    console.log(`${r.branch}: ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }

  console.error('Comandi: start ["<richiesta>"] | critica "<rilievi coi livelli>" | corretto "<report>" | pass "<testo>" | fail "<testo>" | status');
  process.exit(1);
}
