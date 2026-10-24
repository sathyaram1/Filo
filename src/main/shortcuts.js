// Le quattro scorciatoie di Filo (Spiega, Traduci, Salva per dopo, Aiuto), sui tasti scelti dall'utente (#842), e lo schermo intero:
// valgono solo con Filo in primo piano, mai come scorciatoie di sistema (#838). Tasti e nomi: src/shared/tasti.js.
// Sentinelle: tests/unit/scorciatoieSoloInFilo.test.mjs, tests/unit/scorciatoieFilo.test.mjs.

const { BrowserWindow } = require('electron');
require('../shared/tasti');

// I tasti di serie, combinazione → comando: la scelta dell'utente la tiene SN_TASTI.
const COMMANDS = Object.freeze(Object.fromEntries(globalThis.SN_TASTI.AZIONI_FILO.map((a) => [a.serie, a.id])));

// All'avvio e a ogni cambio delle impostazioni: da qui in poi valgono i tasti nuovi, e i vecchi tornano alla pagina.
function configura(settings) {
  globalThis.SN_TASTI.usaScorciatoieFilo(settings && settings.scorciatoie);
}

// Le combinazioni dei moduli dell'Editor stanno nei suoi documenti: la chat e il salvataggio le confrontano con le
// quattro, quindi il main le segue da quando parte a ogni salvataggio dell'Editor.
const COLLEZIONE_EDITOR = 'filo.editor.collection';
let moduliSeguiti = false;
async function seguiModuliEditor() {
  if (moduliSeguiti) return;
  moduliSeguiti = true;
  const Storage = require('./shim/storage');
  Storage.onChanged((cambi) => {
    if (cambi && cambi[COLLEZIONE_EDITOR]) globalThis.SN_TASTI.usaScorciatoieModuli(cambi[COLLEZIONE_EDITOR].newValue);
  });
  try {
    const r = await Storage.get(COLLEZIONE_EDITOR);
    globalThis.SN_TASTI.usaScorciatoieModuli(r && r[COLLEZIONE_EDITOR]);
  } catch (_) {}
}

function comandoDaTasto(input, piattaforma = process.platform) {
  if (!input || input.type !== 'keyDown') return null;
  return globalThis.SN_TASTI.azioneFiloDaTasto(input, piattaforma);
}

// Le Preferenze stanno registrando una combinazione: i tasti che Filo si prende prima
// della pagina (le quattro, schede, zoom, barra) devono arrivarle, o Ctrl+T aprirebbe
// una scheda invece di dire perché non si può. Lo chiede solo una pagina di Filo, e scade da sé.
const REGISTRA_PER_MS = 60_000;
function registraTasti(wc, attivo) {
  if (!wc) return;
  wc._filoRegistraTastiFino = attivo ? Date.now() + REGISTRA_PER_MS : 0;
}
function staRegistrandoTasti(wc) {
  return !!(wc && wc._filoRegistraTastiFino && wc._filoRegistraTastiFino > Date.now());
}

// Da chiamare su ogni webContents di Filo che può avere il fuoco (scheda, barra,
// menu a comparsa): il tasto arriva lì solo se Filo è davanti. `finestra` è
// quella su cui agire (o una funzione che la dà), mai un'altra finestra di Filo.
function collegaScorciatoie(wc, finestra) {
  if (!wc || typeof wc.on !== 'function') return;
  wc.on('before-input-event', (event, input) => {
    if (staRegistrandoTasti(wc)) return;
    if (tastoSchermoIntero(wc, event, input, finestra)) return;
    const command = comandoDaTasto(input);
    if (!command) return;
    event.preventDefault();
    // Tenuto premuto non si ripete: Alt+S chiuderebbe una scheda dopo l'altra.
    if (input.isAutoRepeat) return;
    dispatch(command, typeof finestra === 'function' ? finestra() : finestra);
  });
}

// Lo schermo intero da tastiera, la stessa commutazione della voce di menu, da qualunque vista abbia il fuoco
// (tranne la pagina che s'è presa lo schermo pieno col suo pulsante: `schermoPienoDi`).
function tastoSchermoIntero(wc, event, input, finestra) {
  if (!input || input.type !== 'keyDown' || !globalThis.SN_TASTI.comandoSchermoIntero(input)) return false;
  const tabs = finestraDiFilo(typeof finestra === 'function' ? finestra() : finestra)?._filoTabs;
  if (!tabs || tabs.schermoPienoDi(wc)) return false;
  event.preventDefault();
  // Tenuto premuto non lampeggia: entra una volta sola. È la stessa azione contata della voce di menu (#1461).
  if (!input.isAutoRepeat) {
    require('./services/azioniContate').azione('fullscreen', () => tabs.toggleContentFullscreen(), { incognito: !!(tabs.win && tabs.win._filoIncognito) });
  }
  return true;
}

// L'URL serve alle schede in transizione, dove `isInternal` non è ancora aggiornato.
function isInternalTab(tab) {
  if (!tab) return false;
  return !!tab.isInternal || String(tab.url || '').startsWith('filo://');
}

// Le scorciatoie vanno alla finestra di Filo che l'utente ha davanti (anche l'incognito):
// `ripiego` vale solo se a fuoco non c'è una finestra con schede (un menu a comparsa).
function finestraDiFilo(ripiego) {
  const viva = (w) => !!(w && w._filoTabs && !(typeof w.isDestroyed === 'function' && w.isDestroyed()));
  let aFuoco = null;
  try { aFuoco = BrowserWindow.getFocusedWindow?.() || null; } catch (_) {}
  if (viva(aFuoco)) return aFuoco;
  if (viva(ripiego)) return ripiego;
  try { return (BrowserWindow.getAllWindows?.() || []).find(viva) || null; } catch (_) { return null; }
}

// L'Aiuto laterale e Salva per dopo si contano qui, dove arrivano il tasto, la barra dei menu e chi altro li chiede
// (#1461): la stessa azione dell'icona del tasto destro.
const AZIONE_DEL_COMANDO = { 'open-help-sidebar': 'help-sidebar', 'save-for-later': 'save-for-later' };
function dispatch(command, window) {
  const azione = AZIONE_DEL_COMANDO[command];
  if (!azione) return dispatchOra(command, window);
  const win = finestraDiFilo(window);
  return require('./services/azioniContate').azione(azione, () => dispatchOra(command, window), { incognito: !!(win && win._filoIncognito) });
}

function dispatchOra(command, window) {
  // Manda al webContents della tab attiva. Se è una pagina interna senza
  // content script, nessuno raccoglie: ok, è il comportamento atteso.
  const win = finestraDiFilo(window);
  if (!win) return;
  const active = win._filoTabs.tabs.find((t) => t.id === win._filoTabs.activeId);
  if (!active) return;

  if (command === 'save-for-later') {
    // Una pagina filo:// non va salvata né chiusa: l'uscita è esplicita perché questo comando,
    // a differenza degli altri, agisce comunque.
    if (isInternalTab(active)) return;
    return saveForLater(win, active).catch((e) => console.warn('[Filo] save-for-later failed', e));
  }
  // Sotto l'avviso del sito pericoloso un pannello della pagina non si vedrebbe: l'Aiuto lì è la domanda a Filo (#813.5).
  const tm = win._filoTabs;
  if (tm.avvisoSito && tm.avvisoSito.coperta() === active) {
    if (command === 'open-help-sidebar') require('./services/interruttoreAiuto').seAcceso(win, () => tm._sbScelta(active, 'chiedi'));
    return;
  }
  const wc = active.view.webContents;
  // #405 — la selezione può stare in un riquadro incorporato, e `webContents.send` parla solo
  // col frame principale: questi comandi vanno all'ultimo frame toccato dall'utente.
  const SELECTION_COMMANDS = new Set(['explain-selection', 'translate-selection']);
  let target = wc;
  if (SELECTION_COMMANDS.has(command)) {
    try {
      const frame = wc._filoActiveFrame;
      if (frame && !frame.detached) target = frame;
    } catch (_) { target = wc; }
  }
  try { target.send('shortcut:triggered', { command }); } catch (_) {
    try { wc.send('shortcut:triggered', { command }); } catch (_) {}
  }
}

// #839 — Alt+S e il menu sono la stessa azione: la fa la pagina (savePage nel content script), con la sua
// miniatura, la conferma cliccabile e la chiusura, anche dove Filo è spento. Il main salva da solo solo se la pagina non risponde.
const ATTESA_RICEVUTA_MS = 3500;
const ricevuteInAttesa = new Map();

function consegnaConRicevuta(tab, command, attesaMs = ATTESA_RICEVUTA_MS, context) {
  return new Promise((resolve) => {
    const ricevuta = crypto.randomUUID();
    const chiudi = (presa) => {
      clearTimeout(timer);
      ricevuteInAttesa.delete(ricevuta);
      resolve(presa);
    };
    const timer = setTimeout(() => chiudi(false), attesaMs);
    ricevuteInAttesa.set(ricevuta, { tabId: tab.id, chiudi });
    // `scade`: una pagina che la prende quando il main ha smesso di aspettare non la esegue, se no si salva due volte.
    const scade = Date.now() + attesaMs;
    try { tab.view.webContents.send('shortcut:triggered', { command, ricevuta, context, scade }); } catch (_) { chiudi(false); }
  });
}

// La ricevuta vale solo dalla scheda a cui era stata consegnata.
function riceviRicevuta(ricevuta, tabId, presa) {
  const attesa = ricevuteInAttesa.get(ricevuta);
  if (!attesa || attesa.tabId !== tabId) return false;
  attesa.chiudi(!!presa);
  return true;
}

// Un secondo Alt+S sulla scheda che aspetta ancora la pagina o il ripiego non avvia un altro salvataggio con la sua conferma.
const salvataggiInCorso = new Set();

async function saveForLater(win, tab) {
  if (salvataggiInCorso.has(tab.id)) return;
  salvataggiInCorso.add(tab.id);
  let entry = null;
  try { entry = await salvaPerDopo(win, tab); } finally { salvataggiInCorso.delete(tab.id); }
  if (entry) await confermaSullaSchedaDavanti(win, entry);
}

// Il ripiego scrive dove scriverebbe la pagina passando dall'IPC: in incognito, nella memoria della sessione e non sul disco.
function comeLaFinestra(win, lavoro) {
  return win && win._filoIncognito ? require('./shim/storage').runIncognito(lavoro) : lavoro();
}

async function salvaPerDopo(win, tab) {
  const { handleMessage } = require('./services/handlers');
  const { dallaScheda } = require('./services/miniature');
  const { MSG } = globalThis.SN_MSG;
  // I dati della scheda si fotografano prima di ogni attesa: un redirect intanto farebbe salvare la pagina sbagliata (#334).
  const url = tab.url;
  const title = tab.title;
  const favicon = tab.faviconUrl || '';
  if (await consegnaConRicevuta(tab, 'save-for-later')) return null;
  // Pagina che non l'ha presa (ancora in caricamento, bloccata): si salva comunque, prima della miniatura.
  const entry = await comeLaFinestra(win, async () => {
    const res = await handleMessage({ type: MSG.SAVE_PAGE, page: { url, title, favicon } });
    const thumbnail = await dallaScheda(tab.view.webContents);
    if (thumbnail && res?.entry?.id) await globalThis.SN_SAVED_PAGES.setThumbnail(res.entry.id, thumbnail);
    return res?.entry;
  });
  try { win._filoTabs.closeTab(tab.id, { via: 'salva_per_dopo' }); } catch (_) {}
  return entry;
}

// La scheda salvata non poteva mostrare la conferma: la mostra quella che l'utente ha davanti adesso, senza chiudersi.
// Vale solo quando una pagina l'ha presa: la scheda nata al posto dell'ultima, o una che sta navigando, la prima la perde.
// Gli avvisi della cornice finiscono sotto la pagina, per questo non passa di lì.
async function confermaSullaSchedaDavanti(win, entry, { tentativoMs = 800, totaleMs = 10000 } = {}) {
  if (!entry?.id) return false;
  const context = { entry: { id: entry.id, category: entry.category || null }, conferma: crypto.randomUUID() };
  const fine = Date.now() + totaleMs;
  while (Date.now() < fine) {
    const tm = win && !(win.isDestroyed && win.isDestroyed()) ? win._filoTabs : null;
    if (!tm) return false;
    const davanti = tm.tabs.find((t) => t.id === tm.activeId);
    if (davanti && await consegnaConRicevuta(davanti, 'save-for-later-confirm', tentativoMs, context)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

module.exports = {
  collegaScorciatoie, comandoDaTasto, configura, seguiModuliEditor, registraTasti, staRegistrandoTasti, dispatch, saveForLater,
  consegnaConRicevuta, riceviRicevuta, confermaSullaSchedaDavanti, isInternalTab, COMMANDS,
};
