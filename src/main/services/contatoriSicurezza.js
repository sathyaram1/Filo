// Le misure della sicurezza (#1474): verdetti, controlli di rete, avvisi, pagine delicate, segreti tolti, uscite e tetti.
// Passa nomi da elenchi chiusi e numeri al servizio dei contatori, che tiene interruttore e incognito; mai un indirizzo,
// un segreto o un testo. Forma: src/shared/contatoriSicurezza.js.

function crea(dip = {}) {
  const contatori = dip.contatori;
  const S = dip.S || globalThis.SN_CONTATORI_SICUREZZA;
  const C = () => dip.C || globalThis.SN_CONTATORI;

  // `incognito` vero salta; altrimenti decide il contesto della chiamata, come per ogni altro conto.
  const scrivi = (fn, incognito = false) => contatori.sicurezza((ora) => fn(ora), { incognito: incognito ? true : null });

  // Il verdetto della pagina che la scheda ha davanti: `doc` è il documento della scheda, che porta il segno di dove la
  // pagina è già contata. Si conta l'ultimo verdetto, letto quando la scrittura arriva.
  function verdetto(doc, v, { incognito = false } = {}) {
    if (!doc || typeof doc !== 'object' || !v || typeof v !== 'object') return false;
    if (!doc._contatore) doc._contatore = {};
    const segno = doc._contatore;
    segno.verdetto = { livello: String(v.level || ''), motivi: Array.isArray(v.reasons) ? v.reasons.map(String) : [] };
    scrivi((ora) => S.registraVerdetto(ora, segno), incognito);
    return true;
  }

  function controllo(nome, esito, ms = null, { incognito = false } = {}) {
    if (!S.CONTROLLI.includes(nome)) return false;
    scrivi((ora) => S.registraControllo(ora, nome, esito, ms), incognito);
    return true;
  }
  function cambiato(si, { incognito = false } = {}) {
    scrivi((ora) => S.registraCambiato(ora, !!si), incognito);
    return true;
  }

  function scelta(nome, livello, momento, { incognito = false } = {}) {
    if (!S.SCELTE.includes(nome)) return false;
    scrivi((ora) => S.registraScelta(ora, nome, livello, momento), incognito);
    return true;
  }

  function paginaDelicata(motivo, lavoro, { incognito = false } = {}) {
    if (!motivo || !S.LAVORI.includes(lavoro)) return false;
    scrivi((ora) => S.registraPaginaDelicata(ora, motivo, lavoro), incognito);
    return true;
  }
  function filtroGuasto(lavoro, opzioni) { return paginaDelicata(S.FILTRO_GUASTO, lavoro, opzioni); }

  // `tipi`: i tipi dei segreti tolti da una richiesta (src/main/services/modelGate.js), mai i valori.
  function segretiTolti(action, tipi) {
    if (!Array.isArray(tipi) || !tipi.length) return false;
    let f = '';
    try { f = C().funzioneDi(action) || ''; } catch (_) { f = ''; }
    const lista = tipi.map((t) => String(t || ''));
    scrivi((ora) => S.registraSegreti(ora, f || S.ALTRO, lista));
    return true;
  }

  // `u`: il verdetto della porta delle uscite; del resto della frase non esce niente.
  function uscitaFermata(u, action) {
    if (!u || !u.blocca) return false;
    const regola = String(u.regola || '');
    const tipo = String(u.tipo || '');
    const verbo = String((action && action.type) || '');
    scrivi((ora) => S.registraUscita(ora, regola, tipo, verbo));
    return true;
  }

  function tetto(nome, { incognito = false } = {}) {
    if (!S.TETTI_CODICE.includes(nome)) return false;
    scrivi((ora) => S.registraTetto(ora, nome), incognito);
    return true;
  }

  return { verdetto, controllo, cambiato, scelta, paginaDelicata, filtroGuasto, segretiTolti, uscitaFermata, tetto };
}

// Per gli agganci: una misura che non c'è o che si rompe non ferma mai chi la chiama.
function misura(nome, ...args) {
  try {
    const m = globalThis.SN_CONTATORI_SICUREZZA_MAIN;
    return m && typeof m[nome] === 'function' ? m[nome](...args) : undefined;
  } catch (_) { return undefined; }
}

// La porta delle uscite che conta i suoi blocchi: ogni strada che la usa conta da qui, mai dal chiamante. Non conta chi
// giudica soltanto (`soloGiudizio`: un collegamento giudicato prima del clic, che al clic ripassa). Avvolta due volte conta una.
const CONTATA = Symbol('uscite contate');
function contaUscite(porta) {
  if (typeof porta !== 'function' || porta[CONTATA]) return porta;
  const contata = async (action, opzioni) => {
    const u = await porta(action, opzioni);
    if (u && u.blocca && !(opzioni && opzioni.soloGiudizio)) misura('uscitaFermata', u, action);
    return u;
  };
  contata[CONTATA] = true;
  return contata;
}

module.exports = { crea, misura, contaUscite };
