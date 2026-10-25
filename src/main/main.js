// Filo — entry point del processo main Electron.
// Boota:
//   - protocollo filo:// per pagine interne e asset
//   - finestra principale con shell (tab bar + indirizzo)
//   - manager dei tab basato su WebContentsView
//   - servizi (storage, providers AI, saved pages, ecc.)

const { app, BrowserWindow, nativeTheme, session } = require('electron');
const path = require('node:path');

// Anche userData (cookie, cache) va nella temp, o l'isolamento non è completo.
if (process.env.FILO_USER_DATA) {
  try { app.setPath('userData', process.env.FILO_USER_DATA); } catch (_) {}
}

// «Cancella tutti i dati di Filo» chiesto prima del riavvio (#850): prima che chiunque apra un file della cartella dei dati.
try { require('./cancellaTutto').allAvvio(app); } catch (e) { console.error('[Filo] cancella tutto:', e?.message || e); }

// Prima di qualsiasi sessione, che caricherebbe subito i dizionari del correttore scaricandoli da Google (#1084).
try { require('./services/dizionari').prepara(app); } catch (_) {}

// Su Windows serve un AppUserModelID esplicito perché la taskbar mostri
// l'icona giusta (e non quella di Electron di default).
if (process.platform === 'win32') {
  try { app.setAppUserModelId('ai.filo.desktop'); } catch (_) {}
}

// UA pulita (il perché in src/main/userAgent.js). `userAgentFallback` è quella
// che eredita ogni session, e va fissata PRIMA di whenReady.
// I client hints che una UA riscritta fa sparire li rimette services/clientHints.js, dall'unico onBeforeSendHeaders.
try {
  const { stripEmbeddedUaTokens } = require('./userAgent');
  const cleaned = stripEmbeddedUaTokens(app.userAgentFallback || '', app.getName());
  if (cleaned) app.userAgentFallback = cleaned;
} catch (_) { /* best-effort: in peggio resta la UA di default */ }
// In OGNI sessione, anche incognito e proxy: senza client hints Google respinge l'accesso (#1616). Il GPC resta spento finché la modalità non lo accende.
app.on('session-created', (ses) => { try { require('./services/cookies').ensureHeaderHook(ses); } catch (_) {} });

// Il portachiavi si sceglie solo prima di `ready`: senza, su sway/i3 l'accesso
// non sopravvive alla chiusura nemmeno col portachiavi acceso (#708.1).
try {
  const { portachiaviDaChiedere } = require('./portachiavi');
  const scelto = portachiaviDaChiedere({
    platform: process.platform,
    env: process.env,
    haSwitch: app.commandLine.hasSwitch('password-store'),
  });
  if (scelto) app.commandLine.appendSwitch('password-store', scelto);
} catch (_) {}
require('./test-window-mode').disegnaAncheFuoriSchermo(app);
require('./test-window-mode').webglAncheSenzaScheda(app);

// Carica i moduli "shared/background" portati dall'estensione. Si registrano
// tutti su `globalThis` (pattern IIFE preservato dal codice extension), così
// gli altri moduli del main process li trovano via global.
require('./shim/chrome-api');
require('./services/loader');

// Dentro app.evaluate `require` non esiste: i test arrivano ai servizi veri da
// qui. SINCRONO, non dentro whenReady: un test può valutare prima che finisca.
if (process.env.NODE_ENV === 'test') {
  // Niente browser né gestore file aperti dal sistema durante i test: su un contenitore
  // senza desktop l'apertura non torna mai e l'app non si chiude più.
  try { require('./test-window-mode').silenziaApertureDiSistema(require('electron').shell); } catch (_) {}
  try {
    globalThis.__filoHandlers = require('./services/handlers');
    globalThis.__filoDefaults = require('./services/defaultsStore');
    globalThis.__filoCookies = require('./services/cookies');
    globalThis.__filoAdblock = require('./services/adblock');
    globalThis.__filoCookieBanners = require('./services/cookieBanners');
    globalThis.__filoCookieIncorporati = require('./services/cookieIncorporati');
    globalThis.__filoRiquadriRotti = require('./services/riquadriRotti');
    globalThis.__filoDizionari = require('./services/dizionari');
    globalThis.__filoDizionarioDiFilo = require('./services/dizionarioDiFilo');
    globalThis.__filoFirmatariC2pa = require('./services/firmatariC2pa');
    globalThis.__filoFingerprint = require('./services/fingerprint');
    globalThis.__filoProxyTab = require('./services/proxyTab');
    globalThis.__filoShortcuts = require('./shortcuts');
    globalThis.__filoAuth = require('./auth/google-auth');
    globalThis.__filoUpdater = require('./updater');
    globalThis.__filoAlarmWatcher = require('./services/alarmWatcher');
    globalThis.__filoCancellaTutto = require('./cancellaTutto');
  } catch (_) {}
}

// Nelle prove il servizio vero delle schede non si raggiunge da nessuna porta, anche da quelle
// che aprono Filo fuori dalla modalità test (vedi test-servizi-chiusi.js). No-op altrimenti.
try { require('./test-servizi-chiusi').chiudiServiziNeiTest(); } catch (_) {}

const {
  createMainWindow, revealWindow, assicuraFinestraNormale, onFinestraNormale,
} = require('./window');
const { registerFiloProtocol } = require('./protocol');
const { registerIpcHandlers } = require('./ipc');
const { installaMenuApplicazione } = require('./menu');
const { initAutoUpdater, installaAllAvvioSeServe } = require('./updater');

// PRIMA di app.whenReady, o i privilegi dello schema non si applicano.
require('./protocol').registerProtocolSchemes();

// Le eccezioni del main che nessuno gestisce (#1466), per i contatori anonimi: solo il nome della classe, mai messaggio
// né stack. Il monitor non cambia quello che Electron fa di un'eccezione (il suo avviso); un rifiuto senza gestione,
// che Electron si limitava a scrivere, resta scritto qui.
const contatori = () => globalThis.SN_CONTATORI_MAIN || null;
process.on('uncaughtExceptionMonitor', (err, origine) => {
  try { contatori()?.eccezione(origine === 'unhandledRejection' ? 'rejection' : 'uncaught', err); } catch (_) {}
});
process.on('unhandledRejection', (motivo) => {
  try { console.warn('[Filo] promessa rifiutata senza gestione:', motivo); } catch (_) {}
  try { contatori()?.eccezione('rejection', motivo); } catch (_) {}
});

let mainWindow = null;

// ── Il collegamento d'invito: filo://invito/<codice> (#651) ──────────────────
// Chi riceve un invito riceve un link. Se Filo c'è già, il link lo apre (o lo
// porta davanti) e riscatta da solo, senza far ricopiare otto caratteri a
// nessuno.
//
// ATTENZIONE: registrando `filo://` come protocollo di SISTEMA, il sistema
// consegna all'app QUALUNQUE `filo://…` — anche un `filo://credits/credits.html`
// messo in un link da un sito qualsiasi. Si accetta il solo host `invito`;
// tutto il resto non apre niente e non fa niente, in silenzio. Un invito col
// codice storto, invece, si dice: l'ha cliccato una persona.
//
// Da dove arriva l'indirizzo: su Windows e Linux sta fra gli ARGOMENTI (del
// primo avvio, o di `second-instance`); su Mac arriva con `open-url`, che va
// agganciato prima che l'app sia pronta.
//
// Il pattern per intero:
// patterns/un-protocollo-di-sistema-ti-consegna-tutto-filtra-lhost.md
let invitoInAttesa = null;

// `code` può essere null: il collegamento era un invito (host `invito`) ma il
// codice dentro è storto. Chi ha cliccato aspetta che succeda qualcosa, e lo
// dice la pagina Crediti — è il riscatto a rifiutarlo, con la sua frase.
function apriInvito(code) {
  // Senza finestra (avvio a freddo: l'apertura è ancora a metà) l'invito
  // aspetta lì e parte appena la finestra c'è.
  if (!mainWindow) { invitoInAttesa = { code }; return true; }
  try { revealWindow(mainWindow); } catch (_) {}
  // Riscatto e pagina Crediti partono insieme, e la pagina si aggiorna da sé
  // all'avviso di saldo cambiato. È la stessa strada del clic dentro Filo.
  try { globalThis.SN_WALLET_MAIN?.portaDentroInvito?.(code, mainWindow); } catch (_) {}
  return true;
}

function apriLinkFilo(rawUrl) {
  const W = globalThis.SN_WALLET;
  // Ogni `filo://` che non è un invito si lascia cadere, in silenzio e senza
  // aprire niente: non l'ha chiesto l'utente, l'ha scritto una pagina.
  if (!W?.isInviteDeepLink?.(rawUrl)) return false;
  return apriInvito(W.inviteCodeFromDeepLink(rawUrl));
}

function apriInvitoDaArgv(argv) {
  const url = globalThis.SN_WALLET?.filoUrlFromArgv?.(argv) || null;
  return url ? apriLinkFilo(url) : false;
}

// Mac: l'indirizzo arriva di qui, e può arrivare PRIMA che l'app sia pronta.
app.on('open-url', (event, url) => {
  event.preventDefault();
  apriLinkFilo(url);
});

// Filo si dichiara al sistema come chi apre i `filo://`. In sviluppo l'exe è
// quello di Electron e va passato il percorso del progetto, altrimenti il
// sistema aprirebbe Electron a mani vuote. Durante i test non si tocca: la
// registrazione cambia il sistema di chi lancia la prova, e non è una cosa
// che una prova ha il diritto di fare.
function dichiaraProtocolloInvito() {
  if (process.env.NODE_ENV === 'test' || process.env.FILO_SMOKE) return;
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('filo', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('filo');
    }
  } catch (_) { /* il link resta copiabile a mano: non è un motivo per non partire */ }
}

function syncNativeTheme(theme) {
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system';
}

// Le lingue del correttore nativo: senza, Electron usa solo quella di sistema e la correzione in cima al menu
// (`_spell:native`, tabs.js) manca sulle parole italiane. La scelta e il perché niente inglese forzato: spellLanguages.js.
function configureSpellchecker() {
  try {
    const ses = session.defaultSession;
    if (!ses || typeof ses.setSpellCheckerLanguages !== 'function') return;
    const available = ses.availableSpellCheckerLanguages || [];
    if (!available.length) return; // macOS / nativo: nessuna lista Hunspell
    // Su Linux c'è solo Hunspell e si caricano solo i dizionari inclusi in Filo: un inglese non incluso resterebbe vuoto.
    const inclusi = process.platform === 'linux' ? require('./services/dizionari').lingue() : [];
    const want = globalThis.SN_SPELL_LANG.select(available, app.getLocale(), inclusi);
    if (want.length) ses.setSpellCheckerLanguages(want);
  } catch (_) { /* best-effort: il correttore resta sul default di sistema */ }
}

app.whenReady().then(async () => {
  // I passi dell'avvio per i contatori anonimi (#1466): quanto pesa ognuno, non solo il tutto.
  const passo = (nome, t0) => { try { contatori()?.passoAvvio(nome, Date.now() - t0); } catch (_) {} };
  let t = Date.now();
  // #1039 — un aggiornamento scaricato si installa qui, con la barra visibile, prima che si apra qualsiasi finestra.
  // Prima di ogni lettura delle impostazioni: le pagine leggono il file com'è, e un vecchio «Aiuto spento» di serie non si vede.
  try { await require('./services/interruttoreAiuto').migra(); } catch (e) { console.warn('[Filo] interruttore dell\'Aiuto:', e?.message || e); }
  try { await require('./services/correttoreMigrazione').migra(); } catch (e) { console.warn('[Filo] correttore a due segni:', e?.message || e); }
  let impostazioniAvvio = {};
  try { impostazioniAvvio = await globalThis.SN_STORAGE.getSettings(); } catch (_) {}
  passo('impostazioni_lette', t);
  try { if (await installaAllAvvioSeServe(impostazioniAvvio)) return; } catch (_) {}
  // Com'era finita la volta prima e il segno di questa: solo la copia che tiene il lucchetto, e dopo l'installatore.
  if (app.hasSingleInstanceLock()) { try { contatori()?.avvioProcesso().catch(() => {}); } catch (_) {} }
  t = Date.now();
  await registerFiloProtocol();
  registerIpcHandlers();
  passo('protocollo_ipc', t);
  configureSpellchecker();
  try { require('./services/dizionarioDiFilo').prepara({ locale: app.getLocale(), dopoMs: 1500 }); } catch (_) {}
  // PRIMA di qualsiasi finestra: su Mac la barra vince sui tasti delle pagine.
  installaMenuApplicazione();

  const Storage = globalThis.SN_STORAGE;
  try {
    const s = await Storage.getSettings();
    syncNativeTheme(s.theme);
    try { require('./movimento').segui(s); } catch (_) {}
    // Gestione cookie: emetti GPC sulla sessione di default secondo la modalità.
    const Cookies = require('./services/cookies');
    Cookies.configureFromSettings(s);
    // Cookie dei contenuti incorporati di terzi (#758): va agganciato prima della prima scheda, è lui che vede
    // nascere i cookie dei riquadri.
    try { require('./services/cookieIncorporati').init(s); } catch (_) {}
    try { require('./services/accessoGoogle').init(); } catch (_) {}
    try { require('./services/riquadriRotti').init(s); } catch (_) {}
    // Anti-fingerprinting: carica/genera il master secret persistente e fissa
    // la modalità corrente (off/default/privacy) prima di aprire qualsiasi tab.
    t = Date.now();
    try { await require('./services/fingerprint').init(s); } catch (_) {}
    passo('fingerprint', t);
    try { await Cookies.wipeTrackerCookies(s); } catch (_) {}
    t = Date.now();
    try { await require('./services/adblock').init(s); } catch (_) {}
    passo('adblock', t);
    try { require('./services/adSkip').configureFromSettings(s); } catch (_) {}
    // EasyList Cookie (banner da nascondere): cache su disco e aggiornamento settimanale in sottofondo.
    require('./services/cookieBanners').init(s).catch(() => {});
    // Cosa Filo ha fatto coi banner dei singoli siti: il menu della scheda lo mostra anche alla visita dopo.
    try { await require('./tabs/tabCookies').loadRemembered(); } catch (_) {}
    // #711 — l'elenco ufficiale dei firmatari C2PA: rilegge la copia su disco e
    // la rinfresca in sottofondo quando è vecchia. Non blocca l'avvio.
    try { await require('./services/firmatariC2pa').init(); } catch (_) {}
    // Blocco apertura siti in blacklist (#170.3): legge la config dalle
    // impostazioni (riusa le liste dell'ad-blocker + la blacklist dell'utente).
    try { require('./services/siteBlock').configureFromSettings(s); } catch (_) {}
    // Le scorciatoie scelte dall'utente (#842) valgono dal primo tasto premuto.
    try { require('./shortcuts').configura(s); } catch (_) {}
    require('./shortcuts').seguiModuliEditor().catch(() => {});
    // #588 — conferma prima di scaricare/aprire un programma: la config va
    // letta PRIMA del primo will-download, che è sincrono e non può attenderla.
    try { require('./services/downloads').configureFromSettings(s); } catch (_) {}
    // Le risposte date ai siti vanno lette prima della prima scheda: il controllo dei permessi è sincrono.
    t = Date.now();
    try { await require('./services/permessiPagine').carica(); } catch (_) {}
    passo('permessi', t);
    // Appunti → editor: sposta una-tantum i vecchi appunti dell'archivio in un
    // file "Appunti" dell'editor (fine dell'archivio separato). Idempotente.
    try { await require('./services/editorFiles').migrateNotesToEditor(); } catch (_) {}
    // Le miniature grandi di «Aperti per dopo» (#839), qualche secondo dopo: l’avvio non le aspetta.
    setTimeout(() => { globalThis.SN_SAVED_PAGES?.rimpicciolisciMiniature?.().catch(() => {}); }, 3000);
    // Le icone delle voci rimaste senza copia (#1273), una volta sola e dopo l'avvio.
    try { require('./services/iconeVecchie').avvio(); } catch (_) {}
    // La cronologia AI di storage.json passa ai suoi file subito, non alla prima richiesta: fino ad allora ogni scrittura la ripaga.
    setTimeout(() => { globalThis.SN_HISTORY?.prepara().catch(() => {}); }, 2000);
  } catch (_) {}

  // Le due identità: entrambe leggono solo file, niente rete all'avvio.
  try { require('./auth/google-auth').restore(); } catch (_) {}
  try { require('./auth/anon-auth').restore(); } catch (_) {}

  // I tre in background non bloccano l'avvio: finché la config remota non
  // arriva valgono i default del codice, e senza chiavi resta l'analisi locale.
  try { require('./services/defaultsStore').refresh().catch(() => {}); } catch (_) {}
  try { require('./services/handlers').wireSafebrowse().catch(() => {}); } catch (_) {}
  try { require('./services/downloads').init().catch(() => {}); } catch (_) {}

  // Una finestra normale può nascere anche senza di noi (la scadenza che deve
  // farsi sentire ne apre una): senza aggiornarlo, questo punta a una chiusa.
  onFinestraNormale((w) => { mainWindow = w; });
  mainWindow = createMainWindow();
  try { require('./cancellaTutto').annuncia(); } catch (_) {}
  // Chi è entrato in Filo quando l'accesso passava dal browser trova una volta l'invito a collegare YouTube, Gmail e
  // Drive nelle schede (#1123). Nei test no: comparirebbe in mezzo agli avvisi che gli spec contano.
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => { require('./auth/prodottiGoogle').invitaSeServe().catch(() => {}); }, 15_000).unref?.();
  }

  // Il collegamento d'invito (#651): la dichiarazione al sistema, l'indirizzo
  // dell'avvio a freddo (Windows e Linux lo mettono fra gli argomenti) e
  // quello arrivato da `open-url` mentre la finestra non c'era ancora.
  dichiaraProtocolloInvito();
  if (invitoInAttesa) { const a = invitoInAttesa; invitoInAttesa = null; apriInvito(a.code); }
  else apriInvitoDaArgv(process.argv);

  // #525 — le chat lasciate a metà da una sessione finita di colpo: si
  // chiudono e prendono titolo e tipo adesso. Chiudere Filo è il modo normale
  // di finire una conversazione, quindi senza questo giro la chat più comune
  // di tutte resterebbe senza nome in cronologia. In sottofondo: non blocca
  // l'avvio, e se il modello non c'è si riprova alla partenza dopo.
  // #866 — il filo si legge adesso, e alla prima partenza dopo l'aggiornamento le chat salvate diventano segmenti.
  try { require('./services/ilFilo').carica().catch(() => {}); } catch (_) {}
  try { require('./services/handlers').sweepPendingChats().catch(() => {}); } catch (_) {}

  // #322 — le scadenze si controllano nel main: altrimenti una sveglia scatta
  // solo se la newtab è aperta.
  try { require('./services/alarmWatcher').start(); } catch (_) {}
  try { require('./services/correttoreSpinte').avvia(); } catch (_) {}

  // Controlla le GitHub Releases e scarica in sottofondo; quando installare lo dice updater.js (no-op in dev/test).
  initAutoUpdater(impostazioniAvvio);

  // Smoke: l'ORDINE è la regola. Il sentinel è l'unica cosa che lo script fuori aspetta e va
  // scritto PRIMA delle catture: dopo, una cattura lenta sembra un'app che non parte.
  if (process.env.FILO_SMOKE) {
    const fs = require('node:fs');
    const path = require('node:path');
    // Nessuna attesa dello smoke può durare per sempre: l'app resterebbe
    // appesa senza dire niente.
    const entro = (promessa, ms, cosa) => Promise.race([
      promessa,
      new Promise((r) => setTimeout(() => { console.log(`[smoke] ${cosa}: scaduti ${ms}ms, proseguo`); r(null); }, ms)),
    ]);
    const checkReady = async () => {
      const tabs = mainWindow?._filoTabs;
      const ready = tabs && tabs.tabs.length > 0 && tabs.tabs.some((t) => !t.loading);
      if (!ready) { setTimeout(checkReady, 250); return; }
      // did-stop-loading non vuol dire dipinto: un attimo al renderer.
      await new Promise((r) => setTimeout(r, 800));
      const outDir = path.dirname(process.env.FILO_SMOKE);
      // Il verdetto, subito: da qui in poi è tutta diagnostica.
      try {
        fs.writeFileSync(process.env.FILO_SMOKE, JSON.stringify({
          ts: new Date().toISOString(),
          tabs: tabs.snapshot(),
        }));
        console.log('[smoke] sentinel scritto:', process.env.FILO_SMOKE);
      } catch (e) { console.log('[smoke] sentinel non scritto:', e?.message || String(e)); }
      // Senza una composizione visibile capturePage fallisce con "display
      // surface not available", e da Node Windows non la mostra da sé.
      try {
        mainWindow.show();
        mainWindow.moveTop();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true);
        console.log('[smoke] window state', JSON.stringify({
          visible: mainWindow.isVisible(),
          minimized: mainWindow.isMinimized(),
          focused: mainWindow.isFocused(),
          bounds: mainWindow.getBounds(),
        }));
      } catch (e) { console.log('[smoke] show/focus error', e.message); }
      await new Promise((r) => setTimeout(r, 800));
      const dump = async (label, wc) => {
        console.log(`[smoke] dump:${label} start`);
        try {
          const img = await entro(wc.capturePage(), 15_000, `cattura ${label}`);
          console.log(`[smoke] dump:${label} capturePage resolved, img=`, !!img, 'empty=', img?.isEmpty?.());
          if (!img) { console.log(`[smoke] dump:${label} no img`); return; }
          const png = img.toPNG();
          const sz = img.getSize();
          const file = path.join(outDir, `screenshot-${label}.png`);
          fs.writeFileSync(file, png);
          console.log(`[smoke] capture ${label}: ${sz.width}x${sz.height}, ${png.length} bytes → ${file}`);
        } catch (e) {
          console.log(`[smoke] capture ${label} threw:`, e?.stack || e?.message || String(e));
        }
      };
      await dump('shell', mainWindow.webContents);
      // Aggiro electron#24694: capturePage su una WebContentsView torna
      // un'immagine vuota, quindi l'URL si riapre in una finestra dedicata.
      const captureUrl = async (label, url, preloadName) => {
        try {
          const captureWin = new BrowserWindow({
            width: 1280, height: 800, show: true,
            webPreferences: {
              // Come le schede: la pagina web col preload impacchettato, in sandbox; quella interna col suo.
              preload: preloadName === 'page-preload.js' ? require('./preloadPacchetto').percorsoDelPreload() : path.join(__dirname, '..', 'preload', preloadName),
              contextIsolation: preloadName !== 'internal-preload.js',
              sandbox: preloadName !== 'internal-preload.js', nodeIntegration: false,
            },
          });
          captureWin.loadURL(url);
          await entro(
            new Promise((res) => captureWin.webContents.once('did-stop-loading', res)),
            15_000, `attesa caricamento ${label}`,
          );
          captureWin.show(); captureWin.moveTop(); captureWin.focus();
          captureWin.setAlwaysOnTop(true);
          await new Promise((r) => setTimeout(r, 900));
          await dump(label, captureWin.webContents);
          return captureWin;
        } catch (e) { console.log(`[smoke] capture ${label} failed`, e.message); return null; }
      };

      const active = tabs.tabs.find((t) => t.id === tabs.activeId);
      if (active) {
        const tabCaptureWin = await captureUrl('tab', active.url, 'internal-preload.js');
        if (tabCaptureWin) tabCaptureWin.close();
      }

      // Una pagina che NON è filo://: è l'unico modo di provare i content script.
      const testPageUrl = 'file:///' + path.join(__dirname, '..', '..', 'tests', 'fixtures', 'test-page.html').replace(/\\/g, '/');
      const csWin = await captureUrl('test-page', testPageUrl, 'page-preload.js');
      if (csWin) {
        try {
          const csDiag = await entro(csWin.webContents.executeJavaScript(
            "({ href: location.href," +
            " filoReady: document.documentElement.dataset.filoReady," +
            " filoModules: document.documentElement.dataset.filoModules," +
            " filoTheme: document.documentElement.dataset.snTheme," +
            " filoStyleInjected: !!document.querySelector('link[href*=\"filo://style/\"]')," +
            " linkCount: document.querySelectorAll('link[rel=stylesheet]').length })"
          ), 10_000, 'diagnostica content-script');
          console.log('[smoke] content-script diag:', JSON.stringify(csDiag, null, 2));

          // Seleziona e fa un tasto destro come l'utente: uno fabbricato dallo script il menu lo ignora (#589.8).
          const punto = await entro(csWin.webContents.executeJavaScript(`(() => {
            const span = document.querySelector('.selectable');
            if (!span) return null;
            const range = document.createRange();
            range.selectNodeContents(span);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            const rect = span.getBoundingClientRect();
            return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
          })()`), 10_000, 'tasto destro simulato');
          if (punto) {
            for (const type of ['mouseDown', 'mouseUp']) {
              csWin.webContents.sendInputEvent({ type, x: punto.x, y: punto.y, button: 'right', clickCount: 1 });
            }
          }
          await new Promise((r) => setTimeout(r, 500));
          const menuDiag = await entro(csWin.webContents.executeJavaScript(
            "({ menu: !!document.querySelector('.sn-menu')," +
            " menuItems: document.querySelectorAll('.sn-menu .sn-menu-item, .sn-menu button').length," +
            " menuHtml: (document.querySelector('.sn-menu')?.outerHTML || '').slice(0,300) })"
          ), 10_000, 'diagnostica menu');
          console.log('[smoke] right-click menu diag:', JSON.stringify(menuDiag, null, 2));
          await dump('menu', csWin.webContents);
        } catch (e) { console.log('[smoke] content-script diag failed', e.message); }
        csWin.close();
      }
      setTimeout(() => app.quit(), 200);
    };
    setTimeout(checkReady, 500);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) assicuraFinestraNormale();
  });
});

// Salvataggio SINCRONO delle schede aperte: quello normale ha un debounce, e
// chi esce subito dopo aver aperto una scheda la perderebbe.
app.on('before-quit', () => {
  try { contatori()?.inizioChiusura(); } catch (_) {}
  try {
    const tm = mainWindow?._filoTabs;
    const Storage = require('./shim/storage');
    // L'ora dei contatori viaggia con le schede: dopo questa scrittura non ne parte un'altra (#1466).
    let contati = {};
    try { contati = contatori()?.perLaChiusura() || {}; } catch (_) { contati = {}; }
    // setSync scrive già tutto il file: una seconda scrittura raddoppierebbe solo il tempo della chiusura.
    if (tm && Storage?.setSync) {
      const key = globalThis.SN_CONST?.STORAGE_KEYS?.OPEN_TABS || 'sn_open_tabs';
      Storage.setSync({ [key]: tm.sessionState(), ...contati });
    } else if (Object.keys(contati).length && Storage?.setSync) Storage.setSync(contati);
    else Storage?.flushSync?.();
  } catch (_) {}
});

// L'ultimo istante dell'uscita: il segno «chiusa» con quanto è durata, letto dall'avvio dopo (#1466).
app.on('will-quit', () => {
  try { contatori()?.fineChiusura(); } catch (_) {}
});

// Uscire distrugge le schede senza chiudere le loro pagine: chi aveva caselle da spedire perdeva l'ultima modifica.
// Si aspetta come alla chiusura di una scheda (chiusuraConCaselle), una volta sola.
let congedoUscitaFatto = false;
app.on('before-quit', (e) => {
  if (congedoUscitaFatto) return;
  congedoUscitaFatto = true;
  // Tutte le finestre: una che rifiuta di chiudersi mentre aspetta annullerebbe l'uscita (su Mac Filo resterebbe aperto).
  const { congedaSchede } = require('./tabs/chiusuraConCaselle');
  const attese = BrowserWindow.getAllWindows()
    .map((w) => { try { return w.isDestroyed() ? null : congedaSchede(w._filoTabs); } catch (_) { return null; } })
    .filter(Boolean);
  if (!attese.length) return;
  e.preventDefault();
  const esci = () => { try { app.quit(); } catch (_) {} };
  Promise.all(attese).then(esci, esci);
});

// Wipe dei cookie-tracker all'uscita (modalità 'default'): i cookie funzionali e
// i login restano (le tue scelte non si perdono); rimuoviamo solo eventuali
// cookie di domini-tracker noti. Il wipe è asincrono: rimandiamo l'uscita finché
// non termina (con un timeout di sicurezza, così l'app si chiude comunque se il
// wipe si impalla). In privacy le sessioni sono effimere (niente da fare); in
// manual non tocchiamo nulla.
let cookieWipeDone = false;
app.on('before-quit', (e) => {
  if (cookieWipeDone) return;
  let pending;
  try { pending = require('./services/cookies').wipeOnExit(); } catch (_) { return; }
  // #758 — i cookie partizionati dei riquadri non si possono declassare: quelli ancora in attesa escono qui.
  try { pending = Promise.all([pending, require('./services/cookieIncorporati').allUscita()]); } catch (_) {}
  if (!pending || typeof pending.then !== 'function') return;
  e.preventDefault();
  // L'esito della pulizia va nei contatori (#1469) e i contatori sul disco, prima di uscire: al più 400 ms in più.
  const finish = (esito) => {
    if (cookieWipeDone) return;
    cookieWipeDone = true;
    let scritto = Promise.resolve();
    try {
      const M = globalThis.SN_CONTATORI_MAIN;
      const N = globalThis.SN_CONTATORI && globalThis.SN_CONTATORI.NAV;
      if (M && N) scritto = Promise.race([M.allUscita(esito ? N.pulizia(esito) : null), new Promise((r) => setTimeout(r, 400))]);
    } catch (_) {}
    scritto.catch(() => {}).then(() => app.quit());
  };
  // In Privacy e a mano la pulizia non c'è: si salta, e non si conta.
  const saltata = (r) => { const w = Array.isArray(r) ? r[0] : r; return !!(w && w.skipped); };
  const timer = setTimeout(() => {
    try { contatori()?.tettoChiusura(); } catch (_) {}
    finish('tetto_2500ms');
  }, 2500);
  pending.then((r) => { clearTimeout(timer); finish(saltata(r) ? null : 'finita'); }, () => { clearTimeout(timer); finish(null); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Single instance: la seconda apertura ridà focus all'esistente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    try { contatori()?.secondaIstanza(); } catch (_) {}
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Su Windows e Linux un `filo://…` aperto mentre Filo è già acceso arriva
    // qui, fra gli argomenti della seconda istanza. La posizione non è fissa
    // (in sviluppo il secondo argomento è `.`, nei test `.` è l'ultimo):
    // l'indirizzo si CERCA, mai si prende per indice.
    apriInvitoDaArgv(argv);
  });
}
