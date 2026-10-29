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
// Partenza → la sua voce, per l'esito di un ritiro dopo la partenza.
const voci = new WeakMap();
// Gli invii non ancora finiti: l'uscita da Filo li aspetta, o chi non ha detto no perde la segnalazione.
const inVolo = new Set();
// Tetto dell'attesa all'uscita: una rete ferma non deve tenere Filo aperto.
const USCITA_MS = 5000;

function di(voce, nome) {
  try { if (voce && typeof voce.esito === 'function') voce.esito(nome); } catch (_) {}
}

function sgancia(biglietto) {
  const voce = inAttesa.get(biglietto);
  if (!voce) return null;
  inAttesa.delete(biglietto);
  clearTimeout(voce.timer);
  if (voce.finestra) { try { voce.finestra.removeListener('closed', voce.allaChiusura); } catch (_) {} }
  return voce;
}

// `spedisci` torna l'esito dell'invio ({ id } o { queued }); `finestra` è quella dell'avviso: chiusa lei, l'avviso non
// c'è più e nessuno ha detto no. `esito(nome)` lo sentono i contatori (#1472): inviata, in_coda, fallita, annullata.
function trattieni(spedisci, finestra, { esito = null } = {}) {
  const biglietto = crypto.randomUUID();
  const voce = { spedisci, timer: null, finestra: null, allaChiusura: null, esito };
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
  const partenza = Promise.resolve()
    .then(voce.spedisci)
    .then((r) => (r && r.queued ? { inCoda: true } : { id: r && r.id ? String(r.id) : '' }))
    .catch((e) => { console.warn('[F4] submit auto-feedback fallito:', (e && e.message) || e); return {}; });
  partenza.then((x) => di(voce, x.inCoda ? 'in_coda' : x.id ? 'inviata' : 'fallita'));
  voci.set(partenza, voce);
  inVolo.add(partenza);
  partenza.then(() => inVolo.delete(partenza));
  partite.set(b, partenza);
  return true;
}

// Uscire chiude l'avviso senza un no: le trattenute partono, e l'uscita aspetta che arrivino (col tetto).
function allUscita() {
  for (const b of Array.from(inAttesa.keys())) parti(b);
  if (!inVolo.size) return null;
  return Promise.race([
    Promise.all(Array.from(inVolo)),
    new Promise((r) => { setTimeout(r, USCITA_MS); }),
  ]);
}

// Chi esce mentre aspettiamo (altri congedi richiamano `app.quit()`) viene fermato anche lui, finché l'attesa non finisce.
let congedo = '';
try {
  const { app } = require('electron');
  app.on('before-quit', (e) => {
    if (congedo === 'fatto') return;
    if (congedo === 'in corso') { e.preventDefault(); return; }
    const attesa = allUscita();
    if (!attesa) return;
    congedo = 'in corso';
    e.preventDefault();
    const esci = () => { congedo = 'fatto'; try { app.quit(); } catch (_) {} };
    attesa.then(esci, esci);
  });
} catch (_) {}

async function annulla(biglietto) {
  const b = String(biglietto || '');
  if (!b) return { ok: false, error: 'id mancante' };
  const ferma = sgancia(b);
  if (ferma) { di(ferma, 'annullata'); return { ok: true }; }
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
    di(voci.get(partenza), 'annullata');
    return { ok: true };
  } catch (e) {
    partite.set(b, partenza);
    console.warn('[F4] cancel auto-feedback fallito:', (e && e.message) || e);
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

module.exports = { trattieni, parti, annulla, allUscita };
