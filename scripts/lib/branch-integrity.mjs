// branch-integrity.mjs — l'integrità del ramo su cui lavorano le routine.
//
// PERCHÉ ESISTE (spec: ROUTINE-BRANCH-INTEGRITY.md)
//   Fino al 2026-08-07 il branch su cui un'istanza doveva lavorare era solo una
//   FRASE nel file-ruolo ("fai `git checkout <branch>`"). Niente lo imponeva e
//   niente lo verificava: il 24 luglio un verifier ha giudicato `main` invece
//   del branch del lavoro, ha bocciato una feature completa, e la ri-scrittura
//   conseguente è finita su `main` SENZA passare dal cancello di sicurezza —
//   che nel frattempo esaminava il gemello abbandonato.
//
//   Lavorare sul ramo sbagliato mentre si PRODUCE è spreco; mentre si GIUDICA è
//   danno, perché il verdetto viene creduto e agito. Le difese stanno qui, in
//   codice, e non nella prosa dei ruoli.
//
// COSA C'È QUI
//   A) il dispatcher decide il branch e ci si POSIZIONA (prepareBranch), con
//      nomi UNICI per tentativo (newWorkBranch) → la classe di guasto
//      "nome giusto, contenuto vecchio" sparisce invece di essere gestita;
//   C) ogni scrittura nella macchina a stati RICALCOLA l'identità e rifiuta la
//      transizione se non corrisponde (identityVerdict + checkDelivery); ogni
//      transizione accettata lascia un PUNTO FERMO (withCheckpoint);
//   D) un'interruzione riporta il branch all'ULTIMO punto fermo, spostando di
//      lato — senza distruggerli — i commit scartati (prepareBranch);
//   B) l'identità attesa viene esposta su file (writeExpectation) perché una
//      guardia FUORI dalla sessione (.claude/hooks/branch-guard.sh) possa
//      confrontarla dopo ogni comando.
//
// Tutte le funzioni prendono `root` esplicito (mai un ROOT globale): gli unit
// test girano su repo git temporanei con un finto `origin`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── git minimale (best-effort, mai eccezioni) ───────────────────────────────

export function gitIn(root) {
  return function git(args) {
    try {
      return { ok: true, out: execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
    } catch (e) {
      return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message };
    }
  };
}

/** Branch attualmente checkoutato in `root`. '' se detached/non-repo. */
export function currentBranch(root) {
  const g = gitIn(root);
  const r = g(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!r.ok) return '';
  return r.out === 'HEAD' ? '' : r.out;
}

/** SHA di HEAD in `root` ('' se non risolvibile). */
export function headSha(root) {
  const r = gitIn(root)(['rev-parse', 'HEAD']);
  return r.ok ? r.out : '';
}

// ─── Logica pura (unit-testata) ──────────────────────────────────────────────

/**
 * I nomi che NON sono rami di lavoro. Il valore è INCHIODATO, non preso
 * dall'ambiente: qui è una guardia, e una guardia che si sposta con una
 * variabile non è una guardia (stessa regola di scripts/finish-local.mjs).
 * `master` c'è perché il repo potrebbe cambiare convenzione senza che questo
 * file lo sappia: la guardia sbaglia in direzione sicura.
 */
export const RAMI_PROTETTI = Object.freeze(['main', 'master']);

/**
 * Questo nome è la linea principale invece che un ramo di lavoro? PURA.
 *
 * Gli endpoint di fusione del server rifiutano già `main`; qui il controllo
 * mancava, e una routine poteva ritrovarsi a PRODURRE direttamente sulla linea
 * principale — dove il lavoro non ha modo di arrivare agli utenti (il cancello
 * fonde un RAMO) e dove sporcherebbe la copia locale. È l'incidente #378 preso
 * un passo prima: non "il verdetto è stato dato sull'albero sbagliato", ma "il
 * lavoro è stato fatto sull'albero sbagliato".
 *
 * `mainBranch` (la linea principale dichiarata dal chiamante) si AGGIUNGE ai
 * nomi inchiodati, non li sostituisce. Un nome vuoto conta come protetto: nel
 * dubbio non ci si lavora.
 */
export function isProtectedBranch(name, mainBranch = '') {
  const norm = (s) => String(s || '').trim()
    .replace(/^refs\/heads\//, '').replace(/^origin\//, '').toLowerCase();
  const b = norm(name);
  if (!b || b === 'head') return true;
  const m = norm(mainBranch);
  return RAMI_PROTETTI.includes(b) || (!!m && b === m);
}

/**
 * Marcatore di tentativo: `20260807T195800Z`. Sta dentro i caratteri ammessi da
 * merge-gate.isValidBranch e ordina cronologicamente come stringa.
 */
export function attemptStamp(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * Nome del branch per un lavoro NUOVO. È UNICO PER TENTATIVO: `worker/<id>` era
 * stabile fra tentativi diversi sullo stesso feedback, e due tentativi che si
 * contendono lo stesso nome sono l'origine del caso "nome giusto, contenuto
 * vecchio". Un nome viene creato una volta sola e mai riusato; il nome vero vive
 * nello stato del branch e nel campo `branch` del feedback, quindi non serve
 * poterlo ricalcolare.
 */
export function newWorkBranch(id, nowMs = Date.now()) {
  const safe = String(id || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) throw new Error('newWorkBranch: id non valido');
  return `worker/${safe}-${attemptStamp(nowMs)}`;
}

// (Qui viveva preferredBase: col "Modello B" i pezzi #N.M di una feature
// spezzata nascevano da `feature/N` invece che da main. I sotto-feedback sono
// aboliti — SPEC-RIDISEGNO-MAX.md §1 — e la base di un lavoro nuovo è SEMPRE
// la linea principale.)

/**
 * Verdetto di identità: la directory è sul branch assegnato?
 * Confronta il RISULTATO (dove siamo davvero) e non i comandi: enumerare i modi
 * per cambiare branch è una battaglia persa, git ne ha troppi equivalenti.
 */
export function identityVerdict(current, assigned) {
  const cur = String(current || '');
  const asg = String(assigned || '');
  if (!asg) return { ok: true, current: cur, assigned: asg, reason: 'nessun branch assegnato' };
  if (!cur) return { ok: false, current: cur, assigned: asg, reason: 'la directory non è su nessun branch (HEAD staccata)' };
  if (cur !== asg) return { ok: false, current: cur, assigned: asg, reason: `la directory è su "${cur}" invece che su "${asg}"` };
  return { ok: true, current: cur, assigned: asg, reason: '' };
}

// Quanti punti fermi conservare per branch: servono a D (l'ultimo) e come
// traccia per ricostruire cosa è successo (i precedenti). Cap basso: il file di
// stato vive su git e viene letto a ogni giro.
export const CHECKPOINT_CAP = 20;

/**
 * Aggiunge un PUNTO FERMO allo stato del branch: l'identità del contenuto nel
 * momento in cui una transizione è stata accettata. È il valore a cui D riporta
 * il branch dopo un'interruzione. Pura.
 */
export function withCheckpoint(state, sha, by = '', nowMs = Date.now(), cap = CHECKPOINT_CAP) {
  const s = { ...(state || {}) };
  const list = Array.isArray(s.checkpoints) ? s.checkpoints.filter((c) => c && c.sha) : [];
  // Un punto fermo identico all'ultimo non aggiunge informazione (verifier e
  // secaudit non committano nulla): non lo duplichiamo.
  const prev = list.length ? list[list.length - 1].sha : null;
  if (sha && sha !== prev) list.push({ sha: String(sha), by: String(by || ''), at: new Date(nowMs).toISOString() });
  s.checkpoints = list.length > cap ? list.slice(list.length - cap) : list;
  return s;
}

/** L'ultimo punto fermo registrato, o null se non ce ne sono. */
export function lastCheckpoint(state) {
  const list = Array.isArray(state?.checkpoints) ? state.checkpoints.filter((c) => c && c.sha) : [];
  return list.length ? list[list.length - 1].sha : null;
}

// Quanti rifiuti d'identità consecutivi tollerare prima di chiedere all'owner.
// Stessa soglia e stesso esito del contatore `workingResets` (i reset
// `working`→`todo`) e del loop verifier→fixer: un ambiente che produce
// disallineamenti a ripetizione deve smettere di girare a vuoto, non insistere
// per sempre.
export const IDENTITY_REJECT_LIMIT = 3;

/**
 * Incrementa il contatore dei rifiuti e dice se si è raggiunta la soglia.
 * Pura. `escalate: true` ⇒ il chiamante porta il feedback in `design`.
 */
export function bumpRejects(state) {
  const prev = Number(state?.identityRejects);
  const n = (Number.isInteger(prev) && prev > 0 ? prev : 0) + 1;
  return { state: { ...(state || {}), identityRejects: n }, count: n, escalate: n >= IDENTITY_REJECT_LIMIT };
}

/** Azzera il contatore dei rifiuti (una transizione accettata lo consuma). */
export function clearRejects(state) {
  const s = { ...(state || {}) };
  delete s.identityRejects;
  return s;
}

/** Nome del branch di servizio su cui parcheggiare i commit scartati (D). */
export function discardedBranchName(branch, nowMs = Date.now()) {
  return `discarded/${String(branch || 'sconosciuto')}-${attemptStamp(nowMs)}`;
}

// ─── Stato per branch su disco (condiviso con dispatch.mjs) ──────────────────

/** Directory dello stato per branch (override per i test: FILO_DISPATCH_STATE_DIR). */
export function stateDir(root) {
  return process.env.FILO_DISPATCH_STATE_DIR
    ? resolve(process.env.FILO_DISPATCH_STATE_DIR)
    : resolve(root, '.claude', 'routine-state');
}

export function readBranchState(root, id) {
  const f = resolve(stateDir(root), `${id}.json`);
  if (!existsSync(f)) return null;
  try {
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (_) {
    return null;
  }
}

export function writeBranchState(root, state) {
  if (!state || !state.id) throw new Error('writeBranchState: stato senza id');
  const dir = stateDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${state.id}.json`), JSON.stringify(state, null, 2) + '\n', 'utf8');
  return state;
}

// ─── Identità attesa esposta alla guardia fuori sessione (B) ─────────────────
//
// Il file è EFFIMERO e locale alla macchina (gitignorato): dice "questa
// directory, adesso, deve stare su questo branch". Lo scrive il dispatcher
// quando consegna il lavoro e lo cancella quando il lavoro è consegnato — dopo
// la consegna non c'è più niente da proteggere (ed è ciò che permette al
// merge-gate di cambiare branch legittimamente).

export function expectationFile(root) {
  return resolve(root, '.claude', 'branch-expect.json');
}

export function writeExpectation(root, { branch, id = '' } = {}) {
  if (!branch) return null;
  const f = expectationFile(root);
  mkdirSync(resolve(root, '.claude'), { recursive: true });
  const exp = { branch, id, root, since: new Date().toISOString() };
  writeFileSync(f, JSON.stringify(exp, null, 2) + '\n', 'utf8');
  return exp;
}

export function readExpectation(root) {
  const f = expectationFile(root);
  if (!existsSync(f)) return null;
  try {
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return o && typeof o === 'object' && o.branch ? o : null;
  } catch (_) {
    return null;
  }
}

export function clearExpectation(root) {
  const f = expectationFile(root);
  if (existsSync(f)) rmSync(f, { force: true });
}

// ─── Sigillo di fine giro (#507) ─────────────────────────────────────────────
//
// Il ripristino D preferisce il punto fermo locale al ramo remoto, ed è giusto
// così: l'hook di salvataggio spinge anche il lavoro di un'istanza morta a
// metà, quindi "origin è più avanti" non distingue una consegna da un moncone.
// A distinguere è il SIGILLO: ogni fine giro legittima deve lasciare il punto
// fermo sul contenuto che consegna. Le consegne di verifica/correzione/audit lo
// facevano (sealTransition in dispatch.mjs); la consegna del primo passaggio e
// il rilascio del biglietto no — e al posizionamento successivo nello stesso
// clone il ripristino riportava il ramo alla base, parcheggiando su discarded/
// una consegna intera (feedback #507: due lavori interi buttati in tre giorni).

/** L'id del feedback il cui stato nomina questo branch, o ''. */
export function findStateIdByBranch(root, branch) {
  if (!branch) return '';
  try {
    const dir = stateDir(root);
    if (!existsSync(dir)) return '';
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const o = readBranchState(root, f.slice(0, -5));
      if (o && o.branch === branch) return String(o.id || f.slice(0, -5));
    }
  } catch (_) { /* best-effort */ }
  return '';
}

/**
 * Sigilla il punto fermo del giro corrente sul contenuto ATTUALE della
 * directory. Da chiamare a ogni fine giro legittima: consegna del primo
 * passaggio, rilascio del biglietto. Best-effort: non poterlo scrivere è un
 * rischio per il giro DOPO, non un motivo per non consegnare adesso.
 *
 * L'id si trova da solo (identità attesa, poi stato per branch): chi consegna
 * non deve ricordarsi di passarlo — è la stessa scommessa già persa sul
 * biglietto e sulla firma dei feedback.
 */
export function sealCurrentWork(root, { id = '', by = 'consegna' } = {}) {
  const branch = currentBranch(root);
  if (!branch || branch === 'HEAD' || isProtectedBranch(branch)) return { sealed: false, why: 'no_branch' };
  const sha = headSha(root);
  if (!sha) return { sealed: false, why: 'no_head' };
  let fid = String(id || '');
  if (!fid) {
    const exp = readExpectation(root);
    if (exp && exp.branch === branch) fid = String(exp.id || '');
  }
  if (!fid) fid = findStateIdByBranch(root, branch);
  if (!fid) return { sealed: false, why: 'no_id' };
  const prev = readBranchState(root, fid);
  // Uno stato che nomina un ALTRO branch non si tocca: sigillare lì sposterebbe
  // il punto fermo di un lavoro diverso da quello che si sta consegnando.
  if (prev && prev.branch && prev.branch !== branch) return { sealed: false, why: 'other_branch' };
  const base = { id: fid, branch, ...(prev || {}) };
  base.id = fid; base.branch = branch;
  try {
    writeBranchState(root, clearRejects(withCheckpoint(base, sha, by)));
  } catch (_) {
    return { sealed: false, why: 'write_failed' };
  }
  clearExpectation(root);
  return { sealed: true, id: fid, sha };
}

// ─── A + D: posizionare la directory sul branch giusto ───────────────────────

function refExists(g, ref) {
  return g(['rev-parse', '--verify', '--quiet', ref]).ok;
}

function commitExists(g, sha) {
  return !!sha && g(['cat-file', '-e', `${sha}^{commit}`]).ok;
}

/**
 * I marcatori di sessione: biglietto, battito, ruolo, identità attesa, stato
 * locale. Vivono in `.claude/` DENTRO il progetto, quindi hanno due nemici che
 * il `.gitignore` del ramo GIUSTO tiene a bada, ma quello di un ramo VECCHIO
 * no: la pulizia della directory (che li spazza come file estranei) e il
 * salvataggio automatico (che li committerebbe sul repo pubblico — e dentro il
 * marcatore del biglietto c'è il biglietto).
 *
 * È già successo, il 25 agosto: il checkout di un ramo del 22 ha spazzato il
 * marcatore del battito, nato il 23. La lista di esclusione che viaggia col
 * ramo è vecchia quanto il ramo, per costruzione: ogni marcatore nuovo
 * ripresenterebbe il problema.
 */
export const SESSION_MARKERS = Object.freeze([
  '.claude/routine-ticket.json',
  '.claude/routine-beat.json',
  '.claude/routine-beat-hook.stamp',
  '.claude/routine-role.json',
  '.claude/branch-expect.json',
  '.claude/verify-local.json',
  '.claude/routine-state/',
]);

/**
 * Inchioda i marcatori di sessione in `info/exclude` del repo: la lista di
 * esclusione LOCALE alla macchina, che vale su ogni ramo e ogni worktree e non
 * viaggia mai in un commit. Con questa riga sia la pulizia sia il salvataggio
 * automatico ignorano i marcatori QUALUNQUE sia l'età del ramo checkoutato —
 * che è il punto: la protezione non deve dipendere da ciò che il ramo sa.
 *
 * Best-effort e idempotente: si chiama prima di ogni preparazione del branch,
 * e se fallisce si prosegue (il comportamento torna quello di prima, non
 * peggio).
 */
export function ensureSessionExcludes(root) {
  const g = gitIn(root);
  const common = g(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common.ok || !common.out) return false;
  try {
    const dir = resolve(common.out, 'info');
    const file = resolve(dir, 'exclude');
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const righe = current.split(/\r?\n/);
    const mancanti = SESSION_MARKERS.filter((m) => !righe.includes(m));
    if (!mancanti.length) return true;
    mkdirSync(dir, { recursive: true });
    const testa = current && !current.endsWith('\n') ? '\n' : '';
    writeFileSync(file,
      current + testa
      + '# Marcatori di sessione Filo (scritti da scripts/lib/branch-integrity.mjs):\n'
      + '# effimeri e locali alla macchina, non devono né finire in un commit né\n'
      + '# essere spazzati dalla pulizia quando il ramo checkoutato è più vecchio di loro.\n'
      + mancanti.join('\n') + '\n',
      'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Porta la directory `root` sul branch giusto, con il contenuto giusto.
 *
 * @param {object} o
 *   root         directory del repo
 *   branch       branch su cui posizionarsi (per `create` è il nome da creare)
 *   create       true = lavoro NUOVO (crea il branch dalla base)
 *   base         base da cui creare (default: mainBranch)
 *   mainBranch   linea principale (default 'main')
 *   checkpoint   ultimo punto fermo (SHA) a cui riportare il branch, o null
 *   now          per i test
 *
 * @returns {{ok:true, head:string, discarded:string|null}}
 *        | {ok:false, kind:'transient'|'permanent', message:string}
 *
 * FAIL CLOSED: se non riesce, il chiamante NON consegna il lavoro. Meglio un
 * giro a vuoto che un giro sull'albero sbagliato.
 */
export function prepareBranch({ root, branch, create = false, base = '', mainBranch = 'main', checkpoint = null, now = Date.now() }) {
  const g = gitIn(root);
  if (!branch) return { ok: false, kind: 'transient', message: 'nessun branch da preparare' };
  // Sulla linea principale non si LAVORA: il cancello fonde un ramo, quindi un
  // lavoro fatto lì non ha modo di arrivare agli utenti — e intanto sporcherebbe
  // la copia locale. Guasto PERMANENTE: riprovare ogni 6 ore non lo aggiusta.
  if (isProtectedBranch(branch, mainBranch)) {
    return { ok: false, kind: 'permanent', message: `"${branch}" è la linea principale, non un ramo di lavoro` };
  }
  if (!g(['rev-parse', '--git-dir']).ok) return { ok: false, kind: 'transient', message: 'la directory non è un repo git' };
  // PRIMA di checkout e pulizia: da qui in poi le esclusioni del ramo di arrivo
  // non decidono più la sorte dei marcatori di sessione (vedi il commento su
  // SESSION_MARKERS). Best-effort: un fallimento non ferma la preparazione.
  ensureSessionExcludes(root);

  if (create) {
    const wanted = base || mainBranch;
    g(['fetch', 'origin', wanted]);
    g(['fetch', 'origin', mainBranch]);
    // Base: il branch chiesto se esiste, altrimenti la linea principale.
    // MAI HEAD: se il giro precedente ci ha lasciati su un
    // altro branch di lavoro, partire da HEAD erediterebbe il lavoro altrui.
    const baseRef = [`origin/${wanted}`, wanted, `origin/${mainBranch}`, mainBranch].find((r) => refExists(g, r));
    if (!baseRef) return { ok: false, kind: 'transient', message: `nessuna base utilizzabile (${wanted}/${mainBranch} irraggiungibili)` };
    if (refExists(g, `refs/heads/${branch}`) || refExists(g, `refs/remotes/origin/${branch}`)) {
      // Non deve succedere (i nomi sono unici per tentativo): se succede, il
      // nome è già stato usato e riusarlo riporterebbe il guasto che il nome
      // unico elimina.
      return { ok: false, kind: 'transient', message: `il branch ${branch} esiste già: nome non unico` };
    }
    const co = g(['checkout', '-B', branch, baseRef]);
    if (!co.ok) return { ok: false, kind: 'transient', message: `creazione di ${branch} fallita: ${co.out.slice(0, 200)}` };
    g(['reset', '--hard', baseRef]);
    g(['clean', '-fd']);
    return { ok: true, head: headSha(root), discarded: null, base: baseRef };
  }

  // Branch esistente (verifier / fixer / secaudit).
  g(['fetch', 'origin', branch]);
  const hasLocal = refExists(g, `refs/heads/${branch}`);
  const hasRemote = refExists(g, `refs/remotes/origin/${branch}`);
  if (!hasLocal && !hasRemote) {
    // Guasto PERMANENTE: riprovare ogni 6 ore all'infinito è inutile. Il
    // chiamante porta il feedback fuori dal giro automatico (`design`).
    return { ok: false, kind: 'permanent', message: `il branch ${branch} non esiste più (né in locale né su origin)` };
  }
  const co = hasLocal ? g(['checkout', branch]) : g(['checkout', '-B', branch, `origin/${branch}`]);
  if (!co.ok) return { ok: false, kind: 'transient', message: `checkout di ${branch} fallito: ${co.out.slice(0, 200)}` };

  // Bersaglio del ripristino: l'ultimo punto fermo se lo conosciamo e se è
  // raggiungibile; altrimenti lo stato remoto del branch (che È la consegna).
  // NB: senza punto fermo NON si torna a main — su un branch di revisione il
  // contenuto consegnato è tutto ciò che abbiamo.
  let target = commitExists(g, checkpoint) ? checkpoint : null;
  if (!target) target = hasRemote ? g(['rev-parse', `origin/${branch}`]).out : headSha(root);
  if (!target) return { ok: false, kind: 'transient', message: `impossibile risolvere il contenuto atteso di ${branch}` };

  const before = headSha(root);
  let discarded = null;
  if (before && before !== target) {
    // I commit scartati NON si distruggono: sono la traccia con cui si
    // ricostruisce cosa è successo. Si spostano di lato su un branch di
    // servizio (pushato se possibile) e solo allora si riporta indietro.
    discarded = discardedBranchName(branch, now);
    const parked = g(['branch', '-f', discarded, before]).ok;
    const pushed = parked ? g(['push', 'origin', `${discarded}:refs/heads/${discarded}`]).ok : false;
    const reset = g(['reset', '--hard', target]);
    if (!reset.ok) return { ok: false, kind: 'transient', message: `ripristino di ${branch} fallito: ${reset.out.slice(0, 200)}` };
    // Riallinea origin SOLO se i commit scartati sono al sicuro anche là.
    // Destinazione pienamente qualificata come sopra: `origin <ramo>:<ramo>`
    // già non è dirottabile dalla configurazione, ma la forma refs/heads/… è
    // l'unica che si può controllare a colpo d'occhio (e con cui una sentinella
    // può dire "qui nessuno spedisce senza dire dove").
    if (pushed) g(['push', '--force-with-lease', 'origin', `refs/heads/${branch}:refs/heads/${branch}`]);
    if (!parked) discarded = null;
  } else {
    g(['reset', '--hard', target]);
  }
  // La directory va ripulita SEMPRE: l'auto-commit scatta sugli Edit/Write, non
  // sui comandi — uno script, una build o un test lanciati come ultima azione
  // lasciano residui che al checkout successivo verrebbero TRASPORTATI sul
  // branch del compito dopo, finendo nel diff che va al cancello di sicurezza.
  g(['clean', '-fd']);
  return { ok: true, head: headSha(root), discarded };
}

// ─── C: il controllo che ogni scrittura di stato deve fare ───────────────────

/**
 * Ricalcola l'identità della directory e dice se la transizione è ammissibile.
 * Non chiede all'istanza dove si trova: lo guarda.
 *
 * @returns {{ok:boolean, current:string, assigned:string, reason:string}}
 */
export function checkDelivery(root, assignedBranch) {
  return identityVerdict(currentBranch(root), assignedBranch);
}

/**
 * Guardia COMPLETA di una transizione della macchina a stati: verifica
 * l'identità, e in caso di rifiuto incrementa il contatore e — alla soglia —
 * chiede l'escalation all'owner. Da quando le consegne delle routine passano
 * tutte dal canale autenticato verso il server, il punto di scrittura è uno
 * solo — `guardIdentity` in dispatch.mjs — e delega qui: la regola sta in un
 * posto solo, ed è quello coperto dagli unit test.
 *
 * Non chiede all'istanza dove si trova: lo guarda. `escalate` viene invocata
 * solo alla soglia (porta il feedback in `design`); `persist` salva lo stato
 * fuori dal processo, se il chiamante ha un modo per farlo.
 *
 * @returns {{ok:true, state:object|null} | {ok:false, message:string, escalated:boolean, count:number}}
 */
export function guardTransition(root, id, { escalate, persist, clear } = {}) {
  const prev = readBranchState(root, id);
  const assigned = prev?.branch || '';
  const v = checkDelivery(root, assigned);
  if (v.ok) return { ok: true, state: prev };

  const b = bumpRejects(prev || { id, branch: assigned });
  b.state.id = id;
  const base = `transizione rifiutata su ${id}: ${v.reason}`;
  if (b.escalate) {
    try { if (typeof escalate === 'function') escalate(b.count); } catch (_) { /* la nota resta in coda */ }
    try { if (typeof clear === 'function') clear(); } catch (_) {}
    return { ok: false, escalated: true, count: b.count, message: `${base} — rifiuto ${b.count}: feedback portato in design` };
  }
  writeBranchState(root, b.state);
  try { if (typeof persist === 'function') persist(); } catch (_) {}
  return { ok: false, escalated: false, count: b.count, message: `${base} (rifiuto ${b.count}/${IDENTITY_REJECT_LIMIT}); il feedback resta dov'era e verrà ripescato` };
}

/**
 * Il testo che l'owner legge in dashboard quando la lavorazione automatica
 * viene sospesa per disallineamento ripetuto. Vive qui, accanto alla soglia che
 * lo fa scattare, ed è scritto per l'OWNER: niente branch, niente
 * SHA, niente nomi di file (vedi CLAUDE.md § Tono dei report).
 */
export function escalationNote(count = IDENTITY_REJECT_LIMIT) {
  return `La lavorazione automatica si è disallineata ${count} volte di seguito: chi doveva registrare l'esito stava guardando una versione del codice diversa da quella in lavorazione, quindi il risultato non sarebbe attendibile. Ho sospeso i tentativi automatici invece di insistere; serve una tua decisione su come procedere.`;
}
