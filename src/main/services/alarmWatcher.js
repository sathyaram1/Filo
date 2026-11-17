// Watcher delle scadenze di timer e sveglie nel PROCESSO MAIN (#322).
// Nessuna pagina è garantita aperta, quindi è qui che le scadenze vengono
// marcate; chi le rende percepibili lo dice il pattern «farsi sentire ovunque».
//
// Ogni pochi secondi: gcTimers() marca `ringing`, ogni scadenza NUOVA fa un
// avviso (la forma la sceglie la shell), e broadcastLiveUpdate() sveglia le superfici aperte —
// la shell fa partire la suoneria, la nuova scheda mostra la sua scheda.

const { BrowserWindow } = require('electron');

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
  // Smesso di suonare (Ferma da qualunque parte): via anche l'avviso, nella finestra e nel sistema.
  for (const id of visti) if (!ringingNow.has(id)) { visti.delete(id); ritiraAvviso(chiaveAvviso(id)); }
  // Vale finché QUALCOSA suona, non solo all'istante della scadenza: un tutto
  // schermo che arriva DOPO ricoprirebbe il pulsante e rimetterebbe il rumore
  // senza interruttore.
  if (ringingNow.size) {
    // Con la sola incognito aperta, o su Mac a finestra chiusa (dove Filo resta
    // in funzione), non c'è nessuna finestra che la senta: gliene serve una.
    if (!incognito) { try { require('../window').assicuraFinestraNormale(); } catch (_) {} }
    rientraDaTuttoSchermo(incognito);
  }
  const fresh = (list || []).filter((t) => t.ringing && !visti.has(t.id));
  if (!fresh.length) return;
  for (const t of fresh) {
    visti.add(t.id);
    // Che suona è un evento del filo (#1561), anche in incognito (dove resta in memoria).
    try { require('./accaduti').timerScattato(t, { incognito }); } catch (_) {}
    // Filo lo scrive anche nel filo (#869), fuori dall'incognito per la stessa ragione della notifica qui sotto.
    if (!incognito) { try { globalThis.SN_FILO_PARLA?.segnala({ tipo: 'timer', testo: `${t.kind === 'alarm' ? 'sveglia' : 'timer'}${t.label ? ` «${t.label}»` : ''}` }); } catch (_) {} }
    // La forma la sceglie la shell (#2390): carta che si fa notare nella home, angolo su una pagina, notifica del
    // sistema con Filo non davanti (mai per l'incognito, che lascerebbe una traccia nel centro notifiche).
    try { avvisa(t, incognito); } catch (_) { /* best-effort: la carta che suona nella home resta comunque */ }
  }
  try { require('./handlers').broadcastLiveUpdate(); } catch (_) {}
}

const chiaveAvviso = (id) => `timer:${id}`;
function ritiraAvviso(chiave) {
  try { require('./avvisoFinestra').ritiraAvviso(chiave); } catch (_) {}
}
function avvisa(t, incognito) {
  const sveglia = t.kind === 'alarm';
  const nome = t.label ? ` «${t.label}»` : '';
  const testo = sveglia ? `Sveglia${nome}: è ora` : `Timer${nome} scaduto`;
  // La suoneria c'è già (la shell, finché suona): l'avviso non aggiunge il suo tono.
  require('./avvisoFinestra').avvisoNellaFinestra(testo, {
    tipo: 'timer_scaduto', chiave: chiaveAvviso(t.id), carta: chiaveAvviso(t.id), icona: sveglia ? 'alarm' : 'timer',
    durataSec: 0, suono: false, incognito, azioni: [{ label: 'Ferma', fermaTimer: String(t.id) }],
  });
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

function start() {
  if (handle) return;
  handle = setInterval(() => { tick().catch(() => {}); }, CHECK_MS);
}

function stop() {
  if (handle) clearInterval(handle);
  handle = null;
}

module.exports = { start, stop, _tick: tick, _CHECK_MS: CHECK_MS };
