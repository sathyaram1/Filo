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
//
// Resta solo il microfono. Gli appunti dell'Incolla sono usciti di qui: li legge
// il main e li consegna a chi ha premuto Incolla, perché una concessione che non
// porta il nome di chi l'ha chiesta vale per la PRIMA richiesta che arriva in
// quella scheda, e un sito che chiedeva gli appunti in continuazione se la
// prendeva lui (#586, giro 6). Per il microfono la stessa corsa resta possibile
// in teoria, e qui sotto si chiude togliendo la concessione quando qualcuno la
// sta aspettando: vedi `qualcunoInAttesaDi`.
const unaTantum = new Map(); // `${wcId}|${chiave}` → scadenza (ms)
// Stretta al minimo: chi si annuncia chiama sull'istante, e ogni secondo in più
// è un secondo in cui qualcun altro può passare per primo.
const UNA_TANTUM_MS = 4_000;

// Quando un sito ha chiesto l'ultima volta quella cosa, in quella scheda. Serve
// solo a capire se c'è una corsa in corso nel momento in cui Filo si annuncia.
const ultimaRichiesta = new Map(); // `${wcId}|${chiave}` → ms
const CORSA_MS = 1_500;

function segnaRichiesta(wc, chiavi) {
  if (!wc) return;
  const ora = Date.now();
  for (const k of chiavi) ultimaRichiesta.set(`${wc.id}|${k}`, ora);
  // L'elenco non cresce all'infinito: si pota quello che è vecchio.
  for (const [key, quando] of [...ultimaRichiesta]) {
    if (ora - quando > 60_000) ultimaRichiesta.delete(key);
  }
}

// C'è già qualcuno che aspetta quella cosa in quella scheda? Due segnali: una
// domanda aperta adesso, o una richiesta arrivata un attimo fa. In tutt'e due i
// casi la concessione di Filo NON si arma: se si armasse, il primo a chiedere se
// la prenderebbe, e il primo può essere il sito che sta lì ad aspettarla. Senza
// concessione non si perde niente di garantito — la richiesta di Filo passa dalla
// domanda come le altre — e soprattutto nessuno si porta via un sensore senza che
// l'utente abbia risposto.
function qualcunoInAttesaDi(wc, chiave) {
  if (!wc) return false;
  const ultima = ultimaRichiesta.get(`${wc.id}|${chiave}`) || 0;
  if (Date.now() - ultima < CORSA_MS) return true;
  for (const att of attese.values()) {
    if (att.chiave && att.chiave.startsWith(`${wc.id}|`) && att.chiavi.includes(chiave)) return true;
  }
  return false;
}

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
        // A OGNI riquadro, ciascuno con le scelte della SUA origine. Con un
        // invio solo arrivava al riquadro principale e basta, e un widget dentro
        // un riquadro incorporato restava con quello che aveva letto al
        // caricamento (#586, giro 6).
        try {
          const ctx = contesto(c);
          const mandaA = (frame, url) => {
            try {
              const voci = perOrigine(url, ctx);
              const out = {};
              for (const v of voci) out[v.chiave] = v.scelta;
              frame.send('filo:permessi-noti', out);
            } catch (_) {}
          };
          const principale = c.mainFrame;
          const sopra = c.getURL();
          const frames = (principale && principale.framesInSubtree)
            ? principale.framesInSubtree.filter((f) => f && !f.detached)
            : (principale ? [principale] : []);
          for (const f of frames) {
            // Un riquadro senza indirizzo suo eredita l'origine della pagina.
            const suo = P().origineDi(f.url) ? f.url : sopra;
            mandaA(f, suo);
          }
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

// Chi sta chiedendo, come indirizzo confrontabile.
//
// Un riquadro incorporato SCRITTO DALLA PAGINA (`about:blank`, `srcdoc`) non ha
// un indirizzo suo: per il browser ha l'origine di chi lo ospita ed è lo stesso
// sito. Prendendo alla lettera il suo indirizzo non ne usciva nessuna origine, e
// la richiesta veniva negata in silenzio — nessuna domanda, nessuna scelta
// registrata, quindi in Impostazioni niente da ribaltare e nessun punto in cui
// rimediare. Il lettore video, il modulo di pagamento e la finestra della
// videochiamata vivono proprio lì, e non funzionavano nemmeno dopo un sì dato
// alla pagina che li ospita (#586, giro 6).
//
// Quindi si prova in ordine: l'indirizzo del riquadro, l'origine che il browser
// gli attribuisce, e infine l'indirizzo della pagina. Un riquadro con
// un'origine OPACA (un riquadro in sandbox, un `data:`) non ha né l'una né
// l'altra e resta negato: quello non è lo stesso sito di nessuno.
function buonaPerChiedere(url) {
  const Pp = P();
  const s = String(url || '');
  if (!s || s === 'null') return false;
  return Pp.interno(s) || !!Pp.origineDi(s);
}

function urlRichiedente(wc, dettagli) {
  const d = dettagli || {};
  const candidati = [
    d.requestingUrl,
    d.securityOrigin,
    wc && !wc.isDestroyed() ? wc.getURL() : '',
  ];
  for (const c of candidati) if (buonaPerChiedere(c)) return c;
  return candidati[0] || '';
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
  // Qualcuno sta già aspettando quella cosa in questa scheda: la concessione non
  // si arma, o se la prenderebbe lui (#586, giro 6).
  if (qualcunoInAttesaDi(wc, chiave)) return false;
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
    if (!shell || shell.isDestroyed()) { resolve({ ok: false, deciso: true }); return; }

    const chiaveAttesa = `${wc.id}|${origine}|${chiavi.slice().sort().join(',')}`;
    for (const att of attese.values()) {
      if (att.chiave === chiaveAttesa) { att.callbacks.push(resolve); return; }
    }

    const id = String(prossimoId++);
    const att = {
      chiave: chiaveAttesa, chiavi: chiavi.slice(), callbacks: [resolve], chiudi: null, salva: salvaScelta,
    };
    attese.set(id, att);

    let finito = false;
    // `deciso`: l'utente ha premuto Consenti o Nega. La × e l'attesa scaduta
    // chiudono senza decidere, e sono quelle che contano per l'anello.
    const finisci = (ok, deciso) => {
      if (finito) return;
      finito = true;
      attese.delete(id);
      clearTimeout(timer);
      try { wc.off('did-start-navigation', suNavigazione); } catch (_) {}
      try { wc.off('destroyed', suMorte); } catch (_) {}
      try {
        if (shell && !shell.isDestroyed()) shell.send('permissions:closed', { id });
      } catch (_) {}
      for (const cb of att.callbacks) { try { cb({ ok: !!ok, deciso: !!deciso }); } catch (_) {} }
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
        // I nomi tecnici dei permessi che Filo non sa nominare. Nella domanda
        // non ci vanno (chi la legge non li capisce), nel suggerimento sì: chi
        // li sa leggere li trova passandoci sopra.
        tecnici: Pp.tecnici(chiavi),
        ricordabile,
      });
    } catch (_) { finisci(false, true); }
  });
}

// Risposta dell'utente dalla pastiglia. `ricorda` false = vale solo per questa
// volta (la × della pastiglia: ho chiuso, non ho deciso).
function rispondi(id, scelta, { ricorda = true } = {}) {
  const att = attese.get(String(id));
  if (!att) return { ok: false, error: 'scaduta' };
  const ok = scelta === 'allow';
  if (ricorda && typeof att.salva === 'function') att.salva(ok ? 'allow' : 'deny');
  att.chiudi(ok, ricorda);
  return { ok: true };
}

// ─── il sito che non la smette ──────────────────────────────────────────────
//
// La × chiude senza ricordare niente, ed è giusto: chi l'ha premuta non ha
// deciso. Ma il sito può richiedere subito, e la pastiglia torna. Una pagina
// che richiede ogni decimo di secondo tiene la domanda incollata sotto le
// schede: spinge giù il sito, non si toglie, e l'unica uscita era andarsene
// (#586, giro 5).
//
// Dopo tre domande chiuse senza rispondere, Filo smette di chiedere per quel
// sito su QUELLA pagina. Non è un «no per sempre»: niente resta scritto, e la
// pagina che riparte (un ricaricamento, un link) ricomincia da capo. È la via
// d'uscita, ed è quella che si trova da sé.
// Il conto è per COSA CHIESTA, non per sito: chi ha chiuso tre volte la domanda
// della fotocamera non deve ritrovarsi zittita anche la posizione, che è
// un'altra cosa e che magari ha appena chiesto lui premendo «trovami» (#586,
// giro 6).
//
// E quando Filo smette, lo DICE: una riga sulla scheda con un modo per tornare
// indietro. Prima non compariva niente, il gesto appena fatto non produceva
// nulla e l'unica via d'uscita era ricaricare la pagina, che nessuno può
// indovinare.
const senzaRisposta = new Map(); // `${wcId}|${origine}|${chiave}` → numero
const SENZA_RISPOSTA_MAX = 3;
// Le righe «ho smesso di chiedere» aperte adesso: id → { wc, origine, chiavi }.
const anelliDetti = new Map();

function chiaveAnello(wc, origine, chiave) { return `${wc.id}|${origine}|${chiave}`; }

function dimenticaAnello(wc, chiave) {
  const prefisso = chiave === undefined ? `${wc.id}|` : null;
  for (const key of [...senzaRisposta.keys()]) {
    if (prefisso ? key.startsWith(prefisso) : key === chiave) senzaRisposta.delete(key);
  }
}

function segnaSenzaRisposta(wc, origine, chiavi) {
  for (const c of chiavi) {
    const k = chiaveAnello(wc, origine, c);
    senzaRisposta.set(k, (senzaRisposta.get(k) || 0) + 1);
  }
  if (wc._filoPermessiAnello) return;
  wc._filoPermessiAnello = true;
  const pulisci = (_e, _url, inPlace, isMainFrame) => {
    if (!isMainFrame || inPlace) return;
    dimenticaAnello(wc);
  };
  try { wc.on('did-start-navigation', pulisci); } catch (_) {}
  try { wc.once('destroyed', () => dimenticaAnello(wc)); } catch (_) {}
}

function troppeSenzaRisposta(wc, origine, chiavi) {
  return chiavi.every((c) => (senzaRisposta.get(chiaveAnello(wc, origine, c)) || 0) >= SENZA_RISPOSTA_MAX);
}

function scordaRisposte(wc, origine, chiavi) {
  for (const c of chiavi) senzaRisposta.delete(chiaveAnello(wc, origine, c));
}

// La riga che dice che Filo ha smesso di chiedere, con il modo per tornare
// indietro. Una per scheda e sito: un sito che insiste non deve impilarne dieci.
function diciCheHoSmesso(wc, origine, chiavi) {
  try {
    for (const v of anelliDetti.values()) {
      if (v.wc === wc && v.origine === origine) return;
    }
    const { win, tab } = posizione(wc);
    const shell = win && !win.isDestroyed() ? win.webContents : null;
    if (!shell || shell.isDestroyed()) return;
    const Pp = P();
    const id = `anello${prossimoAvviso++}`;
    anelliDetti.set(id, { wc, origine, chiavi: chiavi.slice() });
    const togli = () => {
      if (!anelliDetti.has(id)) return;
      anelliDetti.delete(id);
      try { if (shell && !shell.isDestroyed()) shell.send('permissions:notice-end', { id }); } catch (_) {}
    };
    const suNavigazione = (_e, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) togli(); };
    try { wc.on('did-start-navigation', suNavigazione); } catch (_) {}
    try { wc.once('destroyed', togli); } catch (_) {}
    shell.send('permissions:notice', {
      id,
      tabId: tab ? tab.id : null,
      testo: `Ho smesso di chiedere per ${Pp.host(origine)}: le ultime domande le hai chiuse senza rispondere.`,
      azione: { testo: 'Chiedimelo di nuovo', tip: 'Le prossime richieste di questo sito tornano a comparire' },
    });
  } catch (_) {}
}

// «Chiedimelo di nuovo»: il conto torna a zero e la riga se ne va. Non concede
// niente a nessuno, riapre solo la possibilità di essere chiesti.
function riprendiAChiedere(id) {
  const v = anelliDetti.get(String(id));
  if (!v) return { ok: false };
  anelliDetti.delete(String(id));
  try { dimenticaAnello(v.wc); } catch (_) {}
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

  // Da qui in giù la richiesta è del sito: si segna, così se Filo si annuncia
  // mentre il sito sta chiedendo la stessa cosa la concessione non si arma.
  segnaRichiesta(wc, chiavi);

  const { win, tab } = posizione(wc);
  const incognito = !!(win && win._filoIncognito);
  const ses = wc && !wc.isDestroyed() ? wc.session : null;
  const memoria = mappaDi(ses, incognito);

  const gia = Pp.decisione(memoria, origine, chiavi);
  if (gia === 'allow') { segnaSensori(wc, origine, chiavi); return true; }
  if (gia === 'deny') return false;

  // La scrittura della memoria passa da qui: una risposta "solo per stavolta"
  // (la × della pastiglia, o l'attesa scaduta) non lascia niente nello storage.
  // I permessi che non si ricordano (lo schermo) non hanno niente da scrivere:
  // lì la pastiglia lo dice, così chi risponde sa che vale per questa volta.
  // Il sito ha già fatto comparire tre domande che chi naviga ha chiuso senza
  // rispondere: su questa pagina non se ne fanno altre (vedi l'anello qui
  // sotto). Non resta scritto niente: la pagina che riparte ricomincia da capo.
  if (troppeSenzaRisposta(wc, origine, chiavi)) { diciCheHoSmesso(wc, origine, chiavi); return false; }

  const memorizzabili = chiavi.filter((k) => Pp.siRicorda(k));
  const salvaScelta = memorizzabili.length ? (scelta) => {
    try {
      scriviMappa(ses, incognito, Pp.conScelta(mappaDi(ses, incognito), origine, memorizzabili, scelta));
    } catch (_) {}
  } : null;
  const esito = await chiedi({ wc, win, tab, origine, chiavi, salvaScelta, ricordabile: !!salvaScelta });
  const ok = !!(esito && esito.ok);
  if (esito && !esito.deciso) segnaSenzaRisposta(wc, origine, chiavi);
  else scordaRisposte(wc, origine, chiavi);

  // Il sì al preambolo vale per la cattura schermo che segue, qualunque delle
  // due strade prenda: la moderna passa dal gestore qui sotto e lì non si
  // richiede (`consumaPreambolo`), la vecchia consegna e basta. In tutti e due
  // i casi da qui parte il segno che la ripresa è in corso: è l'unica cosa che
  // la strada vecchia lascia vedere a chi usa Filo.
  if (preambolo && ok) segnaPreambolo(wc, origine);
  if (ok) segnaSensori(wc, origine, chiavi);
  return ok;
}

// Fotocamera e microfono appena concessi: accendi il cartello che lo dice.
// Vale sia per il sì appena dato sia per una scelta ricordata da prima, perché
// il sito sta chiedendo il sensore adesso in tutti e due i casi. Il cartello
// muore con la pagina (navigazione, scheda chiusa), con «Interrompi» o con la
// revoca del permesso.
function segnaSensori(wc, origine, chiavi) {
  try {
    const Pp = P();
    const sensori = chiavi.filter((k) => k === Pp.CHIAVI.FOTOCAMERA || k === Pp.CHIAVI.MICROFONO);
    if (!sensori.length) return;
    // Un sito che prima ottiene il microfono e poi anche la fotocamera deve
    // ritrovarsi un cartello solo che le nomina tutte e due, non due cartelli
    // accanto né uno che ne dice metà.
    const gia = usoEsistente(wc, origine, 'sensori');
    const tutte = gia
      ? [...usi.get(gia).chiavi, ...sensori.filter((k) => !usi.get(gia).chiavi.includes(k))]
      : sensori;
    iniziaUso(wc, origine, tutte, { tipo: 'sensori' });
  } catch (_) {}
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
    //
    // E non sa nemmeno se la cattura sia partita: se fallisce (su Mac basta che
    // manchi il permesso di sistema) al sito non arriva niente e questo
    // cartello resta acceso a dire il contrario. Per questo, e solo per questo,
    // porta una × che lo chiude senza ricaricare la pagina (#586, giro 4).
    voce.ripresaId = iniziaUso(wc, origine, [P().CHIAVI.SCHERMO], {
      audioSistema: true, chiudibile: true,
    });
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
  if (v.ripresaId) fineUso(v.ripresaId);
  return null;
}

// Quello che un sito PUÒ fare adesso, mentre lo può fare: la ripresa dello
// schermo, la fotocamera, il microfono.
//
// Lo schermo ripreso non lascia nessun segno, e senza questo cartello un sito
// continua a filmare e chi usa Filo non ha modo di saperlo né di fermarlo. Per
// fotocamera e microfono valeva la stessa cosa: qui c'era scritto che «una
// webcam accesa si vede e un microfono aperto prima o poi si sente», ma su un
// fisso e su quasi tutti i portatili il microfono non accende nessuna spia, e
// il sito ascoltava finché la pagina restava aperta senza che comparisse niente
// (#586, giro 4). Adesso il cartello vale per tutte e tre.
//
// Il cartello dice «può», non «sta»: quando il sito smette da solo nessuno ce
// lo dice, e la sola cosa certa è che finché quella pagina è lì il permesso ce
// l'ha ancora. «Interrompi» ricarica la pagina, che è l'unico modo di chiudere
// per davvero: da qui non si spegne una traccia già consegnata.
const usi = new Map(); // id → { wc, shell, origine, chiavi, tipo, frase, incognito, pulisci }
let prossimoUso = 1;

// Un cartello per scheda, sito e tipo: un sito che riapre il microfono dieci
// volte non impila dieci cartelli identici, e uno che chiede prima il microfono
// e poi anche la fotocamera si ritrova un cartello solo che le nomina tutte e
// due invece di due cartelli accanto.
function usoEsistente(wc, origine, tipo) {
  for (const [id, u] of usi) {
    if (u.wc === wc && u.origine === origine && u.tipo === tipo) return id;
  }
  return null;
}

// `chiudibile`: il cartello si può togliere con una ×. Vale solo dove Filo sta
// TIRANDO A INDOVINARE, cioè sulla strada vecchia dello schermo, che non passa
// da nessun gestore e non dice mai se la cattura sia partita davvero. Lì il
// cartello si accendeva anche quando al sito non era arrivato niente, e non se
// ne andava più (#586, giro 4). Dove Filo sa (la fotocamera, il microfono, la
// cattura moderna) la × non c'è: un avviso vero non si toglie di mezzo.
function iniziaUso(wc, origine, chiavi, opzioni) {
  try {
    const o = opzioni || {};
    const { win, tab } = posizione(wc);
    const shell = win && !win.isDestroyed() ? win.webContents : null;
    if (!shell || shell.isDestroyed()) return null;
    const tipo = o.tipo || 'schermo';
    const frase = P().frasePotere(chiavi, !!o.audioSistema);
    // Ce n'è già uno per questa scheda, questo sito e questo tipo: se dice
    // ancora la cosa giusta lo si lascia stare, se il sito nel frattempo ha
    // ottenuto di più lo si rifà con la frase nuova.
    const gia = usoEsistente(wc, origine, tipo);
    if (gia) {
      if (usi.get(gia).frase === frase) return gia;
      fineUso(gia);
    }
    const id = String(prossimoUso++);
    const suNavigazione = (_e, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) fineUso(id);
    };
    const suMorte = () => fineUso(id);
    try { wc.on('did-start-navigation', suNavigazione); } catch (_) {}
    try { wc.once('destroyed', suMorte); } catch (_) {}
    usi.set(id, {
      wc,
      shell,
      origine,
      tipo,
      frase,
      chiavi: chiavi.slice(),
      incognito: !!(win && win._filoIncognito),
      pulisci: () => {
        try { wc.off('did-start-navigation', suNavigazione); } catch (_) {}
        try { wc.off('destroyed', suMorte); } catch (_) {}
      },
    });
    shell.send('permissions:capture-start', {
      id,
      tabId: tab ? tab.id : null,
      host: P().host(origine),
      frase,
      chiudibile: !!o.chiudibile,
    });
    return id;
  } catch (_) { return null; }
}

function fineUso(id) {
  const r = usi.get(String(id));
  if (!r) return { ok: false };
  usi.delete(String(id));
  try { r.pulisci(); } catch (_) {}
  try { if (r.shell && !r.shell.isDestroyed()) r.shell.send('permissions:capture-end', { id: String(id) }); } catch (_) {}
  return { ok: true };
}

// ─── chiudere quello che il sito ha già in mano ─────────────────────────────
//
// Prima qui c'era solo `wc.reload()`: l'unica strada che il main ha per far
// sparire una traccia già consegnata. Funziona, e costa tutto quello che chi
// naviga stava facendo in quella pagina — il commento a metà, il modulo
// compilato, il punto in cui era arrivato a leggere (#586, giro 5). Chi va a
// togliere un permesso lo fa per una questione di privacy e non si aspetta di
// pagarla così.
//
// Adesso si chiede prima alla pagina di fermare le proprie tracce
// (src/preload/permessi-guard.js tiene il conto di quelle che le sono state
// consegnate). Per un sito qualunque le tracce muoiono e non si perde niente.
// La ricarica resta per chi non risponde o resta vivo lo stesso, cioè per una
// pagina che ha fatto di tutto per non passare di lì: la garanzia del giro 4
// («togliere deve togliere anche quello che ha già in mano») non si scuce.
// La domanda va a OGNI riquadro della pagina, non solo a quello principale. Una
// traccia presa da un riquadro incorporato — il widget della videochiamata, il
// lettore, il modulo dentro la pagina — vive lì dentro, e il riquadro principale
// non ne sa niente: interrogando solo lui la risposta era «non è rimasto niente
// di vivo», la ricarica non partiva e il sito continuava ad ascoltare a permesso
// tolto (#586, giro 6).
//
// E non basta sommare i vivi: se NESSUN riquadro ha mai registrato niente,
// mentre Filo sa di aver concesso quella cosa, vuol dire che la pagina non è
// passata di qui, e allora non si crede a nessuno e si ricarica.
const fermate = new Map(); // id richiesta → risolvi
let prossimaFermata = 1;
const FERMATA_MS = 900;

function chiediAUnFrame(frame, chiavi) {
  return new Promise((resolve) => {
    const id = `f${prossimaFermata++}`;
    let finito = false;
    const finisci = (vive, registrate) => {
      if (finito) return;
      finito = true;
      fermate.delete(id);
      clearTimeout(timer);
      resolve({ vive: Number(vive) || 0, registrate: Number(registrate) || 0 });
    };
    // Nessuna risposta entro la finestra = "è rimasto tutto vivo": si ricarica.
    const timer = setTimeout(() => finisci(1, 0), FERMATA_MS);
    if (timer.unref) timer.unref();
    fermate.set(id, finisci);
    try { frame.send('filo:permessi-ferma', { id, chiavi: chiavi && chiavi.length ? chiavi : null }); }
    catch (_) { finisci(1, 0); }
  });
}

async function chiediAllaPaginaDiFermare(wc, chiavi) {
  if (!wc || wc.isDestroyed()) return 0;
  let frames = [];
  try {
    const main = wc.mainFrame;
    frames = (main && main.framesInSubtree) ? main.framesInSubtree.filter((f) => f && !f.detached) : [];
    if (!frames.length && main && !main.detached) frames = [main];
  } catch (_) { frames = []; }
  if (!frames.length) return 1; // non si sa a chi chiedere: strada dura
  const esiti = await Promise.all(frames.map((f) => chiediAUnFrame(f, chiavi)));
  const vive = esiti.reduce((n, e) => n + e.vive, 0);
  const registrate = esiti.reduce((n, e) => n + e.registrate, 0);
  // Nessuno ha mai visto passare una traccia: la pagina non è passata dal nostro
  // giro (o se l'è tolto di mezzo). Non si conclude «è tutto a posto».
  if (!registrate) return 1;
  return vive;
}

// La risposta di un riquadro, inoltrata da src/main/ipc.js.
function rispostaFermata(id, vive, registrate) {
  const f = fermate.get(String(id || ''));
  if (!f) return { ok: false };
  f(vive, registrate);
  return { ok: true };
}

// «Interrompi», e la revoca. Prima si chiede alla pagina; se qualcosa resta
// vivo, si ricarica come prima.
//
// `solo`: la chiave da chiudere, quando chi chiama ne ha tolta una sola. Un
// cartello solo può nominare la fotocamera E il microfono insieme, e chi toglie
// il microfono non deve ritrovarsi spenta anche la webcam. Senza, la ricarica
// li portava via tutti e due comunque: qui si può fare meglio.
function interrompiUso(id, solo) {
  const r = usi.get(String(id));
  if (!r) return { ok: false, error: 'finita' };
  const wc = r.wc;
  const tutte = r.chiavi.slice();
  const chiavi = solo && tutte.includes(String(solo)) ? [String(solo)] : tutte;
  const restano = tutte.filter((k) => !chiavi.includes(k));
  fineUso(id);
  // Al sito resta qualcosa (gli si è tolto il microfono ma tiene la
  // fotocamera): il cartello deve restare, con la frase di quello che gli
  // rimane.
  if (restano.length) iniziaUso(wc, r.origine, restano, { tipo: r.tipo });
  chiediAllaPaginaDiFermare(wc, chiavi).then((vive) => {
    if (!vive) return;
    try { if (wc && !wc.isDestroyed()) wc.reload(); } catch (_) {}
  }).catch(() => {
    try { if (wc && !wc.isDestroyed()) wc.reload(); } catch (_) {}
  });
  return { ok: true };
}

// La × sul cartello incerto: toglie l'avviso e basta, senza toccare la pagina.
function chiudiAvviso(id) {
  return fineUso(id);
}

// ─── la posizione che non arriva ────────────────────────────────────────────
//
// Chi risponde «Consenti» a «vuole sapere dove sei» dà via una cosa delicata, e
// poi al sito non arriva nessuna coordinata: il motore su cui Filo è costruito
// chiede dove sei a un servizio di rete che nelle versioni pubbliche del motore
// non è raggiungibile. Il sito mostra una mappa rotta, e chi naviga dà la colpa
// al sito o pensa di aver sbagliato qualcosa (#586, giro 5).
//
// Filo la posizione non la sa produrre da sé. Quello che può fare è dirlo: una
// riga per scheda, che se ne va con la pagina o con la sua ×.
const avvisiPosizione = new Map(); // wcId → id dell'avviso
let prossimoAvviso = 1;

function posizioneNonDisponibile(wc) {
  try {
    if (!wc || wc.isDestroyed() || avvisiPosizione.has(wc.id)) return { ok: false };
    const { win, tab } = posizione(wc);
    const shell = win && !win.isDestroyed() ? win.webContents : null;
    if (!shell || shell.isDestroyed()) return { ok: false };
    const id = `pos${prossimoAvviso++}`;
    avvisiPosizione.set(wc.id, id);
    const togli = () => {
      if (avvisiPosizione.get(wc.id) !== id) return;
      avvisiPosizione.delete(wc.id);
      try { if (shell && !shell.isDestroyed()) shell.send('permissions:notice-end', { id }); } catch (_) {}
    };
    const suNavigazione = (_e, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) togli(); };
    try { wc.on('did-start-navigation', suNavigazione); } catch (_) {}
    try { wc.once('destroyed', togli); } catch (_) {}
    shell.send('permissions:notice', {
      id,
      tabId: tab ? tab.id : null,
      testo: 'Filo non riesce a sapere dove sei: a questo sito la tua posizione non arriverà.',
    });
    return { ok: true };
  } catch (_) { return { ok: false }; }
}

function chiudiNotizia(id) {
  // La × toglie l'avviso e basta. Su «ho smesso di chiedere» non rimette il
  // conto a zero: quello lo fa il «Chiedimelo di nuovo», che è una scelta.
  if (anelliDetti.delete(String(id))) return { ok: true };
  for (const [wcId, v] of [...avvisiPosizione]) {
    if (v === String(id)) { avvisiPosizione.delete(wcId); return { ok: true }; }
  }
  return { ok: false };
}

// Togliere il permesso deve togliere anche quello che il sito ha già in mano.
// Prima la revoca valeva solo per la volta dopo: si toglieva la scelta dalle
// Impostazioni, l'elenco si svuotava e il microfono restava aperto (#586,
// giro 4). Da qui si chiude sul serio, che vuol dire ricaricare quella scheda:
// è l'unica strada, ed è la stessa dell'«Interrompi» del cartello.
function chiudiUsi(origine, chiave, incognito) {
  const o = P().origineDi(origine);
  if (!o) return;
  for (const [id, u] of [...usi]) {
    if (u.origine !== o) continue;
    if (!!u.incognito !== !!incognito) continue;
    if (chiave && !u.chiavi.includes(String(chiave))) continue;
    interrompiUso(id, chiave || null);
  }
}

// Controllo SINCRONO (navigator.permissions.query, Notification.permission,
// enumerateDevices): può solo rispondere con ciò che già si sa. Mai "sì" per
// una richiesta mai concessa — è esattamente il buco del default di Electron.
function controlla(wc, permesso, origineRichiedente, dettagli) {
  try {
    const Pp = P();
    // Stesso ordine della richiesta: un riquadro senza indirizzo proprio vale
    // come la pagina che lo ospita, e ciò che legge deve dire la stessa cosa.
    const url = buonaPerChiedere(origineRichiedente)
      ? origineRichiedente
      : urlRichiedente(wc, dettagli);
    if (Pp.interno(url)) return true;
    if (Pp.innocuo(permesso)) return true;
    const origine = Pp.origineDi(url);
    if (!origine) return false;
    const chiavi = Pp.chiaviRichieste(permesso, dettagli);
    if (!chiavi.length) return false;
    const { win } = posizione(wc);
    const incognito = !!(win && win._filoIncognito);
    const ses = wc && !wc.isDestroyed() ? wc.session : null;
    const detto = Pp.decisione(mappaDi(ses, incognito), origine, chiavi);
    // Permessi che arrivano SOLO da qui: Chromium non fa mai la richiesta, e
    // con un no consegna al sito un risultato vuoto senza dire niente a
    // nessuno. Senza richiesta non compariva nessuna pastiglia, quindi nessuna
    // scelta veniva registrata, quindi in Impostazioni quel sito non c'era e
    // non c'era niente da ribaltare: l'elenco dei caratteri installati si
    // poteva solo negare, mai consentire (#586, giro 4). La domanda la facciamo
    // partire di qui, e intanto rispondiamo no: quando l'utente consente, il
    // controllo dopo dice sì e il sito, riprovando, ottiene la sua roba.
    //
    // Qui arriva anche la LETTURA di stato, che è tutt'altra cosa e non deve
    // far comparire niente: una pagina che si limitava a guardare cosa può fare
    // si vedeva comparire una domanda col nome del sito, senza che nessuno
    // avesse cliccato (#586, giro 5). Le due sono indistinguibili da qui, e
    // infatti la differenza la fa la pagina: la lettura non arriva più fin qui,
    // se la serve il guardiano nel mondo del sito
    // (src/preload/permessi-guard.js), che risponde «da chiedere» e non sveglia
    // nessuno. Quello che resta a bussare è la richiesta vera.
    if (detto === null && Pp.soloControllo(permesso)) chiediDaControllo(wc, permesso, url, dettagli);
    return detto === 'allow';
  } catch (_) { return false; }
}

// La domanda fatta partire da un CONTROLLO. Non aspetta nessuno (il controllo è
// sincrono e ha già risposto no) e non si impila: finché la pastiglia è aperta
// `chiedi` riconosce la richiesta gemella e le si attacca invece di aprirne
// un'altra. L'origine gliela passiamo noi, perché quella del controllo arriva
// per una strada diversa da quella della richiesta.
function chiediDaControllo(wc, permesso, url, dettagli) {
  Promise.resolve()
    .then(() => decidi(wc, permesso, { ...(dettagli || {}), requestingUrl: url }))
    .catch(() => {});
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
          if (pre && pre.ripresaId) fineUso(pre.ripresaId);
          nega();
          return;
        }
        // Il segno parte ADESSO, che è quando il sito comincia davvero a
        // vedere: prima della scelta della fonte non vede ancora niente. Se il
        // segno prudente della strada vecchia era già partito (il sito ci ha
        // messo più di un attimo ad arrivare qui), lo rifacciamo: adesso
        // sappiamo per certo se l'audio c'è o no, e il segno lo deve dire.
        if (pre && pre.ripresaId) fineUso(pre.ripresaId);
        iniziaUso(bersaglio, P().origineDi(url) || url, [P().CHIAVI.SCHERMO], {
          audioSistema: !!scelta.audio,
        });
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
// finestra sola? E, se il sito ha chiesto anche l'audio, gli si fa sentire
// quello che si sente sul computer? Torna { fonte, audio }, oppure null
// (annullato, nessuna fonte, nessuna shell a cui chiedere, o due minuti senza
// risposta).
async function scegliFonte(wc, frame, audioChiesto) {
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
    const finisci = (fonteId, audio) => {
      if (finito) return;
      finito = true;
      scelteFonte.delete(id);
      clearTimeout(timer);
      try { wc.off('destroyed', suMorte); } catch (_) {}
      try { if (shell && !shell.isDestroyed()) shell.send('permissions:source-closed', { id }); } catch (_) {}
      const fonte = fonteId ? (fonti.find((f) => f.id === fonteId) || null) : null;
      // L'audio si dà solo se il sito l'ha chiesto E l'utente l'ha acceso: una
      // spunta che nessuno ha visto non è un consenso.
      resolve(fonte ? { fonte, audio: !!(audioChiesto && audio) } : null);
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
      shell.send('permissions:pick-source', {
        id, tabId: tab ? tab.id : null, host, voci, audio: !!audioChiesto,
      });
    } catch (_) { finisci(null); }
  });
}

// Risposta della shell: l'id della fonte scelta (o niente per annullare) e se
// l'audio del computer va dato insieme all'immagine.
function scegliFonteRisposta(id, fonteId, audio) {
  const att = scelteFonte.get(String(id));
  if (!att) return { ok: false, error: 'scaduta' };
  att.finisci(fonteId || null, !!audio);
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
// sito richiede, e l'utente risceglie. E, se il sito sta usando quella cosa
// ADESSO, gliela chiude: prima la revoca valeva solo per la volta dopo, e un
// microfono aperto restava aperto (#586, giro 4).
function revoca(origine, chiave, ctx) {
  const c = ctx || {};
  const nuova = P().senza(memoriaDi(c), origine, chiave || null);
  scriviMappa(c.incognito ? c.ses : null, !!c.incognito, nuova);
  chiudiUsi(origine, chiave || null, !!c.incognito);
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
  // Ribaltare a «negato» vale quanto togliere: se il sito lo sta usando adesso,
  // gli si chiude.
  if (scelta === 'deny') chiudiUsi(origine, chiave, !!c.incognito);
  return true;
}

// Solo per i test: stato pulito senza riavviare l'app.
function _reset() {
  mappa = {};
  attese.clear();
  unaTantum.clear();
  ultimaRichiesta.clear();
  scelteFonte.clear();
  preamboli.clear();
  senzaRisposta.clear();
  anelliDetti.clear();
  fermate.clear();
  avvisiPosizione.clear();
  for (const id of [...usi.keys()]) fineUso(id);
}

module.exports = {
  installaSuSessione,
  // Solo per i test: la decisione su una richiesta, senza passare da Electron.
  _decidi: decidi,
  configureFromSettings,
  concessioneUnaTantum,
  rispondi,
  rispostaFermata,
  posizioneNonDisponibile,
  chiudiNotizia,
  riprendiAChiedere,
  contesto,
  scegliFonteRisposta,
  interrompiUso,
  chiudiAvviso,
  elenco,
  perOrigine,
  revoca,
  imposta,
  _reset,
  ATTESA_MS,
};
