// Domande all'owner (SPEC-DOMANDE.md §3): tipi d'azione come dati, validazione coi tetti, etichette e ordine.
// PURO e unico: lo incorpora il server (bake-shared), lo usano la Gestione e scripts/domanda.mjs.
// Un'etichetta nasce solo da tipo, parametri e riferimenti del server, mai dal testo di chi chiede (§3.3).

(function (global) {
  'use strict';

  const PRIORITA = Object.freeze(['bloccante', 'importante', 'quando_puoi']);
  // `in_smistamento`: il compito «Gestisci la domanda» (§3.5) la sta smistando o riscrivendo, prima che arrivi all'owner.
  const STATI = Object.freeze(['in_smistamento', 'aperta', 'in_lavorazione', 'chiusa', 'superata']);
  const SCHEDE = Object.freeze(['da_rispondere', 'in_lavorazione', 'risposte_automatiche', 'archivio']);
  const FIDUCIA = Object.freeze(['fidato', 'non_fidato']);
  const ORIGINI = Object.freeze(['feedback', 'ramo', 'compito', 'domanda', 'locale', 'server']);
  const COLLEGAMENTI = Object.freeze(['feedback', 'ramo', 'domanda']);

  // Tetti in caratteri, la conversazione in byte del chiaro: oltre si rifiuta col numero, mai un taglio (CLAUDE.md § Limiti).
  const TETTI = Object.freeze({
    titolo: 200,
    contesto: 6000,
    problema: 6000,
    opzioni: 8,
    testoOpzione: 600,
    pro: 2000,
    contro: 2000,
    perche: 3000,
    notePerAgenti: 30000,
    gruppo: 100,
    collegamenti: 20,
    idCollegamento: 200,
    testoTurno: 10000,
    conversazioneByte: 300 * 1024,
    aperteBiglietto: 20,
    principio: 2000,
    // La forma (§3.1): il titolo dice di cosa si parla, e un'opzione sola non è una domanda.
    paroleTitolo: 10,
    opzioniMinime: 2,
  });

  // La forma che il compito «Gestisci la domanda» dà a ciò che pubblica per l'owner (§3.5). Una riga sono
  // `caratteriRiga` caratteri, un a capo ne apre un'altra.
  const FORMA_OWNER = Object.freeze({
    opzioniMassime: 4,
    righeContesto: 5,
    righeProblema: 3,
    righeOpzione: 1,
    righePerche: 1,
    caratteriRiga: 140,
  });

  // Le chiavi che un'azione `automazione` può scrivere: solo booleani già in Automazioni. `spegne`: il vero spegne.
  const CHIAVI_AUTOMAZIONE = Object.freeze({
    'routine.enabled': Object.freeze({ nome: 'Routine', spegne: false }),
    'routine.accountAOff': Object.freeze({ nome: 'Routine dell’account A', spegne: true }),
    'routine.accountBOff': Object.freeze({ nome: 'Routine dell’account B', spegne: true }),
  });

  const FEEDBACK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
  const PARAMETRI = Object.freeze({
    feedbackId: (v) => typeof v === 'string' && FEEDBACK_ID_RE.test(v),
    valorePriorita: (v) => Number.isInteger(v) && v >= 0 && v <= 3,
    chiave: (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(CHIAVI_AUTOMAZIONE, v),
    valoreBooleano: (v) => typeof v === 'boolean',
  });

  // `bulk`: ammessa in «applica il consiglio» su più domande. `consenso`: vale solo da un gesto dell'owner nella finestra.
  function tipo(parametri, flag) {
    return Object.freeze(Object.assign({ parametri: Object.freeze(parametri) }, flag));
  }
  const TIPI = Object.freeze({
    riprendi: tipo({ feedbackId: 'feedbackId' }, { bulk: true, consenso: false, attivo: true }),
    priorita: tipo({ feedbackId: 'feedbackId', valore: 'valorePriorita' }, { bulk: true, consenso: false, attivo: true }),
    archivia: tipo({ feedbackId: 'feedbackId' }, { bulk: true, consenso: false, attivo: true }),
    automazione: tipo({ chiave: 'chiave', valore: 'valoreBooleano' }, { bulk: false, consenso: false, attivo: true }),
    ambito: tipo({}, { bulk: false, consenso: true, attivo: false }),
    esperimento: tipo({}, { bulk: false, consenso: true, attivo: false }),
    compito: tipo({}, { bulk: true, consenso: false, attivo: true }),
  });

  const ha = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isOggetto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const no = (errore, dettaglio, extra) => Object.assign({ ok: false, errore, dettaglio }, extra || {});

  /** L'azione normalizzata (solo tipo e i suoi parametri), o il rifiuto: un parametro in più non si ignora. */
  function validaAzione(azione) {
    if (!isOggetto(azione) || typeof azione.tipo !== 'string' || !ha(TIPI, azione.tipo)) {
      const t = isOggetto(azione) && typeof azione.tipo === 'string' ? azione.tipo.slice(0, 40) : '';
      return no('tipo_sconosciuto', `tipo d'azione ${t ? `«${t}» ` : ''}sconosciuto: i tipi sono ${Object.keys(TIPI).join(', ')}`);
    }
    const spec = TIPI[azione.tipo];
    if (!spec.attivo) return no('tipo_non_attivo', `il tipo «${azione.tipo}» non si può ancora applicare`);
    const inPiu = Object.keys(azione).filter((k) => k !== 'tipo' && !ha(spec.parametri, k));
    if (inPiu.length) return no('parametri_non_validi', `«${azione.tipo}» non ha i parametri ${inPiu.map((k) => `«${k.slice(0, 40)}»`).join(', ')}`);
    const out = { tipo: azione.tipo };
    for (const [nome, forma] of Object.entries(spec.parametri)) {
      if (!PARAMETRI[forma](azione[nome])) return no('parametri_non_validi', `«${azione.tipo}»: il parametro «${nome}» manca o non è valido`);
      out[nome] = azione[nome];
    }
    return { ok: true, azione: out };
  }

  function lunghezzaOk(valore, campo, massimo) {
    if (valore.length <= massimo) return null;
    return no('campo_troppo_lungo', `«${campo}» è lungo ${valore.length} caratteri, il massimo è ${massimo}: accorcialo e rimanda la domanda`,
      { campo, lunghezza: valore.length, massimo });
  }

  function testoFacoltativo(input, campo, massimo) {
    if (!ha(input, campo) || input[campo] == null) return { ok: true, valore: '' };
    if (typeof input[campo] !== 'string') return no('domanda_non_valida', `«${campo}» deve essere un testo`);
    const troppo = lunghezzaOk(input[campo], campo, massimo);
    return troppo || { ok: true, valore: input[campo] };
  }

  const CAMPI_DOMANDA = Object.freeze(['titolo', 'contesto', 'problema', 'opzioni', 'consiglio', 'priorita', 'origine', 'collegamenti', 'notePerAgenti', 'gruppo', 'blocca']);
  // Li decide il server: nell'ingresso si ignorano, così un «fidato» scritto da chi chiede non vale niente.
  const CAMPI_DEL_SERVER = Object.freeze(['fiducia', 'stato', 'numero', 'id', 'creataIl', 'modificataIl', 'conversazione', 'esito', 'legata', 'provvisoria', 'principio']);
  const CAMPI_OPZIONE = Object.freeze(['testo', 'pro', 'contro', 'azione']);

  function validaOpzione(o, i, perOwner) {
    const n = i + 1;
    if (!isOggetto(o)) return no('opzione_non_valida', `l'opzione ${n} non è un oggetto con testo, pro, contro e azione`, { campo: `opzioni[${i}]` });
    const ignoti = Object.keys(o).filter((k) => !CAMPI_OPZIONE.includes(k));
    if (ignoti.length) return no('campo_sconosciuto', `l'opzione ${n} ha campi sconosciuti: ${ignoti.map((k) => k.slice(0, 40)).join(', ')}`);
    if (typeof o.testo !== 'string' || !o.testo.trim()) return no('opzione_non_valida', `l'opzione ${n} non ha il testo`, { campo: `opzioni[${i}].testo` });
    const troppo = lunghezzaOk(o.testo, `opzioni[${i}].testo`, TETTI.testoOpzione);
    if (troppo) return troppo;
    const pro = testoFacoltativo(o, 'pro', TETTI.pro);
    if (!pro.ok) return Object.assign(pro, { dettaglio: `opzione ${n}: ${pro.dettaglio}` });
    const contro = testoFacoltativo(o, 'contro', TETTI.contro);
    if (!contro.ok) return Object.assign(contro, { dettaglio: `opzione ${n}: ${contro.dettaglio}` });
    if (perOwner) {
      for (const [campo, r] of [['pro', pro], ['contro', contro]]) {
        if (r.valore.trim()) continue;
        return no(`${campo}_mancante`, `l'opzione ${n} non ha il ${campo}: ogni opzione dice cosa guadagna e cosa costa, in una riga ciascuno`,
          { campo: `opzioni[${i}].${campo}` });
      }
    }
    if (!ha(o, 'azione')) return no('parametri_non_validi', `l'opzione ${n} non ha l'azione: ogni opzione dice cosa fa il suo pulsante`);
    const a = validaAzione(o.azione);
    if (!a.ok) return Object.assign(a, { dettaglio: `opzione ${n}: ${a.dettaglio}` });
    return { ok: true, opzione: { testo: o.testo.trim(), pro: pro.valore, contro: contro.valore, azione: a.azione } };
  }

  function validaCollegamento(c, i) {
    if (!isOggetto(c) || !COLLEGAMENTI.includes(c.tipo)) {
      return no('domanda_non_valida', `collegamento ${i + 1}: il tipo va scelto fra ${COLLEGAMENTI.join(', ')}`);
    }
    const id = typeof c.id === 'string' ? c.id.trim() : '';
    if (!id || id.length > TETTI.idCollegamento || !/^[A-Za-z0-9._/#~-]+$/.test(id)) {
      return no('domanda_non_valida', `collegamento ${i + 1}: l'id manca, ha caratteri non ammessi o supera ${TETTI.idCollegamento} caratteri`);
    }
    return { ok: true, collegamento: { tipo: c.tipo, id } };
  }

  // Testo per l'owner (§3.1): lui non legge il codice. Un sito (filo.red, claude.ai) o un prodotto (Node.js) passa.
  const FILE_CODICE_RE = /^[A-Za-z0-9_][\w.-]*\.(?:mjs|cjs|jsx?|tsx?|json|md|sh|ps1|html?|css|ya?ml)$/i;
  const PRODOTTO_RE = /^[A-Z][a-z]+\.js$/;
  const LINEETTE_RE = /[–—―]/g;
  const PRO_VUOTO_RE = /^(?:nessuno|nessuna|nessun pro|niente|nulla|n\/a|-+)\.?$/i;
  const MOSTRATI = 6;

  // Spezzare prima e controllare ogni pezzo con un'ancora tiene il costo lineare anche su 6000 caratteri ostili.
  function fileNominati(testo) {
    const visti = [];
    for (const parola of String(testo).split(/[\s«»"'‘’“”`()[\]{}<>,;!?|*…]+/)) {
      const senzaSito = parola.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
      for (const pezzo of senzaSito.split(/[/\\:#?=&@]+/)) {
        const nome = pezzo.replace(/\.+$/, '');
        if (FILE_CODICE_RE.test(nome) && !PRODOTTO_RE.test(nome) && !visti.includes(nome)) visti.push(nome);
      }
    }
    return visti;
  }

  /** I campi per l'owner con nomi di file, lineette o un pro vuoto; null se sono puliti. `notePerAgenti` resta libero. */
  function controllaTestoOwner(domanda) {
    const campi = [['titolo', domanda.titolo], ['contesto', domanda.contesto], ['problema', domanda.problema]];
    (domanda.opzioni || []).forEach((o, i) => {
      campi.push([`opzioni[${i}].testo`, o.testo], [`opzioni[${i}].pro`, o.pro], [`opzioni[${i}].contro`, o.contro]);
    });
    if (domanda.consiglio) campi.push(['consiglio.perche', domanda.consiglio.perche]);
    const problemi = [];
    const tipi = new Set();
    for (const [campo, valore] of campi) {
      if (typeof valore !== 'string' || !valore) continue;
      const cosa = [];
      const file = fileNominati(valore);
      if (file.length) {
        const altri = file.length > MOSTRATI ? ` e altri ${file.length - MOSTRATI}` : '';
        cosa.push(`nomina ${file.slice(0, MOSTRATI).join(', ')}${altri}`);
        tipi.add('file');
      }
      const lineette = (valore.match(LINEETTE_RE) || []).length;
      if (lineette) {
        cosa.push(lineette === 1 ? 'ha una lineetta (— o –)' : `ha ${lineette} lineette (— o –)`);
        tipi.add('lineette');
      }
      const lato = /\.(pro|contro)$/.exec(campo);
      if (lato && PRO_VUOTO_RE.test(valore.trim())) {
        cosa.push(`ha come ${lato[1]} «${valore.trim()}»`);
        tipi.add(lato[1]);
      }
      if (cosa.length) problemi.push({ campo, testo: `«${campo}» ${cosa.join(' e ')}` });
    }
    if (!problemi.length) return null;
    const rimedi = [];
    if (tipi.has('file')) rimedi.push('sposta i nomi di file in notePerAgenti, con gli altri dettagli tecnici (lì il testo è libero)');
    if (tipi.has('lineette')) rimedi.push('al posto delle lineette metti un punto o una virgola');
    if (tipi.has('pro')) rimedi.push('un\'opzione senza un pro vero si toglie, o si scrive il pro vero');
    if (tipi.has('contro')) rimedi.push('scrivi il contro vero (cosa costa, cosa rischia, cosa lascia indietro)');
    return no('testo_non_per_owner', `nel testo per l'owner ${problemi.map((p) => p.testo).join('; ')}. Cosa fare: ${rimedi.join('; ')}`,
      { campo: problemi[0].campo, campi: problemi.map((p) => p.campo) });
  }

  // Una parola ha almeno una lettera o una cifra: «:» o «·» da soli non contano, «l'owner» e «D-186» valgono una.
  function paroleDi(testo) {
    return String(testo || '').split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
  }

  /**
   * Una domanda in ingresso, controllata e normalizzata. `conOrigine` false: l'origine la mette il server (biglietto).
   * `perOwner` false solo per una domanda che il server apre per il compito e non arriva all'owner (il terzo guasto
   * uguale, §3.8): lì un'opzione sola e i pro e contro vuoti passano, perché a smistarla è il compito.
   * @returns {{ ok:true, domanda:object } | { ok:false, errore:string, dettaglio:string, campo?:string }}
   */
  function validaDomanda(input, { conOrigine = true, perOwner = true } = {}) {
    if (!isOggetto(input)) return no('domanda_non_valida', 'la domanda deve essere un oggetto JSON');
    const ignoti = Object.keys(input).filter((k) => !CAMPI_DOMANDA.includes(k) && !CAMPI_DEL_SERVER.includes(k));
    if (ignoti.length) {
      return no('campo_sconosciuto', `campi sconosciuti: ${ignoti.slice(0, 8).map((k) => k.slice(0, 40)).join(', ')}. I campi sono ${CAMPI_DOMANDA.join(', ')}`);
    }
    const titolo = typeof input.titolo === 'string' ? input.titolo.trim() : '';
    if (!titolo) return no('titolo_mancante', 'manca il titolo: una riga che dice di cosa si parla', { campo: 'titolo' });
    const t = lunghezzaOk(titolo, 'titolo', TETTI.titolo);
    if (t) return t;
    const parole = paroleDi(titolo);
    if (perOwner && parole > TETTI.paroleTitolo) {
      return no('titolo_troppo_lungo', `il titolo ha ${parole} parole, il massimo è ${TETTI.paroleTitolo}: dice di cosa si parla, il resto va nel contesto`,
        { campo: 'titolo', lunghezza: parole, massimo: TETTI.paroleTitolo });
    }
    if (!PRIORITA.includes(input.priorita)) return no('priorita_non_valida', `la priorità va scelta fra ${PRIORITA.join(', ')}`, { campo: 'priorita' });
    const testi = {};
    for (const campo of ['contesto', 'problema', 'notePerAgenti', 'gruppo']) {
      const r = testoFacoltativo(input, campo, TETTI[campo]);
      if (!r.ok) return r;
      testi[campo] = campo === 'gruppo' ? r.valore.trim() : r.valore;
    }
    const grezze = input.opzioni == null ? [] : input.opzioni;
    if (!Array.isArray(grezze)) return no('domanda_non_valida', '«opzioni» deve essere un elenco', { campo: 'opzioni' });
    if (grezze.length > TETTI.opzioni) {
      return no('troppe_opzioni', `${grezze.length} opzioni, il massimo è ${TETTI.opzioni}`, { campo: 'opzioni', lunghezza: grezze.length, massimo: TETTI.opzioni });
    }
    if (perOwner && grezze.length < TETTI.opzioniMinime) {
      const quante = grezze.length ? 'un\'opzione sola' : 'nessuna opzione';
      return no('opzioni_insufficienti', `${quante}, ne servono almeno ${TETTI.opzioniMinime}: con una scelta sola non c'è niente da decidere `
        + '(è un feedback o una nota). Aggiungi la strada che resta, per esempio archiviare il lavoro o tenerlo com\'è',
      { campo: 'opzioni', lunghezza: grezze.length, minimo: TETTI.opzioniMinime });
    }
    const opzioni = [];
    for (let i = 0; i < grezze.length; i++) {
      const r = validaOpzione(grezze[i], i, perOwner);
      if (!r.ok) return r;
      opzioni.push(r.opzione);
    }
    let consiglio = null;
    if (opzioni.length) {
      const c = input.consiglio;
      if (!isOggetto(c) || !Number.isInteger(c.opzione) || c.opzione < 0 || c.opzione >= opzioni.length) {
        return no('consiglio_non_valido', `con le opzioni serve il consiglio: { opzione: l'indice da 0 a ${opzioni.length - 1}, perche: il motivo }`, { campo: 'consiglio' });
      }
      const ignotiC = Object.keys(c).filter((k) => k !== 'opzione' && k !== 'perche');
      if (ignotiC.length) return no('campo_sconosciuto', `il consiglio ha campi sconosciuti: ${ignotiC.map((k) => k.slice(0, 40)).join(', ')}`);
      if (typeof c.perche !== 'string' || !c.perche.trim()) return no('consiglio_non_valido', 'il consiglio deve dire perché', { campo: 'consiglio.perche' });
      const p = lunghezzaOk(c.perche, 'consiglio.perche', TETTI.perche);
      if (p) return p;
      consiglio = { opzione: c.opzione, perche: c.perche };
    } else if (input.consiglio != null) {
      return no('consiglio_non_valido', 'un consiglio senza opzioni non ha niente da indicare');
    }
    const grezzi = input.collegamenti == null ? [] : input.collegamenti;
    if (!Array.isArray(grezzi)) return no('domanda_non_valida', '«collegamenti» deve essere un elenco');
    if (grezzi.length > TETTI.collegamenti) {
      return no('troppi_collegamenti', `${grezzi.length} collegamenti, il massimo è ${TETTI.collegamenti}`, { lunghezza: grezzi.length, massimo: TETTI.collegamenti });
    }
    const collegamenti = [];
    for (let i = 0; i < grezzi.length; i++) {
      const r = validaCollegamento(grezzi[i], i);
      if (!r.ok) return r;
      collegamenti.push(r.collegamento);
    }
    const domanda = Object.assign({ titolo, priorita: input.priorita, opzioni, consiglio, collegamenti }, testi);
    if (input.blocca != null) {
      if (typeof input.blocca !== 'boolean') return no('domanda_non_valida', '«blocca» è true o false: dice se la domanda ferma il lavoro finché l’owner non risponde');
      domanda.blocca = input.blocca;
    }
    if (conOrigine && input.origine != null) {
      const o = input.origine;
      const id = isOggetto(o) && typeof o.id === 'string' ? o.id.trim() : '';
      if (!isOggetto(o) || !ORIGINI.includes(o.tipo) || id.length > TETTI.idCollegamento || (id && !/^[A-Za-z0-9._/#~-]+$/.test(id))) {
        return no('domanda_non_valida', `l'origine va data come { tipo: uno fra ${ORIGINI.join(', ')}, id }`);
      }
      domanda.origine = { tipo: o.tipo, id };
    }
    const sporco = controllaTestoOwner(domanda);
    if (sporco) return sporco;
    return { ok: true, domanda };
  }

  function righeDi(testo) {
    return String(testo || '').split('\n').filter((r) => r.trim())
      .reduce((n, r) => n + Math.ceil(r.trim().length / FORMA_OWNER.caratteriRiga), 0);
  }

  /**
   * La forma di ciò che il compito «Gestisci la domanda» pubblica per l'owner (§3.5), sopra a `validaDomanda`: da 2 a
   * 4 opzioni, contesto e problema corti, pro, contro e perché di una riga. null se va bene. PURA.
   */
  function controllaFormaOwner(domanda) {
    const d = isOggetto(domanda) ? domanda : {};
    const opzioni = Array.isArray(d.opzioni) ? d.opzioni : [];
    if (opzioni.length > FORMA_OWNER.opzioniMassime) {
      return no('troppe_opzioni', `${opzioni.length} opzioni, per l'owner al massimo ${FORMA_OWNER.opzioniMassime}: tieni le strade che hanno un pro vero`,
        { campo: 'opzioni', lunghezza: opzioni.length, massimo: FORMA_OWNER.opzioniMassime });
    }
    const campi = [['contesto', d.contesto, FORMA_OWNER.righeContesto], ['problema', d.problema, FORMA_OWNER.righeProblema]];
    opzioni.forEach((o, i) => {
      campi.push([`opzioni[${i}].pro`, o && o.pro, FORMA_OWNER.righeOpzione], [`opzioni[${i}].contro`, o && o.contro, FORMA_OWNER.righeOpzione]);
    });
    if (isOggetto(d.consiglio)) campi.push(['consiglio.perche', d.consiglio.perche, FORMA_OWNER.righePerche]);
    for (const [campo, valore, massimo] of campi) {
      const righe = righeDi(valore);
      if (righe <= massimo) continue;
      const max = massimo * FORMA_OWNER.caratteriRiga;
      return no('forma_non_per_owner', `«${campo}» occupa ${righe} righe, per l'owner al massimo ${massimo} (una riga è ${FORMA_OWNER.caratteriRiga} caratteri, `
        + `quindi ${max} in tutto): frasi corte, i dettagli in notePerAgenti`, { campo, lunghezza: righe, massimo });
    }
    return null;
  }

  /** Un'opzione riprende il lavoro su `feedbackId` ('' = su qualunque feedback). PURA. */
  function riprende(domanda, feedbackId = '') {
    return (isOggetto(domanda) && Array.isArray(domanda.opzioni) ? domanda.opzioni : [])
      .some((o) => isOggetto(o) && isOggetto(o.azione) && o.azione.tipo === 'riprendi' && (!feedbackId || o.azione.feedbackId === feedbackId));
  }

  const BLOCCA_REGOLA = 'Blocca (true) se andare avanti con la consigliata, e poi l’owner sceglie altro, lascia un danno che un altro giro '
    + 'non rimedia (soldi, dati dell’utente, sicurezza e segreti, politica sui modelli, terzi, account e credenziali), o se serve un fatto '
    + 'che sa solo l’owner; nel dubbio blocca. Non blocca (false): il lavoro va avanti con la consigliata come decisione provvisoria';

  /**
   * Chi apre una domanda che riprende il lavoro su `feedbackId` dice se lo ferma (#1577); null se la domanda è in
   * regola. `feedbackId` '' vale per qualunque feedback ripreso. PURA.
   */
  function controllaBlocca(domanda, feedbackId = '') {
    const d = isOggetto(domanda) ? domanda : {};
    const lega = riprende(d, feedbackId);
    if (lega && typeof d.blocca !== 'boolean') {
      return no('blocca_mancante', `manca «blocca»: la domanda riprende il lavoro${feedbackId ? ` su ${feedbackId}` : ''}, dì se lo ferma finché l’owner non risponde. ${BLOCCA_REGOLA}`);
    }
    if (!lega && d.blocca === true) {
      return no('blocca_senza_ripresa', `«blocca» vale per una domanda che riprende il lavoro${feedbackId ? ` su ${feedbackId}` : ''}: aggiungi l’opzione «riprendi», o togli «blocca»`);
    }
    return null;
  }

  // Le azioni che il compito «Gestisci la risposta» (§3.5) applica da sé: quelle che l'owner applica anche in blocco.
  // Una di consenso resta a un gesto dell'owner nella finestra (§1.4), e un compito non ne fa nascere un altro.
  const DEL_COMPITO = Object.freeze(['riprendi', 'priorita', 'archivia']);

  /** Il rifiuto per un'azione che il compito non applica, o null se la può applicare. PURA. */
  function vietataAlCompito(azione) {
    const v = validaAzione(azione);
    if (!v.ok) return v;
    const t = v.azione.tipo;
    if (TIPI[t].consenso === true) {
      return no('azione_di_consenso', `«${t}» vuole il consenso dell'owner: la applica solo lui, dalla finestra di Filo. Scrivigli un chiarimento che gli dica quale opzione scegliere`);
    }
    if (!DEL_COMPITO.includes(t)) return no('azione_non_del_compito', `«${t}» non la applica un agente: le sue azioni sono ${DEL_COMPITO.join(', ')}`);
    return null;
  }

  function riferimentoDi(riferimenti, id) {
    const r = isOggetto(riferimenti) && ha(riferimenti, id) ? riferimenti[id] : null;
    return r && typeof r.num === 'string' && /^#\d{1,9}(\.\d{1,6})?$/.test(r.num) ? r : null;
  }

  /** Il testo del pulsante, dai soli dati; null se tipo, parametri o riferimento non tornano (nessun pulsante). */
  function etichettaAzione(azione, riferimenti) {
    const v = validaAzione(azione);
    if (!v.ok) return null;
    const a = v.azione;
    if (a.tipo === 'compito') return 'Affida a un agente';
    if (a.tipo === 'automazione') {
      const k = CHIAVI_AUTOMAZIONE[a.chiave];
      return `${k.nome}: ${a.valore !== k.spegne ? 'accendi' : 'spegni'}`;
    }
    const r = riferimentoDi(riferimenti, a.feedbackId);
    if (!r) return null;
    if (a.tipo === 'riprendi') return `Riprendi ${r.num} con questa scelta`;
    if (a.tipo === 'archivia') return `Archivia ${r.num}`;
    if (a.tipo === 'approva_locale') return `Affida ${r.num} ai lavori server`;
    if (a.tipo === 'priorita') return Number.isInteger(r.priorita) ? `Priorità di ${r.num}: ${r.priorita} → ${a.valore}` : null;
    return null;
  }

  function rangoPriorita(p) {
    const i = PRIORITA.indexOf(p);
    return i < 0 ? PRIORITA.length : i;
  }
  // Una domanda senza gruppo è un gruppo da sola.
  function chiaveGruppo(d) {
    const g = typeof d.gruppo === 'string' ? d.gruppo.trim().toLocaleLowerCase('it') : '';
    return g ? `g:${g}` : `d:${String(d.id || d.numero || '')}`;
  }
  function eta(d) {
    const n = Number(d.creataIl);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  }

  /** §3.7: bloccante, importante, quando_puoi; dentro, per gruppo (dal più vecchio) e poi per età. */
  function ordina(domande) {
    const lista = (Array.isArray(domande) ? domande : []).filter(isOggetto);
    const blocco = (d) => `${rangoPriorita(d.priorita)}|${chiaveGruppo(d)}`;
    const primo = new Map();
    for (const d of lista) primo.set(blocco(d), Math.min(primo.has(blocco(d)) ? primo.get(blocco(d)) : Number.MAX_SAFE_INTEGER, eta(d)));
    return lista.slice().sort((a, b) => (rangoPriorita(a.priorita) - rangoPriorita(b.priorita))
      || (primo.get(blocco(a)) - primo.get(blocco(b)))
      || blocco(a).localeCompare(blocco(b))
      || (eta(a) - eta(b))
      || ((Number(a.numero) || 0) - (Number(b.numero) || 0)));
  }

  /** I blocchi da aprire insieme, nell'ordine di `ordina`: `{ priorita, gruppo, domande }`. */
  function raggruppa(domande) {
    const out = [];
    let corrente = null;
    for (const d of ordina(domande)) {
      const k = `${rangoPriorita(d.priorita)}|${chiaveGruppo(d)}`;
      if (!corrente || corrente.chiave !== k) {
        corrente = { chiave: k, priorita: PRIORITA.includes(d.priorita) ? d.priorita : '', gruppo: typeof d.gruppo === 'string' ? d.gruppo.trim() : '', domande: [] };
        out.push(corrente);
      }
      corrente.domande.push(d);
    }
    return out.map(({ priorita, gruppo, domande: ds }) => ({ priorita, gruppo, domande: ds }));
  }

  /** La scheda della sezione Domande. Uno stato ignoto resta davanti all'owner. */
  function schedaDi(domanda) {
    const s = isOggetto(domanda) ? domanda.stato : '';
    if (s === 'in_lavorazione') return 'in_lavorazione';
    if (s === 'chiusa' && isOggetto(domanda.esito) && domanda.esito.automatica === true) return 'risposte_automatiche';
    if (s === 'chiusa' || s === 'superata') return 'archivio';
    return 'da_rispondere';
  }

  const ID_RE = /^D-([1-9]\d{0,8})$/;
  function idDi(numero) { return `D-${numero}`; }
  function numeroDi(id) {
    const m = ID_RE.exec(String(id == null ? '' : id).trim());
    return m ? Number(m[1]) : null;
  }

  global.SN_DOMANDE = {
    PRIORITA, STATI, SCHEDE, FIDUCIA, ORIGINI, COLLEGAMENTI, TETTI, CHIAVI_AUTOMAZIONE, TIPI, CAMPI_DOMANDA, CAMPI_DEL_SERVER, ID_RE,
    validaAzione, validaDomanda, controllaTestoOwner, etichettaAzione, ordina, raggruppa, schedaDi, idDi, numeroDi, riprende, controllaBlocca,
    DEL_COMPITO, vietataAlCompito,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
