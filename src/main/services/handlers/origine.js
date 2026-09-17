// Da dove arriva la richiesta: la porta unica del confine d'origine (#583).
// Il canale è uno solo: shell, pagine filo:// e content script dei siti. Per le cose con
// potere «chi sei» non basta: con una sessione aperta si vota e si spende al posto altrui.

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

module.exports = { daFilo, soloFilo };
