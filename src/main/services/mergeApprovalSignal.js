'use strict';
// IL CAMPANELLO DELLE FUSIONI IN ATTESA (SPEC-RIDISEGNO-MAX.md §10): un file che `npm run finish` tocca quando il server blocca una fusione e apre la richiesta, così anche una dashboard GIÀ APERTA se ne accorge subito invece che solo alla prossima apertura.
// Un file e non un controllo a intervalli: zero traffico quando non c'è niente da mostrare (l'owner tiene la home aperta per ore) e avviso immediato quando c'è. Le richieste aperte in cloud non passano da questa macchina: quelle compaiono col RIENTRO IN FINESTRA qui sotto.
// Suonarlo non crea e non approva nessuna richiesta: fa solo rileggere al server l'elenco vero. `note()` suona (la chiama `npm run finish`: fuori da Electron, quindi qui dentro MAI require('electron') a livello di modulo); `start()` ascolta.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** La cartella del campanello, dentro la base. Una sola cosa ci vive. */
const DIR_NAME = 'filo-merge-approvals';
const FILE_NAME = 'signal';

// `fs.watch` emette più eventi per una scrittura sola (creazione + contenuto): si aspetta un attimo e si legge una volta.
const DEBOUNCE_MS = 300;

// Rientro in finestra: al massimo una rilettura ogni cinque minuti. È solo la rete di sicurezza — il caso vero (richiesta appena aperta da `npm run finish`) lo copre il campanello — e una rete non deve costare una fila di chiamate per dire ogni volta "non c'è niente".
// Resta comunque diverso da un controllo periodico: senza una persona che torna sulla finestra non scatta MAI.
const FOCUS_MIN_MS = 5 * 60 * 1000;

/** DOVE VIVE IL CAMPANELLO. PURA (a parte l'ambiente). `FILO_USER_DATA` prima di tutto: nei test ogni run ne ha uno suo, così due suite in parallelo non si suonano il campanello a vicenda.
* Fuori dai test è la cartella temporanea dell'utente: la SOLA che il main di Electron e uno script Node lanciato dal terminale calcolano allo stesso identico modo. Due percorsi diversi = campanello muto, guasto silenzioso. */
function baseDir(base) {
  return String(base || process.env.FILO_USER_DATA || os.tmpdir());
}
function signalDir(base) {
  return path.join(baseDir(base), DIR_NAME);
}
function signalFile(base) {
  return path.join(signalDir(base), FILE_NAME);
}

/** Suona: "c'è una richiesta nuova, vai a rileggere". Non lancia mai — se non si scrive, l'avviso si vedrà al prossimo rientro in finestra, e far fallire `npm run finish` perché una cartella temporanea non è scrivibile sarebbe sproporzionato.
* @returns {boolean} true se il campanello è stato scritto */
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

/** Ascolta il campanello guardando la CARTELLA, non il file: il file può ancora non esistere, e una cartella dedicata evita di svegliarsi a ogni file temporaneo del sistema.
* @returns {function} come smettere */
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
      // Un orecchio teso non deve tenere in vita il processo per conto suo.
      if (typeof watcher.unref === 'function') watcher.unref();
      // Una cartella temporanea può sparire sotto i piedi (pulizia del sistema): il watcher muore e da lì in poi non suonerebbe più niente, in silenzio. Si riarma, con calma.
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

/** L'impronta di un elenco. PURA. Serve a NON riavvisare le pagine quando non è cambiato niente: un avviso che si ridisegna da solo mentre l'owner lo sta leggendo (magari con "Confermi?" già armato) è rumore, non aggiornamento. */
function signature(reply) {
  const r = reply || {};
  const pend = (Array.isArray(r.pending) ? r.pending : []).map((x) => String(x && x.id));
  // Le approvate-mai-avvenute contano quanto le pendenti: una che compare o sparisce È un cambiamento da mostrare.
  const fail = (Array.isArray(r.failed) ? r.failed : []).map((x) => String(x && x.id));
  const rec = (Array.isArray(r.recent) ? r.recent : [])
    .map((x) => `${String(x && x.id)}:${String((x && x.outcome) || '')}:${x && x.discarded ? 'd' : ''}`);
  return `${pend.join(',')}|${fail.join(',')}|${rec.join(',')}`;
}

/** LA DECISIONE, con l'I/O iniettato: (perché mi svegli, chi sei) → cosa faccio. Tutto ciò che conta si verifica da qui, senza Electron e senza rete.
* Se non sei il proprietario NON si legge e NON si avvisa nessuno; una raffica di colpi diventa UNA lettura; il rientro in finestra è limitato; se l'elenco è identico a prima le pagine non vengono toccate.
* @param {object} deps { isAdmin(), read() → Promise<reply>, broadcast(msg), now() } */
function makePoker({ isAdmin, read, broadcast, type = 'merge_approvals_changed', now = () => Date.now(), focusMinMs = FOCUS_MIN_MS } = {}) {
  let lastReadAt = 0;
  let lastSig = null;
  let inFlight = null;
  let again = false;

  async function run(reason) {
    if (reason === 'focus' && lastReadAt && (now() - lastReadAt) < focusMinMs) return 'skipped';
    // Il cancello che tiene la promessa "per chi non è l'owner non cambia niente": prima di qualunque chiamata, non dopo.
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
      failed: reply.failed || [],
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

/** Aggancia il campanello al processo main, una volta al boot. `electron` si richiede QUI DENTRO e non in cima: `npm run finish` importa questo modulo solo per `note()`, e fuori da Electron un require in cima lo farebbe morire.
* @returns {function} come smettere */
function start(deps) {
  const poker = makePoker(deps);
  const stopWatch = watchSignal(() => { poker.poke('signal'); }, {});
  let offFocus = null;
  try {
    const { app } = require('electron');
    // Solo la finestra vera del browser (`_filoTabs`): il popup dei menu è una BrowserWindow sua, e ogni menu aperto e richiuso conterebbe come un rientro. Qui "rientro" vuol dire "l'owner è tornato su Filo".
    const onFocus = (_e, win) => { if (win && win._filoTabs) poker.poke('focus'); };
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
