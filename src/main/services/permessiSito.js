// Permessi chiesti dai siti: il gestore vero, uno per OGNI sessione che Filo
// crea (#586).
//
// Senza gestore Electron CONCEDE: un sito qualunque accendeva fotocamera e
// microfono, leggeva la posizione, mandava notifiche e leggeva gli appunti
// senza che comparisse niente. Qui ogni richiesta che non sia innocua
// (src/shared/permessiSiti.js) passa da una scelta dell'utente — la pastiglia
// della shell, con "Consenti" e "Nega" — e la scelta viene ricordata per quel
// sito. Il default, quando nessuno risponde, è NEGARE.
//
// Dove si installa: `installaSuSessione` è idempotente e viene chiamata
// dall'evento `session-created` di Electron (src/main/main.js), che scatta per
// OGNI sessione — quella di default, le partizioni effimere dell'incognito, i
// jar per-sito della modalità privacy, le schede proxate, la finestra isolata
// del safebrowse. Una partizione nuova nasce già protetta senza che nessuno si
// ricordi di chiamare niente. I punti che creano una sessione a mano la
// chiedono comunque a src/main/sessioni.js, che ripassa di qui.
//
// Cosa NON passa dalla domanda:
//   - le superfici di Filo (filo://, devtools): è l'app stessa che chiede;
//   - i permessi innocui (schermo intero, cursore, scrittura appunti, DRM);
//   - le funzioni di Filo che dentro una pagina web chiedono un permesso per
//     conto di chi le ha attivate — la dettatura (microfono) e l'Incolla
//     (appunti) — che si annunciano prima (concessioneUnaTantum): la richiesta
//     è di Filo, non del sito, e una pastiglia col nome del sito sarebbe una
//     bugia; per giunta un "Nega" spegnerebbe la funzione di Filo su quel sito.

const { BrowserWindow, desktopCapturer } = require('electron');

// La regola pura (innocui, chiavi, etichette, memoria). Letta pigramente: il
// loader dei moduli condivisi gira prima, ma questo file può essere richiesto
// da percorsi che non passano da lì (test unitari).
function P() { return globalThis.SN_PERMESSI_SITI; }

// Scelte ricordate: { "<origine>": { "<chiave>": "allow"|"deny" } }. Copia in
// memoria di settings.security.sitePermissions, tenuta allineata da
// `configureFromSettings` (chiamata a ogni salvataggio delle impostazioni) —
// serve una copia perché il gestore di CONTROLLO di Electron è sincrono e non
// può aspettare lo storage.
let mappa = {};

// Finestre in incognito: "nessuna traccia" vale anche per i permessi. Le scelte
// fatte lì vivono in RAM e muoiono con la sessione, come i cookie.
const effimere = new WeakMap(); // Session → mappa

// Richieste in attesa di risposta, per poterle chiudere quando la pagina se ne
// va (e per non impilare due pastiglie identiche).
const attese = new Map(); // id → { chiave, callbacks[], chiudi }
let prossimoId = 1;

// Concessioni una tantum chieste da Filo stesso dentro una pagina web (la
// dettatura). Valgono per UN solo uso e per pochi secondi: passata la finestra
// la richiesta torna a essere quella di un sito qualunque.
const unaTantum = new Map(); // `${wcId}|${chiave}` → scadenza (ms)
const UNA_TANTUM_MS = 15_000;

// Quanto resta in piedi una pastiglia senza risposta prima di negare. Generoso
// di proposito (chi legge una pagina non è un cronometro), ma non infinito: una
// richiesta che non si chiude mai lascia la pagina appesa e il gesto che l'ha
// scatenata ormai dimenticato. Scaduta, si NEGA senza ricordare: la volta dopo
// si richiede.
const ATTESA_MS = 2 * 60 * 1000;

function mappaDi(ses, incognito) {
  if (!incognito) return mappa;
  let m = effimere.get(ses);
  if (!m) { m = {}; effimere.set(ses, m); }
  return m;
}

function scriviMappa(ses, incognito, nuova) {
  if (incognito) { effimere.set(ses, nuova); return; }
  mappa = nuova;
  salva(nuova);
}

// Persistenza: la memoria dei permessi vive nelle impostazioni
// (settings.security.sitePermissions), così è esportabile, importabile e
// modificabile dalla pagina Sicurezza come ogni altra scelta di Filo.
async function salva(nuova) {
  try {
    const Storage = globalThis.SN_STORAGE;
    if (!Storage) return;
    const merged = await Storage.updateSettings({ security: { sitePermissions: nuova } });
    // La pagina Sicurezza aperta si riallinea da sola (stesso canale di ogni
    // altra impostazione).
    try {
      const { broadcastToTabs } = require('./handlers');
      broadcastToTabs({ type: globalThis.SN_MSG.MSG.SETTINGS_UPDATED, settings: merged });
    } catch (_) {}
  } catch (_) {}
}

// Allinea la copia in memoria a ciò che c'è nelle impostazioni. Chiamata
// all'avvio e dal choke point delle scritture (applySettingsUpdate), così una
// revoca fatta in Impostazioni vale subito, senza riavviare.
function configureFromSettings(settings) {
  try {
    mappa = P().normalizza(((settings || {}).security || {}).sitePermissions);
  } catch (_) { mappa = {}; }
}

// Dove vive una WebContents: la finestra che la possiede e la scheda, se è una
// scheda. Serve a sapere a chi mandare la pastiglia, se siamo in incognito, e
// se l'ultimo tasto era Esc (#514).
function posizione(wc) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      if (w.webContents === wc) return { win: w, tab: null };
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      const t = tm.tabs.find((x) => {
        const c = x && x.view && x.view.webContents;
        return c && !c.isDestroyed() && c.id === wc.id;
      });
      if (t) return { win: w, tab: t };
    }
  } catch (_) {}
  return { win: null, tab: null };
}

function urlRichiedente(wc, dettagli) {
  const d = dettagli || {};
  return d.requestingUrl || d.securityOrigin || (wc && !wc.isDestroyed() ? wc.getURL() : '');
}

function scadiUnaTantum() {
  const ora = Date.now();
  for (const [k, fino] of unaTantum) if (fino <= ora) unaTantum.delete(k);
}

// Filo si annuncia prima di chiedere il microfono per la dettatura dentro una
// pagina web: quella richiesta è sua, non del sito.
function concessioneUnaTantum(wc, chiave) {
  if (!wc || !chiave) return false;
  scadiUnaTantum();
  unaTantum.set(`${wc.id}|${chiave}`, Date.now() + UNA_TANTUM_MS);
  return true;
}

function consumaUnaTantum(wc, chiavi) {
  if (!wc) return false;
  scadiUnaTantum();
  const usate = [];
  for (const k of chiavi) {
    const key = `${wc.id}|${k}`;
    if (!unaTantum.has(key)) return false; // deve coprirle tutte
    usate.push(key);
  }
  if (!usate.length) return false;
  for (const key of usate) unaTantum.delete(key); // vale una volta sola
  return true;
}

// ─── la domanda all'utente ──────────────────────────────────────────────────

// Manda la pastiglia alla shell e resta in attesa. Risolve con true/false.
// Nega subito se non c'è nessuna shell a cui chiedere (finestra isolata del
// safebrowse, finestre di servizio): una richiesta che nessuno può vedere non
// può essere concessa.
function chiedi({ wc, win, tab, origine, chiavi, salvaScelta }) {
  return new Promise((resolve) => {
    const shell = win && !win.isDestroyed() ? win.webContents : null;
    if (!shell || shell.isDestroyed()) { resolve(false); return; }

    const chiaveAttesa = `${wc.id}|${origine}|${chiavi.slice().sort().join(',')}`;
    for (const att of attese.values()) {
      if (att.chiave === chiaveAttesa) { att.callbacks.push(resolve); return; }
    }

    const id = String(prossimoId++);
    const att = { chiave: chiaveAttesa, callbacks: [resolve], chiudi: null, salva: salvaScelta };
    attese.set(id, att);

    let finito = false;
    const finisci = (ok) => {
      if (finito) return;
      finito = true;
      attese.delete(id);
      clearTimeout(timer);
      try { wc.off('did-start-navigation', suNavigazione); } catch (_) {}
      try { wc.off('destroyed', suMorte); } catch (_) {}
      try {
        if (shell && !shell.isDestroyed()) shell.send('permissions:closed', { id });
      } catch (_) {}
      for (const cb of att.callbacks) { try { cb(ok); } catch (_) {} }
    };
    att.chiudi = finisci;

    // Default = negare: se la pagina se ne va, muore, o nessuno risponde entro
    // l'attesa, la richiesta cade. Nessuna di queste strade RICORDA la scelta:
    // non aver risposto non è aver detto no per sempre.
    const suNavigazione = (_e, url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) finisci(false);
    };
    const suMorte = () => finisci(false);
    try { wc.on('did-start-navigation', suNavigazione); } catch (_) {}
    try { wc.once('destroyed', suMorte); } catch (_) {}
    const timer = setTimeout(() => finisci(false), ATTESA_MS);

    const Pp = P();
    try {
      shell.send('permissions:request', {
        id,
        tabId: tab ? tab.id : null,
        origine,
        host: Pp.host(origine),
        chiavi,
        testo: Pp.etichettaRichiesta(chiavi),
        nomi: chiavi.map((k) => Pp.nome(k)),
      });
    } catch (_) { finisci(false); }
  });
}

// Risposta dell'utente dalla pastiglia. `ricorda` false = vale solo per questa
// volta (la × della pastiglia: ho chiuso, non ho deciso).
function rispondi(id, scelta, { ricorda = true } = {}) {
  const att = attese.get(String(id));
  if (!att) return { ok: false, error: 'scaduta' };
  const ok = scelta === 'allow';
  if (ricorda && typeof att.salva === 'function') att.salva(ok ? 'allow' : 'deny');
  att.chiudi(ok);
  return { ok: true };
}

// ─── il gestore ─────────────────────────────────────────────────────────────

async function decidi(wc, permesso, dettagli) {
  const Pp = P();
  const url = urlRichiedente(wc, dettagli);

  // Superfici di Filo: è l'app che chiede (dettatura, appunti dei suoi menu,
  // notifiche sue). Chiedere il permesso a chi ha appena premuto il bottone è
  // attrito, e negarlo romperebbe funzioni di Filo.
  if (Pp.interno(url)) return true;

  if (Pp.innocuo(permesso)) return true;

  // Il preambolo della condivisione dello schermo (permesso 'media' con la
  // lista dei tipi vuota) non è una richiesta di fotocamera e microfono: si
  // lascia passare perché la domanda vera la fa il gestore della cattura
  // schermo, qui sotto, che sa cosa sta per essere consegnato. Senza questo
  // ramo, a chi premeva «condividi lo schermo» comparivano due domande e la
  // prima gli faceva consentire per sempre due sensori che non aveva chiesto.
  if (Pp.preamboloSchermo(permesso, dettagli)) return true;

  const origine = Pp.origineDi(url);
  if (!origine) return false; // origine opaca (data:, blob:, file:): si nega

  const chiavi = Pp.chiaviRichieste(permesso, dettagli);
  if (!chiavi.length) return false;

  // La dettatura di Filo dentro una pagina web (vedi concessioneUnaTantum).
  if (consumaUnaTantum(wc, chiavi)) return true;

  const { win, tab } = posizione(wc);
  const incognito = !!(win && win._filoIncognito);
  const ses = wc && !wc.isDestroyed() ? wc.session : null;
  const memoria = mappaDi(ses, incognito);

  const gia = Pp.decisione(memoria, origine, chiavi);
  if (gia === 'allow') return true;
  if (gia === 'deny') return false;

  // La scrittura della memoria passa da qui: una risposta "solo per stavolta"
  // (la × della pastiglia, o l'attesa scaduta) non lascia niente nello storage.
  const salvaScelta = (scelta) => {
    try {
      scriviMappa(ses, incognito, Pp.conScelta(mappaDi(ses, incognito), origine, chiavi, scelta));
    } catch (_) {}
  };
  return chiedi({ wc, win, tab, origine, chiavi, salvaScelta });
}

// Controllo SINCRONO (navigator.permissions.query, Notification.permission,
// enumerateDevices): può solo rispondere con ciò che già si sa. Mai "sì" per
// una richiesta mai concessa — è esattamente il buco del default di Electron.
function controlla(wc, permesso, origineRichiedente, dettagli) {
  try {
    const Pp = P();
    const url = origineRichiedente || urlRichiedente(wc, dettagli);
    if (Pp.interno(url)) return true;
    if (Pp.innocuo(permesso)) return true;
    const origine = Pp.origineDi(url);
    if (!origine) return false;
    const chiavi = Pp.chiaviRichieste(permesso, dettagli);
    if (!chiavi.length) return false;
    const { win } = posizione(wc);
    const incognito = !!(win && win._filoIncognito);
    const ses = wc && !wc.isDestroyed() ? wc.session : null;
    return Pp.decisione(mappaDi(ses, incognito), origine, chiavi) === 'allow';
  } catch (_) { return false; }
}

function installaSuSessione(ses) {
  if (!ses || ses._filoPermessi) return ses;
  ses._filoPermessi = true;

  try {
    ses.setPermissionRequestHandler((wc, permesso, callback, dettagli) => {
      // #514 — l'Esc NON è un gesto con cui una pagina può prendersi lo schermo.
      // Da quando il tasto arriva al documento (serve: chiude i riquadri aperti
      // sopra la pagina), il browser lo conta come gesto dell'utente, e una
      // pagina che chiedeva lo schermo pieno dentro il proprio gestore dell'Esc
      // lo otteneva senza che nessuno avesse cliccato niente.
      if (permesso === 'fullscreen') {
        const { tab } = posizione(wc);
        if (tab && tab._ultimoInputEsc) { callback(false); return; }
      }
      decidi(wc, permesso, dettagli).then(
        (ok) => { try { callback(!!ok); } catch (_) {} },
        () => { try { callback(false); } catch (_) {} },
      );
    });
  } catch (_) {}

  try {
    ses.setPermissionCheckHandler((wc, permesso, origineRichiedente, dettagli) =>
      controlla(wc, permesso, origineRichiedente, dettagli));
  } catch (_) {}

  try {
    ses.setDisplayMediaRequestHandler(async (richiesta, callback) => {
      const nega = () => { try { callback({}); } catch (_) {} };
      try {
        // La richiesta porta il frame, non la WebContents: risaliamo alla
        // scheda che possiede quel frame.
        const frame = richiesta && richiesta.frame;
        const bersaglio = trovaWcDelFrame(frame);
        if (!bersaglio) { nega(); return; }
        const ok = await decidi(bersaglio, 'display-capture', {
          requestingUrl: (frame && frame.url) || richiesta.securityOrigin || '',
        });
        if (!ok) { nega(); return; }
        const fonti = await desktopCapturer.getSources({ types: ['screen'] });
        if (!fonti || !fonti.length) { nega(); return; }
        callback({ video: fonti[0], ...(richiesta && richiesta.audioRequested ? { audio: 'loopback' } : {}) });
      } catch (_) { nega(); }
    });
  } catch (_) {}

  return ses;
}

// Dalla WebFrameMain della richiesta di cattura schermo alla WebContents che la
// possiede: la cerchiamo fra le schede aperte confrontando il processo/frame.
function trovaWcDelFrame(frame) {
  if (!frame) return null;
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      const candidati = [w.webContents, ...((w._filoTabs && w._filoTabs.tabs) || [])
        .map((t) => t && t.view && t.view.webContents)];
      for (const c of candidati) {
        if (!c || c.isDestroyed()) continue;
        if (c.mainFrame === frame) return c;
        try {
          if (typeof c.mainFrame.framesInSubtree !== 'undefined'
            && c.mainFrame.framesInSubtree.includes(frame)) return c;
        } catch (_) {}
      }
    }
  } catch (_) {}
  return null;
}

// ─── lettura / revoca (Impostazioni, menu del tasto destro) ─────────────────

function elenco() { return P().elenco(mappa); }

function perOrigine(origine) {
  const Pp = P();
  const o = Pp.origineDi(origine);
  if (!o) return [];
  const voci = (Pp.normalizza(mappa)[o]) || {};
  return Object.keys(voci).map((chiave) => ({ chiave, nome: Pp.nome(chiave), scelta: voci[chiave] }));
}

// Toglie una scelta ricordata (o tutte quelle del sito): la prossima volta il
// sito richiede, e l'utente risceglie.
function revoca(origine, chiave) {
  const nuova = P().senza(mappa, origine, chiave || null);
  mappa = nuova;
  salva(nuova);
  return true;
}

// Cambia una scelta ricordata senza passare da una richiesta del sito: è la
// simmetria della pastiglia (se si può consentire si può negare, e viceversa)
// pretesa dalle Impostazioni.
function imposta(origine, chiave, scelta) {
  if (scelta !== 'allow' && scelta !== 'deny') return false;
  const nuova = P().conScelta(mappa, origine, [chiave], scelta);
  mappa = nuova;
  salva(nuova);
  return true;
}

// Solo per i test: stato pulito senza riavviare l'app.
function _reset() {
  mappa = {};
  attese.clear();
  unaTantum.clear();
}

module.exports = {
  installaSuSessione,
  // Solo per i test: la decisione su una richiesta, senza passare da Electron.
  _decidi: decidi,
  configureFromSettings,
  concessioneUnaTantum,
  rispondi,
  elenco,
  perOrigine,
  revoca,
  imposta,
  _reset,
  ATTESA_MS,
};
