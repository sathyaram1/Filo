// I lavori lunghi in corso (#870): un turno di Filo, un comando del terminale. La home li mostra a sinistra.
// Solo in memoria: un lavoro non sopravvive al processo che lo fa. Le pagine di Filo li ricevono a ogni cambio.

const lavori = new Map();
let seq = 0;
const TETTO_TESTO = 300;

function elenco() {
  return [...lavori.values()].map(({ id, tipo, chat, testo, iniziato }) => ({ id, tipo, chat, testo, iniziato }));
}

function annuncia() {
  const MSG = globalThis.SN_MSG && globalThis.SN_MSG.MSG;
  const manda = globalThis.SN_BROADCAST_FILO;
  if (MSG && typeof manda === 'function') {
    try { manda({ type: MSG.LAVORI_CAMBIATI, lavori: elenco() }); } catch (_) {}
  }
}

// Restituisce la funzione che lo chiude (si può chiamare più volte). Con `wc` il lavoro si chiude anche se la scheda
// che lo fa muore prima di dirlo.
function inizia({ tipo, chat = null, testo = '', wc = null } = {}) {
  const id = `${tipo}-${Date.now().toString(36)}-${++seq}`;
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  lavori.set(id, {
    id, tipo, chat: typeof chat === 'string' && chat ? chat : null,
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
