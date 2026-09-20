// #517 — Un'azione RACCONTATA a parole e mai eseguita.
//
// Il caso: il modello chiude il turno scrivendo «Ti ho messo una sveglia alle
// 19:00 per ognuna di quelle notti» senza aver chiamato nessuno strumento. Il
// testo arriva all'utente, la sveglia no, e nessuno se ne accorge: l'utente lo
// scopre la mattina in cui non suona. Il prompt già vieta di dichiarare azioni
// non emesse, ma è una promessa affidata al modello, e finora il fallimento era
// completamente muto.
//
// Qui sta la parte deterministica del presidio: riconoscere, nel testo, la
// DICHIARAZIONE di aver già fatto una cosa che si può fare solo chiamando uno
// strumento, e dire se in questo turno quello strumento è stato chiamato.
// Chi lo usa (handleFiloChat) fa due cose con la risposta: rimanda il turno
// indietro una volta (il modello chiama lo strumento o riscrive la frase) e,
// se la dichiarazione resta senza azione, AVVISA l'utente invece di lasciargli
// credere che sia fatto.
//
// Logica PURA (nessun Electron / IPC): unit-testata in
// tests/unit/azioniDichiarate.test.mjs.
//
// Due scelte, per non gridare al lupo:
//  1. si riconosce solo la PRIMA PERSONA al passato («ho messo», «ti ho
//     aperto»): «la sveglia delle 7 è impostata» è un dato dello STATO, non una
//     rivendicazione, e un participio da solo farebbe scattare il presidio su
//     una constatazione vera;
//  2. una dichiarazione preceduta, nella stessa proposizione, da una negazione o
//     da un'ipotesi («non ho messo…», «se ho aperto la pagina sbagliata…»),
//     o che sta dentro una domanda, non conta.
//
// Un avviso che accusa Filo di non aver fatto una cosa che ha fatto è peggio
// del silenzio: si smette di leggerlo, e il presidio torna muto. Quindi ogni
// famiglia elenca TUTTI i modi che Filo ha davvero di fare quella cosa (aprire
// un programma, per esempio, passa da un comando di shell: non esiste uno
// strumento «apri un programma»), e quello che Filo fa SENZA azioni non ha
// famiglia del tutto: quello che impara lo scrive in memoria un passaggio che
// parte da solo dopo il turno, quindi «l'ho memorizzato» è vero e non si tocca.
//
// Giro 2 della verifica: la stessa domanda mal risposta apriva porte dalle due
// parti, e sono state richiuse insieme.
//  - COSA VALE COME PROVA. Un'azione che è stata chiamata ma non ha fatto
//    nascere niente (la sveglia con l'orario che Filo non sa leggere) non copre
//    più la frase che la dà per fatta; e le famiglie non si coprono più a
//    vicenda, perché una sveglia non scrive un appunto.
//  - COSA NON HA BISOGNO DI PROVA. Quello che Filo consegna dentro la risposta
//    («te l'ho scritta qui sotto») non è un'azione mancata; un'immagine mandata
//    in chat la legge senza strumenti, come i file dell'editor; e una sveglia
//    che ESISTE, messa in una sessione precedente, regge la frase che la
//    racconta, se l'ora coincide.

(function (global) {
  'use strict';

  // Fine di parola SICURA anche dopo una vocale accentata. `\b` in JavaScript
  // guarda `\w`, che è solo ASCII: dopo la à di «modalità» non c'è nessun
  // confine, e una regola scritta `modalità\b` non può fare match su niente —
  // nasce spenta e nessuno se ne accorge. Una sentinella negli unit test
  // impedisce che ne ricompaia una (tests/unit/azioniDichiarate.test.mjs).
  const FINE = '(?![\\wàèéìíòóùú])';
  const INIZIO = '(?<![\\wàèéìíòóùú])';
  // L'apostrofo si scrive in due modi e il modello usa tutti e due.
  const AP = "['’]";
  // «Ho» e il participio: quanti spazi vuole il modello, e anche un a capo.
  // Scritto con uno spazio solo, «Ho  messo  la  sveglia» passava intero, e
  // così «Ti ho messo» con l'a capo prima di «una sveglia».
  const HO = '\\bho\\s+';
  // Il pezzo di frase fra il verbo e la cosa. Prima escludeva l'a capo: una
  // dichiarazione spezzata su due righe non veniva vista.
  const PONTE = (n) => `[^.!?]{0,${n}}`;

  // Ogni famiglia: come il modello DICE di aver fatto la cosa (`frasi`), quali
  // azioni la reggono davvero (`tipi`) e cosa va detto all'utente quando la
  // dichiarazione resta senza azione (`avviso`).
  //
  // I `tipi` restano generosi DENTRO la famiglia (tutte le strade che Filo ha
  // per fare quella cosa), ma non escono più dalla famiglia: prima una sveglia
  // reggeva anche l'appunto e l'evento in calendario, quindi una cosa fatta ne
  // assolveva tre mai fatte.
  // La sveglia si chiama anche «allarme»: riconoscere solo una delle due
  // parole lasciava passare «ti ho messo l'allarme alle 19».
  const SVEGLIA = '(?:svegli[ae]|allarm[ei])';

  const FAMIGLIE = [
    {
      id: 'sveglia',
      tipi: ['SVEGLIA', 'MODIFICA_SVEGLIA'],
      // La sveglia può già esistere: se ne esiste una all'ora nominata nella
      // frase, la frase è vera anche senza nessuna azione in questo turno.
      orari: true,
      avviso: 'la sveglia non c\'è',
      frasi: [
        new RegExp(`${HO}(?:messo|impostato|programmato|fissato|creato|aggiunto|piazzato|attivato|settato|puntato)\\b${PONTE(48)}\\b${SVEGLIA}\\b`, 'i'),
        new RegExp(`\\bfatto[,:!]?\\s+(?:la |una |l['’])?${SVEGLIA}\\b${PONTE(24)}\\b(?:impostat|programmat|messa|fissat|pronta)`, 'i'),
      ],
    },
    {
      id: 'timer',
      tipi: ['TIMER'],
      orari: true,
      avviso: 'il timer non è partito',
      frasi: [
        new RegExp(`${HO}(?:avviato|fatto\\s+partire|messo|impostato|acceso|creato|lanciato|fatto\\s+scattare)\\b${PONTE(48)}\\b(?:timer|conto alla rovescia)\\b`, 'i'),
        new RegExp(`\\bfatto[,:!]?\\s+(?:il |un )?timer\\b${PONTE(24)}\\b(?:avviat|partit|impostat|in corso|acceso)`, 'i'),
      ],
    },
    {
      id: 'sveglia-tolta',
      tipi: ['CANCELLA_SVEGLIA', 'MODIFICA_SVEGLIA'],
      avviso: 'la sveglia (o il timer) c\'è ancora',
      frasi: [
        new RegExp(`${HO}(?:cancellato|tolto|rimosso|eliminato|annullato|disattivato|spento|levato)\\b${PONTE(48)}\\b(?:${SVEGLIA}|timer)\\b`, 'i'),
      ],
    },
    {
      id: 'sveglia-spostata',
      tipi: ['MODIFICA_SVEGLIA', 'SVEGLIA', 'CANCELLA_SVEGLIA'],
      orari: true,
      avviso: 'la sveglia è rimasta com\'era',
      frasi: [
        new RegExp(`${HO}(?:spostato|anticipato|posticipato|cambiato|modificato|rimandato)\\b${PONTE(48)}\\b(?:${SVEGLIA}|timer)\\b`, 'i'),
      ],
    },
    {
      // «Promemoria» sta a parte perché in italiano lo è tutto: un appunto, un
      // evento in calendario, una sveglia. Quindi qui i tipi restano larghi,
      // mentre l'appunto vero vuole l'azione che scrive un appunto.
      id: 'promemoria',
      tipi: ['SALVA_APPUNTO', 'SALVA_LEZIONE', 'EVENTO_CALENDARIO', 'SVEGLIA', 'TIMER'],
      // Un promemoria è spessissimo una sveglia, e può essere un appunto: se
      // l'ora nominata è quella di una sveglia che c'è, o se la frase nomina un
      // appunto che c'è, la frase è vera. Senza, «ti ho messo il promemoria per
      // le 19» smentiva una sveglia delle 19 esistente.
      orari: true,
      appunti: true,
      avviso: 'il promemoria non c\'è',
      frasi: [
        new RegExp(`${HO}(?:messo|salvato|scritto|creato|aggiunto|annotato|impostato|segnato|preso|fissato)\\b${PONTE(48)}\\bpromemoria\\b`, 'i'),
        new RegExp(`\\b(?:te |ve )?l${AP}ho\\s+(?:mess|salvat|scritt|annotat|segnat)[oa]\\b${PONTE(32)}\\bpromemoria\\b`, 'i'),
      ],
    },
    {
      id: 'appunto',
      tipi: ['SALVA_APPUNTO', 'SALVA_LEZIONE'],
      // Un appunto che ESISTE già, salvato in una sessione precedente, regge la
      // frase che lo racconta — se la frase lo nomina. Senza, in ogni chat
      // nuova «l'ho salvato fra gli appunti della spesa» era un'accusa.
      appunti: true,
      avviso: 'l\'appunto non c\'è',
      frasi: [
        new RegExp(`${HO}(?:salvato|scritto|creato|aggiunto|annotato|segnato|messo|preso|buttato\\s+giù)\\b${PONTE(48)}\\b(?:appunt[oi]|not[ae])\\b`, 'i'),
        /\bme (?:lo|la|ne) sono (?:segnat|appuntat|annotat)[oa]\b/i,
        new RegExp(`\\b(?:te |ve )?l${AP}ho\\s+(?:salvat|scritt|annotat|mess)[oa]\\b${PONTE(32)}\\b(?:appunt[oi]|not[ae])\\b`, 'i'),
      ],
    },
    {
      id: 'apertura',
      // Un programma o una cartella si aprono con un comando di shell: senza
      // ESEGUI_COMANDO qui, «ho aperto il blocco note» — fatto davvero —
      // faceva comparire all'utente «non si è aperto niente».
      tipi: ['NAVIGA', 'APRI_FILE', 'COMANDO_FINESTRA', 'ESEGUI_COMANDO', 'LEGGI_DOCUMENTO', 'LEGGI_FILE', 'PROXY_TAB', 'REGOLA_PROXY_DOMINIO'],
      avviso: 'non si è aperto niente',
      frasi: [
        new RegExp(`${HO}apert[oa]\\b`, 'i'),
        new RegExp(`\\bl${AP}ho\\s+apert[oa]\\b`, 'i'),
        new RegExp(`\\bte (?:l${AP}|lo |la )ho\\s+apert[oa]\\b`, 'i'),
      ],
    },
    {
      id: 'ricerca',
      tipi: ['CERCA_WEB', 'NAVIGA', 'ESEGUI_COMANDO', 'LEGGI_DOCUMENTO', 'CAPACITA_DETTAGLIO'],
      avviso: 'la ricerca non è partita',
      frasi: [
        new RegExp(`${HO}(?:cercato|guardato|controllato|verificato)\\b${PONTE(32)}\\b(?:sul web|su internet|online|in rete|su google)\\b`, 'i'),
        new RegExp(`${HO}fatto\\s+una\\s+ricerca\\b`, 'i'),
      ],
    },
    {
      id: 'comando',
      tipi: ['ESEGUI_COMANDO'],
      avviso: 'il comando non è partito',
      frasi: [
        new RegExp(`${HO}(?:eseguito|lanciato|fatto\\s+girare|avviato)\\b${PONTE(32)}\\bcomand[oi]\\b`, 'i'),
        /\bcomando (?:eseguito|lanciato)\b/i,
      ],
    },
    {
      id: 'lettura',
      // CONTESTO_FILE e CONTESTO_IMMAGINE non sono strumenti: sono il segno che
      // in questo turno il modello aveva già in mano i riassunti dei file
      // dell'editor, o l'immagine che l'utente ha mandato in chat. Con quelli
      // davanti, «ho letto la bolletta» è vero senza nessuna azione.
      tipi: ['LEGGI_DOCUMENTO', 'LEGGI_FILE', 'LEGGI_TRASPARENZA', 'ESEGUI_COMANDO', 'CERCA_WEB', 'CONTESTO_FILE', 'CONTESTO_IMMAGINE'],
      avviso: 'il documento non l\'ha letto',
      frasi: [
        new RegExp(`${HO}lett[oa]\\b${PONTE(48)}\\b(?:documento|file|pdf|bolletta|contratto|estratto conto|fattura|appunto)\\b`, 'i'),
      ],
    },
    {
      id: 'impostazione',
      tipi: ['IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'COMANDO_FINESTRA', 'STILE_PAGINA', 'RIPRISTINA_STILE_PAGINA'],
      avviso: 'l\'impostazione è rimasta com\'era',
      frasi: [
        new RegExp(`${HO}(?:impostato|attivato|disattivato|acceso|spento|cambiato|modificato|applicato|messo)\\b${PONTE(48)}`
          + `\\b(?:tema|impostazione|preferenza|modalità|opzione|carattere|font|zoom|limite di spesa|colore|sfondo)${FINE}`, 'i'),
      ],
    },
    {
      id: 'segnalazione',
      tipi: ['INVIA_FEEDBACK'],
      avviso: 'la segnalazione non è partita',
      frasi: [
        new RegExp(`${HO}(?:inviato|mandato|spedito|girato)\\b${PONTE(32)}\\b(?:segnalazione|feedback)\\b`, 'i'),
        new RegExp(`${HO}segnalato\\b${PONTE(32)}\\b(?:agli sviluppatori|al team|a chi sviluppa)\\b`, 'i'),
      ],
    },
    {
      id: 'calendario',
      tipi: ['EVENTO_CALENDARIO'],
      avviso: 'l\'evento non è in calendario',
      frasi: [
        new RegExp(`${HO}(?:aggiunto|messo|creato|segnato|inserito)\\b${PONTE(32)}\\b(?:in calendario|nel calendario|l${AP}evento|un evento)\\b`, 'i'),
        new RegExp(`\\b(?:te |ve )?l${AP}ho\\s+(?:aggiunt|mess|segnat|inserit)[oa]\\b${PONTE(32)}\\b(?:in calendario|nel calendario|al calendario)\\b`, 'i'),
      ],
    },
    {
      id: 'schede',
      tipi: ['PULISCI_TAB', 'CANCELLA_ARCHIVIO'],
      avviso: 'le schede sono rimaste com\'erano',
      frasi: [
        new RegExp(`${HO}(?:archiviato|chiuso|ripulito|eliminato|cancellato)\\b${PONTE(32)}\\b(?:le schede|le tab|dall'archivio|la cronologia)\\b`, 'i'),
      ],
    },
    {
      id: 'memoria-cancellata',
      tipi: ['CANCELLA_MEMORIA'],
      avviso: 'la memoria è ancora lì',
      frasi: [
        new RegExp(`${HO}(?:cancellato|azzerato|eliminato|resettato|svuotato)\\b${PONTE(32)}\\b(?:la memoria|le memorie|il profilo|tutto quello che sapevo)\\b`, 'i'),
      ],
    },
    {
      id: 'proxy',
      tipi: ['PROXY_TAB', 'REGOLA_PROXY_DOMINIO', 'RIMUOVI_PROXY', 'RIMUOVI_PROXY_TUTTE', 'RIMUOVI_REGOLA_PROXY'],
      avviso: 'il proxy è rimasto com\'era',
      frasi: [
        new RegExp(`${HO}(?:messo|attivato|applicato|tolto|rimosso|disattivato)\\b${PONTE(32)}\\bil proxy\\b`, 'i'),
        new RegExp(`${HO}instradato\\b`, 'i'),
      ],
    },
    // ULTIMA, e senza tipi: la conferma col PRONOME. Quando la cosa l'ha appena
    // nominata l'utente, in italiano si risponde «l'ho messa alle 19», non «ho
    // messo la sveglia alle 19»: è la forma più probabile subito dopo la
    // richiesta, ed era l'unica che passava intera.
    // Il pronome però non dice COSA: attribuirlo a una famiglia (e scrivere «la
    // sveglia non c'è» su un appunto) sarebbe peggio di tacere. Quindi `tipi`
    // vuoto vuol dire «la regge QUALUNQUE azione del turno che non stia già
    // reggendo un'altra dichiarazione», e l'avviso resta generico. Sta in fondo
    // perché una famiglia che sa dire di cosa si tratta deve vincere su questa.
    // I verbi del CONSEGNARE UN TESTO («l'ho scritta», «l'ho creata») non sono
    // qui: quando l'utente chiede una mail, la mail è la risposta, e non esiste
    // nessuno strumento che possa averla scritta.
    {
      id: 'senza-nome',
      tipi: [],
      pronome: true,
      // Anche il pronome può raccontare una cosa che ESISTE già: «sì, te l'ho
      // messa alle 19», con la sveglia delle 19 che c'è davvero, è vero. La
      // prova dello stato valeva solo per la frase lunga che ripete la parola
      // «sveglia», cioè la forma meno probabile subito dopo la domanda.
      orari: true,
      appunti: true,
      avviso: 'non è partito niente',
      frasi: [
        new RegExp(`\\b(?:te |ve |me )?l${AP}ho\\s+(mess|impostat|programmat|fissat|aggiunt|salvat|annotat|cancellat|tolt|rimoss|spostat|attivat|disattivat|inviat|mandat|segnat|avviat)[oa]\\b`, 'i'),
        /\b(?:te |ve )?l[ei] ho\s+(mess|impostat|programmat|fissat|aggiunt|salvat|annotat|cancellat|tolt|rimoss|spostat|attivat|disattivat|inviat|mandat|segnat|avviat)[ei]\b/i,
      ],
    },
  ];

  // I `tipi` che non sono strumenti ma SEGNI di contesto: chi chiama il
  // presidio li aggiunge quando quel contesto c'era. Elencati qui perché la
  // sentinella degli unit test, che pretende che ogni tipo sia uno strumento
  // vero, sappia distinguerli da un nome scritto male.
  const TIPI_DI_CONTESTO = ['CONTESTO_FILE', 'CONTESTO_IMMAGINE'];

  // Negazioni e ipotesi: se stanno nella stessa proposizione, PRIMA della
  // dichiarazione, non c'è nessuna rivendicazione da verificare.
  const SMENTITE = /\b(?:non|senza|nessun\w*|mai|invece|prima|se|quando|appena|vuoi|vorresti|posso|potrei|dovrei|devo|volevo|avrei|potevo)\b/i;
  // Dove finisce la proposizione che precede un punto del testo. Le
  // congiunzioni accentate («però», «perché», «così») vogliono i confini
  // scritti a mano: con `\b` non avrebbero mai staccato niente, e «non ho
  // trovato l'evento però ti ho messo la sveglia» restava coperta dal «non»,
  // mentre la stessa frase con «ma» veniva vista.
  const STACCHI = new RegExp(`[.!?;:,\\n—]|${INIZIO}(?:ma|però|mentre|quindi|così|perché|siccome)${FINE}`, 'gi');
  // «Eccola qui sotto»: la cosa dichiarata è dentro la risposta, non da
  // un'altra parte. Non c'è nessuno strumento che possa averla fatta, quindi
  // non c'è niente da avvisare.
  const NELLA_RISPOSTA = /\b(?:qui sotto|qua sotto|qui sopra|qua sopra|qui di seguito|di seguito|nella risposta|qui in chat|eccol[aoie])\b/i;

  function proposizionePrima(testo, indice) {
    const prima = testo.slice(0, indice);
    let taglio = -1;
    STACCHI.lastIndex = 0;
    let m;
    while ((m = STACCHI.exec(prima))) taglio = m.index + m[0].length - 1;
    return prima.slice(taglio + 1);
  }

  // La dichiarazione è dentro una domanda? («Ho aperto la pagina giusta?»)
  function dentroUnaDomanda(testo, indice) {
    const dopo = testo.slice(indice);
    const fine = dopo.search(/[.!?\n]/);
    return fine >= 0 && dopo[fine] === '?';
  }

  // La cosa dichiarata sta nella risposta stessa? Si guarda il resto della
  // proposizione: «te l'ho scritta qui sotto», «l'ho aggiunta alla lista qui
  // sopra», o i due punti che introducono il testo consegnato.
  function puntaAllaRisposta(testo, fine) {
    const dopo = testo.slice(fine);
    const stop = dopo.search(/[.!?\n]/);
    const resto = stop >= 0 ? dopo.slice(0, stop) : dopo;
    if (NELLA_RISPOSTA.test(resto)) return true;
    return /:\s*$/.test(stop >= 0 ? dopo.slice(0, stop + 1) : dopo);
  }

  // La radice di un participio, per capire se due frasi raccontano la STESSA
  // cosa: «ho messo la sveglia» e «te l'ho messa» sono un fatto solo, «ho messo
  // la sveglia» e «te l'ho segnata» sono due.
  function radice(parola) {
    return String(parola || '').toLowerCase().replace(/[aeio]+$/, '');
  }

  // Il participio di una dichiarazione, preso dal pezzo che ha fatto match.
  function verboDi(pezzo) {
    const m = String(pezzo || '').match(/\bho\s+([a-zàèéìíòóùú]{3,})/i);
    return m ? radice(m[1]) : '';
  }

  // Gli orari nominati in una frase: «alle 19:00», «alle 19», «alle 7.30».
  function orariNelTesto(frase) {
    const out = new Set();
    const s = String(frase || '');
    let m;
    const conMinuti = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
    while ((m = conMinuti.exec(s))) out.add(`${String(m[1]).padStart(2, '0')}:${m[2]}`);
    const soloOra = /\balle\s+([01]?\d|2[0-3])\b(?![:.]\d)/gi;
    while ((m = soloOra.exec(s))) out.add(`${String(m[1]).padStart(2, '0')}:00`);
    return out;
  }

  // La prima dichiarazione VALIDA di una famiglia, o null. Ritorna la frase
  // così com'è scritta (serve sia al modello, per sapere cosa rimangiarsi, sia
  // all'utente): tagliata a 160 caratteri, che è già una frase lunga.
  function dichiarazione(testo, famiglia) {
    for (const re of famiglia.frasi) {
      const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      let m;
      while ((m = rx.exec(testo))) {
        if (!m[0]) { rx.lastIndex += 1; continue; }
        if (SMENTITE.test(proposizionePrima(testo, m.index))) continue;
        if (dentroUnaDomanda(testo, m.index)) continue;
        const fine = m.index + m[0].length;
        if (famiglia.pronome && puntaAllaRisposta(testo, fine)) continue;
        return { frase: frasePiena(testo, m.index, fine), verbo: verboDi(m[0]) };
      }
    }
    return null;
  }

  // Dalla dichiarazione alla frase intera in cui sta: «ho messo» da solo non
  // dice niente, «Ti ho messo una sveglia alle 19:00» sì.
  function frasePiena(testo, da, a) {
    const prima = testo.slice(0, da);
    const inizio = Math.max(
      prima.lastIndexOf('.'), prima.lastIndexOf('!'), prima.lastIndexOf('?'), prima.lastIndexOf('\n'),
    ) + 1;
    const dopo = testo.slice(a);
    const fine = dopo.search(/[.!?\n]/);
    const frase = testo.slice(inizio, fine >= 0 ? a + fine + 1 : testo.length).trim();
    return frase.length > 160 ? `${frase.slice(0, 157)}…` : frase;
  }

  // Un'azione che è stata CHIAMATA ma non ha fatto nascere niente non regge la
  // frase che la dà per fatta: la sveglia con l'orario che Filo non sa leggere
  // lasciava l'utente senza sveglia e senza avviso, che è esattamente la
  // lamentela del feedback. Restano buone le azioni che hanno prodotto
  // qualcosa (`_output`: una ricerca senza risultati è comunque partita) e
  // quelle in attesa di un OK dell'utente, che in chat si vedono.
  function haFattoQualcosa(a) {
    if (!a || typeof a !== 'object') return true;
    if (a._executed !== false) return true;
    return !!(a._output || a._confirm);
  }

  function insiemeDiTipi(azioni) {
    const out = new Set();
    for (const a of (Array.isArray(azioni) ? azioni : [])) {
      if (!haFattoQualcosa(a)) continue;
      const t = String((a && (a.type || a.tipo)) || '').toUpperCase();
      if (t) out.add(t);
    }
    return out;
  }

  // I tipi di azione già usciti nei turni PRECEDENTI della conversazione: se la
  // sveglia l'aveva messa due messaggi fa, «sì, te l'ho messa alle 7» è vero.
  function tipiDallaCronologia(cronologia) {
    const out = new Set();
    for (const m of (Array.isArray(cronologia) ? cronologia : [])) {
      if (!m || m.role !== 'filo') continue;
      for (const t of insiemeDiTipi(m.actions)) out.add(t);
    }
    return out;
  }

  // rileva(testo, azioni | Set di tipi, stato) → [{ id, avviso, tipi, frase }]
  // Una voce per famiglia dichiarata e non retta da niente.
  // `stato.orariSveglie`: gli orari delle sveglie e dei timer che ESISTONO
  // adesso. Una sveglia messa ieri, in un'altra sessione, non lascia nessuna
  // azione in questa conversazione: senza guardare lo stato, «sì, l'ho messa
  // alle 19» diventava un'accusa a ogni riavvio.
  function rileva(testo, azioni, stato) {
    const t = String(testo || '');
    if (!t.trim()) return [];
    const presenti = (azioni instanceof Set) ? azioni : insiemeDiTipi(azioni);
    const orari = new Set(Array.isArray(stato?.orariSveglie) ? stato.orariSveglie : []);
    const out = [];
    // I tipi che stanno già reggendo una dichiarazione: un'azione sola non può
    // reggerne due diverse.
    const impegnati = new Set();
    // I verbi delle dichiarazioni già rette: servono a capire se il pronome
    // sta ripetendo la stessa cosa o ne sta nominando un'altra.
    const radiciRette = new Set();
    let pronome = null;
    for (const fam of FAMIGLIE) {
      const d = dichiarazione(t, fam);
      if (!d) continue;
      if (fam.pronome) { pronome = d; continue; }
      const retta = fam.tipi.filter((x) => presenti.has(x));
      if (retta.length) {
        for (const x of retta) impegnati.add(x);
        if (d.verbo) radiciRette.add(d.verbo);
        continue;
      }
      // Nessuna azione: la cosa può esistere lo stesso, se l'ora nominata nella
      // frase è quella di una sveglia che c'è davvero.
      if (fam.orari && orari.size) {
        const nominati = orariNelTesto(d.frase);
        if ([...nominati].some((o) => orari.has(o))) {
          if (d.verbo) radiciRette.add(d.verbo);
          continue;
        }
      }
      out.push({ id: fam.id, avviso: fam.avviso, tipi: fam.tipi.slice(), frase: d.frase });
    }
    // Il pronome parla solo se nessuna famiglia ha già saputo dire di cosa si
    // tratta, e se non è rimasta nessuna azione libera a reggerlo. Se la
    // dichiarazione col pronome ripete lo stesso verbo di una già retta («ho
    // messo la sveglia… te l'ho messa alle 19»), è lo stesso fatto detto due
    // volte, non un secondo fatto mai successo.
    if (pronome && !out.length) {
      const libere = [...presenti].some((x) => !impegnati.has(x));
      const ripete = pronome.verbo && radiciRette.has(pronome.verbo);
      if (!libere && !ripete) {
        out.push({ id: 'senza-nome', avviso: 'non è partito niente', tipi: [], frase: pronome.frase });
      }
    }
    return out;
  }

  // Il testo non è una risposta in prosa ma il formato macchina (il JSON del
  // vecchio protocollo, o il nome di uno strumento con i suoi argomenti): quello
  // che arriva in chat non è una risposta, e le azioni che conteneva non sono
  // partite. Si riconosce solo quando NESSUNO strumento è stato chiamato e il
  // recupero del formato vecchio ha già fallito: lì è un turno buttato.
  //
  // Il formato macchina arriva in due posti, e sono lo stesso guasto: da solo,
  // oppure IN CODA alla risposta buona («scrive la risposta buona come
  // preambolo e chiude con un oggetto», dalla segnalazione). Prima si guardava
  // solo l'inizio del testo, quindi bastava una frase davanti perché il turno
  // passasse intero: la frase arrivava all'utente, la sveglia no, e questa
  // volta senza nemmeno un ritentativo.
  //
  // Un ESEMPIO non è un guasto: né dentro un blocco recintato con i tre apici,
  // né quando la riga prima dice che è un esempio («ecco com'è fatta
  // un'azione:»). Buttare via quella risposta e rifarla lasciava l'utente senza
  // la cosa che aveva chiesto di vedere.
  function involucro(s, nomi) {
    if (!s) return false;
    // Il vecchio involucro del protocollo, o un oggetto vuoto al posto della
    // risposta: in chat sono un blocco di codice e basta. La graffa di chiusura
    // non si pretende: un involucro tagliato a metà è comunque un turno buttato.
    if (/^\{/.test(s) && /"(?:text|actions|type)"\s*:/.test(s)) return true;
    if (/^\{\s*\}$/.test(s)) return true;
    // Una lista di azioni scritta invece che chiamata.
    if (/^\[\s*\{[\s\S]*"type"\s*:/.test(s)) return true;
    // Il nome di uno strumento con i suoi argomenti. Il nome si confronta con
    // quelli VERI quando li abbiamo: senza, una parola tutta maiuscola con una
    // parentesi dietro passerebbe per una chiamata.
    const m = s.match(/^([A-Z][A-Z_]{3,})\s*(?:\{|\()/);
    if (m) return !nomi || nomi.has(m[1]);
    return false;
  }

  // La riga che introduce il pezzo di formato dice che è un esempio?
  const ANNUNCIO_DI_ESEMPIO = /(?:esempi|com['’]?\s*è\s+fatt|come\s+si\s+scriv|si\s+scrive\s+così|la\s+sintassi|il\s+formato\s+è)/i;

  function annunciatoComeEsempio(righe, indice) {
    for (let j = indice - 1; j >= 0 && j >= indice - 3; j--) {
      const r = righe[j].trim();
      if (!r) continue;
      return ANNUNCIO_DI_ESEMPIO.test(r);
    }
    return false;
  }

  function formatoSospetto(testo, nomiStrumenti) {
    const grezzo = String(testo || '').trim();
    if (!grezzo) return false;
    const nomi = Array.isArray(nomiStrumenti) ? new Set(nomiStrumenti)
      : (nomiStrumenti instanceof Set ? nomiStrumenti : nomiDegliStrumenti());
    const righe = grezzo.split('\n');
    // Tutta la risposta è formato macchina, anche se recintata coi tre apici:
    // una risposta che è SOLO un involucro non è mai un esempio per l'utente.
    const nudo = grezzo.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    if (involucro(nudo, nomi)) return true;
    // Il formato macchina in coda, dopo la risposta per l'utente. Si parte da
    // ogni riga che potrebbe aprirlo e si guarda da lì alla fine.
    let recinto = false;
    for (let i = 0; i < righe.length; i++) {
      if (/^\s*```/.test(righe[i])) { recinto = !recinto; continue; }
      if (i === 0 || recinto) continue;
      const riga = righe[i].trimStart();
      if (!/^[[{]|^[A-Z][A-Z_]{3,}\s*[{(]/.test(riga)) continue;
      if (annunciatoComeEsempio(righe, i)) continue;
      const coda = righe.slice(i).join('\n').trim().replace(/```[\s\S]*$/, '').trim();
      if (involucro(coda, nomi)) return true;
    }
    return false;
  }

  // I nomi veri degli strumenti, se il registro è già caricato accanto a noi.
  function nomiDegliStrumenti() {
    try {
      const T = global.SN_ACTION_TOOLS;
      if (T && Array.isArray(T.NAMES) && T.NAMES.length) return new Set(T.NAMES);
    } catch (_) {}
    return null;
  }

  // La spinta che torna al modello quando la risposta dichiara un'azione mai
  // chiamata. Non la vede l'utente: è un messaggio di sistema dentro il turno.
  function spintaAzioniMancanti(fantasmi) {
    const righe = (Array.isArray(fantasmi) ? fantasmi : []).map((f) => (f.tipi && f.tipi.length
      ? `- «${f.frase}» (strumenti: ${f.tipi.join(', ')})`
      : `- «${f.frase}» (non hai chiamato niente in questo turno)`));
    return 'La tua risposta dice che hai già fatto questo:\n'
      + `${righe.join('\n')}\n`
      + 'In questo turno però non hai chiamato nessuno strumento che lo faccia, o quello che hai chiamato non ha prodotto niente: '
      + 'non è successo, e così com\'è la tua risposta dice all\'utente una cosa falsa.\n'
      + 'Adesso fai UNA di queste tre cose:\n'
      + '1. se va fatto ORA, chiama lo strumento giusto e poi rispondi;\n'
      + '2. se l\'avevi già fatto in un turno PRECEDENTE di questa conversazione, NON rifarlo: '
      + 'riscrivi la risposta dicendo che era già fatto;\n'
      + '3. se non si può fare, riscrivi la risposta senza dire che è fatto, e spiega all\'utente cosa manca.\n'
      + 'Non ripetere la risposta di prima uguale: questo messaggio non lo vede l\'utente.';
  }

  // La spinta per una risposta arrivata in formato macchina invece che in prosa.
  function spintaFormato() {
    return 'La tua ultima risposta non è arrivata come testo per l\'utente: sembra il formato interno '
      + '(JSON, o il nome di uno strumento con i suoi argomenti). Scritta così non esegue niente e '
      + 'in chat comparirebbe come un blocco di codice.\n'
      + 'Riprova: le azioni si CHIAMANO come strumenti (tool call), la risposta per l\'utente è prosa '
      + 'e basta, senza JSON. Se le azioni ti servono, chiamale adesso.';
  }

  // La riga che l'utente legge sotto la risposta quando la dichiarazione è
  // rimasta senza azione anche dopo il ritentativo.
  function avvisoPerUtente(fantasmi) {
    const lista = (Array.isArray(fantasmi) ? fantasmi : []).map((f) => f.avviso).filter(Boolean);
    if (!lista.length) return '';
    const cose = lista.length === 1
      ? lista[0]
      : `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}`;
    return `Filo ha scritto di averlo già fatto, ma non l'ha fatto: ${cose}. Se ti serve, chiediglielo di nuovo.`;
  }

  // La riga che l'utente legge quando il turno si chiude col formato macchina
  // anche dopo il ritentativo. Senza, quel guasto restava l'unico dei due a
  // finire in silenzio: in chat un blocco di codice, e niente che dicesse che
  // quello che c'era scritto lì dentro non è successo.
  function avvisoFormatoPerUtente() {
    return 'Filo ha risposto con un pezzo del suo formato interno: quello che c\'era scritto lì dentro non è stato fatto. Se ti serve, chiediglielo di nuovo.';
  }

  global.SN_AZIONI_DICHIARATE = {
    FAMIGLIE,
    TIPI_DI_CONTESTO,
    rileva,
    insiemeDiTipi,
    tipiDallaCronologia,
    orariNelTesto,
    formatoSospetto,
    spintaAzioniMancanti,
    spintaFormato,
    avvisoPerUtente,
    avvisoFormatoPerUtente,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
