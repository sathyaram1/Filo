// Watcher delle scadenze di timer e sveglie nel PROCESSO MAIN (#322).
// Nessuna pagina è garantita aperta, quindi è qui che le scadenze vengono
// marcate; chi le rende percepibili lo dice il pattern «farsi sentire ovunque».
//
// Ogni pochi secondi: gcTimers() marca `ringing`, ogni scadenza NUOVA fa una
// notifica di sistema, e broadcastLiveUpdate() sveglia le superfici aperte —
// la shell fa partire la suoneria, la nuova scheda mostra la sua scheda.

const { BrowserWindow, Notification } = require('electron');

const CHECK_MS = 5000;
let handle = null;
// Scadenze già notificate in QUESTA sessione: niente ri-notifica a ogni tick
// finché l'utente non preme "Ferma". Una scadenza ancora `ringing` al boot
// (arrivata mentre Filo era chiuso o nella sessione precedente) viene
// notificata una volta: meglio un avviso in ritardo che nessun avviso.
// Due insiemi perché le viste normale e incognito dello storage sono due liste
// separate: con uno solo, ogni passata cancellerebbe le scadenze dell'altra.
const notified = { normale: new Set(), incognito: new Set() };

// Una scadenza chiesta da una finestra incognito vive SOLO nella vista incognito
// dello storage: senza una passata lì dentro nessuno la vede mai scadere, e quel
// timer resta muto per sempre.
async function tick() {
  await passata(false);
  const conIncognito = BrowserWindow.getAllWindows().some((w) => {
    try { return !w.isDestroyed() && !!w._filoIncognito; } catch (_) { return false; }
  });
  if (!conIncognito) return;
  try {
    const { runIncognito } = require('../shim/storage');
    await runIncognito(() => passata(true));
  } catch (_) { /* best-effort: la passata normale è già andata */ }
}

async function passata(incognito) {
  const FiloMem = globalThis.SN_FILO_MEMORY;
  if (!FiloMem) return;
  let list;
  try { list = await FiloMem.gcTimers(); } catch (_) { return; }
  const visti = incognito ? notified.incognito : notified.normale;
  // Una sveglia RICORRENTE resta in lista dopo essere stata fermata: senza
  // dimenticarla qui, la stessa sveglia non avviserebbe mai più (l'id è già
  // "notificato" per sempre). Si dimentica appena smette di suonare — la volta
  // dopo è una scadenza nuova a tutti gli effetti.
  const ringingNow = new Set((list || []).filter((t) => t.ringing).map((t) => t.id));
  for (const id of visti) if (!ringingNow.has(id)) visti.delete(id);
  // Vale finché QUALCOSA suona, non solo all'istante della scadenza: un tutto
  // schermo che arriva DOPO ricoprirebbe il pulsante e rimetterebbe il rumore
  // senza interruttore.
  if (ringingNow.size) {
    // Suono e pulsante vivono in una finestra che la scadenza la vede: senza
    // garantirne una, con la sola incognito aperta o su Mac a finestra chiusa
    // (dove Filo resta in funzione) la scadenza resta viva e muta.
    if (!incognito) { try { require('../window').assicuraFinestraNormale(); } catch (_) {} }
    rientraDaTuttoSchermo(incognito);
  }
  const fresh = (list || []).filter((t) => t.ringing && !visti.has(t.id));
  if (!fresh.length) return;
  for (const t of fresh) {
    visti.add(t.id);
    // Niente notifica di sistema per una scadenza incognito: titolo ed etichetta
    // resterebbero nel centro notifiche del sistema, cioè una traccia su questo
    // computer di quello che si è fatto in incognito.
    if (incognito) continue;
    try {
      if (Notification.isSupported()) {
        const isAlarm = t.kind === 'alarm';
        const n = new Notification({
          title: isAlarm ? '⏰ Sveglia' : '⏱ Timer scaduto',
          body: t.label || (isAlarm ? 'È ora.' : ''),
        });
        // Con Filo ridotto a icona questa notifica è l'unica cosa che l'utente
        // vede, e il pulsante che ferma la suoneria sta nella finestra.
        n.on('click', () => { try { mostraFinestra(); } catch (_) {} });
        n.show();
      }
    } catch (_) { /* best-effort: la card ringing in dashboard resta comunque */ }
  }
  try { require('./handlers').broadcastLiveUpdate(); } catch (_) {}
}

// A tutto schermo la pagina copre la fila di tab, cioè l'unico posto da cui si
// ferma la suoneria: senza uscirne il rumore parte e non ha interruttore. Ogni
// passata tocca solo le finestre che vedono le scadenze di quella lista.
function rientraDaTuttoSchermo(incognito) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed() || !!win._filoIncognito !== !!incognito) continue;
      const tabs = win._filoTabs;
      if (tabs && tabs.contentFullscreen) tabs.setContentFullscreen(false);
    } catch (_) { /* best-effort: una finestra sola non deve fermare le altre */ }
  }
}

// Il click sulla notifica deve portare dove si ferma la suoneria, cioè in una
// finestra NORMALE: una incognito quella scadenza non la vede, e senza nessuna
// finestra aperta la notifica non porterebbe da nessuna parte.
function mostraFinestra() {
  const { assicuraFinestraNormale, revealWindow } = require('../window');
  const win = assicuraFinestraNormale();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  revealWindow(win);
}

function start() {
  if (handle) return;
  handle = setInterval(() => { tick().catch(() => {}); }, CHECK_MS);
}

function stop() {
  if (handle) clearInterval(handle);
  handle = null;
}

module.exports = { start, stop, _tick: tick, _CHECK_MS: CHECK_MS };
