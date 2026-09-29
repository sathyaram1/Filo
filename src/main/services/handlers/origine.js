// Da dove arriva la richiesta: la porta unica del confine d'origine (#583).
//
// Il canale dei messaggi è UNO SOLO, e ci parlano tre mondi: la shell della
// finestra, le pagine interne `filo://` e i content script che girano dentro i
// siti visitati. Chiedere soltanto «chi sei» non basta per le cose che hanno
// potere: sul computer di chi gestisce i feedback la risposta a «sei
// l'amministratore?» è sempre sì, e su quello di chiunque altro una sessione
// aperta è tutto ciò che serve per votare al posto suo o spendergli i crediti.
// Prima si guarda DA DOVE arriva: il gesto che vale è quello fatto su una
// superficie di Filo.
//
// `code: 'forbidden'` è il motivo in una parola, e serve a chi deve DIRE
// all'utente cosa succede: senza, il rifiuto arriva alla pagina come un errore
// qualunque e finisce tradotto in «controlla la connessione», che manda a
// controllare la cosa sbagliata.
//
// Chi aggiunge una porta con potere passa di qui. `tests/feedback-canali-origine.spec.mjs`
// bussa a tutte da un sito visitato e diventa rossa se una risponde altro.

/** La richiesta arriva da una superficie di Filo? PURA. */
function daFilo(origin, sender) {
  return String(origin || '').startsWith('filo://') || !!(sender && sender.isShell);
}

/** Avvolge un handler: da un sito visitato risponde «rifiutato per provenienza». */
function soloFilo(handler) {
  return async (msg, sender, origin) => {
    if (!daFilo(origin, sender)) return { ok: false, code: 'forbidden', error: 'forbidden' };
    return handler(msg, sender, origin);
  };
}

/** Chi chiede è una pagina che non è di Filo? Una chiamata interna al main non porta né indirizzo né pagina. PURA. */
function daUnSito(origin, sender) {
  const pagina = Boolean(origin) || Boolean(sender && (sender.wc || sender.tab || sender.frame));
  return pagina && !daFilo(origin, sender);
}

/** Chi chiede è il frame principale della scheda in primo piano della sua finestra? */
function inPrimoPiano(sender) {
  const tm = sender && sender.win && sender.win._filoTabs;
  const id = sender && sender.tab && sender.tab.id;
  if (!tm || id == null || tm.activeId !== id) return false;
  let principale = null;
  try { principale = sender.wc && !sender.wc.isDestroyed() ? sender.wc.mainFrame : null; } catch (_) { principale = null; }
  const f = sender.frame;
  return Boolean(f && principale && (f === principale || f.frameTreeNodeId === principale.frameTreeNodeId));
}

module.exports = { daFilo, soloFilo, daUnSito, inPrimoPiano };
