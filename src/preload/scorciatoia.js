// Consegna di una scorciatoia ai content script, la stessa in ogni preload (pagine web e pagine filo://).
// Chi la prende lo fa sapere al main, che altrimenti la riprova o la fa da sé (#839): due copie divergenti
// lasciavano le pagine di Filo mute, e il main rimandava la conferma di «Salva per dopo» finché scadeva.

// La risposta deve arrivare al main prima che smetta di aspettarla: oltre, il lavoro l'ha già fatto o riprovato lui.
const MARGINE_MS = 250;

module.exports = function consegnaScorciatoia(ascoltatori, { command, context, ricevuta, scade } = {}, invia) {
  const MSG = globalThis.SN_MSG?.MSG || {};
  const rispondi = (presa) => {
    if (!ricevuta) return;
    try { Promise.resolve(invia({ type: MSG.SHORTCUT_RECEIPT || 'shortcut_receipt', ricevuta, presa })).catch(() => {}); } catch (_) {}
  };
  if (ricevuta && scade && Date.now() > scade - MARGINE_MS) { rispondi(false); return; }
  let presa = false;
  const segna = (r) => { if (r && r.presa) presa = true; };
  for (const fn of ascoltatori) {
    try { fn({ type: MSG.SHORTCUT_TRIGGERED || 'shortcut_triggered', command, context }, { id: 'filo-desktop' }, segna); } catch (_) {}
  }
  rispondi(presa);
};
