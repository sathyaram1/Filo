// La segnalazione automatica (F4) parte quando il suo avviso si chiude: fino ad allora «Annulla» la ferma per chiunque,
// perché non esiste ancora (#784.6). Partita, la ritira solo l'owner: lo stato di un feedback lo scrive solo lui.
// Pattern: patterns/una-conferma-non-e-un-avviso-sopra-un-fatto-gia-compiuto.md. Prove: tests/auto-feedback-annulla.spec.mjs.
'use strict';

const crypto = require('crypto');

// Rete per un avviso che non dice mai di essersi chiuso (shell ricaricata, durata infinita nelle Preferenze).
const TETTO_MS = 10 * 60 * 1000;
const NON_DA_QUI = 'non è una segnalazione partita da qui';
const TARDI = 'La segnalazione è già partita e non posso più ritirarla';

const inAttesa = new Map();
// biglietto → Promise dell'esito: { id } col documento scritto, { inCoda } aspetta l'owner, {} non è partita.
const partite = new Map();

function sgancia(biglietto) {
  const voce = inAttesa.get(biglietto);
  if (!voce) return null;
  inAttesa.delete(biglietto);
  clearTimeout(voce.timer);
  if (voce.finestra) { try { voce.finestra.removeListener('closed', voce.allaChiusura); } catch (_) {} }
  return voce;
}

// `spedisci` torna l'esito dell'invio ({ id } o { queued }); `finestra` è quella dell'avviso: chiusa lei, l'avviso non
// c'è più e nessuno ha detto no.
function trattieni(spedisci, finestra) {
  const biglietto = crypto.randomUUID();
  const voce = { spedisci, timer: null, finestra: null, allaChiusura: null };
  voce.timer = setTimeout(() => parti(biglietto), TETTO_MS);
  if (finestra && typeof finestra.once === 'function') {
    voce.finestra = finestra;
    voce.allaChiusura = () => parti(biglietto);
    finestra.once('closed', voce.allaChiusura);
  }
  inAttesa.set(biglietto, voce);
  return biglietto;
}

function parti(biglietto) {
  const b = String(biglietto || '');
  const voce = sgancia(b);
  if (!voce) return false;
  partite.set(b, Promise.resolve()
    .then(voce.spedisci)
    .then((r) => (r && r.queued ? { inCoda: true } : { id: r && r.id ? String(r.id) : '' }))
    .catch((e) => { console.warn('[F4] submit auto-feedback fallito:', (e && e.message) || e); return {}; }));
  return true;
}

async function annulla(biglietto) {
  const b = String(biglietto || '');
  if (!b) return { ok: false, error: 'id mancante' };
  if (sgancia(b)) return { ok: true };
  const partenza = partite.get(b);
  if (!partenza) return { ok: false, error: NON_DA_QUI };
  const esito = await partenza;
  // Un altro «Annulla» l'ha già ritirata (o la sta ritirando): non si scrive due volte.
  if (partite.get(b) !== partenza) return { ok: false, error: NON_DA_QUI };
  if (esito.inCoda) return { ok: false, tardi: true, frase: TARDI };
  // Non è arrivata da nessuna parte: non c'è niente da ritirare, ed è quello che l'utente voleva.
  if (!esito.id) { partite.delete(b); return { ok: true }; }
  const auth = require('../auth/google-auth');
  let owner = false;
  try { owner = !!auth.isAdmin(); } catch (_) {}
  if (!owner) return { ok: false, tardi: true, frase: TARDI };
  const FB = globalThis.SN_FEEDBACK;
  if (!FB || typeof FB.updateStatus !== 'function') return { ok: false, error: 'FB non disponibile' };
  partite.delete(b);
  try {
    const idToken = await auth.getIdToken().catch(() => null);
    await FB.updateStatus(esito.id, { status: 'ignored', notes: 'Annullato dall\'utente (undo toast F4)' }, { idToken: idToken || undefined });
    return { ok: true };
  } catch (e) {
    partite.set(b, partenza);
    console.warn('[F4] cancel auto-feedback fallito:', (e && e.message) || e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

module.exports = { trattieni, parti, annulla };
