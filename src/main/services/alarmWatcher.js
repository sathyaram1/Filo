// Watcher delle scadenze di timer e sveglie nel PROCESSO MAIN (#322).
//
// La suoneria vive nella dashboard (AudioContext della pagina newtab): finché
// una newtab è aperta, il suo ticker chiama gcTimers ogni secondo e la
// scadenza suona da sé. Ma una SVEGLIA ("alle 07:00") scatta tipicamente
// quando l'utente NON sta guardando la newtab: senza un controllo nel main
// nessuno marcherebbe la scadenza e l'avviso non partirebbe mai.
//
// Questo watcher gira nel main ogni pochi secondi:
//   1. gcTimers() marca `ringing` le scadenze arrivate;
//   2. per ogni scadenza NUOVA mostra una notifica di sistema (arriva anche
//      con Filo ridotto a icona o su un'altra scheda);
//   3. broadcastLiveUpdate() avvisa le superfici aperte (una dashboard aperta
//      aggiorna la colonna live e fa partire la suoneria).
//
// Vale sia per le sveglie (kind 'alarm') sia per i timer: prima un timer che
// scadeva senza la newtab aperta restava muto — stessa lacuna, stesso fix.

const { Notification } = require('electron');

const CHECK_MS = 5000;
let handle = null;
// Scadenze già notificate in QUESTA sessione: niente ri-notifica a ogni tick
// finché l'utente non preme "Ferma". Una scadenza ancora `ringing` al boot
// (arrivata mentre Filo era chiuso o nella sessione precedente) viene
// notificata una volta: meglio un avviso in ritardo che nessun avviso.
const notified = new Set();

async function tick() {
  const FiloMem = globalThis.SN_FILO_MEMORY;
  if (!FiloMem) return;
  let list;
  try { list = await FiloMem.gcTimers(); } catch (_) { return; }
  // Una sveglia RICORRENTE resta in lista dopo essere stata fermata: senza
  // dimenticarla qui, la stessa sveglia non avviserebbe mai più (l'id è già
  // "notificato" per sempre). Si dimentica appena smette di suonare — la volta
  // dopo è una scadenza nuova a tutti gli effetti.
  const ringingNow = new Set((list || []).filter((t) => t.ringing).map((t) => t.id));
  for (const id of notified) if (!ringingNow.has(id)) notified.delete(id);
  const fresh = (list || []).filter((t) => t.ringing && !notified.has(t.id));
  if (!fresh.length) return;
  for (const t of fresh) {
    notified.add(t.id);
    try {
      if (Notification.isSupported()) {
        const isAlarm = t.kind === 'alarm';
        new Notification({
          title: isAlarm ? '⏰ Sveglia' : '⏱ Timer scaduto',
          body: t.label || (isAlarm ? 'È ora.' : ''),
        }).show();
      }
    } catch (_) { /* best-effort: la card ringing in dashboard resta comunque */ }
  }
  try { require('./handlers').broadcastLiveUpdate(); } catch (_) {}
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
