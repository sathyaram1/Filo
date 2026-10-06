// La disposizione delle carte della home (#870): la legge e la scrive solo da qui, una mossa alla volta.
// Le mosse sono quelle di src/shared/carteHome.js; chi chiama annuncia il cambio alle pagine di Filo.

function Carte() { return globalThis.SN_CARTE_HOME; }
function chiave() { return globalThis.SN_CONST.STORAGE_KEYS.FILO_CARTE_HOME; }

async function leggi() {
  let raw = null;
  try { raw = (await chrome.storage.local.get(chiave()))[chiave()]; } catch (_) {}
  return Carte().normalizza(raw);
}

// Due mosse quasi insieme (due schede della home, la chat e un trascinamento) leggerebbero la stessa
// disposizione e la seconda cancellerebbe la prima: si mettono in fila.
let coda = Promise.resolve();
function modifica(mossa) {
  const giro = coda.then(async () => {
    const esito = Carte().applica(await leggi(), mossa);
    if (esito.cambiato) await chrome.storage.local.set({ [chiave()]: esito.layout });
    return esito;
  });
  coda = giro.catch(() => {});
  return giro;
}

module.exports = { leggi, modifica };
