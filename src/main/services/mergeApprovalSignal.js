'use strict';
// Il campanello delle fusioni in attesa: un file che `npm run finish` tocca quando il server
// blocca una fusione, così una dashboard già aperta se ne accorge subito, e zero traffico
// quando non c'è nulla. Suonarlo non crea e non approva niente: fa rileggere l'elenco vero.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** La cartella del campanello, dentro la base. Una sola cosa ci vive. */
const DIR_NAME = 'filo-merge-approvals';
const FILE_NAME = 'signal';

// `fs.watch` emette più eventi per una scrittura sola: si aspetta un attimo e si legge una
// volta.
const DEBOUNCE_MS = 300;

// Rientro in finestra: al massimo una rilettura ogni cinque minuti. È la rete di sicurezza:
// senza qualcuno che torni sulla finestra non scatta MAI.
const FOCUS_MIN_MS = 5 * 60 * 1000;

// `FILO_USER_DATA` prima di tutto: nei test ogni run ha il suo campanello. Fuori, la
// cartella temporanea è la sola che main ed script calcolano uguale: se diverge, è muto.
function baseDir(base) {
  return String(base || process.env.FILO_USER_DATA || os.tmpdir());
}
function signalDir(base) {
  return path.join(baseDir(base), DIR_NAME);
}
function signalFile(base) {
  return path.join(signalDir(base), FILE_NAME);
}

// Non lancia mai: se non si scrive l'avviso arriva al prossimo rientro in finestra, e far
// fallire `npm run finish` per una cartella non scrivibile sarebbe sproporzionato.
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

// Guarda la CARTELLA, non il file: il file può ancora non esistere, e una cartella dedicata
// evita di svegliarsi a ogni file temporaneo del sistema.
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
      // La cartella temporanea può sparire (pulizia del sistema) e il watcher muore in silenzio:
      // si riarma, con calma.
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

// Serve a NON riavvisare le pagine quando non è cambiato niente: un avviso che si ridisegna
// mentre l'owner lo legge, magari con «Confermi?» armato, è rumore.
function signature(reply) {
  const r = reply || {};
  const pend = (Array.isArray(r.pending) ? r.pending : []).map((x) => String(x && x.id));
  // Le approvate-mai-avvenute contano quanto le pendenti: se compaiono o spariscono, è un
  // cambiamento.
  const fail = (Array.isArray(r.failed) ? r.failed : []).map((x) => String(x && x.id));
  const rec = (Array.isArray(r.recent) ? r.recent : [])
    .map((x) => `${String(x && x.id)}:${String((x && x.outcome) || '')}:${x && x.discarded ? 'd' : ''}`);
  return `${pend.join(',')}|${fail.join(',')}|${rec.join(',')}`;
}

// LA DECISIONE con l'I/O iniettato: tutto ciò che conta si verifica senza Electron e senza
// rete. Non owner: niente lettura e niente avviso; una raffica diventa una lettura sola.
function makePoker({ isAdmin, read, broadcast, type = 'merge_approvals_changed', now = () => Date.now(), focusMinMs = FOCUS_MIN_MS } = {}) {
  let lastReadAt = 0;
  let lastSig = null;
  let inFlight = null;
  let again = false;

  async function run(reason) {
    if (reason === 'focus' && lastReadAt && (now() - lastReadAt) < focusMinMs) return 'skipped';
    // Il cancello sta PRIMA di qualunque chiamata: per chi non è l'owner non cambia niente.
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

// `electron` si richiede QUI DENTRO: `npm run finish` importa il modulo per `note()` e fuori
// da Electron un require in cima lo farebbe morire.
function start(deps) {
  const poker = makePoker(deps);
  const stopWatch = watchSignal(() => { poker.poke('signal'); }, {});
  let offFocus = null;
  try {
    const { app } = require('electron');
    // Solo la finestra vera del browser: il popup dei menu è una BrowserWindow sua, e ogni menu
    // aperto conterebbe come un rientro.
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
