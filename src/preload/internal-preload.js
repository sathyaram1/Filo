// Preload PRIVILEGIATO delle pagine filo://: espone window.filo e lo shim
// chrome.*, con contextIsolation disattivato (codice nostro, che usa chrome.* in
// scope globale). Niente di tutto questo deve uscire da un'origine filo:.

const { ipcRenderer, webFrame, webUtils } = require('electron');

// SICUREZZA: il preload è legato al WebContents, non all'URL, e un documento non filo: può
// finire a girare qui — avrebbe chiavi e dati utente. Gira dopo il commit: location è vera.
const IS_FILO_ORIGIN = (() => {
  try { return location.protocol === 'filo:'; } catch (_) { return false; }
})();

// Modalità zoom con la rotella attivata dal click centrale (sostituisce
// l'autoscroll nativo) + zoom con Ctrl/Cmd (rotella, pinch del trackpad,
// Ctrl +/-/0): sulle pagine interne funziona come su quelle web. Le pagine che
// zoomano da sé si tirano fuori con `dataset.filoOwnZoom`. Vedi wheel-zoom.js.
// Quel marcatore vale solo se il documento è davvero filo://: se un documento
// non nostro finisse a girare qui (il caso che teme il gate qui sopra) se lo
// scriverebbe da sé per rendersi impossibile da ingrandire (#686).
// Chi tocca un riquadro passa da qui (#1560). Nelle pagine interne i riquadri non hanno un preload da perdere: il conto
// dei load non serve, e nessuno risulta in arrivo.
try { require('../shared/riquadriInArrivo.js'); } catch (e) { console.error('[Filo internal] riquadri in arrivo', e); }
try { require('./wheel-zoom.js')(webFrame, { pageZoom: true, ipcRenderer, interna: IS_FILO_ORIGIN }); } catch (e) { console.error('[Filo internal] wheel-zoom', e); }
try { require('./cmd-freccia.js')(window, ipcRenderer); } catch (e) { console.error('[Filo internal] cmd-freccia', e); }
try { require('./trascina-bordo.js')(window, ipcRenderer); } catch (e) { console.error('[Filo internal] trascina-bordo', e); }
// Un'immagine lasciata dove la pagina non la vuole va all'Aiuto (#1623); la home la prende da sé, nel suo campo.
if (IS_FILO_ORIGIN) {
  try {
    require('./rilascio-file.js')(window, {
      pronta: () => globalThis.SN_SIDEBAR?.accoglieRilascio?.() === true,
      consegna: (files) => globalThis.SN_SIDEBAR.allega(files),
      pannello: (t) => globalThis.SN_SIDEBAR?.contiene?.(t) === true,
      nelPannello: (e) => globalThis.SN_SIDEBAR?.rilascio?.(e),
    });
  } catch (e) { console.error('[Filo internal] rilascio', e); }
}

const filoApi = require('./filo-api.js')(ipcRenderer, webUtils);

if (IS_FILO_ORIGIN) window.filo = filoApi;
// Come dalle pagine web: senza, Cerca dal tasto destro chiudeva la misura al clic (#1461.1).
if (IS_FILO_ORIGIN) {
  try { globalThis.SN_APERTURA_SCELTA = require('./apertura-scelta.js')(ipcRenderer); } catch (e) { console.error('[Filo internal] apertura scelta', e); }
}

const chromeShim = require('./chrome-shim.js')(filoApi);

// ─── shortcut hook ─────────────────────────────────────────────────────────
// Gemello dell'adattatore in page-preload.js. La scorciatoia (Alt+E/Alt+T/
// Alt+H in shortcuts.js) e la voce "Aiuto" del menu tasto destro sulla linguetta
// (TabManager.openHelp in tabs.js) fanno webContents.send('shortcut:triggered')
// sul tab attivo. Il content script (content.js) ascolta MSG.SHORTCUT_TRIGGERED
// via chrome.runtime.onMessage: qui traduco l'evento IPC grezzo nel messaggio del
// catalogo e lo consegno ai listener del nostro shim. Senza questo adattatore le
// scorciatoie erano mute sulle pagine filo:// (i content script c'erano ma non
// ricevevano l'evento — asimmetria vs pagine web). `context` è opzionale (lo usa
// la voce "Aiuto" per dire all'agente da dove è stato invocato). Solo su origine
// filo://, dove lo shim e i content script sono davvero installati.
if (IS_FILO_ORIGIN) {
  const consegnaScorciatoia = require('./scorciatoia.js');
  ipcRenderer.on('shortcut:triggered', (_event, payload = {}) => {
    consegnaScorciatoia(chromeShim.runtime.onMessage._listeners, payload, filoApi.message);
  });
}

// #2444 — il menu di Filo qui lo monta content.js a fine init, dopo le impostazioni: l'ultimo tasto destro dato prima
// si tiene, e content.js lo passa appena ascolta dalla stessa porta dei tasti destri dati dopo.
if (IS_FILO_ORIGIN) {
  try {
    const attesa = require('./menu-del-sito.js').tastoDestroInAttesa(window);
    let menuInAscolto = false;
    window.addEventListener('contextmenu', (e) => { if (!menuInAscolto && e.isTrusted) attesa.tieni(e); });
    globalThis.__snTastoDestroInAttesa = () => {
      menuInAscolto = true;
      const copia = attesa.prendi();
      attesa.smetti();
      return copia;
    };
  } catch (e) { console.error('[Filo internal] tasto destro in attesa', e); }
}

// I content script si iniettano su TUTTE le pagine filo://: il tasto destro di
// Filo deve funzionare ovunque, pagine interne comprese.
const path = require('node:path');
const shouldInjectContentScripts = () => true;
function injectContentScriptStyles() {
  const STYLES = ['theme.css', 'menu.css', 'popup.css', 'sidebar.css', 'voce.css',
    'highlight.css', 'spellcheck.css', 'feedback.css', 'redteam-attack.css'];
  for (const f of STYLES) {
    if (document.querySelector(`link[href="filo://style/${f}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'filo://style/' + f;
    document.head.appendChild(link);
  }
}
// Stesso elenco di loadScripts() in page-preload.js: le differenze ammesse
// stanno in tests/unit/contentScriptPreload.test.mjs.
function loadContentScripts() {
  const SHARED = path.join(__dirname, '..', 'shared');
  const CONTENT = path.join(__dirname, '..', 'content');
  // Un modulo che la pagina ha già caricato coi suoi <script> non si riesegue (#1093): si pagherebbe due volte, e uno
  // con stato o ascoltatori (i18n, voceChat) ripartirebbe da capo. `globale`: l'ultimo nome che il modulo registra.
  // Sentinella: tests/unit/contentScriptPreload.test.mjs.
  const safe = (p, globale) => {
    if (globale && typeof globalThis[globale] !== 'undefined') return;
    try { require(p); } catch (e) { console.error('[Filo CS]', p, e.message); }
  };
  // L'ordine conta: le ragioni stanno in fila nella gemella src/preload/page-preload.js.
  safe(path.join(SHARED, 'constants.js'), 'SN_CONST');
  safe(path.join(SHARED, 'immaginiChat.js'), 'SN_IMMAGINI_CHAT'); // #1623 — le immagini date all'Aiuto: PRIMA di sidebar.js
  safe(path.join(SHARED, 'allegatiSegnalazione.js'), 'SN_ALLEGATI_SEGNALAZIONE'); // #1664 — le immagini di una segnalazione dell'Aiuto: PRIMA di sidebar.js
  safe(path.join(SHARED, 'contenutoEsterno.js'), 'SN_ESTERNO'); // #593 — imbusta il contenuto esterno: PRIMA di sidebar.js
  // Il marchio della UI di Filo (menu, avvisi, popup): lo mettono i moduli che
  // la disegnano, lo legge chi cammina sulla pagina.
  safe(path.join(SHARED, 'filoUi.js'), 'SN_FILO_UI');
  safe(path.join(SHARED, 'fontGenerico.js'), 'SN_FONT_GENERICO');
  safe(path.join(SHARED, 'i18n.js'), 'SN_I18N');
  safe(path.join(SHARED, 'clipboardHistory.js'), 'SN_CLIPBOARD'); // #256 — cronologia appunti: chiave e testi uguali da ogni parte
  safe(path.join(SHARED, 'messages.js'), 'SN_MSG');
  safe(path.join(SHARED, 'tasti.js'), 'SN_TASTI'); // nomi delle scorciatoie per il sistema di chi legge: PRIMA di menu/actions/content
  safe(path.join(SHARED, 'disposizioneIcone.js'), 'SN_DISPOSIZIONE_ICONE'); // dove sta ogni icona globale: PRIMA di menuIcons
  safe(path.join(SHARED, 'gestiContati.js'), 'SN_GESTI'); // #1471 — segno dei trascinamenti e nome letto su un'icona: PRIMA di menu.js
  safe(path.join(SHARED, 'campoTesto.js'), 'SN_CAMPO_TESTO'); // "si sta scrivendo qui?": PRIMA di content.js, che ci decide Ctrl+Z
  safe(path.join(SHARED, 'schedeInChat.js'), 'SN_SCHEDE_IN_CHAT'); // #2085 — gettoni delle schede: PRIMA di sidebar.js
  safe(path.join(SHARED, 'schedaTrascinata.js'), 'SN_SCHEDA_TRASCINATA'); // #2084 — la scheda lasciata qui: PRIMA di sidebar.js
  safe(path.join(SHARED, 'trascinoInterno.js'), 'SN_TRASCINO_INTERNO'); // #2300 — il gettone dei trascinamenti interni: PRIMA di sidebar.js
  safe(path.join(SHARED, 'testoDiAltri.js'), 'SN_TESTO_DI_ALTRI'); // #1840 — il testo incollato è di altri: PRIMA di sidebar.js
  safe(path.join(SHARED, 'ricercaCampo.js'), 'SN_RICERCA_CAMPO'); // #824 — "è una ricerca?": PRIMA di content.js
  safe(path.join(SHARED, 'accessoFisso.js'), 'SN_ACCESSO_FISSO'); // #1808 — la password dell'accesso fisso: PRIMA di content.js
  safe(path.join(SHARED, 'urlNav.js'), 'SN_URL_NAV'); // #437 — "è davvero un indirizzo?" per Copia URL/Condividi
  safe(path.join(SHARED, 'nomiSito.js'), 'SN_NOMI_SITO'); // #843 — il sito di «Spegni Filo su questo sito»
  safe(path.join(SHARED, 'wallet.js'), 'SN_WALLET'); // #664 — «è un link d'invito?» per il tasto destro
  safe(path.join(SHARED, 'filoMarkdown.js'), 'SN_MARKDOWN'); // #853 — senza, le risposte del modello entrano come HTML
  safe(path.join(SHARED, 'spiegazioni.js'), 'SN_SPIEGAZIONI'); // #2388 — le spiegazioni al passaggio di popup e Aiuto
  safe(path.join(SHARED, 'linkSospetto.js'), 'SN_LINK_SOSPETTO'); // #725 — link sospetti: euristica e frasi, PRIMA di actions.js
  safe(path.join(SHARED, 'themeTokens.js'), 'SN_THEME_TOKENS');
  safe(path.join(SHARED, 'suggerimento.js'), 'SN_SUGGERIMENTO'); // #2095 — il fumetto di Filo al posto del title nativo: DOPO themeTokens
  safe(path.join(SHARED, 'confirmUi.js'), 'SN_CONFIRM_UI');
  safe(path.join(SHARED, 'chatErrors.js'), 'SN_CHAT_ERRORS'); // #360 — errori tecnici → frasi per l'utente
  safe(path.join(SHARED, 'icons.js'), 'SN_ICONS_UTIL');
  safe(path.join(SHARED, 'qr.js'), 'SN_QR');
  safe(path.join(SHARED, 'calcMarkers.js'), 'SN_CALC'); // #724 — calcolatrice e marker [[calc:]]: PRIMA di popup.js
  safe(path.join(SHARED, 'overlayPlacement.js'), 'SN_PLACE'); // #500 — geometria di menu e riquadro risposta: PRIMA di popup.js e menu.js
  safe(path.join(SHARED, 'guardianoStatico.js'), 'SN_GUARDIANO_STATICO'); // #810.7 — la forma di un numero di carta: PRIMA di extractContext
  safe(path.join(SHARED, 'campiSegreti.js'), 'SN_CAMPI_SEGRETI'); // #810.7 — campi che non vanno al modello: PRIMA di extractContext
  safe(path.join(CONTENT, 'extractContext.js'));
  safe(path.join(CONTENT, 'gesto.js')); // #1070 — «l'utente ha appena fatto qualcosa?»: PRIMA di spellcheck.js e actions.js
  safe(path.join(SHARED, 'avvisiTempo.js'), 'SN_AVVISI'); // tempi della pila degli avvisi: PRIMA di popup.js
  safe(path.join(SHARED, 'azioniMessaggio.js'), 'SN_AZIONI_MESSAGGIO'); // #2096 — Copia e Rispondi sui messaggi: PRIMA di popup.js e sidebar.js
  safe(path.join(CONTENT, 'popup.js'));
  safe(path.join(CONTENT, 'vistoDavvero.js')); // #589.11 — sulle pagine di Filo resta spento: nessun sito può coprire il menu
  safe(path.join(CONTENT, 'menu.js'));
  safe(path.join(CONTENT, 'highlight.js'));
  safe(path.join(SHARED, 'immaginePrincipale.js'), 'SN_IMMAGINE_PRINCIPALE'); // #2371 — PRIMA di aiutoPagina.js
  safe(path.join(SHARED, 'traduzioneDellaPagina.js'), 'SN_TRADUZIONE_PAGINA'); // #504 — PRIMA di aiutoPagina.js
  safe(path.join(CONTENT, 'aiutoPagina.js')); // #1509.3 — quello che l'Aiuto fa sulla pagina: DOPO highlight.js
  safe(path.join(CONTENT, 'sidebar.js'));
  safe(path.join(CONTENT, 'coerenza.js')); // #1115 — date e citazioni del segno ocra: PRIMA di spellcheck.js
  safe(path.join(CONTENT, 'correttoreRegole.js')); // #1446 — candidati e risposte del correttore: PRIMA di spellcheck.js
  safe(path.join(CONTENT, 'correttoreAutomatica.js')); // #1447 — correzione a fine parola: PRIMA di spellcheck.js
  try { globalThis.SN_DIZIONARIO = require('./dizionario.js')(ipcRenderer, webFrame); } catch (e) { console.error('[Filo CS] dizionario', e.message); } // #1446 — PRIMA di spellcheck.js
  safe(path.join(CONTENT, 'spellcheck.js'));
  safe(path.join(SHARED, 'feedback.js'), 'SN_FEEDBACK');
  safe(path.join(SHARED, 'feedbackClientIdHash.js'), 'SN_FEEDBACK_CLIENT_ID_HASH');
  safe(path.join(SHARED, 'feedbackAttachTypes.js'), 'SN_FEEDBACK_ATTACH'); // allowlist tipi allegato
  safe(path.join(CONTENT, 'feedback.js'));
  safe(path.join(CONTENT, 'redteamAttack.js'));
  safe(path.join(SHARED, 'tabColor.js'), 'SN_TAB_COLOR');
  safe(path.join(CONTENT, 'pageColor.js'));
  safe(path.join(CONTENT, 'translatePage.js'));
  safe(path.join(SHARED, 'ttsChunk.js'), 'SN_TTS_CHUNK');
  safe(path.join(SHARED, 'modelCaps.js'), 'SN_MODEL_CAPS');
  safe(path.join(SHARED, 'ttsVoices.js'), 'SN_TTS_VOICES');
  safe(path.join(SHARED, 'dictationSegmenter.js'), 'SN_DICTATION_SEGMENTER');
  safe(path.join(SHARED, 'ascolto.js'), 'SN_ASCOLTO'); // microfono e trascrizione: Detta e le chat
  safe(path.join(SHARED, 'voceChat.js'), 'SN_VOCE_CHAT'); // tasto microfono delle chat, a cui «Detta» passa la mano
  safe(path.join(SHARED, 'trascriviMedia.js'), 'SN_TRASCRIVI_MEDIA'); // #1660 — i tetti di «Trascrivi» su un audio
  // Solo nei test: modelli di prova (vedi loader.js).
  if (process.env.NODE_ENV === 'test') safe(path.join(SHARED, '..', '..', 'tests', 'fixtures', 'testModels.js'));
  safe(path.join(CONTENT, 'tts.js'));
  safe(path.join(CONTENT, 'editBox.js'));
  safe(path.join(SHARED, 'trascrizioneRighe.js'), 'SN_TRASCRIZIONE_RIGHE');
  safe(path.join(CONTENT, 'trascrizione.js'));
  safe(path.join(CONTENT, 'actions.js'));
  safe(path.join(CONTENT, 'menuIcons.js'));
  safe(path.join(CONTENT, 'content.js'));
  try {
    document.documentElement.dataset.filoReady = '1';
    document.documentElement.dataset.filoContentScripts = '1';
  } catch (_) {}
}
// Lo stub chrome di Chromium va sovrascritto PRIMA dei content script: content.js legge le
// impostazioni in init() e sendMessage dev'essere già il nostro. Solo su origine filo:.
if (IS_FILO_ORIGIN) {
  try {
    Object.defineProperty(window, 'chrome', {
      value: chromeShim,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {
    try { window.chrome = chromeShim; } catch (_) { console.warn('[Filo] impossibile sovrascrivere window.chrome', e); }
  }
}

function bootContentScripts() {
  if (!shouldInjectContentScripts()) return;
  injectContentScriptStyles();
  loadContentScripts();
}
if (IS_FILO_ORIGIN) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootContentScripts, { once: true });
  } else {
    bootContentScripts();
  }
} else {
  try {
    console.warn('[Filo] internal-preload su origine non-filo:', location.href,
      '— API privilegiate non esposte');
  } catch (_) {}
}
