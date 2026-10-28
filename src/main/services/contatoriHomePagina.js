// Le misure della home e di quello che Filo fa da sé sulla pagina (#1473): comandi, ricerca, «risali», intervista
// rifatta, proposte e automatismi. Passa nomi da elenchi chiusi e numeri al servizio dei contatori, che tiene
// interruttore e incognito; mai un testo, un sito o un paese. Forma: src/shared/contatoriHomePagina.js.

function crea(dip = {}) {
  const contatori = dip.contatori;
  const H = dip.H || globalThis.SN_CONTATORI_HOME_PAGINA;
  const adesso = dip.adesso || (() => Date.now());

  // `incognito` vero salta; altrimenti decide il contesto della chiamata, come per ogni altro conto.
  const scrivi = (fn, incognito = false) => contatori.homePagina((ora) => fn(ora), { incognito: incognito ? true : null });

  function comando(cosa, scelta = '', { incognito = false } = {}) {
    if (!H.chiaveComando(cosa, scelta)) return false;
    scrivi((ora) => H.registraComando(ora, cosa, scelta), incognito);
    return true;
  }

  // Le ricerche a zero risultati, per pagina: una seconda ricerca entro RIPETUTA_MS dalla vuota è chi si è perso.
  const ultimaVuota = new Map();
  const TETTO_PAGINE = 200;
  function ricerca(pagina, risultati, { incognito = false } = {}) {
    if (!H.fasciaIn(H.FASCE_RISULTATI, risultati)) return false;
    const t = adesso();
    const prima = ultimaVuota.get(pagina);
    const ripetuta = prima != null && t - prima <= H.RIPETUTA_MS;
    ultimaVuota.delete(pagina);
    if (Number(risultati) === 0 && pagina) {
      if (ultimaVuota.size >= TETTO_PAGINE) ultimaVuota.delete(ultimaVuota.keys().next().value);
      ultimaVuota.set(pagina, t);
    }
    scrivi((ora) => H.registraRicerca(ora, risultati) && (!ripetuta || H.registraVuotaRipetuta(ora)), incognito);
    return true;
  }
  function aperto(tipo, posizione, ms, { incognito = false } = {}) {
    if (!H.TIPI_RISULTATO.includes(tipo)) return false;
    scrivi((ora) => H.registraAperto(ora, tipo, posizione, ms), incognito);
    return true;
  }

  function risali(pezzi, { incognito = false } = {}) {
    if (!H.fasciaIn(H.FASCE_PEZZI, pezzi) || !(Number(pezzi) >= 1)) return false;
    scrivi((ora) => H.registraRisali(ora, pezzi), incognito);
    return true;
  }

  function intervistaRiaperta({ incognito = false } = {}) {
    scrivi((ora) => H.registraIntervistaRiaperta(ora), incognito);
    return true;
  }
  function intervistaFine(passo, { incognito = false } = {}) {
    scrivi((ora) => H.registraIntervistaFine(ora, passo), incognito);
    return true;
  }

  function proposta(tipo, esito, { come = '', incognito = false } = {}) {
    if (!H.chiaveProposta(tipo, esito, come)) return false;
    scrivi((ora) => H.registraProposta(ora, tipo, esito, come), incognito);
    return true;
  }

  function fatto(tipo, { incognito = false } = {}) {
    if (!H.AUTOMATISMI.includes(tipo)) return false;
    scrivi((ora) => H.registraFatto(ora, tipo), incognito);
    return true;
  }
  function disfatto(tipo, { incognito = false } = {}) {
    if (!H.DISFACIBILI.includes(tipo)) return false;
    scrivi((ora) => H.registraDisfatto(ora, tipo), incognito);
    return true;
  }

  return { comando, ricerca, aperto, risali, intervistaRiaperta, intervistaFine, proposta, fatto, disfatto };
}

// Per gli agganci: una misura che non c'è o che si rompe non ferma mai chi la chiama.
function misura(nome, ...args) {
  try {
    const m = globalThis.SN_CONTATORI_HOME_PAGINA_MAIN;
    return m && typeof m[nome] === 'function' ? m[nome](...args) : undefined;
  } catch (_) { return undefined; }
}

module.exports = { crea, misura };
