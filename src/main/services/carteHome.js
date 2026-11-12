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
    if (!esito.errore) contaMossa(mossa);
    return esito;
  });
  coda = giro.catch(() => {});
  return giro;
}

// Per i contatori (#1471): la mossa, e la carta che muove (del catalogo, o il tipo di una carta di sinistra).
function contaMossa(mossa) {
  const K = globalThis.SN_CONTATORI_MAIN;
  const v = K && globalThis.SN_CONTATORI?.cartaDellaMossa(mossa);
  if (!v) return;
  try {
    K.gesto('carta_home', v);
    if (v.mossa === 'ripristina') K.gesto('ripristino', { cosa: 'carte_home' });
  } catch (_) {}
}

// Il segno dell'accoglienza si legge dal disco anche per una finestra incognito, che non lo vede (#1661).
async function primoIncontro(settings) {
  try {
    const K = globalThis.SN_CONST;
    const onb = await require('../shim/storage').runNormale(() => globalThis.SN_FILO_MEMORY.getOnboarding());
    return Carte().primoIncontro(onb, K.whyCannotServe(settings, [K.ACTIONS.FILO_DASHBOARD, K.ACTIONS.FILO_CHAT]));
  } catch (_) { return false; }
}

module.exports = { leggi, modifica, primoIncontro };
