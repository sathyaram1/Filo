// Stage 5: sandbox (detonation).
//
// Per la coda sospetta in cui la destinazione vera è incerta (redirect,
// accorciatori): apri il link in anticipo in una finestra NASCOSTA e ISOLATA,
// senza cookie né dati dell'utente, segui i redirect, esegui il JS, e osserva
// URL finale + download. Verdetto in cache (gestita da index.js).
//
// Principi (vedi spec):
//   - "sembra pulito" vale poco (gli attacchi mascherano il contenuto agli
//     scanner) → al massimo 'clean', mai una patente di sicurezza.
//   - "sembra pericoloso" è un forte rinforzo → 'dangerous'.
//   - Non bloccare MAI il click su questo controllo (è sempre async/background).
//   - Niente caccia alla perfezione anti-rilevamento.
//
// #591 — una finestra nascosta con JavaScript attivo è una risorsa vera, e di
// queste non c'era né un tetto al numero né uno al tempo di vita: bastavano
// indirizzi con sottodomini sempre nuovi per farne aprire quante se ne
// volevano, ciascuna potenzialmente per sempre (il timer di attesa veniva
// annullato appena la pagina finiva di caricare, e da lì in poi niente la
// chiudeva più). Adesso ne girano al massimo MAX_CONCURRENT; le altre
// aspettano in coda, la coda ha un fondo e un'attesa massima, e OGNI finestra
// ha un tetto di vita che nessun cammino può disinnescare.
// Il tetto vale anche per la memoria di navigazione isolata che ogni finestra
// si porta dietro: i nomi sono altrettanti e si riusano a turno, svuotati
// prima e dopo ogni controllo. Una memoria nuova per ogni sito sospetto
// sopravviveva alla finestra e restava registrata finché Filo restava aperto.
//
// Richiede Electron (BrowserWindow/session) → funziona solo a runtime nel main.
// In ambiente senza Electron ritorna null.

'use strict';

const DETONATE_TIMEOUT_MS = 9000;
// Tetto di vita della finestra, non annullabile da nessun evento: copre il
// caricamento più il tempo di valutare l'URL finale. Scaduto questo, la
// finestra viene distrutta comunque.
const HARD_LIFETIME_MS = 15000;
// Quante finestre nascoste possono esistere insieme. Due bastano a non
// serializzare del tutto il controllo e restano poche abbastanza da non pesare.
const MAX_CONCURRENT = 2;
// Quante richieste possono aspettare. Oltre, si rinuncia subito invece di
// accumulare lavoro che nessuno leggerà più.
const MAX_QUEUE = 16;
// Quanto può aspettare una richiesta in coda prima di rinunciare.
const MAX_QUEUE_WAIT_MS = 30 * 1000;

// ─── Tetto di concorrenza con coda ──────────────────────────────────────────
// Logica pura (nessun Electron): si prova per quello che è negli unit test.
// `run(task)` ritorna { refused, reason?, value? }: rifiutata vuol dire che il
// controllo non è stato fatto, non che il sito è pulito.
function createConcurrencyGate({
  maxConcurrent = MAX_CONCURRENT,
  maxQueue = MAX_QUEUE,
  maxWaitMs = MAX_QUEUE_WAIT_MS,
} = {}) {
  let active = 0;
  const waiting = [];

  function acquire() {
    if (active < maxConcurrent) { active++; return Promise.resolve('ok'); }
    if (waiting.length >= maxQueue) return Promise.resolve('queue_full');
    return new Promise((resolve) => {
      const entry = { settle: null, timer: null };
      entry.settle = (reason) => {
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
        resolve(reason);
      };
      entry.timer = setTimeout(() => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        entry.settle('queue_timeout');
      }, maxWaitMs);
      waiting.push(entry);
    });
  }

  // Il posto liberato passa a chi aspetta, senza fare scendere il contatore:
  // altrimenti fra il rilascio e la ripresa del chiamante in coda ci sarebbe
  // una finestra in cui ne partono più di maxConcurrent.
  function release() {
    const next = waiting.shift();
    if (next) next.settle('ok');
    else active = Math.max(0, active - 1);
  }

  async function run(task) {
    const slot = await acquire();
    if (slot !== 'ok') return { refused: true, reason: slot };
    try {
      return { refused: false, value: await task() };
    } finally {
      release();
    }
  }

  return {
    run,
    get active() { return active; },
    get queued() { return waiting.length; },
  };
}

const gate = createConcurrencyGate();

// ─── Le memorie isolate, a turno ────────────────────────────────────────────
// Ogni finestra nascosta ha bisogno di una memoria di navigazione tutta sua
// (niente cookie né dati dell'utente). Fabbricarne una NUOVA a ogni controllo,
// con un nome che non si ripete mai, lasciava dietro di sé una memoria per
// ogni sito sospetto incontrato: la finestra ha un tetto e muore, quella no —
// resta registrata in Electron finché Filo resta aperto, e una lunga sessione
// di navigazione se ne lasciava dietro a decine. È l'altra metà della stessa
// risorsa, e il tetto di concorrenza la rende gratis da chiudere: se insieme
// ne girano al massimo MAX_CONCURRENT, bastano altrettanti nomi riusati a
// turno. Si svuota PRIMA dell'uso (e di nuovo dopo, come già si faceva): così
// l'isolamento fra un controllo e il successivo non dipende da quando è
// arrivato lo svuotamento del precedente.
const partizioniLibere = [];
let partizioniFatte = 0;

function prendiPartizione() {
  const libera = partizioniLibere.pop();
  if (libera) return libera;
  partizioniFatte += 1;
  return `filo-detonate-${partizioniFatte}`;
}

function rendiPartizione(nome) {
  if (nome && !partizioniLibere.includes(nome)) partizioniLibere.push(nome);
}

let _electron = null;
function electron() {
  if (_electron === null) {
    try { _electron = require('electron'); } catch (_) { _electron = false; }
  }
  return _electron;
}

// `evaluateFinal(finalUrl)` è iniettata: ri-valuta l'URL finale con l'engine
// (segnali locali) per capire se la destinazione vera è ingannevole.
// `opts` esiste per gli unit test (Electron finto e tempi accorciati): in
// produzione non si passa, e valgono le costanti qui sopra.
async function detonate(url, evaluateFinal, opts = {}) {
  const el = opts.electron || electron();
  if (!el || !el.BrowserWindow || !el.session) return null;

  // Oltre il tetto (o dopo troppa attesa in coda) si rinuncia: nessuna finestra
  // viene aperta e il verdetto resta "non pervenuto" — che NON finisce in
  // cache, così al prossimo passaggio si riprova.
  const out = await gate.run(() => detonateNow(el, url, evaluateFinal, opts));
  if (out.refused) return null;
  return out.value;
}

async function detonateNow(el, url, evaluateFinal, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DETONATE_TIMEOUT_MS;
  const lifetimeMs = Number(opts.hardLifetimeMs) > 0 ? Number(opts.hardLifetimeMs) : HARD_LIFETIME_MS;
  const partition = prendiPartizione();
  let ses;
  try {
    ses = el.session.fromPartition(partition, { cache: false });
  } catch (e) {
    rendiPartizione(partition);
    throw e;
  }
  // Svuotata prima dell'uso: la memoria è riusata, e il turno precedente non
  // deve poter lasciare niente a questo.
  try { await ses.clearStorageData(); } catch (_) {}

  let downloadStarted = false;
  let downloadName = '';
  // Il sorvegliante dei download si toglie alla fine del giro: la memoria è
  // riusata, e uno lasciato attaccato si sommerebbe a quello del giro dopo
  // (e ai suoi, e ai suoi ancora), scrivendo su variabili di un controllo
  // ormai chiuso.
  const suDownload = (e, item) => {
    downloadStarted = true;
    try { downloadName = item.getFilename(); } catch (_) {}
    e.preventDefault(); // non scaricare davvero nulla
  };
  try { ses.on('will-download', suDownload); } catch (_) {}

  let win;
  try {
    win = creaFinestra(el, ses);
  } catch (e) {
    rendiPartizione(partition);
    throw e;
  }

  const wc = win.webContents;
  const redirects = [];
  let finalUrl = url;
  let finished = false;
  let ripulito = false;

  const cleanup = () => {
    if (ripulito) return;
    ripulito = true;
    try { if (!win.isDestroyed()) win.destroy(); } catch (_) {}
    try { ses.removeListener('will-download', suDownload); } catch (_) {}
    // Svuota i dati effimeri della memoria e la rimette nel giro.
    try { Promise.resolve(ses.clearStorageData()).catch(() => {}); } catch (_) {}
    rendiPartizione(partition);
  };

  return await new Promise((resolve) => {
    let timer = null;
    let hardTimer = null;

    const done = (verdict, extra = {}) => {
      if (finished) return;
      finished = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
      cleanup();
      resolve({ verdict, finalUrl, redirects, download: downloadStarted ? (downloadName || true) : false, ...extra });
    };

    timer = setTimeout(() => done(downloadStarted ? 'dangerous' : 'clean'), timeoutMs);
    // Il tetto di vita: nessun cammino lo annulla, solo `done`. Prima, appena la
    // pagina finiva di caricare il timer di attesa veniva annullato e una
    // valutazione dell'URL finale che non tornava mai lasciava la finestra
    // viva, con JavaScript attivo, per tutta la sessione.
    // Scaduto il tetto: se un download era già partito il verdetto è certo e
    // vale; altrimenti si esce senza verdetto (null), che index.js NON mette in
    // cache — al prossimo passaggio si riprova, invece di ricordarsi per mezz'ora
    // un "pulito" che nessuno ha mai stabilito.
    hardTimer = setTimeout(() => {
      if (downloadStarted) return done('dangerous', { timedOut: true });
      if (finished) return;
      finished = true;
      if (timer) { clearTimeout(timer); timer = null; }
      hardTimer = null;
      cleanup();
      resolve(null);
    }, lifetimeMs);

    try {
      wc.on('did-redirect-navigation', (_e, u) => { if (u) { redirects.push(u); finalUrl = u; } });
      wc.on('did-navigate', (_e, u) => { if (u) finalUrl = u; });
      wc.on('did-create-window', (child) => { try { child.destroy(); } catch (_) {} }); // niente popup
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));

      wc.on('did-stop-loading', async () => {
        if (timer) { clearTimeout(timer); timer = null; }
        // Verdetto: download forzato → pericoloso. Altrimenti valuta l'URL
        // finale: se la destinazione vera è impersonazione/blacklist → pericoloso.
        if (downloadStarted) return done('dangerous');
        let verdict = 'clean';
        if (typeof evaluateFinal === 'function' && finalUrl && finalUrl !== url) {
          try {
            const v = await evaluateFinal(finalUrl);
            if (v && v.level === 'pericoloso') verdict = 'dangerous';
            else if (v && v.level === 'sospetto') verdict = 'suspicious';
          } catch (_) {}
        }
        done(verdict);
      });

      wc.on('did-fail-load', (_e, code) => {
        // -3 = ABORTED (spesso per un download intercettato): non è un errore.
        if (code === -3 && downloadStarted) return; // lascia decidere will-download/timer
      });

      wc.loadURL(url).catch(() => done(downloadStarted ? 'dangerous' : 'clean'));
    } catch (_) {
      done(null);
    }
  });
}

function creaFinestra(el, ses) {
  return new el.BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      session: ses,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: true,
      images: false,
      webgl: false,
      // niente preload: la pagina gira nuda, isolata dall'app.
    },
  });
}

module.exports = {
  detonate,
  createConcurrencyGate,
  LIMITS: { MAX_CONCURRENT, MAX_QUEUE, MAX_QUEUE_WAIT_MS, HARD_LIFETIME_MS, DETONATE_TIMEOUT_MS },
  // Quante finestre nascoste ci sono adesso, quante aspettano e quante memorie
  // isolate sono state fabbricate in tutto (diagnostica e test): quest'ultima
  // non deve crescere col numero di siti controllati, ma fermarsi al tetto.
  stats() { return { active: gate.active, queued: gate.queued, partizioni: partizioniFatte }; },
};
