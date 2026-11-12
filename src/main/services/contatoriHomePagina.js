// Le misure della home e di quello che Filo fa da sé sulla pagina (#1473): comandi, ricerca, «risali», intervista
// rifatta, proposte e automatismi. Passa nomi da elenchi chiusi e numeri al servizio dei contatori, che tiene
// interruttore e incognito; mai un testo, un sito o un paese. Forma: src/shared/contatoriHomePagina.js.

function crea(dip = {}) {
  const contatori = dip.contatori;
  const H = dip.H || globalThis.SN_CONTATORI_HOME_PAGINA;

  // `incognito` vero salta; altrimenti decide il contesto della chiamata, come per ogni altro conto.
  const scrivi = (fn, incognito = false) => contatori.homePagina((ora) => fn(ora), { incognito: incognito ? true : null });

  function comando(cosa, scelta = '', { incognito = false } = {}) {
    if (!H.chiaveComando(cosa, scelta)) return false;
    scrivi((ora) => H.registraComando(ora, cosa, scelta), incognito);
    return true;
  }

  // `ripetuta`: la ricerca prima di questa, entro RIPETUTA_MS, non aveva trovato niente (lo sa la pagina).
  function ricerca(risultati, { ripetuta = false, incognito = false } = {}) {
    if (!H.fasciaIn(H.FASCE_RISULTATI, risultati)) return false;
    scrivi((ora) => H.registraRicerca(ora, risultati) && (!ripetuta || H.registraVuotaRipetuta(ora)), incognito);
    return true;
  }
  function aperto(tipo, posizione, ms, { incognito = false } = {}) {
    if (!H.TIPI_RISULTATO.includes(tipo)) return false;
    scrivi((ora) => H.registraAperto(ora, tipo, posizione, ms), incognito);
    return true;
  }

  // ── Quello che resta aperto in una pagina: chi chiude la scheda non lo dice, e lo conta il main ──────────────
  // `chiave`: la pagina e la cosa («wc|cosa|id», handlers/contatori.js). In incognito non si tiene niente.
  // Una serie di «risali»: `pezzi` è quanti ne ha fatti di fila finora, e la serie si conta quando finisce.
  function risaliDiFila(chiave, pezzi) {
    const n = Number(pezzi);
    if (!chiave || !Number.isInteger(n) || n < 1) return false;
    return contatori.sospesaInCorso(chiave, () => scrivi((ora) => H.registraRisali(ora, n)));
  }
  // L'avviso del sito che non si trova: «in_attesa» quando compare, poi la scelta. Un avviso nuovo, l'invio di
  // qualcos'altro o la pagina che se ne va lo lasciano.
  function nonRisolto(chiave, scelta) {
    if (!chiave) return false;
    if (scelta === 'in_attesa') {
      contatori.chiudiUnaInCorso(chiave);
      return contatori.sospesaInCorso(chiave, () => scrivi((ora) => H.registraComando(ora, H.NON_RISOLTO, 'lascia')));
    }
    if (scelta === 'lascia') return contatori.chiudiUnaInCorso(chiave);
    if (scelta !== 'apri_lo_stesso' || !contatori.haInCorso(chiave)) return false;
    contatori.finitaInCorso(chiave);
    scrivi((ora) => H.registraComando(ora, H.NON_RISOLTO, scelta));
    return true;
  }
  const fineInCorso = (chiave) => Boolean(chiave) && contatori.chiudiUnaInCorso(chiave);

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
  // Una proposta a schermo aspetta la sua risposta in `segno`, un oggetto di chi la mostra (la scheda, il campo): una
  // risposta sola per proposta, e quella rimasta senza è «ignorata». `chiave` distingue la stessa ridisegnata da una nuova.
  function propostaMostrata(segno, tipo, { chiave = '', incognito = false } = {}) {
    if (!segno || typeof segno !== 'object' || !H.TIPI_PROPOSTA.includes(tipo)) return false;
    const prima = segno[tipo];
    if (prima && prima.chiave === String(chiave)) return true;
    if (prima) proposta(tipo, 'ignorata', { incognito: prima.incognito });
    segno[tipo] = { chiave: String(chiave), incognito: !!incognito };
    return true;
  }
  function propostaRisposta(segno, tipo, esito, { come = '' } = {}) {
    const p = segno && typeof segno === 'object' ? segno[tipo] : null;
    if (!p) return false;
    delete segno[tipo];
    return proposta(tipo, esito, { come, incognito: p.incognito });
  }
  // La pagina cambiata, il campo lasciato, la scheda chiusa: quelle ancora senza risposta.
  function proposteVia(segno, tipo = null) {
    if (!segno || typeof segno !== 'object') return false;
    let n = 0;
    for (const t of tipo ? [tipo] : Object.keys(segno)) if (propostaRisposta(segno, t, 'ignorata')) n++;
    return n > 0;
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

  return {
    comando, ricerca, aperto, risaliDiFila, nonRisolto, fineInCorso, intervistaRiaperta, intervistaFine, proposta,
    propostaMostrata, propostaRisposta, proposteVia, fatto, disfatto,
  };
}

// Per gli agganci: una misura che non c'è o che si rompe non ferma mai chi la chiama.
function misura(nome, ...args) {
  try {
    const m = globalThis.SN_CONTATORI_HOME_PAGINA_MAIN;
    return m && typeof m[nome] === 'function' ? m[nome](...args) : undefined;
  } catch (_) { return undefined; }
}

module.exports = { crea, misura };
