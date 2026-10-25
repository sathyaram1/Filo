// Gli ambiti dei biglietti (SPEC-DOMANDE.md §5): l'elenco chiuso delle operazioni che il server accetta, gli ambiti
// iniziali coi loro limiti e il controllo di un ambito nuovo. Logica pura, fonte unica: il server la incorpora al
// deploy (filo-security tools/bake-shared.js), la Gestione la mostra. Prove: tests/unit/ambiti.test.mjs.

(function (global) {
  'use strict';

  // La triade (§5.1): nf legge testo non fidato, pv vede segreti o dati privati, ex agisce verso l'esterno.
  // rs: il server consegna testo riservato, quindi vale solo nell'ambiente dei riservati (§1.2).
  function op(descr, t) {
    const f = t || {};
    return Object.freeze({ descr, nf: !!f.nf, pv: !!f.pv || !!f.rs, ex: !!f.ex, rs: !!f.rs, attiva: f.attiva !== false });
  }
  const NON_ANCORA = { attiva: false };
  const OPERAZIONI = Object.freeze({
    'lavoro.consegna': op('lavorare il suo feedback', { nf: true }),
    'ramo.spingi': op('spingere il suo ramo', { ex: true }),
    'fusione.chiedi': op('chiedere la fusione', { ex: true }),
    'server.spingi': op('spingere un ramo su filo-security', { pv: true, ex: true }),
    'feedback.apri': op('aprire feedback'),
    'domanda.apri': op('aprire domande per l’owner'),
    'feedback.metadati': op('leggere numeri, stati, date e rami dei feedback, senza i testi'),
    'feedback.leggi': op('leggere il testo di un feedback', { nf: true, rs: true }),
    'coda.elenco': op('leggere l’elenco dei feedback in coda, coi titoli', { nf: true, rs: true }),
    'coda.leggi': op('leggere un feedback in coda', { nf: true, rs: true }),
    'coda.priorita': op('cambiare la priorità di un feedback in coda'),
    'coda.unione': op('chiedere un biglietto di unione, coi soli numeri'),
    'coda.archivia': op('archiviare un feedback in coda'),
    'unisci.genitori': op('leggere i feedback da unire', { nf: true }),
    'unisci.scrivi': op('scrivere il feedback unito e chiudere i genitori col rimando'),
    'domande.elenco': op('leggere l’elenco delle domande per l’owner', { nf: true, rs: true }),
    'domande.leggi': op('leggere una domanda per l’owner', { nf: true, rs: true }),
    'domande.priorita': op('cambiare la priorità di una domanda'),
    'domande.raggruppa': op('raggruppare le domande per tema'),
    'domande.supera': op('chiudere come superate le domande assorbite in un’altra'),
    'domande.principio': op('rispondere coi principi del registro', NON_ANCORA),
    'taccuino.scrivi': op('scrivere nel taccuino della gestione del lavoro', NON_ANCORA),
    'registri.leggi': op('leggere registri e sessioni delle routine', { nf: true, rs: true, attiva: false }),
    'curva.scrivi': op('scrivere la curva del parallelismo', NON_ANCORA),
    'ricorrente.anticipa': op('anticipare riordino e potatura, coi soli numeri', NON_ANCORA),
    'esperimento.lancia': op('lanciare esperimenti nel budget', NON_ANCORA),
    'fineturno.cambia': op('cambiare la domanda di fine turno dei ruoli', NON_ANCORA),
    'routine.spegni': op('spegnere routine o account in emergenza', NON_ANCORA),
    'sveglia.chiedi': op('chiedere una sveglia', NON_ANCORA),
    'guasto.rispondi': op('rispondere alle domande di guasto con riprendi, attendi o archivia', NON_ANCORA),
    'web.cerca': op('cercare sul web attraverso il server', { nf: true, ex: true, attiva: false }),
    'posta.leggi': op('ricevere i messaggi della casella di Filo', { nf: true, rs: true, attiva: false }),
    'posta.bozza': op('aprire domande con bozze di mail, solo per l’owner', NON_ANCORA),
    'esperimento.consegna': op('consegnare l’esito di un esperimento, come dati', NON_ANCORA),
    'giudizio.consegna': op('consegnare il verdetto di un giudizio cieco', NON_ANCORA),
  });

  // Le ha ogni biglietto (segnala) o ogni compito (rapporto), fuori dagli ambiti: non leggono e non escono.
  const UNIVERSALI = Object.freeze({
    segnala: 'mandare una segnalazione libera',
    rapporto: 'consegnare il rapporto dell’istanza',
  });

  // Nessun ambito le ha né le può avere (§5.1): una proposta che le nomina è respinta per nome, non perché sconosciuta.
  const VIETATE = Object.freeze({
    'blocco.approva': 'approvare blocchi di sicurezza',
    'fiducia.cambia': 'cambiare la fiducia',
    'ambito.crea': 'creare ambiti',
    'chiavi.tocca': 'toccare le chiavi',
  });

  function ambito(puo, nonPuo, f) {
    const flag = f || {};
    return Object.freeze({ puo: Object.freeze(puo.slice()), nonPuo, attivo: flag.attivo !== false, soloPuliti: !!flag.soloPuliti });
  }
  const LAVORO = ['lavoro.consegna', 'ramo.spingi', 'fusione.chiedi', 'feedback.apri', 'domanda.apri'];
  const INIZIALI = Object.freeze({
    lavoro: ambito(LAVORO, 'tutto il resto'),
    server: ambito(LAVORO.concat(['server.spingi']), 'tutto il resto, e vale solo per i biglietti puliti', { soloPuliti: true }),
    coda: ambito(['coda.elenco', 'coda.leggi', 'coda.priorita', 'coda.unione', 'coda.archivia', 'taccuino.scrivi'],
      'scrivere testi di feedback, cancellare, toccare Ricevuti'),
    unisci: ambito(['unisci.genitori', 'unisci.scrivi'], 'leggere altro'),
    domande: ambito(['domande.elenco', 'domande.leggi', 'domande.raggruppa', 'domande.priorita', 'domande.supera', 'domande.principio', 'domanda.apri'],
      'rispondere senza un principio, cambiare i principi, leggere le domande dell’addetto comunicazioni'),
    gestione_lavoro: ambito(['feedback.metadati', 'feedback.leggi', 'domande.elenco', 'domande.leggi', 'feedback.apri', 'domanda.apri',
      'registri.leggi', 'taccuino.scrivi', 'curva.scrivi', 'ricorrente.anticipa', 'esperimento.lancia', 'fineturno.cambia',
      'routine.spegni', 'sveglia.chiedi', 'guasto.rispondi'],
    'scrivere codice; cambiare feedback, priorità, criteri di verifica, prompt dei ruoli; rispondere con testo a una domanda di guasto; riaccendere quello che ha spento l’owner'),
    rami: ambito(['feedback.metadati', 'feedback.leggi', 'feedback.apri', 'domanda.apri', 'taccuino.scrivi'],
      'cancellare rami: lo fa la regola del server'),
    audit: ambito(['feedback.metadati', 'feedback.leggi', 'feedback.apri', 'domanda.apri'],
      'spingere rami, chiedere fusioni, cambiare feedback'),
    opportunita: ambito(['web.cerca', 'posta.bozza'], 'ricevere la casella; mandare mail', { attivo: false }),
    posta: ambito(['posta.leggi', 'posta.bozza', 'feedback.apri'], 'uscire in rete; mandare mail; vedere le credenziali della casella', { attivo: false }),
    esperimento: ambito(['esperimento.consegna'], 'fondere, aprire feedback o domande, spingere su GitHub, uscire in rete', { attivo: false }),
    giudizio: ambito(['giudizio.consegna'], 'tutto il resto, uscire in rete compreso', { attivo: false }),
  });

  const NOME_RE = /^[a-z][a-z_]{2,30}$/;
  const TETTI = Object.freeze({ operazioni: 30, nonPuo: 1000 });
  const ha = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const no = (errore, dettaglio) => ({ ok: false, errore, dettaglio });

  /** Le tre gambe della triade per un elenco di operazioni; un ambito solo per biglietti puliti non legge non fidato. */
  function triadeDi(puo, soloPuliti) {
    const ops = (Array.isArray(puo) ? puo : []).map((n) => OPERAZIONI[n]).filter(Boolean);
    return { nf: !soloPuliti && ops.some((o) => o.nf), pv: ops.some((o) => o.pv), ex: ops.some((o) => o.ex) };
  }
  function rompeTriade(puo, soloPuliti) {
    const t = triadeDi(puo, soloPuliti);
    return t.nf && t.pv && t.ex;
  }
  /** L'ambito consegna testo riservato: i suoi compiti girano solo nell'ambiente dei riservati. */
  function riservatoDi(puo) {
    return (Array.isArray(puo) ? puo : []).some((n) => OPERAZIONI[n] && OPERAZIONI[n].rs);
  }

  function approvatoNormale(v) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.operazioni)) return null;
    const puo = v.operazioni.filter((n) => typeof n === 'string' && ha(OPERAZIONI, n));
    if (!puo.length || rompeTriade(puo, false)) return null;
    return Object.freeze({ puo: Object.freeze(puo), nonPuo: typeof v.nonPuo === 'string' ? v.nonPuo : '', attivo: true, soloPuliti: false, approvato: true });
  }

  /** L'ambito col suo nome: iniziale, o approvato dall'owner (`approvati`: { nome: { operazioni, nonPuo } }); null se non c'è. */
  function ambitoDi(nome, approvati) {
    const n = String(nome || '');
    if (ha(INIZIALI, n)) return INIZIALI[n];
    if (approvati && typeof approvati === 'object' && ha(approvati, n) && NOME_RE.test(n)) return approvatoNormale(approvati[n]);
    return null;
  }

  /** Tutti gli ambiti come li mostra la Gestione. */
  function elenco(approvati) {
    const nomi = Object.keys(INIZIALI).concat(Object.keys(approvati && typeof approvati === 'object' ? approvati : {}).filter((n) => !ha(INIZIALI, n)));
    const out = [];
    for (const nome of nomi) {
      const a = ambitoDi(nome, approvati);
      if (!a) continue;
      out.push({
        nome,
        attivo: a.attivo,
        riservato: riservatoDi(a.puo),
        soloPuliti: a.soloPuliti,
        approvato: a.approvato === true,
        puo: a.puo.map((n) => ({ op: n, descr: OPERAZIONI[n].descr, attiva: OPERAZIONI[n].attiva })),
        nonPuo: a.nonPuo,
      });
    }
    return out;
  }

  /** I nomi degli ambiti che si possono dare a un compito adesso. */
  function attivi(approvati) {
    return elenco(approvati).filter((a) => a.attivo).map((a) => a.nome);
  }

  /**
   * Il biglietto con questi ambiti può fare `operazione`? Le universali sì, le altre solo se un suo ambito attivo la
   * elenca ed è già attiva. → { ok:true } | { ok:false, errore, dettaglio }
   */
  function consente(ambitiDelBiglietto, operazione, approvati) {
    const n = String(operazione || '');
    if (ha(UNIVERSALI, n)) return { ok: true };
    if (ha(VIETATE, n)) return no('operazione_vietata', `nessun ambito può ${VIETATE[n]}`);
    if (!ha(OPERAZIONI, n)) return no('operazione_sconosciuta', `«${n.slice(0, 60)}» non è un’operazione del server`);
    const nomi = (Array.isArray(ambitiDelBiglietto) ? ambitiDelBiglietto : []).map(String);
    const lo = nomi.find((nome) => { const a = ambitoDi(nome, approvati); return a && a.attivo && a.puo.includes(n); });
    if (!lo) return no('fuori_ambito', `«${n}» non è nell’ambito del biglietto (${nomi.join(', ') || 'nessuno'})`);
    if (!OPERAZIONI[n].attiva) return no('operazione_non_attiva', `«${n}» è dell’ambito ${lo} ma il server non la fa ancora`);
    return { ok: true };
  }

  /**
   * La proposta di un ambito nuovo (azione `ambito` di una domanda, §5.3), controllata come la controlla il server
   * prima di approvarla: nome libero, operazioni dell'elenco chiuso, nessuna vietata, triade rispettata.
   * → { ok:true, ambito: { nome, operazioni, nonPuo, riservato } } | { ok:false, errore, dettaglio }
   */
  function validaProposta(p, approvati) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return no('proposta_malformata', 'la proposta è un oggetto con nome, operazioni e nonPuo');
    const nome = typeof p.nome === 'string' ? p.nome.trim() : '';
    if (!NOME_RE.test(nome)) return no('nome_non_valido', 'il nome è di lettere minuscole e trattini bassi, da 3 a 31 caratteri, e comincia con una lettera');
    if (ambitoDi(nome, approvati) || ha(INIZIALI, nome)) return no('nome_esistente', `l’ambito «${nome}» esiste già`);
    const ops = Array.isArray(p.operazioni) ? p.operazioni : null;
    if (!ops || !ops.length) return no('operazioni_mancanti', 'un ambito ha almeno un’operazione');
    if (ops.length > TETTI.operazioni) return no('troppe_operazioni', `le operazioni sono ${ops.length}, il massimo è ${TETTI.operazioni}`);
    const viste = new Set();
    for (const o of ops) {
      const n = typeof o === 'string' ? o : '';
      if (ha(VIETATE, n)) return no('operazione_vietata', `nessun ambito può ${VIETATE[n]}`);
      if (ha(UNIVERSALI, n)) return no('operazione_universale', `«${n}» ce l’ha già ogni biglietto`);
      if (!ha(OPERAZIONI, n)) return no('operazione_sconosciuta', `«${String(o).slice(0, 60)}» non è un’operazione del server`);
      if (viste.has(n)) return no('operazione_doppia', `«${n}» è scritta due volte`);
      viste.add(n);
    }
    const nonPuo = typeof p.nonPuo === 'string' ? p.nonPuo.trim() : '';
    if (!nonPuo) return no('nonpuo_mancante', 'la proposta dice cosa l’ambito non può fare');
    if (nonPuo.length > TETTI.nonPuo) return no('troppo_lungo', `«non può» ha ${nonPuo.length} caratteri, il massimo è ${TETTI.nonPuo}`);
    const operazioni = Array.from(viste);
    if (rompeTriade(operazioni, false)) {
      return no('triade', 'l’ambito metterebbe insieme testo non fidato, dati privati e azioni verso l’esterno');
    }
    return { ok: true, ambito: { nome, operazioni, nonPuo, riservato: riservatoDi(operazioni) } };
  }

  global.SN_AMBITI = Object.freeze({
    OPERAZIONI, UNIVERSALI, VIETATE, INIZIALI, TETTI, NOME_RE,
    triadeDi, rompeTriade, riservatoDi, ambitoDi, elenco, attivi, consente, validaProposta,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
