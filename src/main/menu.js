// La barra dei menu dell'applicazione (#527). Su Mac esiste sempre ed è la
// PRIMA a vedere i tasti: ogni voce deve fare ESATTAMENTE quello che Filo fa già
// per quel tasto, e togliere la barra non è un'uscita (spegnerebbe copia e
// incolla). Perché e storia: patterns/quello-che-il-sistema-aggancia-da-se-va-dichiarato.md.

// Electron si chiede DENTRO le funzioni: così `template()` lo legge anche la
// sentinella degli unit test, che gira in Node puro.
const MAC = process.platform === 'darwin';

// Voce che mostra la scritta senza registrare il tasto. Su Mac non si può:
// Electron onora `registerAccelerator: false` solo su Windows e Linux, quindi
// lì la barra il tasto se lo prende e la voce deve fare la cosa giusta.
const SOLO_SCRITTA = MAC ? {} : { registerAccelerator: false };

function finestra() {
  const { BrowserWindow } = require('electron');
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

// Può essere la shell (la fila delle schede) o la pagina dentro la scheda.
function contenutoAFuoco() {
  try {
    const { webContents } = require('electron');
    const wc = webContents.getFocusedWebContents();
    if (wc && !wc.isDestroyed()) return wc;
  } catch (_) {}
  const c = schedaAttiva();
  const wc = c && c.tab.view && c.tab.view.webContents;
  return wc && !wc.isDestroyed() ? wc : null;
}

// La regola sta in src/shared/campoTesto.js: qui si manda a valutare dentro la
// pagina. #405 — si chiede all'ultimo riquadro toccato, non alla pagina madre.
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
    // Nel dubbio si annulla: un annulla a vuoto non fa niente, un "indietro"
    // mentre si scrive porta via il testo appena battuto.
    return true;
  }
}

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

// Stessa porta di Ctrl+rotella (src/preload/wheel-zoom.js): lo zoom è della
// PAGINA, e le pagine che zoomano da sé restano escluse anche da qui.
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

// Ctrl/Cmd+Z: nel campo di testo annulla, fuori torna indietro. Stessa regola di
// src/content/content.js, che vale quando il tasto arriva alla pagina.
async function annulla() {
  const wc = contenutoAFuoco();
  if (!wc) return;
  if (await staScrivendo(wc)) { try { wc.undo(); } catch (_) {} return; }
  const c = schedaAttiva();
  try { c && c.tabs.goBack(c.tab.id); } catch (_) {}
}

// Solo mentre si scrive: fuori da un campo Filo non ha un "avanti" su questo
// tasto, e una voce che non fa niente è meglio di una che sorprende.
async function ripeti() {
  const wc = contenutoAFuoco();
  if (!wc) return;
  if (await staScrivendo(wc)) { try { wc.redo(); } catch (_) {} }
}

function template() {
  const menuFilo = {
    label: 'Filo',
    submenu: [
      { role: 'about', label: 'Informazioni su Filo' },
      { type: 'separator' },
      { label: 'Preferenze', click: () => apriPagina('filo://preferences/preferences.html') },
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
      { label: 'Nuova finestra in incognito', click: finestraIncognito },
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
      // Senza acceleratore, e non è una dimenticanza: in questa barra ci vanno
      // SOLO i tasti che Filo fa già ovunque. Un tasto che qui funziona e su
      // Windows no sarebbe la stessa asimmetria da cui nasce tutto #527.
      { label: 'Schermo intero', click: schermoIntero },
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
    ],
  };

  return [menuFilo, menuSchede, menuModifica, menuVista, menuFinestra, menuAiuto];
}

// Da chiamare una volta sola, dopo `app.whenReady()`.
function installaMenuApplicazione() {
  const { Menu, app } = require('electron');
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
