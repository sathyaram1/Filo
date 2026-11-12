// I contatori della sicurezza (#1474): verdetti sui siti, controlli di rete, avvisi, pagine delicate, segreti tolti,
// uscite fermate e tetti toccati: nomi da elenchi chiusi e numeri, mai un dominio, un indirizzo o un segreto.
// Regole: tests/unit/firestoreRulesContatoriSicurezza.test.mjs. Misura: src/main/services/contatoriSicurezza.js.

(function (global) {
  'use strict';

  // Un documento per pseudonimo e ora, con l'id dell'ora (#1461): le regole dell'ora sono già al tetto di espressioni.
  const VERSIONE = 1;
  const COLLEZIONE = 'contatori-sicurezza';
  const ALTRO = 'altro';

  // ── Gli elenchi chiusi: copie di quelli del codice, tests/unit/contatoriSicurezza.test.mjs li confronta ─────────
  const LIVELLI = Object.freeze(['safe', 'sospetto', 'pericoloso']);
  // I motivi del motore (src/main/services/safebrowse/engine.js e signals.js): «gsb_» con la categoria di Safe Browsing
  // (gsb.js, più «listed» quando non la dice), «cert_» con lo stato di un certificato rotto.
  const CATEGORIE_GSB = Object.freeze(['malware', 'phishing', 'unwanted', 'listed']);
  const STATI_CERT = Object.freeze(['expired', 'mismatch', 'self_signed', 'untrusted', 'absent', 'revoked']);
  const MOTIVI_SITO = Object.freeze([
    ...CATEGORIE_GSB.map((c) => `gsb_${c}`), 'strict_impersonation', 'broad_impersonation', 'weak_typo', 'young_domain',
    ...STATI_CERT.map((s) => `cert_${s}`), 'sandbox_dangerous', 'llm', 'insecure_form', 'insecure_transport',
    'sensitive_input', 'auto_download', 'double_extension', 'hosted_content', 'whitelisted', 'clean', 'local_host',
    'unparsable', ALTRO,
  ]);

  // I controlli di rete del verdetto. Il certificato lo vede la scheda, non lo si chiede a nessuno: niente durata né spento.
  const CONTROLLI_DI_RETE = Object.freeze(['gsb', 'rdap', 'ct', 'sandbox', 'llm']);
  const CONTROLLI = Object.freeze([...CONTROLLI_DI_RETE, 'cert']);
  // «fallito»: ha risposto senza un dato (un registro senza l'età, un giudizio illeggibile) o ha rifiutato la chiave.
  const ESITI_RETE = Object.freeze(['ok', 'transitorio', 'fallito']);
  const SPENTO = 'non_configurato';
  const ESITI_CERT = Object.freeze(['ok', 'fallito']);
  const CAMBIATO = 'cambiato';
  // Le attese in fasce, come quelle dei contatori dell'ora.
  const FASCE_DURATA = Object.freeze([
    ['ms500', 500], ['s1', 1000], ['s2', 2000], ['s5', 5000], ['s10', 10000], ['s30', 30000], ['oltre', Infinity],
  ]);

  // Le scelte sull'avviso del sito (src/main/tabs/tabSafebrowse.js, _sbScelta): «procedi» vale solo con «confermo».
  const SCELTE = Object.freeze(['procedi', 'continua', 'indietro', 'copia', 'chiedi', 'segnala_falso_allarme']);
  const LIVELLI_AVVISO = Object.freeze(['sospetto', 'pericoloso']);
  const MOMENTI = Object.freeze(['prima_di_aprire', 'dopo']);

  // I motivi di src/shared/pagineDelicate.js: i siti dell'utente, le categorie di serie, i campi visti. Una categoria
  // arrivata dalla configurazione remota esce «altro»: il suo nome lo sceglie chi scrive la configurazione.
  const CATEGORIE_DELICATE = Object.freeze(['utente', 'posta', 'banche', 'sanita', 'pa', 'campi', ALTRO]);
  // Il filtro che lancia vale «delicata» per tutto (nel dubbio): si conta a parte, non sotto una categoria.
  const FILTRO_GUASTO = 'filtro_guasto';
  const LAVORI = Object.freeze(['descrizione_automatica', 'spiegazione_preparata', 'contesto_correttore', 'riquadri', 'schermo',
    'riordino_schede', 'riassunto_schede']);

  // I tipi dei segreti custoditi (src/main/services/segretiCustoditi.js); un tipo nuovo che qui manca esce «altro».
  const TIPI_SEGRETO = Object.freeze(['portafoglio', 'accesso', 'identita', 'feedback', 'chiave', ALTRO]);
  // Le regole di valutaUscita (src/shared/urlExfil.js) e il guasto della porta (verdettiUscite.js).
  const REGOLE_LETTE = Object.freeze(['codice', 'password', 'chiave', 'iban', 'carta']);
  const CUSTODITO = 'custodito';
  const REGOLE_USCITA = Object.freeze([CUSTODITO, ...REGOLE_LETTE, 'guasto', ALTRO]);
  // I tipi d'azione dell'elenco delle uscite (USCITE e USCITE_PAGINA di urlExfil.js), scritti come nelle conferme (#1461).
  const VERBI = Object.freeze(['NAVIGA', 'LEGGI_PAGINA', 'CERCA_WEB', 'ESEGUI_COMANDO', 'INVIA_FEEDBACK', 'APRI_FILE',
    'APRI_SALVATA', 'CERCA_DOCUMENTI', 'CAMPO_PAGINA', 'SCARICA_COLLEGAMENTO', ALTRO]);

  // I tetti del codice che, toccati, fermano o tagliano qualcosa: chi li conta li nomina da qui.
  const TETTI_CODICE = Object.freeze(['automatiche_spiegazioni', 'automatiche_correttore', 'riquadri_visioni', 'geo_budget',
    'safebrowse_approfondimenti', 'link_accorciati', 'segreti_saturo', 'contatori_combinazioni']);

  // Il nome di una funzione contata (#969) come lo tengono le regole: l'elenco lo tiene l'app, e cresce.
  const FORMA_FUNZIONE = '[a-z][a-z0-9-]{0,39}';

  const MAX_CONTO = 999999999;
  const nomi = (fasce) => Object.freeze(fasce.map(([k]) => k));
  const alternative = (l) => `(${l.join('|')})`;
  const intero = (n) => Number.isInteger(n) && n >= 0;
  const oggetto = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const conto = (n) => (intero(n) ? Math.min(n, MAX_CONTO) : 0);
  const dalElenco = (v, l) => (l.includes(v) ? v : ALTRO);

  function fasciaIn(fasce, v) {
    const n = Number(v);
    if (v == null || v === '' || !Number.isFinite(n) || n < 0) return '';
    return fasce.find(([, fino]) => n <= fino)[0];
  }

  function funzioni() {
    const C = global.SN_CONTATORI;
    const l = C && typeof C.funzioni === 'function' ? C.funzioni() : [];
    return [...new Set([...l, ALTRO])].filter((f) => new RegExp(`^${FORMA_FUNZIONE}$`).test(f));
  }

  // ── Le chiavi di ogni misura: l'elenco chiuso intero, e la forma che ne tengono le regole ──────────────────────
  const prodotto = (...liste) => liste.reduce((acc, l) => acc.flatMap((a) => l.map((b) => (a ? `${a}:${b}` : b))), ['']);
  const MAPPE = Object.freeze(['sito_verdetto', 'sito_approfondito', 'avviso_scelta', 'pagina_delicata', 'segreto_oscurato',
    'uscita_fermata', 'tetto_toccato']);
  const CAMPI = Object.freeze(['v', 'pseudonimo', 'giorno', 'mese', 'ora', 'app', 'os', ...MAPPE]);
  const CATEGORIE_CONTATE = Object.freeze([...CATEGORIE_DELICATE, FILTRO_GUASTO]);
  const REGOLE_SENZA_TIPO = Object.freeze(REGOLE_USCITA.filter((r) => r !== CUSTODITO));

  function chiaviDi(campo) {
    switch (campo) {
      // «livello» da solo conta le pagine; «livello:motivo» i motivi, che in una pagina possono essere più d'uno.
      case 'sito_verdetto': return [...LIVELLI, ...prodotto(LIVELLI, MOTIVI_SITO)];
      case 'sito_approfondito': return [
        ...prodotto(CONTROLLI_DI_RETE, ESITI_RETE, nomi(FASCE_DURATA)), ...prodotto(CONTROLLI_DI_RETE, [SPENTO]),
        ...prodotto(['cert'], ESITI_CERT), ...prodotto([CAMBIATO], ['si', 'no']),
      ];
      case 'avviso_scelta': return prodotto(SCELTE, LIVELLI_AVVISO, MOMENTI);
      case 'pagina_delicata': return prodotto(CATEGORIE_CONTATE, LAVORI);
      case 'segreto_oscurato': return prodotto(TIPI_SEGRETO, funzioni());
      case 'uscita_fermata': return [...prodotto([CUSTODITO], TIPI_SEGRETO, VERBI), ...prodotto(REGOLE_SENZA_TIPO, VERBI)];
      case 'tetto_toccato': return [...TETTI_CODICE];
      default: return [];
    }
  }

  const CHIAVI_FORMA = Object.freeze({
    sito_verdetto: `${alternative(LIVELLI)}([:]${alternative(MOTIVI_SITO)})?`,
    sito_approfondito: `(${alternative(CONTROLLI_DI_RETE)}[:](${alternative(ESITI_RETE)}[:]${alternative(nomi(FASCE_DURATA))}|${SPENTO})`
      + `|cert[:]${alternative(ESITI_CERT)}|${CAMBIATO}[:](si|no))`,
    avviso_scelta: `${alternative(SCELTE)}[:]${alternative(LIVELLI_AVVISO)}[:]${alternative(MOMENTI)}`,
    pagina_delicata: `${alternative(CATEGORIE_CONTATE)}[:]${alternative(LAVORI)}`,
    segreto_oscurato: `${alternative(TIPI_SEGRETO)}[:]${FORMA_FUNZIONE}`,
    uscita_fermata: `(${CUSTODITO}[:]${alternative(TIPI_SEGRETO)}|${alternative(REGOLE_SENZA_TIPO)})[:]${alternative(VERBI)}`,
    tetto_toccato: alternative(TETTI_CODICE),
  });
  const unite = (voce) => `^(${voce}(#${voce})*)?$`;
  const FORME = Object.freeze({
    CHIAVI: Object.freeze(Object.fromEntries(MAPPE.map((c) => [c, unite(CHIAVI_FORMA[c])]))),
    CONTI: unite('[0-9]{1,9}'),
  });
  // I tetti di caratteri delle chiavi unite e dei conti uniti, per misura: almeno il doppio dell'elenco intero di oggi.
  // I segreti per funzione hanno posto per quattro volte le funzioni di oggi: una funzione nuova non aspetta regole nuove.
  const FUNZIONI_PREVISTE = 160;
  const TETTI = Object.freeze({
    sito_verdetto: [3600, 1700], sito_approfondito: [3800, 2300], avviso_scelta: [1500, 500], pagina_delicata: [2700, 1200],
    segreto_oscurato: [FUNZIONI_PREVISTE * TIPI_SEGRETO.length * 54, FUNZIONI_PREVISTE * TIPI_SEGRETO.length * 10],
    uscita_fermata: [7200, 2900], tetto_toccato: [400, 200],
  });

  // ── L'ora, in memoria ─────────────────────────────────────────────────
  // Sta nell'ora dei contatori sotto `sicurezza`: i suoi conti hanno già la chiave che esce.
  function vuota() {
    return Object.fromEntries(MAPPE.map((c) => [c, {}]));
  }
  function dati(ora) {
    if (!oggetto(ora)) return vuota();
    if (!oggetto(ora.sicurezza)) ora.sicurezza = vuota();
    const d = ora.sicurezza;
    for (const c of MAPPE) if (!oggetto(d[c])) d[c] = {};
    return d;
  }
  function piuUno(ora, campo, chiave) {
    const m = dati(ora)[campo];
    m[chiave] = conto(m[chiave]) + 1;
    return true;
  }

  function chiaviVerdetto(livello, motivi) {
    if (!LIVELLI.includes(livello)) return [];
    const visti = [...new Set((Array.isArray(motivi) ? motivi : []).map((m) => dalElenco(String(m), MOTIVI_SITO)))];
    return [livello, ...visti.map((m) => `${livello}:${m}`)];
  }
  // Un verdetto per pagina aperta, l'ultimo: `segno` è della pagina e ricorda dove e con quali chiavi l'ha contata. Nella
  // stessa ora il verdetto nuovo prende il posto del vecchio; dopo, la pagina resta contata dov'era.
  function registraVerdetto(ora, segno) {
    if (!oggetto(segno) || !oggetto(segno.verdetto)) return false;
    const nuove = chiaviVerdetto(segno.verdetto.livello, segno.verdetto.motivi);
    if (!nuove.length) return false;
    const prima = oggetto(segno.contato) ? segno.contato : null;
    if (prima && prima.ora !== ora) return false;
    const m = dati(ora).sito_verdetto;
    if (prima) {
      if (prima.chiavi.join('#') === nuove.join('#')) return true;
      for (const k of prima.chiavi) {
        const n = conto(m[k]) - 1;
        if (n > 0) m[k] = n; else delete m[k];
      }
    }
    for (const k of nuove) m[k] = conto(m[k]) + 1;
    segno.contato = { ora, chiavi: nuove };
    return true;
  }

  // Un controllo del verdetto: l'esito, e per quelli di rete quanto è durato. «non_configurato» non ha durata.
  function registraControllo(ora, controllo, esito, ms) {
    if (controllo === 'cert') return ESITI_CERT.includes(esito) ? piuUno(ora, 'sito_approfondito', `cert:${esito}`) : false;
    if (!CONTROLLI_DI_RETE.includes(controllo)) return false;
    if (esito === SPENTO) return piuUno(ora, 'sito_approfondito', `${controllo}:${SPENTO}`);
    const f = fasciaIn(FASCE_DURATA, ms);
    if (!ESITI_RETE.includes(esito) || !f) return false;
    return piuUno(ora, 'sito_approfondito', `${controllo}:${esito}:${f}`);
  }
  function registraCambiato(ora, cambiato) {
    return piuUno(ora, 'sito_approfondito', `${CAMBIATO}:${cambiato ? 'si' : 'no'}`);
  }

  function registraScelta(ora, scelta, livello, momento) {
    if (!SCELTE.includes(scelta) || !LIVELLI_AVVISO.includes(livello) || !MOMENTI.includes(momento)) return false;
    return piuUno(ora, 'avviso_scelta', `${scelta}:${livello}:${momento}`);
  }

  // `motivo`: quello che dà il filtro (una categoria, anche remota), o FILTRO_GUASTO.
  function categoriaDi(motivo) {
    const m = String(motivo || '');
    if (!m) return '';
    return m === FILTRO_GUASTO ? m : dalElenco(m, CATEGORIE_DELICATE);
  }
  function registraPaginaDelicata(ora, motivo, lavoro) {
    const c = categoriaDi(motivo);
    if (!c || !LAVORI.includes(lavoro)) return false;
    return piuUno(ora, 'pagina_delicata', `${c}:${lavoro}`);
  }

  // Una richiesta a un modello partita con almeno un segreto tolto: un conto per tipo tolto, sotto la sua funzione.
  function registraSegreti(ora, funzione, tipi) {
    const f = dalElenco(String(funzione || ''), funzioni());
    const visti = [...new Set((Array.isArray(tipi) ? tipi : []).map((t) => dalElenco(String(t || ''), TIPI_SEGRETO)))];
    if (!visti.length) return false;
    for (const t of visti) piuUno(ora, 'segreto_oscurato', `${t}:${f}`);
    return true;
  }

  function chiaveUscita(regola, tipo, verbo) {
    const r = dalElenco(String(regola || ''), REGOLE_USCITA);
    const v = dalElenco(String(verbo || '').toUpperCase(), VERBI);
    return r === CUSTODITO ? `${r}:${dalElenco(String(tipo || ''), TIPI_SEGRETO)}:${v}` : `${r}:${v}`;
  }
  function registraUscita(ora, regola, tipo, verbo) {
    return piuUno(ora, 'uscita_fermata', chiaveUscita(regola, tipo, verbo));
  }

  function registraTetto(ora, tetto) {
    return TETTI_CODICE.includes(tetto) ? piuUno(ora, 'tetto_toccato', tetto) : false;
  }

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
    const grezzo = oggetto(ora) && oggetto(ora.sicurezza) ? JSON.parse(JSON.stringify(ora.sicurezza)) : {};
    const d = dati({ sicurezza: grezzo });
    const [giorno, h] = String(chiave || '').split('T');
    const doc = {
      v: VERSIONE,
      pseudonimo: String(pseudonimo || ''),
      giorno: String(giorno || ''),
      mese: String(giorno || '').slice(0, 7),
      ora: String(h || ''),
      app: C ? C.versioneApp(app) : String(app || ''),
      os: C && C.OS.includes(os) ? os : ALTRO,
    };
    for (const c of MAPPE) doc[c] = contiPuliti(d[c], chiaviDi(c));
    return doc;
  }
  // Un'ora senza niente della sicurezza non ha il suo documento.
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

  global.SN_CONTATORI_SICUREZZA = {
    VERSIONE, COLLEZIONE, CAMPI, MAPPE, FORME, TETTI, CHIAVI_FORMA, FUNZIONI_PREVISTE, FORMA_FUNZIONE, ALTRO,
    LIVELLI, CATEGORIE_GSB, STATI_CERT, MOTIVI_SITO, CONTROLLI_DI_RETE, CONTROLLI, ESITI_RETE, SPENTO, ESITI_CERT, FASCE_DURATA,
    SCELTE, LIVELLI_AVVISO, MOMENTI, CATEGORIE_DELICATE, FILTRO_GUASTO, LAVORI, TIPI_SEGRETO, REGOLE_LETTE, REGOLE_USCITA, VERBI,
    TETTI_CODICE,
    funzioni, chiaviDi, fasciaIn, chiaviVerdetto, categoriaDi, chiaveUscita,
    vuota, dati, registraVerdetto, registraControllo, registraCambiato, registraScelta, registraPaginaDelicata,
    registraSegreti, registraUscita, registraTetto,
    documento, senzaDati, valida,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
