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
  if (incognito) { effimere.set(ses, nuova); annunciaAiSiti(); return; }
  mappa = nuova;
  salva(nuova);
  annunciaAiSiti();
}

// Ogni pagina aperta riceve le scelte della PROPRIA origine, e solo quelle.
// Serve a quello che il sito legge su di sé: senza, un "nega per sempre" dato
// mentre la pagina è aperta continuava a leggersi "da chiedere" fino al
// ricaricamento. Vedi src/preload/permessi-guard.js.
function annunciaAiSiti() {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      const tm = w._filoTabs;
      if (!tm || !Array.isArray(tm.tabs)) continue;
      for (const t of tm.tabs) {
        const c = t && t.view && t.view.webContents;
        if (!c || c.isDestroyed()) continue;
        try {
          const voci = perOrigine(c.getURL(), contesto(c));
          const out = {};
          for (const v of voci) out[v.chiave] = v.scelta;
          c.send('filo:permessi-noti', out);
        } catch (_) {}
      }
    }
  } catch (_) {}
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
  annunciaAiSiti();
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
function chiedi({ wc, win, tab, origine, chiavi, salvaScelta, ricordabile = true }) {
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
        ricordabile,
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

  const origine = Pp.origineDi(url);
  if (!origine) return false; // origine opaca (data:, blob:, file:): si nega

  // Il preambolo della cattura schermo: permesso 'media' con la lista dei tipi
  // VUOTA. Non è una richiesta di fotocamera e microfono, e non va trattata
  // come tale: chiedere «vuole usare la fotocamera e il microfono» a chi ha
  // premuto «condividi lo schermo» gli fa consentire due sensori che nessuno
  // gli ha nominato. È la domanda dello SCHERMO, e va fatta qui.
  //
  // Qui non basta lasciarla passare, ed è il buco che questo ramo chiude:
  // Chromium manda questa stessa identica richiesta per DUE strade. Quella
  // moderna (`getDisplayMedia`) passa subito dopo dal gestore della cattura
  // schermo, dove Filo fa scegliere la fonte. Quella vecchia (`getUserMedia`
  // con `chromeMediaSource: 'desktop'` fra i vincoli) da quel gestore NON
  // passa: consegna lo schermo intero, e il suono del computer se lo chiede,
  // appena il permesso è concesso. Le due sono indistinguibili quando
  // arrivano, quindi la domanda si fa ADESSO, prima di concedere: chi apre
  // qui apre anche la strada vecchia, e lì non chiede più niente nessuno.
  // Negarla e basta non è un'uscita: spegne anche la condivisione vera,
  // perché il gestore della cattura schermo non viene nemmeno chiamato.
  const preambolo = Pp.preamboloSchermo(permesso, dettagli);

  const chiavi = preambolo
    ? [Pp.CHIAVI.SCHERMO]
    : Pp.chiaviRichieste(permesso, dettagli);
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
  // I permessi che non si ricordano (lo schermo) non hanno niente da scrivere:
  // lì la pastiglia lo dice, così chi risponde sa che vale per questa volta.
  const memorizzabili = chiavi.filter((k) => Pp.siRicorda(k));
  const salvaScelta = memorizzabili.length ? (scelta) => {
    try {
      scriviMappa(ses, incognito, Pp.conScelta(mappaDi(ses, incognito), origine, memorizzabili, scelta));
    } catch (_) {}
  } : null;
  const ok = await chiedi({ wc, win, tab, origine, chiavi, salvaScelta, ricordabile: !!salvaScelta });

  // Il sì al preambolo vale per la cattura schermo che segue, qualunque delle
  // due strade prenda: la moderna passa dal gestore qui sotto e lì non si
  // richiede (`consumaPreambolo`), la vecchia consegna e basta. In tutti e due
  // i casi da qui parte il segno che la ripresa è in corso: è l'unica cosa che
  // la strada vecchia lascia vedere a chi usa Filo.
  if (preambolo && ok) segnaPreambolo(wc, origine);
  return ok;
}

// ─── il preambolo consentito, e il segno che lo schermo è ripreso ───────────

// Chi ha appena detto sì alla domanda dello schermo, per pochi secondi: il
// gestore della cattura schermo lo consuma e va dritto alla scelta della fonte
// invece di richiedere la stessa cosa due volte di fila.
const preamboli = new Map(); // wcId → { fino, timer, ripresaId }
const PREAMBOLO_MS = 20_000;

// Passato questo tempo dal sì, se il gestore della cattura schermo non si è
// fatto vivo la strada era quella vecchia: lo schermo è già stato consegnato
// senza passare da nessuna scelta della fonte, e il segno «può vedere il tuo
// schermo» va acceso lo stesso — altrimenti proprio la strada silenziosa
// resterebbe l'unica senza nemmeno un segno.
const SENZA_GESTORE_MS = 1500;

function segnaPreambolo(wc, origine) {
  if (!wc) return;
  const ora = Date.now();
  for (const [k, v] of preamboli) {
    if (v.fino <= ora) { clearTimeout(v.timer); preamboli.delete(k); }
  }
  const voce = { fino: ora + PREAMBOLO_MS, timer: null, ripresaId: null };
  voce.timer = setTimeout(() => {
    const attuale = preamboli.get(wc.id);
    if (attuale !== voce || voce.ripresaId) return;
    // Strada vecchia: non passa dalla scelta della fonte, quindi Filo non può
    // sapere se il sito si è preso anche l'audio del computer né toglierglielo
    // (la richiesta arriva identica a quella senza audio, e il permesso è uno
    // solo: sì o no). Qui il segno dice la cosa più grande delle due, perché
    // «può» al posto di «sta» è già il modo in cui questo segno parla: dire
    // solo «vede» quando potrebbe anche sentire sarebbe la bugia peggiore.
    voce.ripresaId = iniziaRipresa(wc, origine, { audio: 'forse' });
  }, SENZA_GESTORE_MS);
  if (voce.timer.unref) voce.timer.unref();
  preamboli.set(wc.id, voce);
}

function consumaPreambolo(wc) {
  if (!wc) return null;
  const v = preamboli.get(wc.id);
  if (!v) return null;
  preamboli.delete(wc.id);
  clearTimeout(v.timer);
  if (v.fino > Date.now()) return v;
  if (v.ripresaId) fineRipresa(v.ripresaId);
  return null;
}

// Riprese dello schermo in corso. Una webcam accesa si vede e un microfono
// aperto prima o poi si sente; lo schermo ripreso non lascia nessun segno, e
// senza questo un sito continua a filmare e chi usa Filo non ha modo di
// saperlo né di fermarlo. Il segno dice «può vedere», non «sta vedendo»,
// perché quando il sito smette da solo nessuno ce lo dice: la sola cosa certa
// è che finché quella pagina è lì il permesso ce l'ha ancora. «Interrompi»
// ricarica la pagina, che è l'unico modo di chiudere la ripresa per davvero.
const riprese = new Map(); // id → { wc, shell, pulisci }
let prossimaRipresa = 1;

function iniziaRipresa(wc, origine, opzioni) {
  try {
    const { win, tab } = posizione(wc);
    const shell = win && !win.isDestroyed() ? win.webContents : null;
    if (!shell || shell.isDestroyed()) return null;
    const id = String(prossimaRipresa++);
    const suNavigazione = (_e, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) fineRipresa(id);
    };
    const suMorte = () => fineRipresa(id);
    try { wc.on('did-start-navigation', suNavigazione); } catch (_) {}
    try { wc.once('destroyed', suMorte); } catch (_) {}
    riprese.set(id, {
      wc,
      shell,
      pulisci: () => {
        try { wc.off('did-start-navigation', suNavigazione); } catch (_) {}
        try { wc.off('destroyed', suMorte); } catch (_) {}
      },
    });
    shell.send('permissions:capture-start', {
      id,
      tabId: tab ? tab.id : null,
      host: P().host(origine),
      // 'no' = solo l'immagine; 'si' = anche l'audio del computer, e l'utente
      // l'ha scelto; 'forse' = strada vecchia, dove non si può sapere.
      audio: (opzioni && opzioni.audio) || 'no',
    });
    return id;
  } catch (_) { return null; }
}

function fineRipresa(id) {
  const r = riprese.get(String(id));
  if (!r) return { ok: false };
  riprese.delete(String(id));
  try { r.pulisci(); } catch (_) {}
  try { if (r.shell && !r.shell.isDestroyed()) r.shell.send('permissions:capture-end', { id: String(id) }); } catch (_) {}
  return { ok: true };
}

// «Interrompi»: ricaricare la pagina distrugge il documento e con lui la
// ripresa. È brutale e lo dice il suggerimento del bottone, ma è l'unica via
// che chiude davvero: da qui non si può spegnere una traccia già consegnata.
function interrompiRipresa(id) {
  const r = riprese.get(String(id));
  if (!r) return { ok: false, error: 'finita' };
  try { if (r.wc && !r.wc.isDestroyed()) r.wc.reload(); } catch (_) {}
  return fineRipresa(id);
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
        const url = (frame && frame.url) || richiesta.securityOrigin || '';
        // La domanda l'ha già fatta il preambolo, un attimo fa: richiedere la
        // stessa cosa due volte di fila è attrito, e la seconda domanda
        // sembrerebbe una cosa diversa dalla prima.
        const pre = consumaPreambolo(bersaglio);
        const ok = pre ? true : await decidi(bersaglio, 'display-capture', { requestingUrl: url });
        if (!ok) { nega(); return; }
        // Consentito: ora CHE COSA. Consegnare sempre lo schermo intero
        // significa mostrare anche le notifiche che arrivano e tutto quello
        // che c'è aperto dietro, a chi voleva far vedere una diapositiva.
        //
        // E QUANTO. Un sito che chiede lo schermo può chiedere anche l'audio
        // del computer, che non è lo schermo: è la musica, un video, la
        // chiamata che stai facendo in un'altra finestra, la voce di chi ti
        // parla. Prima arrivava insieme all'immagine senza che niente lo
        // nominasse e senza un modo di dare l'una senza l'altro (#586). Ora è
        // una scelta a parte dentro il riquadro, e parte da spenta.
        const scelta = await scegliFonte(bersaglio, frame, !!(richiesta && richiesta.audioRequested));
        if (!scelta) {
          // Annullato qui: il sì di un attimo fa non vale più niente, e un
          // eventuale segno della ripresa va tolto o resterebbe a mentire.
          if (pre && pre.ripresaId) fineRipresa(pre.ripresaId);
          nega();
          return;
        }
        // Il segno parte ADESSO, che è quando il sito comincia davvero a
        // vedere: prima della scelta della fonte non vede ancora niente. Se il
        // segno prudente della strada vecchia era già partito (il sito ci ha
        // messo più di un attimo ad arrivare qui), lo rifacciamo: adesso
        // sappiamo per certo se l'audio c'è o no, e il segno lo deve dire.
        if (pre && pre.ripresaId) fineRipresa(pre.ripresaId);
        iniziaRipresa(bersaglio, P().origineDi(url) || url, { audio: scelta.audio ? 'si' : 'no' });
        callback({ video: scelta.fonte, ...(scelta.audio ? { audio: 'loopback' } : {}) });
      } catch (_) { nega(); }
    });
  } catch (_) {}

  return ses;
}

// ─── che cosa si condivide ──────────────────────────────────────────────────

// Scelte della fonte in attesa: id → { risolvi }.
const scelteFonte = new Map();
let prossimaScelta = 1;

// Dopo il «Consenti» arriva la seconda mezza domanda: tutto lo schermo, o una
// finestra sola? Torna la fonte scelta, oppure null (annullato, nessuna fonte,
// nessuna shell a cui chiedere, o due minuti senza risposta).
async function scegliFonte(wc, frame) {
  const { win, tab } = posizione(wc);
  const shell = win && !win.isDestroyed() ? win.webContents : null;
  if (!shell || shell.isDestroyed()) return null;

  let fonti = [];
  try {
    fonti = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: false,
    });
  } catch (_) { return null; }
  if (!fonti || !fonti.length) return null;

  const Pp = P();
  const url = (frame && frame.url) || (wc && !wc.isDestroyed() ? wc.getURL() : '');
  const host = Pp.host(Pp.origineDi(url) || '');

  const id = String(prossimaScelta++);
  // I nomi degli SCHERMI arrivano dal sistema in inglese («Entire screen»,
  // «Screen 1») e restavano così dentro una Filo tutta in italiano, sotto una
  // frase italiana. Li scriviamo noi. I nomi delle FINESTRE no: quelli sono il
  // titolo vero della finestra (un documento, un programma) e tradurli
  // significherebbe non farla più riconoscere.
  const nomiSchermi = Pp.nomiDegliSchermi(fonti.map((f) => f.id));
  const voci = fonti.map((f) => ({
    id: f.id,
    nome: nomiSchermi[f.id] || f.name || 'Una finestra',
    schermo: !!nomiSchermi[f.id],
    anteprima: (() => { try { return f.thumbnail.toDataURL(); } catch (_) { return ''; } })(),
  }));

  return new Promise((resolve) => {
    let finito = false;
    const finisci = (fonteId) => {
      if (finito) return;
      finito = true;
      scelteFonte.delete(id);
      clearTimeout(timer);
      try { wc.off('destroyed', suMorte); } catch (_) {}
      try { if (shell && !shell.isDestroyed()) shell.send('permissions:source-closed', { id }); } catch (_) {}
      resolve(fonteId ? (fonti.find((f) => f.id === fonteId) || null) : null);
    };
    const suMorte = () => finisci(null);
    try { wc.once('destroyed', suMorte); } catch (_) {}
    const timer = setTimeout(() => finisci(null), ATTESA_MS);
    scelteFonte.set(id, { finisci });
    try {
      // `tabId`: la scelta appartiene alla scheda che l'ha chiesta, come la
      // pastiglia. Senza, restava sopra la scheda su cui si passava, col nome
      // di un sito che non era quello che si stava guardando, e un clic lì
      // consegnava lo schermo a quell'altro sito.
      shell.send('permissions:pick-source', { id, tabId: tab ? tab.id : null, host, voci });
    } catch (_) { finisci(null); }
  });
}

// Risposta della shell: l'id della fonte scelta, o niente per annullare.
function scegliFonteRisposta(id, fonteId) {
  const att = scelteFonte.get(String(id));
  if (!att) return { ok: false, error: 'scaduta' };
  att.finisci(fonteId || null);
  return { ok: true };
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

// Da una shell (la finestra che chiede) alla memoria giusta. In incognito le
// scelte vivono in RAM e muoiono con la finestra, ma si devono poter RIVEDERE e
// TOGLIERE finché la finestra è aperta: se si può dare si può togliere, anche
// quando la scelta dura una sessione sola. Prima leggevano tutte la memoria su
// disco, e in incognito l'elenco tornava vuoto: l'unico modo di disdire era
// chiudere la finestra.
// Vale sia per la shell di una finestra (il tasto destro sulla scheda) sia per
// una pagina dentro una scheda (il preload che chiede cosa è già stato deciso).
function contesto(wc) {
  try {
    const { win, tab } = posizione(wc);
    if (!win) return { ses: null, incognito: false };
    if (!win._filoIncognito) return { ses: null, incognito: false };
    let c = tab && tab.view && tab.view.webContents;
    if (!c || c.isDestroyed()) {
      const tm = win._filoTabs;
      const t = tm && Array.isArray(tm.tabs)
        ? (tm.tabs.find((x) => x.id === tm.activeId) || tm.tabs[0]) : null;
      c = t && t.view && t.view.webContents;
    }
    return { ses: c && !c.isDestroyed() ? c.session : null, incognito: true };
  } catch (_) {}
  return { ses: null, incognito: false };
}

function memoriaDi(ctx) {
  const c = ctx || {};
  return c.incognito ? mappaDi(c.ses, true) : mappa;
}

function elenco(ctx) { return P().elenco(memoriaDi(ctx)); }

function perOrigine(origine, ctx) {
  const Pp = P();
  const o = Pp.origineDi(origine);
  if (!o) return [];
  const voci = (Pp.normalizza(memoriaDi(ctx))[o]) || {};
  return Object.keys(voci).map((chiave) => ({ chiave, nome: Pp.nome(chiave), scelta: voci[chiave] }));
}

// Toglie una scelta ricordata (o tutte quelle del sito): la prossima volta il
// sito richiede, e l'utente risceglie.
function revoca(origine, chiave, ctx) {
  const c = ctx || {};
  const nuova = P().senza(memoriaDi(c), origine, chiave || null);
  scriviMappa(c.incognito ? c.ses : null, !!c.incognito, nuova);
  return true;
}

// Cambia una scelta ricordata senza passare da una richiesta del sito: è la
// simmetria della pastiglia (se si può consentire si può negare, e viceversa)
// pretesa dalle Impostazioni.
function imposta(origine, chiave, scelta, ctx) {
  if (scelta !== 'allow' && scelta !== 'deny') return false;
  const c = ctx || {};
  const nuova = P().conScelta(memoriaDi(c), origine, [chiave], scelta);
  scriviMappa(c.incognito ? c.ses : null, !!c.incognito, nuova);
  return true;
}

// Solo per i test: stato pulito senza riavviare l'app.
function _reset() {
  mappa = {};
  attese.clear();
  unaTantum.clear();
  scelteFonte.clear();
  preamboli.clear();
  for (const id of [...riprese.keys()]) fineRipresa(id);
}

module.exports = {
  installaSuSessione,
  // Solo per i test: la decisione su una richiesta, senza passare da Electron.
  _decidi: decidi,
  configureFromSettings,
  concessioneUnaTantum,
  rispondi,
  contesto,
  scegliFonteRisposta,
  interrompiRipresa,
  elenco,
  perOrigine,
  revoca,
  imposta,
  _reset,
  ATTESA_MS,
};
