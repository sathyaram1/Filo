'use strict';
// IL CAMPANELLO DELLE FUSIONI IN ATTESA (SPEC-RIDISEGNO-MAX.md §10).
//
// IL GUASTO CHE CHIUDE
//   Quando i controlli del server fermano una fusione, il terminale dice
//   "approvala dalla prima schermata di Filo". Ma la prima schermata leggeva
//   l'elenco solo all'apertura, al cambio di account e dopo una decisione: se
//   era GIÀ APERTA — cioè quasi sempre, visto che è la home del browser — non
//   mostrava niente finché non se ne apriva una nuova. Un avviso che si vede
//   solo aprendo una finestra in più è un avviso che l'owner si perde, e ci si
//   è cascati subito.
//
// PERCHÉ UN FILE E NON UN CONTROLLO A INTERVALLI
//   Le richieste nascono in UN solo posto, e quel posto è QUESTA macchina:
//   `npm run finish` chiede la fusione, il server la blocca e apre la
//   richiesta. Non c'è nessun altro produttore (il cancello delle routine
//   respinge e basta, non accoda). Quindi non serve chiedere "c'è qualcosa?"
//   a ripetizione: basta che chi apre la richiesta lo dica, e lo può dire
//   scrivendo un file.
//
//   Il risultato è quello che serviva: ZERO traffico quando non c'è niente da
//   mostrare — e l'owner tiene la home aperta per ore — e l'avviso che compare
//   entro un istante quando invece c'è.
//
// LA RETE DI SICUREZZA (e perché non è un controllo periodico)
//   Il campanello può non suonare: Filo era chiuso quando è arrivata la
//   richiesta, la cartella temporanea è stata ripulita, un domani un'altra
//   strada apre richieste dal server. Per quei casi c'è il RIENTRO IN FINESTRA
//   (`browser-window-focus`): quando l'owner torna su Filo si rilegge, al
//   massimo una volta al minuto. È guidato dall'attenzione di una persona, non
//   da un orologio: chi resta sulla home per ore non genera nemmeno una
//   chiamata, e chi torna dal terminale trova l'avviso già lì.
//
// QUESTO CAMPANELLO NON DÀ POTERI A NESSUNO
//   Suonarlo non crea una richiesta e non ne approva nessuna: fa solo rileggere
//   al server l'elenco vero. Una sessione catturata poteva già chiedere fusioni
//   (è il presupposto di tutta la §10); qui al massimo fa aggiornare una lista.
//   Per non farne un modo di tempestare il server, un colpo per volta e le
//   raffiche si fondono in una.
//
// CHI SUONA E CHI SENTE
//   · `note()` lo suona — la chiama `npm run finish` (fuori da Electron: qui
//     dentro non si richiede mai `electron` a livello di modulo, o lo script
//     non potrebbe importarlo);
//   · `start()` lo ascolta — la chiama il main, che rilegge e avvisa le pagine.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** La cartella del campanello, dentro la base. Una sola cosa ci vive. */
const DIR_NAME = 'filo-merge-approvals';
const FILE_NAME = 'signal';

// `fs.watch` emette più eventi per una scrittura sola (creazione + contenuto):
// si aspetta un attimo e si legge una volta.
const DEBOUNCE_MS = 300;

// Rientro in finestra: al massimo una rilettura ogni cinque minuti.
//
// Perché così larga: il caso VERO — la richiesta appena aperta da
// `npm run finish` — lo copre il campanello, che arriva in un istante e non
// aspetta nessun intervallo. Questo è solo la rete di sicurezza, e una rete non
// deve costare: cinque minuti bastano a raccogliere ciò che il campanello ha
// mancato (Filo era chiuso, cartella ripulita) senza che una giornata di lavoro
// dentro Filo — dove ogni rientro nella finestra è un'occasione di rilettura —
// si trasformi in una fila di chiamate per dire ogni volta "non c'è niente".
//
// E resta comunque diverso da un controllo periodico: senza una persona che
// torna sulla finestra non scatta MAI. Chi tiene la home aperta per ore non
// genera una sola chiamata.
const FOCUS_MIN_MS = 5 * 60 * 1000;

/**
 * DOVE VIVE IL CAMPANELLO. PURA (a parte l'ambiente).
 *
 * `FILO_USER_DATA` prima di tutto: nei test ogni run ne ha uno suo, quindi due
 * suite in parallelo non si suonano il campanello a vicenda. Fuori dai test è
 * la cartella temporanea dell'utente — la SOLA che il main di Electron e uno
 * script Node lanciato dal terminale calcolano allo stesso identico modo, senza
 * doversi accordare sul nome dell'applicazione. Se i due calcolassero percorsi
 * diversi il campanello non suonerebbe e nessuno se ne accorgerebbe: è
 * esattamente il tipo di guasto silenzioso da non introdurre.
 */
function baseDir(base) {
  return String(base || process.env.FILO_USER_DATA || os.tmpdir());
}
function signalDir(base) {
  return path.join(baseDir(base), DIR_NAME);
}
function signalFile(base) {
  return path.join(signalDir(base), FILE_NAME);
}

/**
 * Suona: "c'è una richiesta nuova, vai a rileggere".
 *
 * Non lancia mai. Il campanello è una comodità: se non si scrive, l'avviso si
 * vedrà comunque al prossimo rientro in finestra o alla prossima apertura. Far
 * fallire `npm run finish` perché una cartella temporanea non è scrivibile
 * sarebbe sproporzionato.
 *
 * @returns {boolean} true se il campanello è stato scritto
 */
function note(id, base) {
  try {
    fs.mkdirSync(signalDir(base), { recursive: true });
    fs.writeFileSync(
      signalFile(base),
      JSON.stringify({ at: Date.now(), id: String(id || '') }),
      'utf8'
    );
    return true;
  } catch (_) {
    return false;
  }
}

/** L'ultimo colpo di campanello, o null. Serve alla diagnosi e ai test. */
function readNote(base) {
  try {
    return JSON.parse(fs.readFileSync(signalFile(base), 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Ascolta il campanello.
 *
 * Si guarda la CARTELLA, non il file: il file può ancora non esistere, e una
 * cartella dedicata garantisce che l'unica cosa che ci succede sia il nostro
 * campanello (guardare la cartella temporanea intera vorrebbe dire svegliarsi
 * a ogni file temporaneo del sistema).
 *
 * @returns {function} come smettere
 */
function watchSignal(onRing, { base, debounceMs = DEBOUNCE_MS } = {}) {
  let watcher = null;
  let timer = null;
  let stopped = false;
  let rearm = null;

  const ring = () => {
    timer = null;
    try { onRing(); } catch (_) {}
  };

  const arm = () => {
    if (stopped) return;
    try {
      fs.mkdirSync(signalDir(base), { recursive: true });
      watcher = fs.watch(signalDir(base), (_event, filename) => {
        if (filename && String(filename) !== FILE_NAME) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(ring, debounceMs);
      });
      // Una cartella temporanea può sparire sotto i piedi (pulizia del sistema):
      // il watcher muore e da lì in poi non suonerebbe più niente, in silenzio.
      // Si riarma, con calma.
      watcher.on('error', () => {
        try { watcher.close(); } catch (_) {}
        watcher = null;
        if (stopped) return;
        rearm = setTimeout(arm, 5000);
        if (rearm.unref) rearm.unref();
      });
    } catch (_) {
      if (stopped) return;
      rearm = setTimeout(arm, 5000);
      if (rearm.unref) rearm.unref();
    }
  };

  arm();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (rearm) clearTimeout(rearm);
    try { if (watcher) watcher.close(); } catch (_) {}
    watcher = null;
  };
}

/**
 * L'impronta di un elenco. PURA.
 *
 * Serve a NON riavvisare le pagine quando non è cambiato niente: un avviso che
 * si ridisegna da solo mentre l'owner lo sta leggendo (e magari mentre ha già
 * armato "Confermi?") è rumore, non aggiornamento.
 */
function signature(reply) {
  const r = reply || {};
  const pend = (Array.isArray(r.pending) ? r.pending : []).map((x) => String(x && x.id));
  const rec = (Array.isArray(r.recent) ? r.recent : [])
    .map((x) => `${String(x && x.id)}:${String((x && x.outcome) || '')}:${x && x.discarded ? 'd' : ''}`);
  return `${pend.join(',')}|${rec.join(',')}`;
}

/**
 * LA DECISIONE, con l'I/O iniettato: (perché mi svegli, chi sei) → cosa faccio.
 *
 * Tutto ciò che conta si verifica da qui, senza Electron e senza rete:
 *   · se non sei il proprietario NON si legge e NON si avvisa nessuno — per
 *     chiunque altro questa parte dell'app non esiste, nemmeno come chiamata;
 *   · una raffica di colpi di campanello diventa UNA lettura;
 *   · il rientro in finestra non rilegge più di una volta al minuto;
 *   · se l'elenco è identico a quello di prima, le pagine non vengono toccate.
 *
 * @param {object} deps { isAdmin(), read() → Promise<reply>, broadcast(msg), now() }
 */
function makePoker({ isAdmin, read, broadcast, type = 'merge_approvals_changed', now = () => Date.now(), focusMinMs = FOCUS_MIN_MS } = {}) {
  let lastReadAt = 0;
  let lastSig = null;
  let inFlight = null;
  let again = false;

  async function run(reason) {
    if (reason === 'focus' && lastReadAt && (now() - lastReadAt) < focusMinMs) return 'skipped';
    // Il cancello che tiene la promessa "per chi non è l'owner non cambia
    // niente": prima di qualunque chiamata, non dopo.
    if (!isAdmin()) return 'not_owner';
    lastReadAt = now();
    let reply;
    try {
      reply = await read();
    } catch (_) {
      return 'unreadable';
    }
    if (!reply || reply.ok === false) return 'unreadable';
    const sig = signature(reply);
    if (sig === lastSig) return 'unchanged';
    lastSig = sig;
    broadcast({
      type,
      pending: reply.pending || [],
      recent: reply.recent || [],
      ttlMs: Number(reply.ttlMs) || 0,
    });
    return 'sent';
  }

  /** Un colpo per volta: una raffica si fonde in una lettura + una in coda. */
  function poke(reason) {
    if (inFlight) { again = true; return inFlight; }
    inFlight = run(reason).then(async (out) => {
      inFlight = null;
      if (again) { again = false; return poke(reason); }
      return out;
    }, () => { inFlight = null; again = false; return 'unreadable'; });
    return inFlight;
  }

  return { poke, _signature: signature };
}

/**
 * Aggancia il campanello al processo main. Si chiama una volta, al boot.
 *
 * `electron` si richiede QUI DENTRO e non in cima al file: `npm run finish`
 * importa questo modulo solo per `note()`, e fuori da Electron un require in
 * cima lo farebbe morire.
 *
 * @param {object} deps { isAdmin(), read(), broadcast(msg), type }
 * @returns {function} come smettere
 */
function start(deps) {
  const poker = makePoker(deps);
  const stopWatch = watchSignal(() => { poker.poke('signal'); }, {});
  let offFocus = null;
  try {
    const { app } = require('electron');
    const onFocus = () => { poker.poke('focus'); };
    app.on('browser-window-focus', onFocus);
    offFocus = () => { try { app.off('browser-window-focus', onFocus); } catch (_) {} };
  } catch (_) { /* fuori da Electron resta il solo campanello */ }
  return () => {
    stopWatch();
    if (offFocus) offFocus();
  };
}

module.exports = {
  DIR_NAME,
  FILE_NAME,
  DEBOUNCE_MS,
  FOCUS_MIN_MS,
  signalDir,
  signalFile,
  note,
  readNote,
  watchSignal,
  signature,
  makePoker,
  start,
};
