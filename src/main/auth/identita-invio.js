// Chi siamo, quando mandiamo qualcosa al backend di sicurezza che deve
// limitarne la frequenza «per identità» (#585).
//
// L'identità da allegare è quella dell'INSTALLAZIONE: ogni copia di Filo ne ha
// una (è quella su cui poggiano crediti e portafoglio), il server la verifica,
// e resta la stessa anche dopo un login Google, che a quell'identità si
// collega. Il login Google invece è opzionale: chiedere quello voleva dire
// mandare quasi sempre una richiesta senza mittente, e lasciare al server il
// solo indirizzo IP — cioè il limite per identità senza niente sotto.
//
// Il mittente resta ANONIMO lo stesso: il token viaggia ACCANTO al documento e
// non ci entra (vedi src/shared/pathsSafety.js → sanitizeSubmission), perché la
// raccolta dei percorsi la legge chiunque.
//
// Un'identità irraggiungibile (offline, o annullata sul server) non deve far
// saltare la raccolta, che è telemetria best-effort: si ripiega sul login
// Google se c'è, altrimenti si manda senza e il server si arrangia con quello
// che ha.
//
// Sta in un modulo suo perché lo chiedono in due — chi raccoglie un percorso e
// la coda che lo spedisce ore dopo — e una catena di ripieghi scritta due volte
// diverge in silenzio.

const google = require('./google-auth');
const anonima = require('./anon-auth');

async function ottieniIdToken() {
  try {
    const t = await anonima.getIdToken();
    if (t) return t;
  } catch (_) { /* offline o identità persa: si ripiega */ }
  try {
    return (await google.getIdToken()) || '';
  } catch (_) {
    return '';
  }
}

module.exports = { ottieniIdToken };
