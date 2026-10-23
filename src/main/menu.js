// La barra dei menu dell'applicazione (#527). Su Mac esiste sempre ed è la prima a vedere
// i tasti: ogni voce fa esattamente quello che Filo fa già, e toglierla spegnerebbe copia
// e incolla. Il perché: patterns/quello-che-il-sistema-aggancia-da-se-va-dichiarato.md

// Electron si chiede DENTRO le funzioni, non qui in cima: così `template()` —
// la forma della barra, cioè la parte che va tenuta d'occhio — si legge anche
// dalla sentinella negli unit test, che gira in Node puro e in millisecondi
// sulla macchina di chi scrive la modifica.
// Il nome di una scorciatoia non si scrive a mano nemmeno qui: su Mac indietro
// e avanti stanno su un'altra combinazione (src/shared/tasti.js).
require('../shared/tasti');

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

// L'utente sta scrivendo in un campo di testo? La regola è una sola e sta in
// src/shared/campoTesto.js: qui la mandiamo a valutare dentro la pagina.
// Si parte sempre dalla pagina principale, che segue il fuoco fin dentro i
// riquadri della sua origine; un riquadro d'altra origine (null) si interroga a
// parte (#405, #685.1): l'ultimo riquadro toccato non è dove sta il fuoco.
async function staScrivendo(wc) {
  if (!wc) return false;
  const sorgente = globalThis.SN_CAMPO_TESTO && globalThis.SN_CAMPO_TESTO.sorgenteScriveQui();
  if (!sorgente) return true;
  try {
    const qui = await wc.executeJavaScript(sorgente, false);
    if (qui !== null) return !!qui;
    const riquadri = (wc.mainFrame && wc.mainFrame.framesInSubtree) || [];
    const risposte = await Promise.all(riquadri
      .filter((f) => f !== wc.mainFrame && require('./services/riquadroArrivato').riquadroArrivato(f))
      .map((f) => f.executeJavaScript(sorgente, false).catch(() => true)));
    return risposte.some((r) => r === true);
  } catch (_) {
    // Nel dubbio si annulla: un annulla a vuoto non fa niente, un "indietro"
    // mentre si scrive porta via il testo appena battuto.
    return true;
  }
}

const SORGENTE_CAMPO_VUOTO = `(() => {
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  if (!a) return false;
  const v = typeof a.value === 'string' ? a.value : a.textContent;
  return typeof v === 'string' && v.trim() === '';
})()`;
async function campoVuoto(wc) {
  try { return (await wc.executeJavaScript(SORGENTE_CAMPO_VUOTO, false)) === true; } catch (_) { return false; }
}

// Le Preferenze stanno registrando una scorciatoia (#842): su Mac la barra vede il tasto prima della pagina, che
// deve poterlo rifiutare col perché invece di vedere aprirsi una scheda. Il tasto le arriva com'è stato premuto.
function oRegistra(accel, fa, mac, aFuoco = contenutoAFuoco) {
  return (...args) => {
    const wc = aFuoco();
    if (!wc || !require('./shortcuts').staRegistrandoTasti(wc)) return fa(...args);
    const pezzi = String(accel).split('+');
    const keyCode = pezzi.pop();
    const nomi = { commandorcontrol: mac ? 'meta' : 'control', cmd: 'meta', command: 'meta', ctrl: 'control', control: 'control', alt: 'alt', shift: 'shift' };
    const modifiers = pezzi.map((m) => nomi[m.toLowerCase()]).filter(Boolean);
    try {
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    } catch (_) {}
    return undefined;
  };
}

// ─── le azioni, le stesse delle scorciatoie ─────────────────────────────────

// Ogni voce è un'azione contata (#1461), con lo stesso id della scorciatoia che la fa nelle pagine.
function contata(azione, fn) {
  return (...args) => {
    const win = finestra();
    return require('./services/azioniContate').azione(azione, () => fn(...args), { incognito: !!(win && win._filoIncognito) });
  };
}

const nuovaScheda = contata('new-tab', () => {
  const win = finestra();
  try { win && win._filoTabs.openTab('filo://newtab/'); } catch (_) {}
});

const chiudiScheda = contata('close-tab', () => {
  const c = schedaAttiva();
  try { c && c.tabs.closeTab(c.tab.id); } catch (_) {}
});

function chiudiFinestra() {
  const win = finestra();
  try { win && win.close(); } catch (_) {}
}

const ricarica = contata('reload', () => {
  const c = schedaAttiva();
  try { c && c.tabs.reload(c.tab.id); } catch (_) {}
});

// Indietro e avanti passano dalla stessa porta di tutte le altre strade
// (scorciatoia, tasti laterali del mouse, swipe): se non c'è dove andare non
// succede niente.
const indietro = contata('navigate-back-forward', () => {
  const c = schedaAttiva();
  try { c && c.tabs.navigaCronologia('indietro', c.tab.id); } catch (_) {}
});

const avanti = contata('navigate-back-forward', () => {
  const c = schedaAttiva();
  try { c && c.tabs.navigaCronologia('avanti', c.tab.id); } catch (_) {}
});

const vaiAScrivereUnIndirizzo = contata('address-bar', () => {
  const c = schedaAttiva();
  if (c) { try { c.tabs.navigate(c.tab.id, 'filo://newtab/'); } catch (_) {} return; }
  const win = finestra();
  try { win && win._filoTabs.openTab('filo://newtab/'); } catch (_) {}
});

// Stessa porta di Ctrl+rotella (src/preload/wheel-zoom.js): lo zoom è della
// PAGINA, e le pagine che zoomano da sé restano escluse anche da qui.
// Lo zoom si conta dove si registra, la raffica finita (src/main/tabs.js): da qui, dalla tastiera e dalla rotella.
function zoom(verso) {
  const c = schedaAttiva();
  if (!c) return;
  try { c.tab.view.webContents.send('filo:zoom-key', verso); } catch (_) {}
}

// Dal tasto, lo schermo pieno chiesto dalla pagina a fuoco (un video) resta suo, come in src/main/shortcuts.js.
const schermoIntero = contata('fullscreen', (_voce, _finestra, evento) => {
  const win = finestra();
  if (evento && evento.triggeredByAccelerator && win && win._filoTabs && win._filoTabs.schermoPienoDi(contenutoAFuoco())) return;
  try { win && win._filoTabs.toggleContentFullscreen(); } catch (_) {}
});

// La barra laterale e l'Aiuto si contano dove arrivano tutte le loro strade: la barra che si apre, il comando.
function barraLaterale() {
  const win = finestra();
  try { win && win._filoTabs.barra.commuta('tasto'); } catch (_) {}
}

function apriPagina(url) {
  const win = finestra();
  try { win && win._filoTabs.openTab(url, { origine: { tipo: 'filo' } }); } catch (_) {}
}

const finestraIncognito = contata('incognito', () => {
  try { require('./window').createIncognitoWindow(); } catch (_) {}
});

function assistenteLaterale() {
  try { require('./shortcuts').dispatch('open-help-sidebar', finestra()); } catch (_) {}
}

// Ctrl/Cmd+Z: nel campo di testo annulla, fuori torna indietro. Stessa regola di
// src/content/content.js, che vale quando il tasto arriva alla pagina.
async function annulla() {
  const wc = contenutoAFuoco();
  if (!wc) return;
  const win = finestra();
  const incognito = !!(win && win._filoIncognito);
  if (await staScrivendo(wc)) {
    // Un campo vuoto non ha niente da disfare: è l'azione di Filo appena fatta (src/content/content.js, stessa regola).
    if (await campoVuoto(wc)) { try { globalThis.SN_CONTATORI_MAIN && globalThis.SN_CONTATORI_MAIN.tastoAnnulla({ incognito }); } catch (_) {} }
    try { wc.undo(); } catch (_) {}
    return;
  }
  // Subito dopo un'azione di Filo, Ctrl/Cmd+Z è un «annulla» per lei (#1461); ed è comunque un indietro.
  try { globalThis.SN_CONTATORI_MAIN && globalThis.SN_CONTATORI_MAIN.tastoAnnulla({ incognito }); } catch (_) {}
  const c = schedaAttiva();
  require('./services/azioniContate').azione('navigate-back-forward', () => {
    try { c && c.tabs.goBack(c.tab.id); } catch (_) {}
  }, { incognito });
}

// Solo mentre si scrive: fuori da un campo Filo non ha un "avanti" su questo
// tasto, e una voce che non fa niente è meglio di una che sorprende.
async function ripeti() {
  const wc = contenutoAFuoco();
  if (!wc) return;
  if (await staScrivendo(wc)) { try { wc.redo(); } catch (_) {} }
}

// ─── la barra ───────────────────────────────────────────────────────────────

function template(piattaforma) {
  // La piattaforma si può passare: così la sentinella legge la barra VERA del
  // Mac anche mentre gira su Windows o Linux, dove quelle voci non si vedono.
  const MAC = (piattaforma || process.platform) === 'darwin';
  // Tasti che le pagine di Filo gestiscono già da sé: su Windows e Linux la
  // voce mostra la scritta ma NON registra il tasto (là arriva alla pagina, e
  // la pagina sa cosa farne). Su Mac la barra lo registra comunque — ed è per
  // questo che la voce deve fare la cosa giusta.
  const SOLO_SCRITTA = MAC ? {} : { registerAccelerator: false };
  const tasto = (accel) => globalThis.SN_TASTI.acceleratoreElectron(accel, MAC ? 'darwin' : 'win32');

  const menuFilo = {
    label: 'Filo',
    submenu: [
      { role: 'about', label: 'Informazioni su Filo' },
      { type: 'separator' },
      { label: 'Preferenze', click: () => apriPagina('filo://preferences/preferences.html') },
      { label: 'Opzioni', click: () => apriPagina('filo://options/options.html') },
      // Dove si riscatta un invito (#664): fuori dalla pagina, l'invito non aveva altre porte.
      { label: 'Crediti e inviti', click: () => apriPagina('filo://credits/credits.html') },
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
      { label: 'Indietro', accelerator: tasto('Alt+\u2190'), click: indietro, ...SOLO_SCRITTA },
      { label: 'Avanti', accelerator: tasto('Alt+\u2192'), click: avanti, ...SOLO_SCRITTA },
      { type: 'separator' },
      { label: 'Vai a un indirizzo', accelerator: 'CommandOrControl+L', click: vaiAScrivereUnIndirizzo, ...SOLO_SCRITTA },
      { label: 'Ricarica', accelerator: 'CommandOrControl+R', click: ricarica, ...SOLO_SCRITTA },
      { label: 'Quaderno delle memorie', click: () => apriPagina('filo://quaderno/quaderno.html') },
      { label: 'Cronologia AI', click: () => apriPagina('filo://history/history.html') },
      { type: 'separator' },
      // Cmd+W chiude la SCHEDA, non la finestra: è quello che Filo promette.
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
      // Il "+" si fa con Shift: senza questo alias Cmd+=, che è come lo zoom si
      // preme davvero, resterebbe scoperto.
      { label: 'Ingrandisci', accelerator: 'CommandOrControl+=', click: () => zoom('in'), visible: false, ...SOLO_SCRITTA },
      { label: 'Rimpicciolisci', accelerator: 'CommandOrControl+-', click: () => zoom('out'), ...SOLO_SCRITTA },
      { label: 'Dimensione reale', accelerator: 'CommandOrControl+0', click: () => zoom('reset'), ...SOLO_SCRITTA },
      { type: 'separator' },
      // Il tasto abituale di ogni sistema (F11, su Mac Control+Cmd+F): lo ascolta src/main/shortcuts.js ovunque.
      { label: 'Schermo intero', accelerator: globalThis.SN_TASTI.etichettaSchermoIntero(MAC ? 'darwin' : 'win32'), click: schermoIntero, ...SOLO_SCRITTA },
      { label: 'Barra laterale', accelerator: 'CommandOrControl+Shift+B', click: barraLaterale, ...SOLO_SCRITTA },
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
      { id: 'assistente-laterale', label: 'Assistente laterale', click: assistenteLaterale },
    ],
  };

  const barra = [menuFilo, menuSchede, menuModifica, menuVista, menuFinestra, menuAiuto];
  for (const m of barra) {
    for (const v of m.submenu || []) if (v.accelerator && typeof v.click === 'function') v.click = oRegistra(v.accelerator, v.click, MAC);
  }
  return barra;
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
  // L'Aiuto spento (#841) non resta nel menu: la voce segue l'interruttore.
  try {
    const segui = (s) => {
      const voce = Menu.getApplicationMenu()?.getMenuItemById('assistente-laterale');
      if (voce) voce.visible = require('./services/interruttoreAiuto').acceso(s);
    };
    globalThis.SN_STORAGE.getSettings().then(segui, () => {});
    require('./shim/storage').onChanged((changes) => { if (changes && changes.settings) segui(changes.settings.newValue); });
  } catch (_) {}
}

module.exports = { installaMenuApplicazione, template, annulla, ripeti, staScrivendo, oRegistra };
