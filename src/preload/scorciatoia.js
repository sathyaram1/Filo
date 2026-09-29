// Consegna di una scorciatoia ai content script, la stessa in ogni preload (pagine web e pagine filo://).
// Chi la prende lo fa sapere al main, che altrimenti la riprova o la fa da sé (#839): due copie divergenti
// lasciavano le pagine di Filo mute, e il main rimandava la conferma di «Salva per dopo» finché scadeva.
module.exports = function consegnaScorciatoia(ascoltatori, { command, context, ricevuta } = {}, invia) {
  const MSG = globalThis.SN_MSG?.MSG || {};
  let presa = false;
  const rispondi = (r) => { if (r && r.presa) presa = true; };
  for (const fn of ascoltatori) {
    try { fn({ type: MSG.SHORTCUT_TRIGGERED || 'shortcut_triggered', command, context }, { id: 'filo-desktop' }, rispondi); } catch (_) {}
  }
  if (ricevuta) {
    try { Promise.resolve(invia({ type: MSG.SHORTCUT_RECEIPT || 'shortcut_receipt', ricevuta, presa })).catch(() => {}); } catch (_) {}
  }
};
