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
//      transizione accettata lascia un PUNTO FERMO (withCheckpoint). Le DUE
//      metà stanno qui insieme — guardTransition (rifiuta) e sealState (sigilla)
//      — perché valgono per tutti i punti di scrittura: i verdetti in
//      dispatch.mjs e le CONSEGNE in queue-triage.mjs. Tenerne una sola nel
//      posto condiviso è ciò che ha prodotto il guasto #460: le consegne
//      controllavano l'identità ma non lasciavano nessun punto fermo;
//   D) un'interruzione riporta il branch all'ULTIMO punto fermo, spostando di
//      lato — senza distruggerli — i commit scartati (prepareBranch);
//   B) l'identità attesa viene esposta su file (writeExpectation) perché una
//      guardia FUORI dalla sessione (.claude/hooks/branch-guard.sh) possa
//      confrontarla dopo ogni comando.
//
// Tutte le funzioni prendono `root` esplicito (mai un ROOT globale): gli unit
// test girano su repo git temporanei con un finto `origin`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
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

/**
 * Base da cui far nascere il branch di un lavoro nuovo. Modello B (ROUTINES.md
 * § Feature spezzate): i pezzi `#N.M` di una feature spezzata NON nascono da
 * `main` ma da `feature/N`, e lì si rifondono. Qui si calcola solo il CANDIDATO
 * dal numero del feedback; se quel branch non esiste, prepareBranch ripiega su
 * `main` (un pezzo isolato su main è recuperabile, un pezzo nato dal branch
 * sbagliato no).
 * @param {string|number} num  es. "#146.3" oppure "146.3"
 */
export function preferredBase(num, mainBranch = 'main') {
  const m = String(num == null ? '' : num).match(/^#?(\d+)\.(\d+)$/);
  return m ? `feature/${m[1]}` : mainBranch;
}

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
// Stessa soglia e stesso esito del contatore `workingResets` (apply-triage) e
// del loop verifier→fixer: un ambiente che produce disallineamenti a ripetizione
// deve smettere di girare a vuoto, non insistere per sempre.
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
    : resolve(root, 'feedback-triage', 'state');
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

// ─── A + D: posizionare la directory sul branch giusto ───────────────────────

function refExists(g, ref) {
  return g(['rev-parse', '--verify', '--quiet', ref]).ok;
}

function commitExists(g, sha) {
  return !!sha && g(['cat-file', '-e', `${sha}^{commit}`]).ok;
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
  if (!g(['rev-parse', '--git-dir']).ok) return { ok: false, kind: 'transient', message: 'la directory non è un repo git' };

  if (create) {
    const wanted = base || mainBranch;
    g(['fetch', 'origin', wanted]);
    g(['fetch', 'origin', mainBranch]);
    // Base: il branch chiesto se esiste (Modello B: feature/N), altrimenti la
    // linea principale. MAI HEAD: se il giro precedente ci ha lasciati su un
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
    if (pushed) g(['push', '--force-with-lease', 'origin', `${branch}:${branch}`]);
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
 * chiede l'escalation all'owner. Condivisa fra i due punti di scrittura
 * (i verdetti in dispatch.mjs e le consegne in queue-triage.mjs): la stessa
 * regola scritta due volte diventa due regole diverse al primo ritocco.
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
 * L'ALTRA METÀ di `guardTransition`: una transizione ACCETTATA lascia un PUNTO
 * FERMO (l'identità del contenuto in questo istante) e rilascia l'identità
 * attesa — dopo la consegna non c'è più niente da proteggere su quel branch.
 *
 * Sta QUI, non nei chiamanti, per lo stesso motivo di `guardTransition`: C vale
 * per i verdetti **e** per le consegne, e finché la seconda metà è vissuta solo
 * dentro dispatch.mjs le consegne verificavano l'identità senza lasciare niente
 * dietro. Conseguenza reale (feedback #460): dopo una consegna di lavoro nuovo
 * l'ultimo punto fermo restava quello scritto alla CREAZIONE del branch — un
 * momento in cui non esisteva ancora una riga di codice — e al giro dopo D
 * leggeva il lavoro consegnato come "istanza interrotta" e riportava il branch a
 * prima che esistesse, force-push su origin compreso. Chi doveva verificare
 * trovava il vuoto, e il vuoto si legge come "lavoro mai fatto".
 *
 * @param {string} root   directory del repo (l'identità la GUARDA, non la chiede)
 * @param {object} state  stato del branch da sigillare (deve avere `id`)
 * @param {string} by     chi sigilla (es. 'verifier:pass', 'consegna:revision_capability')
 */
export function sealState(root, state, by, now = Date.now()) {
  const sealed = clearRejects(withCheckpoint(state, headSha(root), by, now));
  writeBranchState(root, sealed);
  clearExpectation(root);
  return sealed;
}

/**
 * Il testo che l'owner legge in dashboard quando la lavorazione automatica
 * viene sospesa per disallineamento ripetuto. Vive qui perché lo usano
 * entrambi i punti di scrittura, e perché è per l'OWNER: niente branch, niente
 * SHA, niente nomi di file (vedi CLAUDE.md § Tono dei report).
 */
export function escalationNote(count = IDENTITY_REJECT_LIMIT) {
  return `La lavorazione automatica si è disallineata ${count} volte di seguito: chi doveva registrare l'esito stava guardando una versione del codice diversa da quella in lavorazione, quindi il risultato non sarebbe attendibile. Ho sospeso i tentativi automatici invece di insistere; serve una tua decisione su come procedere.`;
}
