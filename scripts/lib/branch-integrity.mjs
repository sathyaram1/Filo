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
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, realpathSync, readlinkSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { installaControlloSpedizione } from './copie-di-dati.mjs';
import { ensureCommentChar } from './carattere-commento.mjs';
import { beatIsLive, pidAlive, readBeat, stessaCartella } from './routine-beat.mjs';
import { bigliettoFinito, leggiMarcatoreBiglietto } from './routine-ticket.mjs';

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
 * nomi di ramo validi e ordina cronologicamente come stringa.
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
// lavoro di dopo di cambiare branch legittimamente).

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
 *
 * `sha` sigilla un commit diverso dalla punta: il rilascio dopo la domanda di fine sessione, che non spedisce più (#1555).
 */
export function sealCurrentWork(root, { id = '', by = 'consegna', sha: dichiarato = '' } = {}) {
  const branch = currentBranch(root);
  if (!branch || branch === 'HEAD' || isProtectedBranch(branch)) return { sealed: false, why: 'no_branch' };
  const sha = String(dichiarato || '') || headSha(root);
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

/**
 * I campi dello specchio locale che dicono SU QUALE CONTENUTO è stato dato ogni
 * via libera, per l'intento che lo registra. Uno solo, così le due strade non
 * possono divergere sul nome (feedback #485).
 */
export const CAMPI_ESITO = Object.freeze({
  verdict: Object.freeze(['verifierSha']),
  secaudit: Object.freeze(['secauditSha']),
  // Una correzione è contenuto nuovo: gli esiti dati su quello vecchio se ne
  // vanno con lui, o resterebbe in giro la firma di un controllo fatto altrove.
  fixed: Object.freeze(['verifierSha', 'secauditSha']),
});

/**
 * Ricorda qui su quale contenuto è stato dato un via libera (o lo dimentica,
 * quando arriva una correzione).
 *
 * PERCHÉ NON STA SOLO DOVE STAVA (feedback #485, giro 3)
 *   Il rifiuto che ferma la fusione quando il ramo si è mosso dopo il controllo
 *   di sicurezza (e la nota sulla verifica) si regge su questo fogliettino. Se lo scrive una sola delle due strade con
 *   cui un esito si registra, basta usare l'altra perché la fusione riparta a
 *   foglio sostituito: la difesa si spegne scegliendo l'ingresso. Qui c'è la
 *   porta unica, e la chiamano tutte e due.
 *
 * Best-effort, come il sigillo: non riuscire a scrivere è un rischio per il
 * passo dopo, non un motivo per non registrare l'esito adesso. Quando non c'è
 * niente da scrivere (nessuno stato per questo ramo: un clone appena fatto) il
 * fatto viene DETTO a chi legge, perché il cancello di fusione possa astenersi
 * ad alta voce invece di tacere.
 *
 * @returns {{ scritto: boolean, id?: string, why?: string }}
 */
export function ricordaEsitoSuCommit(root, intento, sha) {
  const campi = CAMPI_ESITO[String(intento || '')];
  if (!campi) return { scritto: false, why: 'intento_senza_esito' };
  const svuota = String(intento) === 'fixed';
  if (!svuota && !String(sha || '')) return { scritto: false, why: 'senza_commit' };
  const branch = currentBranch(root);
  if (!branch || branch === 'HEAD' || isProtectedBranch(branch)) return { scritto: false, why: 'no_branch' };
  let fid = '';
  const exp = readExpectation(root);
  if (exp && exp.branch === branch) fid = String(exp.id || '');
  if (!fid) fid = findStateIdByBranch(root, branch);
  if (!fid) return { scritto: false, why: 'no_id' };
  const prev = readBranchState(root, fid);
  // Uno stato che nomina un ALTRO branch non si tocca: stessa regola del
  // sigillo, per lo stesso motivo.
  if (prev && prev.branch && prev.branch !== branch) return { scritto: false, why: 'other_branch' };
  const base = { ...(prev || {}), id: fid, branch };
  for (const c of campi) base[c] = svuota ? '' : String(sha);
  try {
    writeBranchState(root, base);
  } catch (_) {
    return { scritto: false, why: 'write_failed' };
  }
  return { scritto: true, id: fid };
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
  '.claude/routine-consumo.json',
  '.claude/routine-role.json',
  '.claude/branch-expect.json',
  '.claude/verify-local.json',
  '.claude/routine-state/',
  '.claude/biglietti/',
  '.claude/filo-worker.json',
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
 * @returns {{ok:true, head:string, discarded:string|null, rewritten?:string|null}}
 *          rewritten = il punto fermo lasciato perché il ramo su origin è stato riscritto
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
  // Prima del ramo di scarto spedito più sotto: i commit locali di una sessione morta possono portare una copia dei dati (#1108).
  try { installaControlloSpedizione(root); } catch (_) { /* senza, restano i controlli delle singole strade */ }
  ensureCommentChar(root);

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
  const tip = hasRemote ? g(['rev-parse', `origin/${branch}`]) : null;
  const remoteTip = tip && tip.ok ? tip.out : '';
  let target = commitExists(g, checkpoint) ? checkpoint : null;
  // Un punto fermo fuori dalla linea della punta pubblicata è di una storia riscritta altrove (un riallineamento):
  // vince la punta. Antenato della punta resta il caso dell'interruzione (#507), discendente è lavoro non spedito (#1486).
  let rewritten = null;
  if (target && remoteTip && !sullaStessaLinea(g, target, remoteTip)) {
    rewritten = target;
    target = remoteTip;
  }
  if (!target) target = remoteTip || headSha(root);
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
    // Mai su un commit fuori dalla linea della punta remota: riporterebbe origin a una storia già riscritta.
    if (pushed && (!remoteTip || sullaStessaLinea(g, target, remoteTip))) {
      g(['push', '--force-with-lease', 'origin', `refs/heads/${branch}:refs/heads/${branch}`]);
    }
    if (!parked) discarded = null;
  } else {
    g(['reset', '--hard', target]);
  }
  // La directory va ripulita SEMPRE: l'auto-commit scatta sugli Edit/Write, non
  // sui comandi — uno script, una build o un test lanciati come ultima azione
  // lasciano residui che al checkout successivo verrebbero TRASPORTATI sul
  // branch del compito dopo, finendo nel diff che va al cancello di sicurezza.
  g(['clean', '-fd']);
  return { ok: true, head: headSha(root), discarded, rewritten };
}

/** `a` e `b` stanno sulla stessa storia: uguali, o uno antenato dell'altro. */
function sullaStessaLinea(g, a, b) {
  return a === b
    || g(['merge-base', '--is-ancestor', a, b]).ok
    || g(['merge-base', '--is-ancestor', b, a]).ok;
}

// ─── C: il controllo che ogni scrittura di stato deve fare ───────────────────

/**
 * Ricalcola l'identità della directory e dice se la transizione è ammissibile.
 * Non chiede all'istanza dove si trova: lo guarda.
 *
 * @returns {{ok:boolean, current:string, assigned:string, reason:string}}
 */
export function checkDelivery(root, assignedBranch, { da, dal } = {}) {
  const altra = altraCartellaDelDeposito(root, da);
  if (altra) {
    return {
      ok: false, current: altra.ramo, assigned: String(assignedBranch || ''), cartella: altra.cartella, radice: altra.radice,
      reason: `la registrazione parte dalla cartella "${altra.cartella}"${altra.ramo ? ` (ramo "${altra.ramo}")` : ''}, un'altra cartella dello stesso deposito: il lavoro si registra da "${altra.radice}", dove è stato posizionato`,
    };
  }
  const v = identityVerdict(currentBranch(root), assignedBranch);
  if (v.ok && v.assigned) {
    const fuori = lavoroInUnAltroWorktree(root, { dal: dal ?? (readExpectation(root) || {}).since });
    if (fuori) {
      const lista = fuori.commit.map((c) => c.slice(0, 12)).join(' ');
      return {
        ...v, ok: false, altrove: fuori,
        reason: `il ramo "${v.assigned}" non contiene ${fuori.commit.length === 1 ? 'un commit fatto' : `${fuori.commit.length} commit fatti`} dopo l'inizio di questo lavoro nella cartella "${fuori.cartella}"${fuori.ramo ? ` (ramo "${fuori.ramo}")` : ''}, e la verifica non li troverebbe: portali qui (\`git -C "${fuori.radice}" cherry-pick ${lista}\`) e registra di nuovo; se non sono di questo lavoro, togli quella cartella (\`git worktree remove "${fuori.cartella}"\`, il suo ramo resta)`,
      };
    }
  }
  if (v.ok || v.current) return v;
  // Durante il rebase del ramo assegnato la cartella è staccata per forza: il rifiuto resta, ma non è una
  // deriva (`rebase: true`). Il rebase di un altro ramo lo è.
  const r = rebaseInCorso(root);
  if (!r) return v;
  if (!r.ramo || r.ramo !== v.assigned) {
    return { ...v, reason: `la directory è a metà del rebase di un altro ramo${r.ramo ? ` ("${r.ramo}")` : ''}, non di "${v.assigned}"` };
  }
  return {
    ...v,
    rebase: true,
    reason: `c'è un rebase in corso del ramo "${r.ramo}": portalo a termine (risolvi i conflitti, poi \`git rebase --continue\`) e registra dopo, dal ramo`,
  };
}

/**
 * Un worktree dello stesso deposito da cui parte la registrazione, diverso dalla cartella posizionata (`root`): lì
 * ramo e commit non sono quelli che il controllo guarda (#772). null se no; fuori da ogni deposito, o in un altro, non conta.
 */
export function altraCartellaDelDeposito(root, da = process.cwd()) {
  const chiedi = (dir) => {
    const r = gitIn(dir)(['rev-parse', '--show-toplevel', '--git-common-dir']);
    if (!r.ok) return null;
    const [top, comune] = r.out.split(/\r?\n/);
    return top && comune ? { top: percorsoVero(resolve(dir, top)), comune: percorsoVero(resolve(dir, comune)) } : null;
  };
  const qui = chiedi(da);
  const lavoro = qui ? chiedi(root) : null;
  if (!qui || !lavoro || qui.comune !== lavoro.comune || qui.top === lavoro.top) return null;
  return { cartella: qui.top, radice: lavoro.top, ramo: currentBranch(da) };
}

/**
 * Un altro worktree dello stesso deposito con commit nati da `dal` (l'inizio del lavoro) che la cartella posizionata
 * non contiene (#772.1). Non contano la linea principale né i commit già portati qui con un cherry-pick.
 * @returns {null | { cartella: string, ramo: string, radice: string, commit: string[] }} i commit dal più vecchio
 */
export function lavoroInUnAltroWorktree(root, { dal = '' } = {}) {
  const inizio = Math.floor(Date.parse(String(dal || '')) / 1000);
  if (!Number.isFinite(inizio)) return null;
  const g = gitIn(root);
  const top = g(['rev-parse', '--show-toplevel']);
  const elenco = g(['worktree', 'list', '--porcelain']);
  if (!top.ok || !elenco.ok) return null;
  const radice = percorsoVero(top.out);
  const def = g(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const principale = def.ok && def.out ? def.out.replace(/^origin\//, '') : 'main';
  const fuori = [principale, `origin/${principale}`].filter((r) => g(['rev-parse', '--verify', '--quiet', `${r}^{commit}`]).ok);
  for (const blocco of elenco.out.split(/\r?\n\s*\r?\n/)) {
    const righe = blocco.split(/\r?\n/);
    const campo = (nome) => (righe.find((r) => r.startsWith(`${nome} `)) || '').slice(nome.length + 1).trim();
    const cartella = campo('worktree');
    const testa = campo('HEAD');
    // Una cartella sparita (worktree da potare) non è dove si lavora adesso.
    if (!cartella || !/^[0-9a-f]{7,64}$/i.test(testa) || righe.includes('bare') || !existsSync(cartella)) continue;
    if (percorsoVero(cartella) === radice) continue;
    const r = g(['log', '--no-merges', '--right-only', '--cherry-pick', '--format=%H %ct', `HEAD...${testa}`, ...fuori.map((x) => `^${x}`)]);
    if (!r.ok || !r.out) continue;
    const commit = r.out.split(/\r?\n/).map((l) => l.trim().split(' '))
      .filter(([sha, ct]) => sha && Number(ct) >= inizio).map(([sha]) => sha).reverse();
    if (commit.length) return { cartella: percorsoVero(cartella), ramo: campo('branch').replace(/^refs\/heads\//, ''), radice, commit };
  }
  return null;
}

function percorsoVero(p) {
  try { return realpathSync.native(p); } catch (_) { return p; }
}

/**
 * Rebase interrotto in `root`? null se no, altrimenti `{ ramo }` (il ramo che si sta riscrivendo, '' se
 * non si legge). La cartella git si chiede a git: in un worktree `.git` è un file, non una cartella.
 */
export function rebaseInCorso(root) {
  const g = gitIn(root);
  for (const nome of ['rebase-merge', 'rebase-apply']) {
    const p = g(['rev-parse', '--git-path', nome]);
    if (!p.ok || !p.out) continue;
    const dir = resolve(root, p.out);
    if (!existsSync(dir)) continue;
    // `git am` usa la stessa cartella di rebase-apply, e non è un rebase.
    if (nome === 'rebase-apply' && !existsSync(resolve(dir, 'rebasing'))) continue;
    let ramo = '';
    try { ramo = readFileSync(resolve(dir, 'head-name'), 'utf8').trim().replace(/^refs\/heads\//, ''); } catch (_) {}
    return { ramo };
  }
  return null;
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
 * @returns {{ok:true, state:object|null}
 *   | {ok:false, message:string, escalated:boolean, count:number, current:string, assigned:string, rebase?:true}}
 */
export function guardTransition(root, id, { escalate, persist, clear, assigned: ripiego = '' } = {}) {
  const prev = readBranchState(root, id);
  // `assigned` vale solo se lo stato non nomina un ramo: chi lo passa (il canale) lo legge dall'identità attesa.
  const assigned = prev?.branch || String(ripiego || '');
  const v = checkDelivery(root, assigned);
  if (v.ok) return { ok: true, state: prev };
  const dove = { current: v.current, assigned: v.assigned, ...(v.cartella ? { cartella: v.cartella, radice: v.radice } : {}), ...(v.altrove ? { altrove: v.altrove } : {}) };
  // Il rebase del ramo assegnato si finisce e poi si registra: non conta verso la sospensione per deriva.
  if (v.rebase) return { ok: false, rebase: true, escalated: false, count: 0, ...dove, message: `registrazione rifiutata su ${id}: ${v.reason}` };

  const b = bumpRejects(prev || { id, branch: assigned });
  b.state.id = id;
  const base = `transizione rifiutata su ${id}: ${v.reason}`;
  if (b.escalate) {
    try { if (typeof escalate === 'function') escalate(b.count); } catch (_) { /* la nota resta in coda */ }
    try { if (typeof clear === 'function') clear(); } catch (_) {}
    return { ok: false, escalated: true, count: b.count, ...dove, message: `${base} — rifiuto ${b.count}: feedback portato in design` };
  }
  writeBranchState(root, b.state);
  try { if (typeof persist === 'function') persist(); } catch (_) {}
  return { ok: false, escalated: false, count: b.count, ...dove, message: `${base} (rifiuto ${b.count}/${IDENTITY_REJECT_LIMIT}); il feedback resta dov'era e verrà ripescato` };
}

export function clearBranchState(root, id) {
  if (!id) return;
  const f = resolve(stateDir(root), `${id}.json`);
  if (existsSync(f)) rmSync(f, { force: true });
}

/** Una transizione accettata consuma i rifiuti di fila (vedi clearRejects). Best-effort. */
export function azzeraRifiuti(root, id) {
  const s = id ? readBranchState(root, id) : null;
  if (!s || s.identityRejects === undefined) return;
  try { writeBranchState(root, clearRejects(s)); } catch (_) { /* il contatore resta: decide la soglia */ }
}

/** `refs/heads/x` è `x`: la forma piena di git conferma il nome corto. PURA. */
function nomeRamo(s) {
  return String(s || '').trim().replace(/^refs\/heads\//, '');
}

/**
 * C sulla strada diretta del canale (#772), per le consegne che valgono per un commit. Ramo assegnato e id vengono
 * dall'identità attesa di dispatch; da lì controllo e contatore sono quelli di guardTransition, e alla soglia la
 * sospensione la manda `escalate`. Senza identità attesa restano i divieti che non dipendono dall'assegnazione
 * (linea principale, cartella staccata): il confronto col ramo legato al biglietto lo fa il server sul ramo VERO.
 * Un ramo dichiarato può solo confermare quello della cartella.
 *
 * @returns {{ok:true, branch:string, id:string, assigned:string}
 *   | {ok:false, motivo:'deriva'|'rebase'|'principale'|'staccata'|'dichiarato'|'cartella'|'altrove', current:string, assigned:string,
 *      cartella?:string, radice?:string, altrove?:{cartella:string, ramo:string, radice:string, commit:string[]},
 *      declared?:string, rebaseDi?:string, count?:number, escalated?:boolean}}
 */
export function guardiaConsegna(root, { dichiarato = '', escalate } = {}) {
  const exp = readExpectation(root);
  const id = String((exp && exp.id) || '');
  let assigned = String((exp && exp.branch) || '');
  const rebaseDi = () => { const r = rebaseInCorso(root); return r ? (r.ramo || '?') : ''; };
  const def = gitIn(root)(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const principale = def.ok ? def.out.replace(/^origin\//, '') : '';
  if (exp) {
    // Un'attesa senza id non ha uno stato a cui intestare i rifiuti: il controllo resta, il contatore no.
    const g = id
      ? guardTransition(root, id, { assigned, escalate, clear: () => clearBranchState(root, id) })
      : checkDelivery(root, assigned);
    if (!g.ok) {
      const cur = g.current || '';
      const motivo = g.cartella ? 'cartella' : g.altrove ? 'altrove' : g.rebase ? 'rebase' : !cur ? 'staccata' : isProtectedBranch(cur, principale) ? 'principale' : 'deriva';
      const dove = g.cartella ? { cartella: g.cartella, radice: g.radice } : g.altrove ? { altrove: g.altrove } : {};
      return { ok: false, motivo, current: cur, assigned: g.assigned || assigned, rebaseDi: rebaseDi(), count: g.count || 0, escalated: !!g.escalated, ...dove };
    }
    if (g.state && g.state.branch) assigned = g.state.branch;
  } else {
    const altra = altraCartellaDelDeposito(root);
    if (altra) return { ok: false, motivo: 'cartella', current: altra.ramo, assigned, cartella: altra.cartella, radice: altra.radice };
  }
  const current = currentBranch(root);
  if (!current) {
    const ramo = rebaseDi();
    return { ok: false, motivo: ramo ? 'rebase' : 'staccata', current, assigned, rebaseDi: ramo };
  }
  if (isProtectedBranch(current, principale)) return { ok: false, motivo: 'principale', current, assigned };
  const declared = nomeRamo(dichiarato);
  if (declared && declared !== current) return { ok: false, motivo: 'dichiarato', current, assigned, declared };
  return { ok: true, branch: current, id, assigned };
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

// ─── Lavoro vivo nella cartella (#1480) ──────────────────────────────────────
// Un worker che l'orchestratore crede finito può lavorare ancora qui: chi sposta la cartella o rilascia il suo
// biglietto glielo toglie (D-90, D-91). Una guardia sola per tutte le porte; regole: tests/unit/lavoroVivo.test.mjs.

export const USCITA_LAVORO_VIVO = 5;
// Il gancio rinnova il timbro al più ogni 5 minuti: 10 coprono un salvataggio e il successivo.
export const TIMBRO_VIVO_MS = 10 * 60 * 1000;
export const SEGNI_TUTTI = Object.freeze(['battito', 'timbro', 'processi']);
// Il battito si conta dal suo marcatore: i battiti singoli del gancio e il ciclo di un biglietto non sono lavoro.
const COMANDO_BATTITO = /routine-channel\.mjs["']?\s+heartbeat\b/;

export function timbroFile(root) {
  return resolve(root, '.claude', 'routine-beat-hook.stamp');
}

/** `p` è `cartella` o ci sta dentro? PURA. */
export function sottoCartella(p, cartella, platform = process.platform) {
  const n = (x) => { const r = resolve(String(x || '')); return platform === 'win32' ? r.toLowerCase() : r; };
  const a = n(p);
  const b = n(cartella);
  return !!String(p || '') && !!String(cartella || '') && (a === b || a.startsWith(b.endsWith(sep) ? b : b + sep));
}

/** Un comando da mostrare: una riga, accorciato, senza codici lunghi (un biglietto, una parola d'ordine). PURA. */
export function comandoLeggibile(cmd) {
  const s = String(cmd || '').replace(/\s+/g, ' ').trim().replace(/[A-Za-z0-9_-]{32,}/g, (m) => `${m.slice(0, 6)}…`);
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
}

/**
 * I segni di lavoro vivo, da dati già letti. PURA.
 * `mio`: il biglietto di chi chiede (il suo battito e il suo timbro non contano). `cosa`: quali segni guardare.
 * `processi`: null = non visti (fuori da Linux); ognuno { pid, sid, stato, cwd, cmd }.
 */
export function segniDiLavoroVivo({
  mio = '', battito = null, battitoVivo = false, biglietto = null, timbroMs = null, processi = [], cartelle = [],
  esclusi = new Set(), sessione = 0, adesso = Date.now(), cosa = SEGNI_TUTTI, platform = process.platform,
} = {}) {
  const segni = [];
  const corto = (t) => String(t || '').slice(0, 8);
  if (cosa.includes('battito') && battito && battitoVivo && String(battito.ticket || '') !== String(mio || '')) {
    segni.push({ tipo: 'battito', biglietto: corto(battito.ticket), pid: Number(battito.pid) || 0 });
  }
  if (cosa.includes('timbro') && biglietto && biglietto.ticket && String(biglietto.ticket) !== String(mio || '')
      && Number.isFinite(timbroMs) && adesso - timbroMs < TIMBRO_VIVO_MS && adesso - timbroMs > -60 * 1000) {
    // Un timbro di prima della fine del biglietto è il suo ultimo salvataggio; uno dopo è un worker che lavora ancora.
    const fine = bigliettoFinito(biglietto) ? Date.parse(biglietto.morto.ora) : NaN;
    if (!(fine >= timbroMs)) segni.push({ tipo: 'timbro', biglietto: corto(biglietto.ticket), etaMs: Math.max(0, adesso - timbroMs) });
  }
  if (cosa.includes('processi') && Array.isArray(processi)) {
    for (const p of processi) {
      if (!p || esclusi.has(p.pid) || (sessione > 0 && p.sid === sessione) || p.stato === 'Z' || !p.cmd) continue;
      if (COMANDO_BATTITO.test(p.cmd)) continue;
      const cartella = cartelle.find((c) => sottoCartella(p.cwd, c, platform));
      if (cartella) segni.push({ tipo: 'processo', pid: p.pid, cmd: comandoLeggibile(p.cmd), cwd: p.cwd });
    }
  }
  return segni;
}

/** I processi della macchina, con cartella di lavoro e sessione. null dove non si sanno leggere. */
export function processiDiSistema({ platform = process.platform, proc = '/proc' } = {}) {
  if (platform === 'linux') {
    let voci;
    try { voci = readdirSync(proc).filter((n) => /^\d+$/.test(n)); } catch (_) { return null; }
    const out = [];
    for (const n of voci) {
      try {
        const stat = readFileSync(`${proc}/${n}/stat`, 'utf8');
        const campi = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        let cwd = '';
        try { cwd = readlinkSync(`${proc}/${n}/cwd`).replace(/ \(deleted\)$/, ''); } catch (_) { /* di un altro utente, o già uscito */ }
        let cmd = '';
        try { cmd = readFileSync(`${proc}/${n}/cmdline`, 'utf8').split('\u0000').join(' ').trim(); } catch (_) { /* già uscito */ }
        out.push({ pid: Number(n), stato: campi[0], ppid: Number(campi[1]), sid: Number(campi[3]), cwd, cmd });
      } catch (_) { /* uscito mentre lo leggevo */ }
    }
    return out;
  } else {
    // Mac e Windows non hanno /proc: le routine girano su Linux, e qui restano battito e timbro.
    return null;
  }
}

/** Chi chiede e i suoi antenati, e la sessione da escludere se l'ha aperta uno di loro (la shell del comando). PURA. */
export function questoProcesso(processi, pid = process.pid) {
  const perPid = new Map((processi || []).map((p) => [p.pid, p]));
  const esclusi = new Set();
  for (let p = pid; p > 0 && !esclusi.has(p);) {
    esclusi.add(p);
    const v = perPid.get(p);
    if (!v) break;
    p = v.ppid;
  }
  const mia = perPid.get(pid);
  const sessione = mia && mia.sid > 0 && esclusi.has(mia.sid) ? mia.sid : 0;
  return { esclusi, sessione };
}

function worktreeEstranei(root) {
  const l = gitIn(root)(['worktree', 'list', '--porcelain']);
  if (!l.ok) return [];
  const qui = percorsoVero(root);
  return l.out.split(/\r?\n/).filter((r) => r.startsWith('worktree ')).map((r) => r.slice(9).trim())
    .filter((d) => d && existsSync(d) && percorsoVero(d) !== qui).map(percorsoVero);
}

function ultimoCommit(root) {
  const r = gitIn(root)(['log', '-1', '--format=%h%x00%cr%x00%s']);
  if (!r.ok || !r.out) return null;
  const [sha, quando, titolo] = r.out.split('\u0000');
  return { ramo: currentBranch(root), sha, quando, titolo: String(titolo || '').slice(0, 80) };
}

/**
 * C'è lavoro vivo in `root`? Battito di un altro biglietto, timbro fresco del gancio di salvataggio, processi con la
 * cartella di lavoro qui o in un worktree estraneo dello stesso deposito. Esclusi chi chiede, i suoi antenati e la sua
 * shell. @returns {{ vivo: boolean, segni: object[], processiVisti: boolean, commit: object|null }}
 */
export function lavoroVivo(root, {
  mio = '', cosa = SEGNI_TUTTI, adesso = Date.now(), leggiProcessi = processiDiSistema, alive = pidAlive, pid = process.pid,
} = {}) {
  const radice = percorsoVero(resolve(root));
  const battito = readBeat(radice);
  const diQui = battito && (!battito.root || stessaCartella(battito.root, radice));
  const battitoVivo = !!(diQui && beatIsLive(battito, battito.ticket, { now: adesso, alive }));
  let timbroMs = null;
  try { timbroMs = statSync(timbroFile(radice)).mtimeMs; } catch (_) { /* nessun salvataggio in questo giro */ }
  const processi = cosa.includes('processi') ? leggiProcessi() : [];
  const { esclusi, sessione } = questoProcesso(processi || [], pid);
  const segni = segniDiLavoroVivo({
    mio, battito: diQui ? battito : null, battitoVivo, biglietto: leggiMarcatoreBiglietto(radice), timbroMs,
    processi, cartelle: processi && processi.length ? [radice, ...worktreeEstranei(radice)] : [radice],
    esclusi, sessione, adesso, cosa,
  });
  return { vivo: segni.length > 0, segni, processiVisti: processi !== null, commit: segni.length ? ultimoCommit(radice) : null };
}

const MOSTRATI = 6;

/** Il rifiuto, con chi lavora ancora e cosa fare: `azione` è ciò che non si è fatto. PURA. */
export function testoLavoroVivo(esito, azione) {
  const segni = (esito && esito.segni) || [];
  // Prima i comandi veri, poi le shell che li avvolgono.
  const shell = (s) => /^(\S*\/)?(ba|z)?sh -c /.test(s.cmd) ? 1 : 0;
  const processi = segni.filter((s) => s.tipo === 'processo').sort((a, b) => shell(a) - shell(b));
  // Una suite di test sono decine di processi: i primi bastano a dire chi è, il numero dice il resto.
  const righe = [...segni.filter((s) => s.tipo !== 'processo'), ...processi.slice(0, MOSTRATI)].map((s) => {
    if (s.tipo === 'battito') return `battito vivo del biglietto ${s.biglietto}… (pid ${s.pid})`;
    if (s.tipo === 'timbro') return `il gancio di salvataggio del biglietto ${s.biglietto}… ha salvato ${Math.round(s.etaMs / 60000)} minuti fa`;
    return `processo ${s.pid} «${s.cmd}» in ${s.cwd}`;
  });
  if (processi.length > MOSTRATI) righe.push(`e altri ${processi.length - MOSTRATI} processi`);
  const c = esito && esito.commit;
  const commit = c ? ` Ultimo commit della cartella: ${c.sha} (${c.quando}) «${c.titolo}»${c.ramo ? ` sul ramo ${c.ramo}` : ''}.` : '';
  // Il testo finisce anche dentro un `--guasto "…"` copiato a mano: niente virgolette doppie, apici inversi, dollari.
  return `lavoro ancora vivo nella cartella: non ho ${azione}. ${righe.join('; ')}.${commit}`.replace(/\\/g, '/').replace(/["`$]/g, "'");
}
