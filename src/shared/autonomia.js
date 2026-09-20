// LA REGOLA — «Filo può fare X?» — come DATI, in un posto solo (#530).
//
// Prima ogni azione aveva un livello fisso 1/2/3 nel registro delle azioni
// (actionLevels.js): un numero che diceva da solo se si eseguiva subito, se si
// chiedeva conferma o se si pretendeva la parola digitata. Non basta. Il
// pericolo non sta nell'azione: sta nella COMBINAZIONE fra ciò che è entrato
// nel contesto e ciò che esce. Leggere una mail e rispondere in chat è
// innocuo; leggere la stessa mail e salvare una lezione nella memoria di Filo
// no — quella mail l'ha scritta qualcuno che non è l'utente, e da lì in poi
// vale per sempre.
//
// Qui dentro c'è UNA regola sola, scritta come dati: livelli, classi delle
// fonti, costi, la tabella, l'elenco fisso, le manopole dei campi. Ogni
// superficie che deve decidere chiama `decide()` e non ricalcola niente per
// conto suo (una sentinella negli unit test lo pretende).
//
// CINQUE INGRESSI, tutti noti al motore senza chiedere al modello:
//   1. livello   — la scelta globale dell'utente (conservativo…yolo);
//   2. stato     — pulito o contaminato: la classe PIÙ BASSA fra tutte le
//                  fonti che il compito ha letto, confrontata con la soglia
//                  del livello;
//   3. costo     — quanto costa sbagliare quella azione (0-3), dichiarato dal
//                  potere stesso nel registro delle azioni;
//   4. perimetro — le uscite autorizzate (la richiesta dell'utente, o la
//                  regola di un'automazione). Riguarda SOLO le uscite:
//                  leggere di più è sempre libero;
//   5. origine   — chat o automazione.
//
// Esposto come SN_AUTONOMIA (IIFE su globalThis, come tutti i moduli
// condivisi). PURO: nessun accesso allo storage, nessun DOM, nessuna rete.

(function (global) {
  'use strict';

  // ── Le quattro risposte, più la forma dell'automazione ───────────────────
  const SI = 'si';            // Filo fa da solo
  const CHIEDE = 'chiede';    // popup con OK (il livello 2 di ieri)
  const CONFERMA = 'conferma'; // parola «conferma» digitata (il livello 3 di ieri)
  const NO = 'no';            // non si fa, a nessun livello
  const PROPONE = 'propone';  // notifica con l'azione pronta: un clic approva
  const RISPOSTE = [SI, CHIEDE, CONFERMA, NO, PROPONE];

  // «sì dopo il guardiano di uscita»: parte da sola, ma un guardiano legge
  // l'uscita prima che esca. Il guardiano arriva in un feedback successivo:
  // FINCHÉ NON C'È, `si+G` vale CHIEDE (vedi `risolviGuardiano`). È scritto
  // nella tabella e non spianato via, perché il giorno in cui il guardiano
  // arriva la tabella è già quella giusta: si toglie solo il ripiego.
  const SI_G = 'si+G';

  // Quanto è stretta una risposta: serve a combinare più regole senza che una
  // possa mai ALLENTARE quello che un'altra ha stretto.
  const STRETTEZZA = { [SI]: 1, [SI_G]: 2, [CHIEDE]: 3, [PROPONE]: 3, [CONFERMA]: 4, [NO]: 5 };
  function piuStretta(a, b) {
    if (!a) return b;
    if (!b) return a;
    return (STRETTEZZA[a] || 0) >= (STRETTEZZA[b] || 0) ? a : b;
  }

  // ── 1. Livello di autonomia (scelta globale dell'utente) ─────────────────
  // `soglia` è la classe più bassa che il livello considera ancora «pulita».
  const LIVELLI = [
    {
      id: 'conservativo', label: 'Conservativo', soglia: 1, selezionabile: true,
      frase: 'Chiede prima di quasi tutto quello che dura.',
    },
    {
      id: 'default', label: 'Normale', soglia: 2, selezionabile: true,
      frase: 'Fa da solo quello che si disfa e quello che si rimedia; chiede per le cose definitive.',
    },
    {
      id: 'automatico', label: 'Automatico', soglia: 3, selezionabile: true,
      frase: 'Fa da solo anche quando ha letto cose scritte da autori che conosci.',
    },
    {
      id: 'yolo', label: 'Yolo', soglia: 3, selezionabile: false,
      frase: 'Fa tutto da solo, con un guardiano che controlla ogni uscita.',
      // Esiste come VALORE (la tabella ce l'ha, i test la coprono) ma non si
      // può scegliere finché il guardiano dei registri non c'è: senza di lui
      // sarebbe solo «automatico senza rete».
      perche: 'Si potrà scegliere quando ci sarà il guardiano dei registri.',
    },
  ];
  const LIVELLO_DEFAULT = 'default';

  function livello(id) {
    const k = String(id == null ? '' : id).trim().toLowerCase();
    return LIVELLI.find((l) => l.id === k) || null;
  }
  // Il livello NOTO più vicino a ciò che gli viene passato: un valore
  // sconosciuto (scrittura sbagliata, modulo più vecchio) ricade sul default,
  // che non è mai il più permissivo. Yolo è noto — la tabella ce l'ha e i test
  // la coprono per intero — ma non è SCEGLIBILE: quello lo dice
  // `livelloValido`, che è ciò che si legge dalle impostazioni.
  function livelloNoto(id) {
    const l = livello(id);
    return l ? l.id : LIVELLO_DEFAULT;
  }
  // Il livello valido come SCELTA dell'utente: quello che non si può scegliere
  // (yolo, finché non c'è il guardiano) ricade sul default.
  function livelloValido(id) {
    const l = livello(id);
    if (!l || !l.selezionabile) return LIVELLO_DEFAULT;
    return l.id;
  }
  function livelliSelezionabili() {
    return LIVELLI.filter((l) => l.selezionabile);
  }
  // Ordine dal più prudente al più permissivo: serve a sapere se un cambio
  // ALZA il livello (allenta una difesa → parola digitata, regola (d)).
  function indiceLivello(id) {
    return LIVELLI.findIndex((l) => l.id === livelloNoto(id));
  }
  function alzaLivello(da, a) {
    return indiceLivello(a) > indiceLivello(da);
  }

  // Le tre frasi sopra il selettore, nelle Preferenze. Stanno qui perché la
  // regola e il modo di raccontarla cambiano insieme.
  const FRASI_SELETTORE = [
    'Filo fa da solo quello che può disfare.',
    'Quando legge cose scritte da altri, fa meno.',
    'Tu scegli con un livello quanto si fida.',
  ];

  // ── 2. Classi delle fonti, e lo stato del compito ────────────────────────
  const CLASSI = [
    { classe: 1, label: 'Filo e le tue cose', esempi: 'chat, memorie, impostazioni, manifesto, cronologia delle chat' },
    { classe: 2, label: 'I file su cui lavori', esempi: 'i documenti dell\'editor, quelli toccati di recente' },
    { classe: 3, label: 'Autori che conosci', esempi: 'chi ti ha scritto e a cui hai risposto, o che hai marcato tu' },
    { classe: 4, label: 'Altri file del computer', esempi: 'un file qualunque sul disco' },
    { classe: 5, label: 'Autore ignoto', esempi: 'sconosciuti, contatti nuovi, pagine web, ricerche, file scaricati' },
  ];
  const CLASSE_MIN = 1;
  const CLASSE_MAX = 5;

  // Le fonti che Filo sa già leggere, con la loro classe e la frase che
  // racconta all'utente PERCHÉ sta chiedendo. La frase sta qui accanto alla
  // classe perché le due cose devono cambiare insieme: una fonte nuova senza
  // la sua frase lascerebbe il popup muto sul motivo.
  // `campo` è il campo da cui quella fonte arriva: è la SUA manopola della
  // fiducia ad abbassarla di una classe, non quella del campo in cui si sta
  // per agire (leggere una mail e poi scrivere un file sono due campi diversi,
  // e la manopola della posta deve valere sulla mail).
  const FONTI = {
    chat: { classe: 1, frase: 'quello che mi hai scritto tu' },
    memoria: { classe: 1, frase: 'le mie memorie' },
    impostazioni: { classe: 1, frase: 'le tue impostazioni' },
    capacita: { classe: 1, frase: 'il mio manifesto' },
    trasparenza: { classe: 1, frase: 'i miei documenti di trasparenza' },
    editor: { classe: 2, frase: 'un documento del tuo editor', campo: 'file' },
    // Le schede aperte e le immagini che l'utente passa sono classe 2 per lo
    // stesso motivo dei file dell'editor: il testo dentro l'ha scritto un
    // altro, ma è roba che l'utente ha scelto e ha sotto mano. A classe 5
    // («pagine web») un browser con una scheda aperta sarebbe contaminato
    // sempre, e il livello normale non varrebbe mai per nessuno.
    schede: { classe: 2, frase: 'i titoli delle schede che hai aperto', campo: 'web' },
    immagine: { classe: 2, frase: 'un\'immagine che mi hai passato' },
    documento: { classe: 4, frase: 'un documento dal tuo computer', campo: 'file' },
    comando: { classe: 5, frase: 'quello che ha stampato un comando', campo: 'terminale' },
    ricerca: { classe: 5, frase: 'una ricerca sul web', campo: 'web' },
    web: { classe: 5, frase: 'una pagina web', campo: 'web' },
    scaricato: { classe: 5, frase: 'un file scaricato', campo: 'web' },
  };
  // Il campo di una fonte, o null se non ne ha uno (le cose di Filo e
  // dell'utente non vengono da un campo).
  function campoFonte(id) {
    const k = String(id == null ? '' : id).trim().toLowerCase();
    return (FONTI[k] && FONTI[k].campo) || null;
  }

  // Classe di una fonte, tenendo conto degli spostamenti dell'utente
  // (`fonti` = mappa id→classe salvata nelle impostazioni). Alzare una fonte
  // di classe è allentare una difesa: lo pretende la regola (d), qui si legge
  // e basta. Una fonte sconosciuta vale 5: non sappiamo chi l'ha scritta.
  function classeFonte(id, spostate) {
    const k = String(id == null ? '' : id).trim().toLowerCase();
    const base = FONTI[k] ? FONTI[k].classe : CLASSE_MAX;
    const n = spostate ? numero(spostate[k]) : null;
    if (n != null && n >= CLASSE_MIN && n <= CLASSE_MAX) return Math.round(n);
    return base;
  }
  function fraseFonte(id) {
    const k = String(id == null ? '' : id).trim().toLowerCase();
    return (FONTI[k] && FONTI[k].frase) || 'qualcosa che non hai scritto tu';
  }

  // ── 5 campi, 2 manopole ──────────────────────────────────────────────────
  // I campi non hanno un livello proprio: hanno due manopole che SOLO
  // restringono. «Quanto mi fido di ciò che leggo da qui» abbassa di una
  // classe le fonti del campo (numero più alto = meno fidata); «quanto è grave
  // sbagliare qui» alza di uno il costo delle sue azioni.
  const CAMPI = [
    { id: 'posta', label: 'Posta' },
    { id: 'messaggistica', label: 'Messaggistica' },
    { id: 'file', label: 'File' },
    { id: 'terminale', label: 'Terminale' },
    { id: 'web', label: 'Web' },
  ];
  const MANOPOLE = [
    {
      id: 'fiducia', domanda: 'Quanto mi fido di ciò che leggo da qui',
      effetto: 'abbassa di una classe le fonti di questo campo',
    },
    {
      id: 'gravita', domanda: 'Quanto è grave sbagliare qui',
      effetto: 'alza di uno il costo delle azioni di questo campo',
    },
  ];
  function campoValido(id) {
    const k = String(id == null ? '' : id).trim().toLowerCase();
    return CAMPI.some((c) => c.id === k) ? k : null;
  }
  function manopolaAccesa(campo, manopola, manopole) {
    const c = campoValido(campo);
    if (!c || !manopole) return false;
    const v = manopole[c];
    return !!(v && v[manopola]);
  }
  // Un numero vero, non «qualcosa che Number() trasforma in zero»: `null` e la
  // stringa vuota valgono 0 per JavaScript, e un costo mancante passerebbe per
  // un costo zero — cioè per un'azione che non costa niente.
  function numero(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  }

  // Solo restringono: una manopola può abbassare la classe di una fonte, mai
  // alzarla.
  function classeConManopole(classe, campo, manopole) {
    const n = numero(classe);
    if (n == null) return CLASSE_MAX;
    const giu = manopolaAccesa(campo, 'fiducia', manopole) ? 1 : 0;
    return Math.min(CLASSE_MAX, Math.max(CLASSE_MIN, Math.round(n) + giu));
  }
  // Il costo dichiarato dall'azione, più la manopola «quanto è grave sbagliare
  // qui» del suo campo. Un costo fuori scala NON si arrotonda dentro: torna
  // null, e chi decide risponde no — un potere che dichiara un costo assurdo è
  // un potere rotto, non un potere gratis.
  function costoConManopole(costo, campo, manopole) {
    const n = numero(costo);
    if (n == null || !Number.isInteger(n) || n < COSTO_MIN || n > COSTO_MAX) return null;
    const su = manopolaAccesa(campo, 'gravita', manopole) ? 1 : 0;
    return Math.min(COSTO_MAX, n + su);
  }

  // ── 3. Costo di sbagliare ────────────────────────────────────────────────
  const COSTI = [
    { costo: 0, label: 'Solo chat', esempi: 'rispondere, leggere, cercare: non lascia traccia fuori dalla conversazione' },
    { costo: 1, label: 'Si disfa', esempi: 'una sveglia, il tema, una scheda archiviata, una bozza non inviata' },
    { costo: 2, label: 'Dura, o si vede fuori, ma si rimedia', esempi: 'una lezione in memoria, una regola di automazione, una mail a un destinatario scelto' },
    { costo: 3, label: 'Irreversibile o costoso', esempi: 'una mail a uno sconosciuto, un modulo inviato, un acquisto, un file eliminato, un comando che modifica' },
  ];
  const COSTO_MIN = 0;
  const COSTO_MAX = 3;
  // Un costo vero, non «qualcosa che assomiglia a un numero»: `null` diventa 0
  // se lo si passa da Number(), e un'azione senza costo verrebbe scambiata per
  // un'azione che non costa niente. Qui dev'essere già un intero.
  function costoValido(c) {
    return Number.isInteger(c) && c >= COSTO_MIN && c <= COSTO_MAX;
  }

  // ── 4/5. Perimetro e origine ─────────────────────────────────────────────
  const ORIGINI = ['chat', 'automazione'];
  function origineValida(o) {
    const k = String(o == null ? '' : o).trim().toLowerCase();
    return ORIGINI.includes(k) ? k : 'chat';
  }

  // ── LA TABELLA (livello, stato → risposta per costo 0/1/2/3) ─────────────
  // Riga per riga, com'è scritta nella regola: l'indice è il costo.
  const TABELLA = {
    conservativo: {
      pulito: [SI, SI, CHIEDE, CHIEDE],
      contaminato: [SI, CHIEDE, CHIEDE, NO],
    },
    default: {
      pulito: [SI, SI, SI, CHIEDE],
      contaminato: [SI, SI, CHIEDE, CONFERMA],
    },
    automatico: {
      pulito: [SI, SI, SI, SI_G],
      contaminato: [SI, SI, SI_G, CHIEDE],
    },
    yolo: {
      pulito: [SI, SI, SI, SI_G],
      contaminato: [SI, SI_G, SI_G, SI_G],
    },
  };
  const STATI = ['pulito', 'contaminato'];

  // Finché il guardiano di uscita non esiste, «parte da sola dopo il
  // guardiano» vale «chiede». Quando arriverà, questa funzione è l'unico
  // punto da cambiare.
  function risolviGuardiano(risposta) {
    return risposta === SI_G ? CHIEDE : risposta;
  }

  // ── (c) L'ELENCO FISSO: no a ogni livello ────────────────────────────────
  // Cinque cose che Filo non fa da sé, qualunque livello l'utente scelga e per
  // quanto pulito sia il compito. Non è una valutazione di un modello: chi
  // marca un'azione con uno di questi id lo fa con un controllo
  // deterministico (vedi il registro delle azioni).
  const ELENCO_FISSO = [
    {
      id: 'segreto-in-uscita',
      label: 'Far uscire un segreto',
      desc: 'Password, codici usa e getta o di recupero, chiavi, coordinate bancarie che non hai chiesto tu.',
    },
    {
      id: 'molti-destinatari',
      label: 'Spedire a molti destinatari insieme',
      desc: 'Un messaggio che parte verso più persone in un colpo solo.',
    },
    {
      id: 'credenziali',
      label: 'Cambiare le credenziali di un servizio',
      desc: 'Password, recupero, indirizzo di sicurezza: si cambiano solo a mano.',
    },
    {
      id: 'regole-di-autonomia',
      label: 'Cambiare queste stesse regole',
      desc: 'Livelli, classi delle fonti, costi e questo elenco li sposti solo tu, dalle Preferenze.',
    },
    {
      id: 'cancellazione-definitiva',
      label: 'Cancellare dati in modo definitivo',
      desc: 'Quello che sparisce per sempre lo cancelli tu, da dove si cancella.',
    },
  ];
  function vocefissa(id) {
    const k = String(id == null ? '' : id).trim().toLowerCase();
    return ELENCO_FISSO.find((v) => v.id === k) || null;
  }

  // ── LA DECISIONE ─────────────────────────────────────────────────────────
  // `valuta` ritorna il dettaglio, `decide` la sola risposta. Ordine delle
  // regole SOPRA la tabella, come nella regola scritta: (a) fuori perimetro,
  // (b) origine automazione, (c) elenco fisso, (d) difesa che si allenta.
  // Nessuna di queste può ALLENTARE ciò che un'altra ha stretto: si combinano
  // prendendo sempre la più stretta (`piuStretta`).
  //
  // opts:
  //   livello        'conservativo' | 'default' | 'automatico' | 'yolo'
  //   stato          'pulito' | 'contaminato'  (oppure `fonti`, vedi sotto)
  //   fonti          elenco di id di fonte lette dal compito: se c'è, lo stato
  //                  lo calcola il modulo (ed è lui a saper dire il motivo)
  //   costo          0-3
  //   dentroPerimetro  true/false (default true)
  //   origine        'chat' | 'automazione' (default 'chat')
  //   campo          uno dei CAMPI, o null
  //   manopole       { <campo>: { fiducia: bool, gravita: bool } }
  //   fontiSpostate  { <fonte>: classe } — gli spostamenti dell'utente
  //   vietato        id dell'elenco fisso, se l'azione ci ricade
  //   allentaDifesa  true se l'azione alza il livello, alza una fonte o
  //                  abbassa un costo
  function valuta(opts) {
    const o = opts || {};
    const liv = livelloNoto(o.livello);
    const campo = campoValido(o.campo);
    const manopole = o.manopole || null;
    const costo = costoConManopole(o.costo, campo, manopole);
    const origine = origineValida(o.origine);
    const dentro = o.dentroPerimetro !== false;

    // Un'azione senza costo non si valuta: il chiamante deve rifiutarla. È la
    // stessa regola del registro di ieri («azione non registrata → rifiutata»).
    if (!costoValido(costo)) {
      return {
        risposta: NO, parola: false, guardiano: false, regola: 'costo-mancante',
        motivo: 'Questa azione non dichiara quanto costa sbagliarla, quindi non la eseguo.',
      };
    }

    // Stato del compito: o lo dice il chiamante, o lo calcoliamo dalle fonti.
    const fonti = Array.isArray(o.fonti) ? o.fonti : null;
    const classi = fonti
      ? fonti.map((f) => classeConManopole(classeFonte(f, o.fontiSpostate), campoFonte(f), manopole))
      : null;
    const soglia = (livello(liv) || {}).soglia || 1;
    let stato;
    let peggiore = null;
    if (classi && classi.length) {
      // «Lo stato è la classe più bassa fra tutto ciò che il compito ha
      // letto»: più bassa = meno fidata = numero più ALTO nella scala 1-5,
      // dove 1 è Filo e le cose dell'utente. Quindi si prende il massimo.
      let mass = CLASSE_MIN;
      for (let i = 0; i < classi.length; i += 1) {
        if (classi[i] > mass) { mass = classi[i]; peggiore = fonti[i]; }
      }
      stato = mass <= soglia ? 'pulito' : 'contaminato';
    } else {
      stato = STATI.includes(String(o.stato || '').toLowerCase()) ? String(o.stato).toLowerCase() : 'pulito';
    }

    const riga = TABELLA[liv] || TABELLA[LIVELLO_DEFAULT];
    let risposta = riga[stato][costo];
    let regola = 'tabella';
    let guardiano = risposta === SI_G;

    // (a) Fuori perimetro. Riguarda solo le USCITE: chi legge non passa di
    // qui. Da chat: chiede a conservativo e default; ad automatico e yolo si
    // usa la cella CONTAMINATA con guardiano obbligatorio. Da automazione:
    // propone (lo applica la regola (b) qui sotto).
    // Il perimetro riguarda le USCITE: leggere di più è sempre libero, e il
    // costo 0 è per definizione ciò che non esce dalla conversazione.
    if (!dentro && costo > 0) {
      const fuori = (liv === 'automatico' || liv === 'yolo')
        ? piuStretta(riga.contaminato[costo], SI_G)
        : CHIEDE;
      const nuova = piuStretta(risposta, fuori);
      if (STRETTEZZA[nuova] > STRETTEZZA[risposta]) regola = 'fuori-perimetro';
      risposta = nuova;
      if (risposta === SI_G) guardiano = true;
    }

    // Il guardiano non c'è ancora: «sì dopo il guardiano» vale «chiede».
    risposta = risolviGuardiano(risposta);

    // (c) Elenco fisso: no, a ogni livello.
    const fissa = vocefissa(o.vietato);
    if (fissa) {
      risposta = piuStretta(risposta, NO);
      regola = 'elenco-fisso';
    }

    // (d) Una difesa che si allenta vuole la parola digitata, a ogni livello.
    if (o.allentaDifesa && risposta !== NO) {
      risposta = piuStretta(risposta, CONFERMA);
      if (risposta === CONFERMA) regola = 'difesa';
    }

    // (b) Origine automazione: quello che in chat si chiede, qui si propone —
    // una notifica con l'azione già pronta, un clic per approvare. Dove
    // servirebbe la parola digitata, la proposta se la porta dietro.
    let parola = risposta === CONFERMA;
    if (origine === 'automazione' && (risposta === CHIEDE || risposta === CONFERMA)) {
      parola = risposta === CONFERMA;
      risposta = PROPONE;
    }

    return {
      risposta,
      parola,
      guardiano,
      regola,
      stato,
      costo,
      livello: liv,
      fonte: peggiore,
      motivo: motivoPer({ regola, stato, fonte: peggiore, fissa, livello: liv }),
      uscita: uscitaPer({ risposta, regola }),
    };
  }

  function decide(opts) {
    return valuta(opts).risposta;
  }

  // La frase che il popup mette sotto a cosa Filo sta per fare: perché stavolta
  // sta chiedendo. Una riga, in italiano, senza gergo.
  function motivoPer({ regola, stato, fonte, fissa }) {
    if (regola === 'elenco-fisso' && fissa) return `${fissa.desc}`;
    if (regola === 'difesa') return 'Questa modifica allenta una protezione: per cambiarla ti chiedo di scriverlo.';
    if (regola === 'fuori-perimetro') return 'Non me l\'avevi chiesto: sto per fare qualcosa che esce da quello che mi hai detto.';
    if (stato === 'contaminato') return `In questo compito ho letto ${fonte ? fraseFonte(fonte) : 'qualcosa che non hai scritto tu'}.`;
    return '';
  }

  // Un «no» che arriva dalla TABELLA non è un divieto per sempre: a un altro
  // livello, o in un compito che non ha letto niente di altri, la stessa cosa
  // si fa. Senza questa riga il rifiuto è un vicolo cieco muto, e chi tiene il
  // livello prudente ci finisce appena cerca qualcosa sul web. Il «no»
  // dell'elenco fisso invece è definitivo: lì la strada a mano la dice il
  // registro delle azioni.
  function uscitaPer({ risposta, regola }) {
    if (risposta !== NO || regola !== 'tabella') return '';
    return 'A questo punto non posso farlo. Puoi rifarmelo chiedere in una conversazione nuova, '
      + 'dove non ho ancora letto niente scritto da altri, oppure dare a Filo più autonomia in '
      + 'Preferenze → «Quanto Filo fa da solo». Dillo all\'utente e non riprovare.';
  }

  // Stato del compito da un elenco di fonti lette (comodo per chi non deve
  // decidere ma solo mostrare): la classe meno fidata contro la soglia.
  function statoPerFonti(fonti, liv, { manopole = null, fontiSpostate = null } = {}) {
    const soglia = (livello(livelloNoto(liv)) || {}).soglia || 1;
    let mass = CLASSE_MIN;
    for (const f of (Array.isArray(fonti) ? fonti : [])) {
      const c = classeConManopole(classeFonte(f, fontiSpostate), campoFonte(f), manopole);
      if (c > mass) mass = c;
    }
    return mass <= soglia ? 'pulito' : 'contaminato';
  }

  // Le manopole di serie: tutte spente (nessun campo restringe niente).
  function manopoleDiSerie() {
    const out = {};
    for (const c of CAMPI) out[c.id] = { fiducia: false, gravita: false };
    return out;
  }

  global.SN_AUTONOMIA = {
    // risposte
    SI, CHIEDE, CONFERMA, NO, PROPONE, SI_G, RISPOSTE,
    // dati
    LIVELLI, LIVELLO_DEFAULT, FRASI_SELETTORE, CLASSI, CLASSE_MIN, CLASSE_MAX,
    FONTI, CAMPI, MANOPOLE, COSTI, COSTO_MIN, COSTO_MAX, TABELLA, STATI,
    ELENCO_FISSO, ORIGINI,
    // lettura
    livello, livelloNoto, livelloValido, livelliSelezionabili, indiceLivello, alzaLivello,
    classeFonte, fraseFonte, campoFonte, campoValido, manopolaAccesa, classeConManopole,
    costoConManopole, costoValido, origineValida, risolviGuardiano, vocefissa,
    statoPerFonti, manopoleDiSerie, piuStretta, uscitaPer,
    // decisione
    valuta, decide,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
