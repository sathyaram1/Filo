// La barra dei menu dell'applicazione.
//
// PERCHÉ ESISTE (#527)
//   Su Windows e Linux la finestra di Filo è senza cornice: nessuna barra dei
//   menu viene disegnata e i suoi tasti non arrivano a nessuno. Su macOS la
//   barra è dell'APPLICAZIONE: sta in cima allo schermo, c'è sempre — anche con
//   la finestra senza cornice — ed è la PRIMA a vedere i tasti, prima di
//   qualunque cosa la pagina ascolti.
//
//   Filo non ne dichiarava nessuna, quindi restava appesa quella di serie di
//   Electron: in inglese, con le voci di un altro prodotto e i link al suo
//   sito, e con otto voci che si prendevano Cmd+W, Cmd+R, Cmd+Z e Cmd +/-/0 —
//   cioè proprio le scorciatoie che il manifesto delle capacità promette
//   all'utente Mac. Chiudere una scheda gli chiudeva la finestra intera.
//
// LA REGOLA, UNA SOLA
//   Ogni tasto che compare in questa barra fa ESATTAMENTE quello che Filo fa
//   già per quel tasto. Non basta togliere la barra: su macOS Chromium NON ha
//   scorciatoie di modifica proprie (taglia, copia, incolla, seleziona tutto,
//   annulla le lascia apposta al menu dell'applicazione), quindi una barra
//   assente spegne copia e incolla in ogni campo di testo. Va sostituita, non
//   rimossa.
//
//   Da qui le due metà del file:
//   · i `role` di Electron si usano SOLO dove il tasto non è di Filo (taglia,
//     copia, incolla, seleziona tutto, nascondi, riduci a icona, esci);
//   · dove il tasto è di Filo (T, W, R, Z, +, -, 0) la voce NON ha `role`: ha
//     un `click` che chiama la stessa funzione della scorciatoia. Un `role` lì
//     significherebbe il comportamento di Electron al posto di quello di Filo,
//     ed è esattamente il difetto che questo file chiude.
//
//   `registerAccelerator: false` non è una via d'uscita su Mac: Electron lo
//   onora solo su Windows e Linux. Lì lo usiamo, ed è giusto — i tasti li
//   gestiscono già le pagine (src/main/tabs.js, src/renderer/shell.js), la
//   barra non si vede e non deve toglierglieli. Su Mac l'unico modo di non
//   prendersi un tasto è non scriverlo.
//
// NIENTE STRUMENTI DA SVILUPPATORE
//   La barra di serie apriva le DevTools con Opzione+Cmd+I a chiunque. Non è
//   una voce per l'utente di Filo: qui non c'è.

const { Menu, app, BrowserWindow, webContents } = require('electron');

const MAC = process.platform === 'darwin';

// Tasti che le pagine di Filo gestiscono già da sé: su Windows e Linux la voce
// mostra la scritta ma NON registra il tasto (là arriva alla pagina, e la
// pagina sa cosa farne). Su Mac la barra lo registra comunque — ed è per questo
// che la voce deve fare la cosa giusta.
const SOLO_SCRITTA = MAC ? {} : { registerAccelerator: false };

// ─── a chi si parla ─────────────────────────────────────────────────────────

function finestra() {
  const messa = BrowserWindow.getFocusedWindow();
  if (messa && messa._filoTabs) return messa;
  return BrowserWindow.getAllWindows().find((w) => w._filoTabs) || null;
}

function schedaAttiva() {
  const win = finestra();
  const tabs = win && win._filoTabs;
  if (!tabs) return null;
  const tab = tabs.tabs.find((t) => t.id === tabs.activeId);
  return tab ? { win, tabs, tab } : null;
}

// La webContents che ha davvero il cursore: può essere la shell (la fila delle
// schede) o la pagina dentro la scheda attiva.
function contenutoAFuoco() {
  try {
    const wc = webContents.getFocusedWebContents();
    if (wc && !wc.isDestroyed()) return wc;
  } catch (_) {}
  const c = schedaAttiva();
  const wc = c && c.tab.view && c.tab.view.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

// L'utente sta scrivendo in un campo di testo? La regola è una sola e sta in
// src/shared/campoTesto.js: qui la mandiamo a valutare dentro la pagina.
// #405: la domanda va fatta al RIQUADRO con cui l'utente ha interagito per
// ultimo (un commento dentro un iframe è un campo di testo tanto quanto uno
// nella pagina che lo ospita).
async function staScrivendo(wc) {
  if (!wc) return false;
  let dove = wc;
  try {
    const frame = wc._filoActiveFrame;
    if (frame && !frame.detached) dove = frame;
  } catch (_) { dove = wc; }
  const sorgente = globalThis.SN_CAMPO_TESTO && globalThis.SN_CAMPO_TESTO.sorgenteScriveQui();
  if (!sorgente) return true;
  try {
    return !!(await dove.executeJavaScript(sorgente, false));
  } catch (_) {
    // Nel dubbio si annulla, non si naviga: annullare quando non c'è niente da
    // annullare non fa nulla, mentre andare indietro mentre si scrive porta via
    // il testo appena battuto.
    return true;
  }
}

// ─── le azioni, le stesse delle scorciatoie ─────────────────────────────────

function nuovaScheda() {
  const win = finestra();
  try { win && win._filoTabs.openTab('filo://newtab/'); } catch (_) {}
}

function chiudiScheda() {
  const c = schedaAttiva();
  try { c && c.tabs.closeTab(c.tab.id); } catch (_) {}
}

function chiudiFinestra() {
  const win = finestra();
  try { win && win.close(); } catch (_) {}
}

function ricarica() {
  const c = schedaAttiva();
  try { c && c.tabs.reload(c.tab.id); } catch (_) {}
}

function vaiAScrivereUnIndirizzo() {
  const c = schedaAttiva();
  if (c) { try { c.tabs.navigate(c.tab.id, 'filo://newtab/'); } catch (_) {} return; }
  nuovaScheda();
}

// Lo zoom è della PAGINA, non della fila delle schede: passa dallo stesso punto
// da cui passa Ctrl+rotella (src/preload/wheel-zoom.js), così le pagine che
// zoomano da sé — l'editor — restano escluse anche da questa strada.
function zoom(verso) {
  const c = schedaAttiva();
  if (!c) return;
  try { c.tab.view.webContents.send('filo:zoom-key', verso); } catch (_) {}
}

function schermoIntero() {
  const win = finestra();
  try { win && win._filoTabs.toggleContentFullscreen(); } catch (_) {}
}

function apriPagina(url) {
  const win = finestra();
  try { win && win._filoTabs.openTab(url); } catch (_) {}
}

function finestraIncognito() {
  try { require('./window').createIncognitoWindow(); } catch (_) {}
}

function assistenteLaterale() {
  try { require('./shortcuts').dispatch('open-help-sidebar', finestra()); } catch (_) {}
}

// Ctrl/Cmd+Z: dentro un campo di testo annulla quello che si sta scrivendo,
// fuori torna alla pagina precedente. È la stessa regola di src/content/content.js
// — quella strada vale dove il tasto arriva alla pagina, questa dove se lo
// prende la barra dei menu.
async function annulla() {
  const wc = contenutoAFuoco();
  if (!wc) return;
  if (await staScrivendo(wc)) { try { wc.undo(); } catch (_) {} return; }
  const c = schedaAttiva();
  try { c && c.tabs.goBack(c.tab.id); } catch (_) {}
}

// Ctrl/Cmd+Shift+Z: solo "ripeti", e solo mentre si scrive. Fuori da un campo
// di testo non significa niente (Filo non ha un "avanti" su questo tasto), e
// una voce che non fa niente è meglio di una che fa una cosa a sorpresa.
async function ripeti() {
  const wc = contenutoAFuoco();
  if (!wc) return;
  if (await staScrivendo(wc)) { try { wc.redo(); } catch (_) {} }
}

// ─── la barra ───────────────────────────────────────────────────────────────

function template() {
  const menuFilo = {
    label: 'Filo',
    submenu: [
      { role: 'about', label: 'Informazioni su Filo' },
      { type: 'separator' },
      { label: 'Preferenze…', accelerator: 'CommandOrControl+,', click: () => apriPagina('filo://preferences/preferences.html') },
      { label: 'Opzioni', click: () => apriPagina('filo://options/options.html') },
      { type: 'separator' },
      ...(MAC ? [
        { role: 'services', label: 'Servizi' },
        { type: 'separator' },
        { role: 'hide', label: 'Nascondi Filo' },
        { role: 'hideOthers', label: 'Nascondi le altre' },
        { role: 'unhide', label: 'Mostra tutte' },
        { type: 'separator' },
      ] : []),
      { role: 'quit', label: 'Esci da Filo' },
    ],
  };

  const menuSchede = {
    label: 'Schede',
    submenu: [
      { label: 'Nuova scheda', accelerator: 'CommandOrControl+T', click: nuovaScheda, ...SOLO_SCRITTA },
      { label: 'Nuova finestra in incognito', accelerator: 'CommandOrControl+Shift+N', click: finestraIncognito },
      { type: 'separator' },
      { label: 'Vai a un indirizzo', accelerator: 'CommandOrControl+L', click: vaiAScrivereUnIndirizzo, ...SOLO_SCRITTA },
      { label: 'Ricarica', accelerator: 'CommandOrControl+R', click: ricarica, ...SOLO_SCRITTA },
      { label: 'Cronologia', click: () => apriPagina('filo://history/history.html') },
      { type: 'separator' },
      // Cmd+W chiude la SCHEDA, non la finestra: è quello che Filo promette e
      // quello che fa dovunque non ci sia una barra dei menu di mezzo.
      { label: 'Chiudi scheda', accelerator: 'CommandOrControl+W', click: chiudiScheda, ...SOLO_SCRITTA },
      { label: 'Chiudi finestra', click: chiudiFinestra },
    ],
  };

  const menuModifica = {
    label: 'Modifica',
    submenu: [
      { label: 'Annulla', accelerator: 'CommandOrControl+Z', click: annulla, ...SOLO_SCRITTA },
      { label: 'Ripeti', accelerator: 'CommandOrControl+Shift+Z', click: ripeti, ...SOLO_SCRITTA },
      { type: 'separator' },
      { role: 'cut', label: 'Taglia' },
      { role: 'copy', label: 'Copia' },
      { role: 'paste', label: 'Incolla' },
      { role: 'pasteAndMatchStyle', label: 'Incolla senza formato' },
      { role: 'selectAll', label: 'Seleziona tutto' },
    ],
  };

  const menuVista = {
    label: 'Vista',
    submenu: [
      { label: 'Ingrandisci', accelerator: 'CommandOrControl+Plus', click: () => zoom('in'), ...SOLO_SCRITTA },
      // Sulle tastiere il "+" si fa con Shift: senza questo alias Cmd+= — il
      // modo in cui lo zoom si preme davvero — resterebbe scoperto.
      { label: 'Ingrandisci', accelerator: 'CommandOrControl+=', click: () => zoom('in'), visible: false, ...SOLO_SCRITTA },
      { label: 'Rimpicciolisci', accelerator: 'CommandOrControl+-', click: () => zoom('out'), ...SOLO_SCRITTA },
      { label: 'Dimensione reale', accelerator: 'CommandOrControl+0', click: () => zoom('reset'), ...SOLO_SCRITTA },
      { type: 'separator' },
      { label: 'Schermo intero', accelerator: MAC ? 'Control+Command+F' : 'F11', click: schermoIntero },
    ],
  };

  const menuFinestra = {
    label: 'Finestra',
    submenu: [
      { role: 'minimize', label: 'Riduci a icona' },
      ...(MAC ? [
        { role: 'zoom', label: 'Ingrandisci finestra' },
        { type: 'separator' },
        { role: 'front', label: 'Porta tutto in primo piano' },
      ] : []),
    ],
  };

  const menuAiuto = {
    label: 'Aiuto',
    role: 'help',
    submenu: [
      { label: 'Assistente laterale', click: assistenteLaterale },
      { label: 'Cronologia', click: () => apriPagina('filo://history/history.html') },
    ],
  };

  return [menuFilo, menuSchede, menuModifica, menuVista, menuFinestra, menuAiuto];
}

// Da chiamare una volta sola, dopo `app.whenReady()`.
function installaMenuApplicazione() {
  try {
    app.setAboutPanelOptions({ applicationName: 'Filo', applicationVersion: app.getVersion() });
  } catch (_) {}
  try {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template()));
  } catch (e) {
    console.warn('[Filo] barra dei menu non installata', e && e.message);
  }
}

module.exports = { installaMenuApplicazione, template, annulla, ripeti, staScrivendo };
