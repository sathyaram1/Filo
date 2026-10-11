// Le chiamate al server degli strumenti: un altro tentativo quando muore la connessione, non quando il server risponde.
// Dopo minuti di test una connessione tenuta viva può essere già chiusa dall'altra parte (#933): il primo uso la trova morta.
// Le regole stanno in tests/unit/rete.test.mjs.

// Errori del socket, non della risposta: ritentare apre una connessione nuova. ENOTFOUND no, è la rete che manca.
const CODICI_DI_SOCKET = new Set([
  'ECONNABORTED', 'ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT',
  'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_CONNECT_TIMEOUT',
]);

/** Il primo `code` lungo la catena delle cause: fetch lo nasconde dietro «fetch failed». PURA. */
export function codiceDiRete(e) {
  for (let x = e, giri = 0; x && giri < 6; x = x.cause, giri++) {
    if (typeof x.code === 'string' && x.code) return x.code;
  }
  return '';
}

/** PURA. */
export function erroreDiSocket(e) {
  return CODICI_DI_SOCKET.has(codiceDiRete(e));
}

/** «fetch failed: write ECONNABORTED»: il messaggio di fetch da solo non dice cosa è successo. PURA. */
export function descriviErroreDiRete(e) {
  const fuori = String((e && e.message) || e || 'errore di rete');
  const causa = e && e.cause;
  const dentro = causa ? String(causa.message || causa.code || '') : '';
  const codice = codiceDiRete(e);
  let testo = dentro && !fuori.includes(dentro) ? `${fuori}: ${dentro}` : fuori;
  if (codice && !testo.includes(codice)) testo += ` (${codice})`;
  return testo;
}

const attesaVera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch con altri tentativi sui soli errori di socket; una risposta HTTP, anche 5xx, torna com'è.
 * Dopo l'ultimo tentativo rilancia l'errore, con `tentativi` addosso.
 */
export async function fetchRitentato(url, init, { fetchImpl = fetch, tentativi = 3, attese = [300, 1500], sleep = attesaVera } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fetchImpl(url, init);
    } catch (e) {
      if (i >= tentativi || !erroreDiSocket(e)) {
        try { if (e && typeof e === 'object') e.tentativi = i; } catch (_) { /* errore non estendibile: si rilancia com'è */ }
        throw e;
      }
      await sleep(attese[Math.min(i - 1, attese.length - 1)] || 0);
    }
  }
}
