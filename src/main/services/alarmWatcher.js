// Scadenze di timer e sveglie controllate nel processo main (#322).
// La suoneria vive nella dashboard: senza una newtab aperta una scadenza non verrebbe mai
// notificata, ed è così che scatta quasi sempre una sveglia.

const { Notification } = require('electron');

const CHECK_MS = 5000;
let handle = null;
// Le scadenze già notificate in questa sessione non si ri-notificano a ogni tick; una
// ancora `ringing` al boot si notifica una volta: meglio un avviso tardi che nessuno.
const notified = new Set();

async function tick() {
  const FiloMem = globalThis.SN_FILO_MEMORY;
  if (!FiloMem) return;
  let list;
  try { list = await FiloMem.gcTimers(); } catch (_) { return; }
  // Una sveglia ricorrente resta in lista dopo essere stata fermata: se il suo id non si
  // dimentica qui resta «notificato» per sempre e non avviserebbe mai più.
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
