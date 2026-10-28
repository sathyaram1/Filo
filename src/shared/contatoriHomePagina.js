// I contatori della home e di quello che Filo fa da sé sulla pagina (#1473): comandi e ricerca della barra della home,
// «risali», l'intervista rifatta, le proposte sulla pagina e gli automatismi fatti e disfatti. Nomi da elenchi chiusi e
// numeri, mai un testo, un sito o un paese. Regole: tests/unit/firestoreRulesContatoriHomePagina.test.mjs. Misura: src/main/services/contatoriHomePagina.js.

(function (global) {
  'use strict';

  // Un documento per pseudonimo e ora, con l'id dell'ora (#1461): le regole dell'ora sono già al tetto di espressioni.
  const VERSIONE = 1;
  const COLLEZIONE = 'contatori-home-pagina';

  // ── Gli elenchi chiusi: copie di quelli del codice, tests/unit/contatoriHomePagina.test.mjs li confronta ─────────
  // I comandi di SLASH_COMMANDS (src/pages/dashboard/dashboard-comandi.js) per nome, senza /incognito: da quale strada
  // parte una finestra in incognito non esce.
  const COMANDI = Object.freeze(['home', 'clear', 'kill', 'newtab', 'models', 'modelli', 'sicurezza', 'preferenze', 'editor',
    'feedback', 'pulisci', 'pulizia', 'riordina', 'set']);
  // «sito_diretto»: «/dominio»; «shell»: un comando della modalità terminale; «sconosciuto_inviato»: un «/qualcosa» rosso
  // mandato lo stesso al modello.
  const STRADE = Object.freeze(['sito_diretto', 'shell', 'sconosciuto_inviato']);
  const NON_RISOLTO = 'sito_non_risolto';
  const SCELTE_NON_RISOLTO = Object.freeze(['apri_lo_stesso', 'lascia']);

  const FASCE_RISULTATI = Object.freeze([['r0', 0], ['r1_3', 3], ['r4_10', 10], ['oltre', Infinity]]);
  const TIPI_RISULTATO = Object.freeze(['messaggio', 'pagina', 'scheda_chiusa']);
  const FASCE_POSIZIONE = Object.freeze([['p1', 1], ['p2_3', 3], ['p4_10', 10], ['oltre', Infinity]]);
  // Le attese nelle fasce dei contatori dell'ora (SN_CONTATORI.FASCE).
  const FASCE_TEMPO = Object.freeze([
    ['ms500', 500], ['s1', 1000], ['s2', 2000], ['s5', 5000], ['s10', 10000], ['s30', 30000], ['oltre', Infinity],
  ]);
  const VUOTA_RIPETUTA = 'vuota_ripetuta';
  // Una ricerca a zero risultati seguita da un'altra entro questo tempo: chi si è perso riprova.
  const RIPETUTA_MS = 10 * 1000;

  const FASCE_PEZZI = Object.freeze([['n1', 1], ['n2_3', 3], ['n4_10', 10], ['oltre', Infinity]]);

  const RIAPERTA = 'riaperta';
  const COMPLETA = 'completa';

  const TIPI_PROPOSTA = Object.freeze(['apri_da_altro_paese', 'email_account', 'riquadro_rotto', 'resta_connesso']);
  // «ignorata»: sparita senza risposta (la pagina cambiata, la scheda chiusa, una proposta nuova al suo posto).
  const ESITI_PROPOSTA = Object.freeze(['accettata', 'rifiutata', 'spenta_per_sempre', 'ignorata']);
  // Come si accetta la proposta dell'account email (src/main/propostaEmail.js).
  const COME_EMAIL = Object.freeze(['clic', 'tastiera', 'menu']);

  const AUTOMATISMI = Object.freeze(['banner_cookie', 'zoom_ricordato', 'segnalazione_automatica', 'pubblicita_saltata']);
  // La pubblicità saltata non ha un ritorno: il suo conto dice solo se la funzione lavora.
  const DISFACIBILI = Object.freeze(AUTOMATISMI.filter((a) => a !== 'pubblicita_saltata'));

  const MAX_CONTO = 999999999;
  const nomi = (fasce) => Object.freeze(fasce.map(([k]) => k));
  const alternative = (l) => `(${l.join('|')})`;
  const intero = (n) => Number.isInteger(n) && n >= 0;
  const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const conto = (n) => (intero(n) ? Math.min(n, MAX_CONTO) : 0);

  function fasciaIn(fasce, v) {
    const n = Number(v);
    if (v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(n) || n < 0) return '';
    return fasce.find(([, fino]) => n <= fino)[0];
  }

  // I passi dell'intervista (SN_ONBOARDING.ITEM_IDS): l'elenco lo tiene l'intervista, le regole ne tengono la forma.
  const FORMA_PASSO = '[a-z][a-z0-9_]{0,29}';
  function passi() {
    const O = global.SN_ONBOARDING;
    const l = O && Array.isArray(O.ITEM_IDS) ? O.ITEM_IDS : [];
    return l.filter((p) => new RegExp(`^${FORMA_PASSO}$`).test(p) && p !== COMPLETA);
  }

  // ── Le chiavi di ogni misura: l'elenco chiuso intero, e la forma che ne tengono le regole ──────────────────────
  const prodotto = (...liste) => liste.reduce((acc, l) => acc.flatMap((a) => l.map((b) => (a ? `${a}:${b}` : b))), ['']);
  const MAPPE = Object.freeze(['comando_home', 'ricerca_home', 'risali', 'intervista_rifatta', 'proposta_sulla_pagina',
    'automatismo_fatto', 'automatismo_disfatto']);
  const CAMPI = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'ora', 'app', 'os', ...MAPPE]);

  function chiaviDi(campo) {
    switch (campo) {
      case 'comando_home': return [...COMANDI, ...STRADE, ...prodotto([NON_RISOLTO], SCELTE_NON_RISOLTO)];
      // «risultati:» conta le ricerche, «aperto:» i risultati aperti.
      case 'ricerca_home': return [
        ...prodotto(['risultati'], nomi(FASCE_RISULTATI)),
        ...prodotto(['aperto'], TIPI_RISULTATO, nomi(FASCE_POSIZIONE), nomi(FASCE_TEMPO)),
        VUOTA_RIPETUTA,
      ];
      case 'risali': return [...nomi(FASCE_PEZZI)];
      case 'intervista_rifatta': return [RIAPERTA, ...prodotto(['fine'], [...passi(), COMPLETA])];
      case 'proposta_sulla_pagina': return [...prodotto(TIPI_PROPOSTA, ESITI_PROPOSTA), ...prodotto(['email_account'], ['accettata'], COME_EMAIL)];
      case 'automatismo_fatto': return [...AUTOMATISMI];
      case 'automatismo_disfatto': return [...DISFACIBILI];
      default: return [];
    }
  }

  const CHIAVI_FORMA = Object.freeze({
    comando_home: `(${alternative([...COMANDI, ...STRADE])}|${NON_RISOLTO}[:]${alternative(SCELTE_NON_RISOLTO)})`,
    ricerca_home: `(risultati[:]${alternative(nomi(FASCE_RISULTATI))}|aperto[:]${alternative(TIPI_RISULTATO)}[:]`
      + `${alternative(nomi(FASCE_POSIZIONE))}[:]${alternative(nomi(FASCE_TEMPO))}|${VUOTA_RIPETUTA})`,
    risali: alternative(nomi(FASCE_PEZZI)),
    intervista_rifatta: `(${RIAPERTA}|fine[:]${FORMA_PASSO})`,
    proposta_sulla_pagina: `(${alternative(TIPI_PROPOSTA)}[:]${alternative(ESITI_PROPOSTA)}|email_account[:]accettata[:]${alternative(COME_EMAIL)})`,
    automatismo_fatto: alternative(AUTOMATISMI),
    automatismo_disfatto: alternative(DISFACIBILI),
  });
  const unite = (voce) => `^(${voce}(#${voce})*)?$`;
  const FORME = Object.freeze({
    CHIAVI: Object.freeze(Object.fromEntries(MAPPE.map((c) => [c, unite(CHIAVI_FORMA[c])]))),
    CONTI: unite('[0-9]{1,9}'),
  });
  // I tetti di caratteri delle chiavi unite e dei conti uniti, per misura: almeno il doppio dell'elenco intero di oggi.
  // L'intervista ha posto per quattro volte i passi di oggi: un passo nuovo non aspetta regole nuove.
  const PASSI_PREVISTI = 40;
  const TETTI = Object.freeze({
    comando_home: [600, 400], ricerca_home: [5600, 1800], risali: [100, 100],
    intervista_rifatta: [PASSI_PREVISTI * 36, PASSI_PREVISTI * 10], proposta_sulla_pagina: [1200, 400],
    automatismo_fatto: [200, 100], automatismo_disfatto: [200, 100],
  });

  // ── L'ora, in memoria ─────────────────────────────────────────────────
  // Sta nell'ora dei contatori sotto `homePagina`: i suoi conti hanno già la chiave che esce.
  function vuota() {
    return Object.fromEntries(MAPPE.map((c) => [c, {}]));
  }
  function dati(ora) {
    if (!oggetto(ora)) return vuota();
    if (!oggetto(ora.homePagina)) ora.homePagina = vuota();
    const d = ora.homePagina;
    for (const c of MAPPE) if (!oggetto(d[c])) d[c] = {};
    return d;
  }
  function piuUno(ora, campo, chiave) {
    if (!chiaviDi(campo).includes(chiave)) return false;
    const m = dati(ora)[campo];
    m[chiave] = conto(m[chiave]) + 1;
    return true;
  }

  // `cosa`: un comando di COMANDI, una strada di STRADE, o «sito_non_risolto» con la scelta.
  function chiaveComando(cosa, scelta = '') {
    const c = String(cosa || '');
    if (c === NON_RISOLTO) return SCELTE_NON_RISOLTO.includes(scelta) ? `${NON_RISOLTO}:${scelta}` : '';
    return COMANDI.includes(c) || STRADE.includes(c) ? c : '';
  }
  function registraComando(ora, cosa, scelta) {
    const k = chiaveComando(cosa, scelta);
    return k ? piuUno(ora, 'comando_home', k) : false;
  }

  function registraRicerca(ora, risultati) {
    const f = fasciaIn(FASCE_RISULTATI, risultati);
    return f ? piuUno(ora, 'ricerca_home', `risultati:${f}`) : false;
  }
  // `posizione` da 1; `ms` dalla ricerca all'apertura.
  function registraAperto(ora, tipo, posizione, ms) {
    const p = Number(posizione) >= 1 ? fasciaIn(FASCE_POSIZIONE, posizione) : '';
    const t = fasciaIn(FASCE_TEMPO, ms);
    if (!TIPI_RISULTATO.includes(tipo) || !p || !t) return false;
    return piuUno(ora, 'ricerca_home', `aperto:${tipo}:${p}:${t}`);
  }
  function registraVuotaRipetuta(ora) { return piuUno(ora, 'ricerca_home', VUOTA_RIPETUTA); }

  function registraRisali(ora, pezzi) {
    const f = Number(pezzi) >= 1 ? fasciaIn(FASCE_PEZZI, pezzi) : '';
    return f ? piuUno(ora, 'risali', f) : false;
  }

  function registraIntervistaRiaperta(ora) { return piuUno(ora, 'intervista_rifatta', RIAPERTA); }
  // `passo`: quello dove la persona si è fermata, o COMPLETA.
  function registraIntervistaFine(ora, passo) {
    const p = String(passo || '');
    return p === COMPLETA || passi().includes(p) ? piuUno(ora, 'intervista_rifatta', `fine:${p}`) : false;
  }

  function chiaveProposta(tipo, esito, come = '') {
    if (!TIPI_PROPOSTA.includes(tipo) || !ESITI_PROPOSTA.includes(esito)) return '';
    if (tipo === 'email_account' && esito === 'accettata' && COME_EMAIL.includes(come)) return `${tipo}:${esito}:${come}`;
    return `${tipo}:${esito}`;
  }
  function registraProposta(ora, tipo, esito, come) {
    const k = chiaveProposta(tipo, esito, come);
    return k ? piuUno(ora, 'proposta_sulla_pagina', k) : false;
  }

  function registraFatto(ora, tipo) { return AUTOMATISMI.includes(tipo) ? piuUno(ora, 'automatismo_fatto', tipo) : false; }
  function registraDisfatto(ora, tipo) { return DISFACIBILI.includes(tipo) ? piuUno(ora, 'automatismo_disfatto', tipo) : false; }

  // ── Il documento che esce: ricostruito dagli elenchi chiusi, mai copiato ───────────────────────────────────
  function contiPuliti(mappa, ammesse) {
    const out = {};
    for (const k of ammesse) {
      const n = oggetto(mappa) && has(mappa, k) ? mappa[k] : 0;
      if (intero(n) && n > 0) out[k] = String(conto(n));
    }
    return out;
  }

  // `dati`: l'ora dei contatori com'è sul disco.
  function documento({ pseudonimo, chiave, app, os, dati: ora }) {
    const C = global.SN_CONTATORI;
    const grezzo = oggetto(ora) && oggetto(ora.homePagina) ? JSON.parse(JSON.stringify(ora.homePagina)) : {};
    const d = dati({ homePagina: grezzo });
    const [giorno, h] = String(chiave || '').split('T');
    const doc = {
      v: VERSIONE,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: String(giorno || '').slice(0, 7),
      ora: String(h || ''),
      app: C ? C.versioneApp(app) : String(app || ''),
      os: C && C.OS.includes(os) ? os : 'altro',
    };
    for (const c of MAPPE) doc[c] = contiPuliti(d[c], chiaviDi(c));
    return doc;
  }
  // Un'ora senza niente di questi contatori non ha il suo documento.
  function senzaDati(doc) {
    return !doc || MAPPE.every((c) => !oggetto(doc[c]) || !Object.keys(doc[c]).length);
  }

  // La forma che chiedono le regole, e in più le chiavi dell'elenco chiuso intero.
  function valida(doc) {
    const no = (motivo) => ({ ok: false, motivo });
    const C = global.SN_CONTATORI;
    if (!oggetto(doc)) return no('non è un documento');
    const chiavi = Object.keys(doc);
    if (chiavi.length !== CAMPI.length || !CAMPI.every((k) => has(doc, k))) return no(`campi: ${chiavi.join(',')}`);
    if (doc.v !== VERSIONE) return no('versione');
    if (!C) return no('contatori non caricati');
    if (!C.PSEUDONIMO_RE.test(String(doc.pseudonimo))) return no('pseudonimo');
    if (!C.GIORNO_RE.test(String(doc.giorno)) || doc.mese !== String(doc.giorno).slice(0, 7)) return no('giorno');
    if (!C.ORA_RE.test(String(doc.ora))) return no('ora');
    if (!C.APP_RE.test(String(doc.app))) return no('versione dell\'app');
    if (!C.OS.includes(doc.os)) return no('sistema');
    const conti = new RegExp(FORME.CONTI);
    for (const c of MAPPE) {
      const m = doc[c];
      if (!oggetto(m)) return no(c);
      const ammesse = new Set(chiaviDi(c));
      const ks = Object.keys(m);
      if (ks.some((k) => !ammesse.has(k))) return no(`${c}: chiave fuori elenco`);
      const vs = Object.values(m);
      if (!vs.every((v) => typeof v === 'string')) return no(`${c}: valori`);
      const [tk, tv] = TETTI[c];
      if (ks.join('#').length > tk || vs.join('#').length > tv) return no(`${c}: oltre il tetto`);
      if (!new RegExp(FORME.CHIAVI[c]).test(ks.join('#')) || !conti.test(vs.join('#'))) return no(`${c}: forma`);
    }
    return { ok: true, motivo: '' };
  }

  global.SN_CONTATORI_HOME_PAGINA = {
    VERSIONE, COLLEZIONE, CAMPI, MAPPE, FORME, TETTI, CHIAVI_FORMA, PASSI_PREVISTI, FORMA_PASSO,
    COMANDI, STRADE, NON_RISOLTO, SCELTE_NON_RISOLTO, FASCE_RISULTATI, TIPI_RISULTATO, FASCE_POSIZIONE, FASCE_TEMPO,
    VUOTA_RIPETUTA, RIPETUTA_MS, FASCE_PEZZI, RIAPERTA, COMPLETA, TIPI_PROPOSTA, ESITI_PROPOSTA, COME_EMAIL, AUTOMATISMI,
    DISFACIBILI,
    passi, chiaviDi, fasciaIn, chiaveComando, chiaveProposta,
    vuota, dati, registraComando, registraRicerca, registraAperto, registraVuotaRipetuta, registraRisali,
    registraIntervistaRiaperta, registraIntervistaFine, registraProposta, registraFatto, registraDisfatto,
    documento, senzaDati, valida,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
