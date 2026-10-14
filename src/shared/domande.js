// Domande all'owner (SPEC-DOMANDE.md §3): tipi d'azione come dati, validazione coi tetti, etichette, ordine e registro.
// PURO e unico: lo incorpora il server (bake-shared), lo usano la Gestione e scripts/domanda.mjs.
// Un'etichetta nasce solo da tipo, parametri e riferimenti del server, mai dal testo di chi chiede (§3.3).

(function (global) {
  'use strict';

  const PRIORITA = Object.freeze(['bloccante', 'importante', 'quando_puoi']);
  const STATI = Object.freeze(['aperta', 'in_lavorazione', 'chiusa', 'superata']);
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
    principio: 1000,
    cerca: 300,
    risultatiRegistro: 30,
    assorbite: 20,
  });

  // Le chiavi che un'azione `automazione` può scrivere: solo booleani già in Automazioni. `spegne`: il vero spegne.
  const CHIAVI_AUTOMAZIONE = Object.freeze({
    'routine.enabled': Object.freeze({ nome: 'Routine', spegne: false }),
    'routine.proberWhenIdle': Object.freeze({ nome: 'Esplorazione a coda vuota', spegne: false }),
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
    approva_locale: tipo({ feedbackId: 'feedbackId' }, { bulk: false, consenso: true, attivo: true }),
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

  const CAMPI_DOMANDA = Object.freeze(['titolo', 'contesto', 'problema', 'opzioni', 'consiglio', 'priorita', 'origine', 'collegamenti', 'notePerAgenti', 'gruppo']);
  // Li decide il server: nell'ingresso si ignorano, così un «fidato» scritto da chi chiede non vale niente.
  const CAMPI_DEL_SERVER = Object.freeze(['fiducia', 'stato', 'numero', 'id', 'creataIl', 'modificataIl', 'conversazione', 'esito',
    'principio', 'assorbitaDa', 'assorbite', 'riaperta']);
  const CAMPI_OPZIONE = Object.freeze(['testo', 'pro', 'contro', 'azione']);

  function validaOpzione(o, i) {
    const n = i + 1;
    if (!isOggetto(o)) return no('opzione_non_valida', `l'opzione ${n} non è un oggetto con testo, pro, contro e azione`);
    const ignoti = Object.keys(o).filter((k) => !CAMPI_OPZIONE.includes(k));
    if (ignoti.length) return no('campo_sconosciuto', `l'opzione ${n} ha campi sconosciuti: ${ignoti.map((k) => k.slice(0, 40)).join(', ')}`);
    if (typeof o.testo !== 'string' || !o.testo.trim()) return no('opzione_non_valida', `l'opzione ${n} non ha il testo`);
    const troppo = lunghezzaOk(o.testo, `opzioni[${i}].testo`, TETTI.testoOpzione);
    if (troppo) return troppo;
    const pro = testoFacoltativo(o, 'pro', TETTI.pro);
    if (!pro.ok) return Object.assign(pro, { dettaglio: `opzione ${n}: ${pro.dettaglio}` });
    const contro = testoFacoltativo(o, 'contro', TETTI.contro);
    if (!contro.ok) return Object.assign(contro, { dettaglio: `opzione ${n}: ${contro.dettaglio}` });
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

  /**
   * Una domanda in ingresso, controllata e normalizzata. `conOrigine` false: l'origine la mette il server (biglietto).
   * @returns {{ ok:true, domanda:object } | { ok:false, errore:string, dettaglio:string }}
   */
  function validaDomanda(input, { conOrigine = true } = {}) {
    if (!isOggetto(input)) return no('domanda_non_valida', 'la domanda deve essere un oggetto JSON');
    const ignoti = Object.keys(input).filter((k) => !CAMPI_DOMANDA.includes(k) && !CAMPI_DEL_SERVER.includes(k));
    if (ignoti.length) {
      return no('campo_sconosciuto', `campi sconosciuti: ${ignoti.slice(0, 8).map((k) => k.slice(0, 40)).join(', ')}. I campi sono ${CAMPI_DOMANDA.join(', ')}`);
    }
    const titolo = typeof input.titolo === 'string' ? input.titolo.trim() : '';
    if (!titolo) return no('titolo_mancante', 'manca il titolo: una riga che dice cosa si chiede');
    const t = lunghezzaOk(titolo, 'titolo', TETTI.titolo);
    if (t) return t;
    if (!PRIORITA.includes(input.priorita)) return no('priorita_non_valida', `la priorità va scelta fra ${PRIORITA.join(', ')}`);
    const testi = {};
    for (const campo of ['contesto', 'problema', 'notePerAgenti', 'gruppo']) {
      const r = testoFacoltativo(input, campo, TETTI[campo]);
      if (!r.ok) return r;
      testi[campo] = campo === 'gruppo' ? r.valore.trim() : r.valore;
    }
    const grezze = input.opzioni == null ? [] : input.opzioni;
    if (!Array.isArray(grezze)) return no('domanda_non_valida', '«opzioni» deve essere un elenco');
    if (grezze.length > TETTI.opzioni) {
      return no('troppe_opzioni', `${grezze.length} opzioni, il massimo è ${TETTI.opzioni}`, { lunghezza: grezze.length, massimo: TETTI.opzioni });
    }
    const opzioni = [];
    for (let i = 0; i < grezze.length; i++) {
      const r = validaOpzione(grezze[i], i);
      if (!r.ok) return r;
      opzioni.push(r.opzione);
    }
    let consiglio = null;
    if (opzioni.length) {
      const c = input.consiglio;
      if (!isOggetto(c) || !Number.isInteger(c.opzione) || c.opzione < 0 || c.opzione >= opzioni.length) {
        return no('consiglio_non_valido', `con le opzioni serve il consiglio: { opzione: l'indice da 0 a ${opzioni.length - 1}, perche: il motivo }`);
      }
      const ignotiC = Object.keys(c).filter((k) => k !== 'opzione' && k !== 'perche');
      if (ignotiC.length) return no('campo_sconosciuto', `il consiglio ha campi sconosciuti: ${ignotiC.map((k) => k.slice(0, 40)).join(', ')}`);
      if (typeof c.perche !== 'string' || !c.perche.trim()) return no('consiglio_non_valido', 'il consiglio deve dire perché');
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
    if (conOrigine && input.origine != null) {
      const o = input.origine;
      const id = isOggetto(o) && typeof o.id === 'string' ? o.id.trim() : '';
      if (!isOggetto(o) || !ORIGINI.includes(o.tipo) || id.length > TETTI.idCollegamento || (id && !/^[A-Za-z0-9._/#~-]+$/.test(id))) {
        return no('domanda_non_valida', `l'origine va data come { tipo: uno fra ${ORIGINI.join(', ')}, id }`);
      }
      domanda.origine = { tipo: o.tipo, id };
    }
    return { ok: true, domanda };
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
    if (a.tipo === 'approva_locale') return `Approva come lavoro locale ${r.num}`;
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
    if (s === 'chiusa' && isOggetto(domanda.esito) && (domanda.esito.automatica === true || domanda.esito.tipo === 'principio')) return 'risposte_automatiche';
    if (s === 'chiusa' || s === 'superata') return 'archivio';
    return 'da_rispondere';
  }

  // ─── Registro delle decisioni (§3.6): le domande chiuse col loro principio, nessun archivio a parte ───

  /** Il principio che una risposta stabilisce: una regola generale in una frase. Oltre il tetto si rifiuta col numero. */
  function validaPrincipio(testo) {
    const t = typeof testo === 'string' ? testo.trim() : '';
    if (!t) return no('principio_vuoto', 'il principio è la regola generale che la risposta stabilisce: una frase, non vuota');
    return lunghezzaOk(t, 'principio', TETTI.principio) || { ok: true, principio: t };
  }

  function principioDi(d) {
    const p = isOggetto(d) && isOggetto(d.principio) ? d.principio : null;
    return p && typeof p.testo === 'string' && p.testo.trim() ? p : null;
  }
  const idValido = (v) => (typeof v === 'string' && numeroDi(v) !== null ? v.trim() : '');

  /**
   * La voce del registro di una domanda, o null: conta solo una chiusa col suo principio non ancora sostituito.
   * Senza `fiducia` scritta dal server il principio vale non fidato: un principio piantato non risponde da solo.
   */
  function voceRegistro(d) {
    const p = principioDi(d);
    if (!p || d.stato !== 'chiusa' || idValido(p.sostituitoDa)) return null;
    return {
      id: String(d.id || ''),
      titolo: typeof d.titolo === 'string' ? d.titolo : '',
      gruppo: typeof d.gruppo === 'string' ? d.gruppo.trim() : '',
      principio: p.testo.trim(),
      fiducia: p.fiducia === 'fidato' ? 'fidato' : 'non_fidato',
      daRivedere: isOggetto(p.daRivedere),
      il: Number(p.scrittoIl) || Number(d.modificataIl) || 0,
    };
  }

  const PAROLE_VUOTE = new Set(('che chi con per non una uno gli del dei delle della dello degli alla alle allo agli dal dai '
    + 'dalla nel nei nella nelle sul sui sulla come piu anche sono essere fare questo questa quello quella quando dove '
    + 'cosa ogni tutto tutti tra fra senza').split(' '));
  // Una radice grezza basta a far incontrare «credito» e «crediti»: la ricerca la fa un agente, che riprova con altre parole.
  function radici(testo) {
    const s = String(testo == null ? '' : testo).toLocaleLowerCase('it').normalize('NFD').replace(/[̀-ͯ]/g, '');
    const out = new Set();
    for (const w of s.split(/[^a-z0-9]+/)) {
      if (w.length < 3 || PAROLE_VUOTE.has(w)) continue;
      out.add(w.length > 5 ? w.slice(0, Math.max(5, w.length - 2)) : w);
    }
    return out;
  }
  function incontra(q, parole) {
    for (const p of parole) {
      if (p === q) return true;
      const corta = p.length < q.length ? p : q;
      if (corta.length >= 4 && (p.startsWith(q) || q.startsWith(p))) return true;
    }
    return false;
  }
  const PESI_REGISTRO = Object.freeze({ principio: 3, titolo: 2, gruppo: 2 });
  const piuUtile = (a, b) => (Number(a.daRivedere) - Number(b.daRivedere))
    || (Number(b.fiducia === 'fidato') - Number(a.fiducia === 'fidato')) || (b.il - a.il);

  /**
   * Cerca nel registro. Senza parole lo dà tutto (per gruppo, poi dal più recente), così chi chiede può leggerlo intero;
   * con le parole, i primi `limite` per pertinenza e quante ne restano fuori. Mai un taglio muto.
   * @returns {{ ok:true, voci:object[], totale:number, altre:number } | { ok:false, errore, dettaglio }}
   */
  function cercaNelRegistro(domande, testo, { limite = TETTI.risultatiRegistro } = {}) {
    const q = typeof testo === 'string' ? testo.trim() : '';
    if (q.length > TETTI.cerca) {
      return no('campo_troppo_lungo', `la ricerca è lunga ${q.length} caratteri, il massimo è ${TETTI.cerca}: bastano le parole chiave`,
        { campo: 'cerca', lunghezza: q.length, massimo: TETTI.cerca });
    }
    const voci = (Array.isArray(domande) ? domande : []).map(voceRegistro).filter(Boolean);
    if (!q) {
      const perGruppo = (a, b) => (!a.gruppo - !b.gruppo) || a.gruppo.localeCompare(b.gruppo, 'it') || piuUtile(a, b);
      return { ok: true, voci: voci.sort(perGruppo), totale: voci.length, altre: 0 };
    }
    const cercate = [...radici(q)];
    if (!cercate.length) return no('ricerca_vuota', 'nessuna parola utile da cercare: servono parole di almeno tre lettere');
    const trovate = [];
    for (const v of voci) {
      const campi = { principio: radici(v.principio), titolo: radici(v.titolo), gruppo: radici(v.gruppo) };
      let punteggio = 0;
      for (const c of cercate) {
        let peso = 0;
        for (const [campo, parole] of Object.entries(campi)) if (PESI_REGISTRO[campo] > peso && incontra(c, parole)) peso = PESI_REGISTRO[campo];
        punteggio += peso;
      }
      if (punteggio > 0) trovate.push(Object.assign({ punteggio }, v));
    }
    trovate.sort((a, b) => (b.punteggio - a.punteggio) || piuUtile(a, b));
    const n = Number.isInteger(limite) && limite > 0 ? limite : TETTI.risultatiRegistro;
    return { ok: true, voci: trovate.slice(0, n), totale: trovate.length, altre: Math.max(0, trovate.length - n) };
  }

  /**
   * Un principio chiude da solo una domanda solo se è fidato e non da rivedere, e solo con un'azione che l'owner
   * applicherebbe anche in blocco senza un suo gesto: nessuna risposta automatica fa ciò che chiede il consenso.
   */
  function principioApplicabile(voce, azione) {
    if (!isOggetto(voce) || voce.fiducia !== 'fidato' || voce.daRivedere === true) return false;
    const v = validaAzione(azione);
    return v.ok && TIPI[v.azione.tipo].bulk === true && TIPI[v.azione.tipo].consenso !== true;
  }

  /**
   * La risposta automatica di una domanda aperta con un principio del registro: sceglie l'opzione `scelta`.
   * Il server applica l'azione come per una scelta dell'owner, poi scrive l'esito con ok/errore e la chiude.
   * @returns {{ ok:true, esito:object } | { ok:false, errore, dettaglio }}
   */
  function rispostaDaPrincipio(domanda, voce, scelta) {
    if (!isOggetto(domanda) || domanda.stato !== 'aperta') return no('domanda_non_aperta', 'un principio risponde solo a una domanda aperta');
    if (!isOggetto(voce) || !idValido(voce.id)) return no('principio_sconosciuto', 'il principio va indicato con la domanda che lo porta (D-n)');
    if (voce.id === domanda.id) return no('principio_di_se_stessa', 'una domanda non si risponde col proprio principio');
    const opzioni = Array.isArray(domanda.opzioni) ? domanda.opzioni : [];
    if (!Number.isInteger(scelta) || scelta < 0 || scelta >= opzioni.length) {
      return no('scelta_non_valida', opzioni.length ? `l'opzione va scelta fra 1 e ${opzioni.length}` : 'la domanda non ha opzioni da scegliere: resta all\'owner');
    }
    const azione = isOggetto(opzioni[scelta]) ? opzioni[scelta].azione : null;
    if (!principioApplicabile(voce, azione)) {
      const perche = voce.fiducia !== 'fidato' ? 'il principio non è fidato'
        : voce.daRivedere === true ? 'il principio è da rivedere: l\'owner l\'ha smentito con una riapertura'
          : 'l\'azione di quell\'opzione la decide solo l\'owner';
      return no('principio_non_applicabile', `${perche}: la domanda resta all'owner`);
    }
    return {
      ok: true,
      esito: { automatica: true, tipo: 'principio', principio: voce.id, testoPrincipio: voce.principio, scelta, azione: validaAzione(azione).azione },
    };
  }

  /**
   * La riapertura dell'owner di una risposta automatica: la domanda torna aperta con l'esito di prima da parte, e il
   * principio che l'aveva chiusa diventa da rivedere finché la nuova risposta non lo corregge o lo conferma.
   */
  function riapriAutomatica(domanda, { ora } = {}) {
    const e = isOggetto(domanda) ? domanda.esito : null;
    if (!isOggetto(domanda) || domanda.stato !== 'chiusa' || !isOggetto(e) || (e.automatica !== true && e.tipo !== 'principio')) {
      return no('non_automatica', 'così si riapre solo una risposta automatica chiusa');
    }
    const sorgente = idValido(e.principio);
    return {
      ok: true,
      domanda: { stato: 'aperta', esito: null, riaperta: { il: ora, esitoPrima: e }, modificataIl: ora },
      principio: sorgente ? { id: sorgente, daRivedere: { il: ora, da: String(domanda.id || '') } } : null,
    };
  }

  /** Chiusa col suo principio dopo una riapertura: il principio smentito che va segnato `sostituitoDa`, o ''. */
  function principioDaSostituire(domanda) {
    if (!isOggetto(domanda) || domanda.stato !== 'chiusa' || !principioDi(domanda)) return '';
    const prima = isOggetto(domanda.riaperta) && isOggetto(domanda.riaperta.esitoPrima) ? domanda.riaperta.esitoPrima : null;
    const id = prima ? idValido(prima.principio) : '';
    return id && id !== domanda.id ? id : '';
  }

  /**
   * Assorbe in `madre` le domande aperte che sono casi dello stesso problema: le figlie diventano superate e restano
   * leggibili dentro la madre, che prende i loro legami ai feedback e la priorità più urgente (assorbire non abbassa mai).
   * @returns {{ ok:true, madre:object, figlie:object[] } | { ok:false, errore, dettaglio }}
   */
  function assorbi(madre, figlie, { ora } = {}) {
    // Una madre già in lavorazione ha una risposta in mano a un agente, che non vedrebbe i casi arrivati dopo.
    if (!isOggetto(madre) || madre.stato !== 'aperta' || !idValido(madre.id)) {
      return no('madre_non_aperta', 'si assorbe solo in una domanda aperta');
    }
    const lista = Array.isArray(figlie) ? figlie : [];
    if (!lista.length) return no('niente_da_assorbire', 'nessuna domanda da assorbire');
    if (lista.length > TETTI.assorbite) {
      return no('troppe_assorbite', `${lista.length} domande da assorbire, il massimo è ${TETTI.assorbite} per volta`, { lunghezza: lista.length, massimo: TETTI.assorbite });
    }
    const ids = [];
    for (const f of lista) {
      const id = isOggetto(f) ? idValido(f.id) : '';
      if (!id) return no('domanda_non_valida', 'ogni domanda da assorbire va data con il suo id (D-n)');
      if (id === madre.id) return no('assorbe_se_stessa', `${id} non può assorbire se stessa`);
      if (ids.includes(id)) return no('assorbita_due_volte', `${id} compare due volte`);
      if (f.stato !== 'aperta') return no('assorbita_non_aperta', `${id} è ${String(f.stato || '?').slice(0, 20)}: si assorbono solo le domande aperte`);
      ids.push(id);
    }
    const gia = Array.isArray(madre.collegamenti) ? madre.collegamenti.filter(isOggetto) : [];
    const chiave = (c) => `${c.tipo}|${c.id}`;
    const visti = new Set(gia.map(chiave));
    const collegamenti = gia.slice();
    const aggiungi = (c) => { if (c && !visti.has(chiave(c))) { visti.add(chiave(c)); collegamenti.push(c); } };
    for (const f of lista) {
      aggiungi({ tipo: 'domanda', id: f.id });
      if (isOggetto(f.origine) && f.origine.tipo === 'feedback' && f.origine.id) aggiungi({ tipo: 'feedback', id: f.origine.id });
      for (const c of Array.isArray(f.collegamenti) ? f.collegamenti : []) if (isOggetto(c) && c.tipo === 'feedback' && c.id) aggiungi({ tipo: 'feedback', id: c.id });
    }
    if (collegamenti.length > TETTI.collegamenti) {
      return no('troppi_collegamenti', `la domanda che assorbe arriverebbe a ${collegamenti.length} collegamenti, il massimo è ${TETTI.collegamenti}: assorbine meno per volta`,
        { lunghezza: collegamenti.length, massimo: TETTI.collegamenti });
    }
    const prima = Array.isArray(madre.assorbite) ? madre.assorbite.filter((x) => idValido(x)) : [];
    const rango = Math.min(rangoPriorita(madre.priorita), ...lista.map((f) => rangoPriorita(f.priorita)));
    return {
      ok: true,
      madre: { collegamenti, assorbite: [...new Set([...prima, ...ids])], priorita: PRIORITA[rango] || madre.priorita, modificataIl: ora },
      figlie: ids.map((id) => ({ id, stato: 'superata', assorbitaDa: madre.id, modificataIl: ora })),
    };
  }

  const ID_RE = /^D-([1-9]\d{0,8})$/;
  function idDi(numero) { return `D-${numero}`; }
  function numeroDi(id) {
    const m = ID_RE.exec(String(id == null ? '' : id).trim());
    return m ? Number(m[1]) : null;
  }

  global.SN_DOMANDE = {
    PRIORITA, STATI, SCHEDE, FIDUCIA, ORIGINI, COLLEGAMENTI, TETTI, CHIAVI_AUTOMAZIONE, TIPI, CAMPI_DOMANDA, CAMPI_DEL_SERVER, ID_RE,
    validaAzione, validaDomanda, etichettaAzione, ordina, raggruppa, schedaDi, idDi, numeroDi,
    validaPrincipio, voceRegistro, cercaNelRegistro, principioApplicabile, rispostaDaPrincipio, riapriAutomatica,
    principioDaSostituire, assorbi,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
