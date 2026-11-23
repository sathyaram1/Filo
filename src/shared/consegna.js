// La consegna di chi lavora (#2505): criteri con la prova, elementi nuovi, classe di rischio e il suo minimo dai percorsi.
// Unica fonte per il canale delle routine e per il server (bake-shared → functions/src/routine/consegnaCondivisa.js).
// Prove: tests/unit/consegna.test.mjs e functions/test/consegna-2505.test.js.

(function (global) {
  'use strict';

  const VERSIONE = 1;
  // I nomi in grassetto di routines/roles/_criteri-verifica.md, nell'ordine: la sentinella li confronta col file.
  const CRITERI = Object.freeze([
    'La lamentela', 'Strade equivalenti', 'Stress', 'Sicurezza funzionale', 'Aspetto',
    'Completezza', 'Pattern', 'Miglioramenti', 'Una causa, tutte le porte', 'Oggetti e tipi',
  ].map((nome, i) => Object.freeze({ n: i + 1, nome })));
  const ESITI = Object.freeze(['fatto', 'non si applica']);
  // In ordine di gravità: la classe finale è la più alta fra la dichiarata e il minimo.
  const CLASSI = Object.freeze(['visibile', 'nascosto', 'irreparabile']);
  const AZIONI = Object.freeze(['clic', 'destro', 'trascina', 'hover']);
  // Una tabella di nove righe e una ventina di elementi stanno in pochi KB: il tetto ferma solo un file sbagliato.
  const MAX_BYTE = 64 * 1024;
  const MIN_PROVA = 10;
  // «L'ho guardato» non vale (#2505), in nessuna forma: una prova fatta SOLO di parole che dicono «ho controllato» senza
  // dire cosa è vaga. Basta una parola fuori da qui (un file, un caso, una strada) perché un altro abbia cosa controllare.
  const PAROLE_VAGHE = new Set(('l lo la li le ho ha abbiamo è e ed a al ai con di da in nel nella nell su sul sulla io ci '
    + 'mano occhio bene tutto tutti tutte ok okay si sì no fatto fatta fatti visto vista guardato guardata guardati '
    + 'verificato verificata verificati controllato controllata controllati provato provata provati testato testata testati '
    + 'funziona funzionano funzionante correttamente regolarmente va vanno nessun nessuno problema problemi errore errori '
    + 'manualmente già anche sempre come atteso previsto passa passano verde verdi').split(' '));

  // Le sei zone dell'irreparabile, riconosciute da ciò che il ramo tocca: elenco STRETTO, le prove non contano mai.
  const r = (s) => new RegExp(s);
  const ZONE = Object.freeze([
    { chiave: 'dati', nome: 'formato dei dati salvati e migrazioni',
      app: [r('^src/(shared|main/shim)/storage\\.js$'), r('^src/main/services/scritturaAtomica\\.js$'), r('(^|/)[^/]*Migrazione\\.js$'),
        r('^scripts/[^/]*-migra\\.mjs$'), r('^src/main/cancellaTutto\\.js$'), r('^(firestore|storage)\\.rules$')],
      server: [r('(^|/)[^/]*Migrazione\\.js$'), r('(^|/)(firestore|storage)\\.rules$')] },
    { chiave: 'conferme', nome: 'conferme prima di un\'azione o di un comando',
      app: [r('^src/shared/(autonomia|cmdClassify|actionLevels|confirmUi|confermaSulPosto|eseguibili)\\.js$'),
        r('^src/main/confermeSopraPagina\\.js$')],
      server: [] },
    { chiave: 'uscite', nome: 'cosa esce dalla macchina',
      app: [r('^src/shared/(urlExfil|livelliPrivacy|campiSegreti|feedbackSanitizer|feedbackCrypto|feedbackPublicKey)\\.js$'),
        r('^src/main/services/(segretiCustoditi|segretiLetti|testoInviato|safe-fetch)\\.js$'), r('^src/main/services/segreto/')],
      server: [r('^functions/src/feedback(Crypto|Decrypt)\\.js$')] },
    { chiave: 'crediti', nome: 'crediti',
      app: [r('^src/shared/wallet\\.js$'), r('^src/main/services/(creditStore|costTracker)\\.js$')],
      server: [r('^functions/src/wallet/'), r('^functions/src/routine/crediti\\.js$')] },
    { chiave: 'aggiornamento', nome: 'aggiornamento e installatore',
      app: [r('^src/main/(updater|aggiornamentoRegole|ancoraRilascio)\\.js$'), r('^scripts/(after-pack[^/]*\\.js|release-[^/]*\\.mjs)$'),
        r('^electron-builder\\.'), r('^build/'), r('^\\.github/workflows/release[^/]*\\.ya?ml$')],
      server: [] },
    { chiave: 'fusione', nome: 'chi può fondere o è fidato',
      app: [r('^src/shared/(mergeApprovals|mittenti|ambiti)\\.js$'), r('^src/main/services/(mergeApprovalSignal|cancelloOwner)\\.js$'),
        r('^scripts/(fiducia-[^/]*|finish-local|branch-integrity|merge-gate)\\.mjs$'), r('^\\.github/workflows/')],
      server: [r('^functions/src/(fiducia[^/]*|fermoFiducia|autoApprove|ambitiApprovati)\\.js$'), r('^functions/src/l5/'),
        r('^functions/src/routine/(mergeGate|ownerMerge|mergeApprovals|fusioneServer|ownerFiducia|fiduciaSessione)\\.js$'),
        r('^\\.github/workflows/')] },
  ].map((z) => Object.freeze(z)));

  const PROVA_DI = [r('^tests/'), r('(^|/)test/'), r('\\.(test|spec)\\.[cm]?js$')];
  const INTERFACCIA = [r('^src/(pages|renderer|content|styles)/'), r('^src/.*\\.(html|css)$'), r('^site/')];

  const pulito = (p) => String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\.\//, '');
  const eUnaProva = (p) => PROVA_DI.some((re) => re.test(p));

  /** I percorsi dell'app che fanno del ramo un lavoro sull'interfaccia (vuoto = non lo è). PURA. */
  function lavoroDiInterfaccia(percorsiApp) {
    return (Array.isArray(percorsiApp) ? percorsiApp : []).map(pulito)
      .filter((p) => p && !eUnaProva(p) && INTERFACCIA.some((re) => re.test(p)));
  }

  /** Il minimo senza modello: «irreparabile» se il ramo tocca una delle sei zone, altrimenti nessuno. PURA. */
  function minimoDaiPercorsi({ app = [], server = [] } = {}) {
    const zone = [];
    for (const z of ZONE) {
      const tocca = (lista, regole) => (Array.isArray(lista) ? lista : []).map(pulito)
        .filter((p) => p && !eUnaProva(p) && regole.some((re) => re.test(p)));
      const percorsi = [...tocca(app, z.app), ...tocca(server, z.server).map((p) => `server: ${p}`)];
      if (percorsi.length) zone.push({ chiave: z.chiave, nome: z.nome, percorsi });
    }
    return { classe: zone.length ? 'irreparabile' : '', zone };
  }

  /** Vale la più alta fra la dichiarata e il minimo; `decisaDa` dice quale delle due ha vinto. PURA. */
  function classeFinale(dichiarata, minimo) {
    const d = CLASSI.indexOf(String(dichiarata || ''));
    const m = CLASSI.indexOf(String(minimo || ''));
    if (m > d) return { classe: CLASSI[m], decisaDa: 'minimo' };
    return { classe: d >= 0 ? CLASSI[d] : '', decisaDa: 'chi lavora' };
  }

  const testo = (v) => (typeof v === 'string' ? v.trim() : '');
  const vaga = (t) => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).every((p) => PAROLE_VAGHE.has(p));

  /**
   * I motivi per cui una consegna non è buona (vuoto = buona), ognuno con la riga che li ha. `interfaccia`: i percorsi
   * d'interfaccia toccati dal ramo (lavoroDiInterfaccia); con almeno uno l'elenco degli elementi nuovi è obbligatorio. PURA.
   */
  function validaConsegna(c, { interfaccia = [] } = {}) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return ['la consegna non è un oggetto JSON'];
    const m = [];
    const righe = Array.isArray(c.criteri) ? c.criteri : null;
    if (!righe) m.push('manca la tabella dei criteri («criteri»: una riga per ognuno dei nove)');
    else {
      for (const k of CRITERI) {
        const riga = righe.find((x) => x && Number(x.criterio) === k.n);
        const chi = `criterio ${k.n} («${k.nome}»)`;
        if (!riga) { m.push(`${chi}: manca la riga`); continue; }
        const esito = testo(riga.esito);
        if (!ESITI.includes(esito)) { m.push(`${chi}: l'esito è «${esito.slice(0, 30)}», vale ${ESITI.map((e) => `«${e}»`).join(' o ')}`); continue; }
        if (esito === 'non si applica') {
          if (testo(riga.motivo).length < MIN_PROVA) m.push(`${chi}: un criterio che non si applica si dichiara col motivo («motivo»)`);
          continue;
        }
        const prova = testo(riga.prova);
        if (!prova) m.push(`${chi}: manca la prova («prova»: il nome di un test, una schermata, un elenco)`);
        else if (prova.length < MIN_PROVA || vaga(prova)) m.push(`${chi}: «${prova.slice(0, 40)}» non è una prova: scrivi cosa un altro controlla senza rifare il lavoro (il nome di un test, una schermata, un elenco)`);
      }
      const doppie = righe.filter((x, i) => x && righe.findIndex((y) => y && Number(y.criterio) === Number(x.criterio)) !== i);
      if (doppie.length) m.push(`criterio ${Number(doppie[0].criterio)}: la riga c'è due volte`);
      const fuori = righe.filter((x) => !x || !CRITERI.some((k) => k.n === Number(x.criterio)));
      if (fuori.length) m.push(`la tabella ha una riga che non è uno dei nove criteri («criterio» va da 1 a ${CRITERI.length})`);
    }
    const ui = Array.isArray(interfaccia) ? interfaccia : [];
    if (c.elementi !== undefined && !Array.isArray(c.elementi)) m.push('«elementi» è un elenco');
    else if (Array.isArray(c.elementi)) {
      c.elementi.forEach((e, i) => {
        const nome = testo(e && e.elemento);
        const chi = `elemento ${i + 1}${nome ? ` («${nome.slice(0, 30)}»)` : ''}`;
        if (!nome) m.push(`${chi}: manca il nome («elemento»)`);
        if (!testo(e && e.perche)) m.push(`${chi}: manca perché non si può togliere («perche»)`);
        for (const a of AZIONI) if (!testo(e && e[a])) m.push(`${chi}: manca cosa fa ${a}, o perché non serve («${a}»)`);
      });
      if (!c.elementi.length && ui.length && testo(c.nessunElemento).length < MIN_PROVA) {
        m.push('elenco degli elementi nuovi vuoto: se il lavoro non ne aggiunge, dillo col motivo («nessunElemento»)');
      }
    } else if (ui.length) {
      m.push(`lavoro sull'interfaccia (tocca ${ui.slice(0, 3).join(', ')}${ui.length > 3 ? '…' : ''}): manca l'elenco degli elementi nuovi («elementi»)`);
    }
    const cl = c.classe;
    if (!cl || typeof cl !== 'object') m.push(`manca la classe di rischio («classe»: { «valore»: ${CLASSI.map((x) => `«${x}»`).join(', ')}, «motivo» })`);
    else {
      if (!CLASSI.includes(testo(cl.valore))) m.push(`classe di rischio: «${testo(cl.valore).slice(0, 30)}» non vale, sono ${CLASSI.map((x) => `«${x}»`).join(', ')}`);
      if (testo(cl.motivo).length < MIN_PROVA) m.push('classe di rischio: manca la riga di motivo («motivo»)');
    }
    const pt = c.provaTest;
    if (pt !== undefined && (!pt || typeof pt !== 'object' || !pt.app || !Array.isArray(pt.app.casi))) {
      m.push('«provaTest» la scrive lo strumento dei test nuovi: non è nella sua forma');
    }
    return m;
  }

  /** Un caso della prova dei test nuovi da segnalare: verde anche senza il lavoro, o non verde col lavoro. PURA. */
  function casoSegnalato(c) {
    if (!c || c.senza === 'verde') return c ? 'verde anche senza il lavoro' : '';
    return c.con !== 'verde' ? 'non verde col lavoro' : '';
  }

  global.SN_CONSEGNA = Object.freeze({
    VERSIONE, CRITERI, ESITI, CLASSI, AZIONI, ZONE, MAX_BYTE,
    validaConsegna, lavoroDiInterfaccia, minimoDaiPercorsi, classeFinale, casoSegnalato,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
