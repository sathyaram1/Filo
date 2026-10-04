// I lavori lunghi in corso (#870): un turno di Filo, un comando del terminale. La home li mostra a sinistra.
// Solo in memoria: un lavoro non sopravvive al processo che lo fa. Ogni lavoro ha l'ambito della sua finestra
// (quello degli scaricamenti): una finestra incognito e quella normale non vedono l'una i lavori dell'altra.

const lavori = new Map();
let seq = 0;
const TETTO_TESTO = 300;

// Senza ambito vale quello della finestra normale: chi non dice da dove guarda non vede l'incognito.
function elenco(ambito = '') {
  return [...lavori.values()].filter((l) => l.ambito === String(ambito || ''))
    .map(({ id, tipo, chat, testo, iniziato }) => ({ id, tipo, chat, testo, iniziato }));
}

function annuncia() {
  const MSG = globalThis.SN_MSG && globalThis.SN_MSG.MSG;
  const manda = globalThis.SN_BROADCAST_FILO;
  if (MSG && typeof manda === 'function') {
    try { manda((ambito) => ({ type: MSG.LAVORI_CAMBIATI, lavori: elenco(ambito) })); } catch (_) {}
  }
}

// Restituisce la funzione che lo chiude (si può chiamare più volte). Con `wc` il lavoro si chiude anche se la scheda
// che lo fa muore prima di dirlo.
function inizia({ tipo, chat = null, testo = '', wc = null, ambito = '' } = {}) {
  const id = `${tipo}-${Date.now().toString(36)}-${++seq}`;
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  lavori.set(id, {
    id, tipo, chat: typeof chat === 'string' && chat ? chat : null, ambito: String(ambito || ''),
    testo: t.length > TETTO_TESTO ? `${t.slice(0, TETTO_TESTO - 1)}…` : t, iniziato: Date.now(),
  });
  annuncia();
  let chiuso = false;
  const fine = () => {
    if (chiuso) return;
    chiuso = true;
    if (lavori.delete(id)) annuncia();
  };
  try { if (wc && typeof wc.once === 'function') wc.once('destroyed', fine); } catch (_) {}
  return fine;
}

module.exports = { inizia, elenco };
