// Chi firma un feedback che parte da questa copia di Filo (#912, #953): riquadro, chat, segnalazione automatica e
// bacheca chiedono tutti qui. L'owner firma con la sua credenziale o non parte da anonimo; gli altri partono come sempre.
// Non spedisce per conto suo: decide mittente e prova. Le prove: tests/feedback-owner-firma-ovunque.spec.mjs.
'use strict';

const auth = require('../auth/google-auth');

// Anche l'owner appena buttato fuori da un rinnovo fallito: quello che manda aspetta che rientri.
function dallOwner() {
  try { return !!(auth.isAdmin() || (auth.accessoOwnerCaduto && auth.accessoOwnerCaduto())); } catch (_) { return false; }
}

// '' = l'accesso non c'è; un errore con la sessione ancora aperta è la rete, e chi chiama decide se riprovare.
async function tokenOwner() {
  if (!auth.isAdmin()) return '';
  try { return (await auth.getIdToken()) || ''; } catch (e) { if (!auth.isAdmin()) return ''; throw e; }
}

// Il nome con cui parte: per l'owner il suo nome riservato, che senza la prova vale come utente (feedbackThread.js).
// `perConto`: scritta da Filo dopo aver letto testo di altri (#953). Porta la prova dell'owner ma resta di Filo: non
// fidata, passa dai giudici; l'owner la segna fidata in Gestione se vuole.
function firma(clientId, { perConto = false } = {}) {
  const c = String(clientId || '');
  const TH = globalThis.SN_FEEDBACK_THREAD;
  if (!dallOwner() || !TH || typeof TH.ownerize !== 'function') return { clientId: c, dallOwner: false };
  if (perConto) return { clientId: c.replace(/^owner:/, ''), dallOwner: true };
  const firmato = TH.ownerize(c);
  return { clientId: firmato, dallOwner: firmato.startsWith('owner:') };
}

// La spedizione subito di una voce dell'owner: col token fresco, mai col ripiego anonimo. Senza un accesso valido la
// voce va alla coda, che aspetta il suo rientro e glielo dice; la rete che manca resta un errore per chi chiama.
async function spedisciDallOwner(payload) {
  const FB = globalThis.SN_FEEDBACK;
  const idToken = await tokenOwner();
  if (idToken) {
    try { return await FB.submit(payload, { idToken, soloAdmin: true }); } catch (e) { if (!e || !e.accessoOwner) throw e; }
  }
  const Outbox = globalThis.SN_FEEDBACK_OUTBOX;
  if (!Outbox || typeof Outbox.enqueue !== 'function') throw new Error('SN_FEEDBACK_OUTBOX non caricato nel main process');
  // Come il riquadro (#602): una voce che non si potrà cifrare non entra in coda a promettere un invio che non ci sarà.
  const motivo = typeof FB.encryptionUnavailable === 'function' ? FB.encryptionUnavailable() : '';
  if (motivo) throw new Error(FB.encryptionBlockedMessage ? FB.encryptionBlockedMessage(motivo) : motivo);
  const q = await Outbox.enqueue(payload, { dallOwner: true });
  return { id: q.id, queued: true };
}

module.exports = { dallOwner, tokenOwner, firma, spedisciDallOwner };
