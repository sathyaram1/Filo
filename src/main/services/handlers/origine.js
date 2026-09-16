// Da dove arriva la richiesta: la porta unica del confine d'origine (#583).
// Il canale dei messaggi è UNO SOLO e ci parlano tre mondi: la shell, le pagine `filo://` e i content script dei siti visitati. Per le cose che hanno potere chiedere «chi sei» non basta: sul computer di chi gestisce i feedback «sei l'amministratore?» è sempre sì, e su quello di chiunque altro una sessione aperta è tutto ciò che serve per votare al posto suo o spendergli i crediti.
// `code: 'forbidden'` è il motivo in una parola e serve a chi deve DIRE all'utente cosa succede: senza, il rifiuto arriva come un errore qualunque e finisce tradotto in «controlla la connessione». Chi aggiunge una porta con potere passa di qui: tests/feedback-canali-origine.spec.mjs bussa a tutte da un sito visitato.

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
