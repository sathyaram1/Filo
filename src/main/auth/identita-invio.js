// Quale identità allegare al backend che limita la frequenza «per identità» (#585).
// È quella dell'installazione: il login Google è opzionale e lascerebbe il solo IP.
// Se è irraggiungibile si ripiega e si manda senza: la raccolta non deve saltare.

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
