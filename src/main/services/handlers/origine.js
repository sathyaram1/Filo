// Da dove arriva la richiesta: la porta unica del confine d'origine (#583).
// Il canale è uno solo: shell, pagine filo:// e content script dei siti. Per le cose con
// potere «chi sei» non basta: con una sessione aperta si vota e si spende al posto altrui.

// Vale come Filo chi ha una vista di Filo: la barra, una scheda interna, la home pronta. L'indirizzo non basta: la
// finestrella di accesso e le schede del web girano col preload delle pagine web anche su un filo:// (#1506). PURA.
function vistaInterna({ isShell = false, riserva = false, tab = null, segnata = false } = {}) {
  if (isShell || riserva) return true;
  return tab ? tab.isInternal === true : segnata === true;
}

// L'indirizzo che fa da origine ai servizi. Un mittente come lo costruisce senderInfo porta `interna`; uno fatto a mano
// (test, chiamate interne) no, e conta il suo indirizzo. PURA.
function origineDi(sender) {
  const u = String((sender && ((sender.tab && sender.tab.url) || sender.url)) || '');
  return sender && sender.interna === false && /^filo:/i.test(u) ? '' : u;
}

/** La richiesta arriva da una superficie di Filo? PURA. */
function daFilo(origin, sender) {
  if (sender && sender.interna === false) return false;
  return String(origin || '').startsWith('filo://') || !!(sender && sender.isShell);
}

function soloFilo(handler) {
  return async (msg, sender, origin) => {
    if (!daFilo(origin, sender)) return { ok: false, code: 'forbidden', error: 'forbidden' };
    return handler(msg, sender, origin);
  };
}

module.exports = { daFilo, soloFilo, vistaInterna, origineDi };
