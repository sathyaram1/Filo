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
  // Le paroline che si infilano fra «ho» e il participio. Giro 5: il
  // participio doveva stare ATTACCATO a «ho», quindi «ti ho GIÀ messo la
  // sveglia alle 19» — la risposta tipica quando l'utente richiede una cosa —
  // non veniva vista affatto, in nessuna famiglia e nemmeno col pronome.
  // L'elenco è chiuso apposta: un `\w+` qualunque qui dentro farebbe passare
  // il complemento («ho la sveglia messa da parte») per un avverbio.
  // Giro 6: «gia'» con l'apostrofo al posto dell'accento. I modelli scrivono
  // così di continuo, e la parola con l'accento era l'unica riconosciuta.
  const AVVERBI = `(?:gi[àa]${AP}?|appena|anche|pure|subito|poi|quindi|comunque|intanto|infine`
    + '|ovviamente|certamente|sicuramente|effettivamente|finalmente|volentieri|prontamente'
    + '|ora|adesso|oggi|ieri|stamattina|stasera|stanotte|nel frattempo|per te|per voi)';
  // Giro 6: il grassetto di Markdown, che può stare intorno al verbo da solo
  // («ti ho **messo** la sveglia»). Gli asterischi e gli underscore contano
  // come spazio, non come parola.
  const MD = '[*_]{0,3}';
  const AVV = `(?:${MD}${AVVERBI}${MD}\\s+){0,3}${MD}`;
  // «Ho» e il participio: quanti spazi vuole il modello, e anche un a capo.
  // Scritto con uno spazio solo, «Ho  messo  la  sveglia» passava intero, e
  // così «Ti ho messo» con l'a capo prima di «una sveglia».
  // Giro 6: «avevo» accanto a «ho». Il trapassato è il tempo con cui si dice
  // «l'avevo già fatto», ed è la risposta tipica a chi richiede una cosa.
  const HO = `\\b(?:ho|avevo)\\s+${AVV}`;
  // Il pezzo di frase fra il verbo e la cosa. Prima escludeva l'a capo: una
  // dichiarazione spezzata su due righe non veniva vista. Da 48 a 72: con 48
  // «Ho messo, come mi avevi chiesto ieri sera prima di uscire, la sveglia
  // alle 19» restava muta.
  const PONTE = (n) => `[^.!?]{0,${n}}`;
  // I pronomi con cui si risponde quando la cosa l'ha appena nominata
  // l'utente. «Gliel'ho messa» mancava: c'erano solo prima e seconda persona.
  const PRON = `(?:te |ve |me |glie)?l${AP}(?:ho|avevo)\\s+${AVV}`;

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
      // …e l'ora DECIDE: se la frase nomina un'ora, la prova è che la sveglia
      // a quell'ora ci sia, non che in questa conversazione sia partita una
      // SVEGLIA qualunque. Senza, bastava una sveglia messa prima nel thread
      // perché ogni sveglia raccontata dopo, a qualunque ora, passasse muta.
      oreProva: true,
      avviso: 'la sveglia non c\'è',
      frasi: [
        new RegExp(`${HO}(?:messo|impostato|programmato|fissato|creato|aggiunto|piazzato|attivato|settato|puntato)\\b${PONTE(72)}\\b${SVEGLIA}\\b`, 'i'),
        new RegExp(`\\bfatto[,:!]?\\s+(?:la |una |l['’])?${SVEGLIA}\\b${PONTE(24)}\\b(?:impostat|programmat|messa|fissat|pronta)`, 'i'),
      ],
    },
    {
      id: 'timer',
      tipi: ['TIMER'],
      orari: true,
      oreProva: true,
      avviso: 'il timer non è partito',
      frasi: [
        new RegExp(`${HO}(?:avviato|fatto\\s+partire|messo|impostato|acceso|creato|lanciato|fatto\\s+scattare)\\b${PONTE(72)}\\b(?:timer|conto alla rovescia)\\b`, 'i'),
        new RegExp(`\\bfatto[,:!]?\\s+(?:il |un )?timer\\b${PONTE(24)}\\b(?:avviat|partit|impostat|in corso|acceso)`, 'i'),
      ],
    },
    {
      id: 'sveglia-tolta',
      tipi: ['CANCELLA_SVEGLIA', 'MODIFICA_SVEGLIA'],
      avviso: 'la sveglia (o il timer) c\'è ancora',
      frasi: [
        new RegExp(`${HO}(?:cancellato|tolto|rimosso|eliminato|annullato|disattivato|spento|levato)\\b${PONTE(72)}\\b(?:${SVEGLIA}|timer)\\b`, 'i'),
      ],
    },
    {
      id: 'sveglia-spostata',
      tipi: ['MODIFICA_SVEGLIA', 'SVEGLIA', 'CANCELLA_SVEGLIA'],
      orari: true,
      avviso: 'la sveglia è rimasta com\'era',
      frasi: [
        new RegExp(`${HO}(?:spostato|anticipato|posticipato|cambiato|modificato|rimandato)\\b${PONTE(72)}\\b(?:${SVEGLIA}|timer)\\b`, 'i'),
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
        new RegExp(`${HO}(?:messo|salvato|scritto|creato|aggiunto|annotato|impostato|segnato|preso|fissato)\\b${PONTE(72)}\\bpromemoria\\b`, 'i'),
        new RegExp(`\\b${PRON}(?:mess|salvat|scritt|annotat|segnat)[oa]\\b${PONTE(32)}\\bpromemoria\\b`, 'i'),
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
        new RegExp(`${HO}(?:salvato|scritto|creato|aggiunto|annotato|segnato|messo|preso|buttato\\s+giù)\\b${PONTE(72)}\\b(?:appunt[oi]|not[ae])\\b`, 'i'),
        /\bme (?:lo|la|ne) sono (?:segnat|appuntat|annotat)[oa]\b/i,
        new RegExp(`\\b${PRON}(?:salvat|scritt|annotat|segnat|mess)[oa]\\b${PONTE(32)}\\b(?:appunt[oi]|not[ae])\\b`, 'i'),
        // «Ti ho segnato la spesa»: il verbo del prendere nota, col pronome di
        // chi lo riceve e senza la parola «appunto». Accanto a una sveglia
        // partita davvero questa restava l'unica cosa mai fatta, e nessuno lo
        // diceva. Fuori dal calendario, dove «segnare» vuol dire un'altra cosa
        // e la famiglia giusta è un'altra.
        new RegExp(`\\b(?:te |ve |ti |mi )ho\\s+${AVV}(?:segnat|appuntat|salvat)[oa]\\b`
          + '(?!\\s+(?:la vita|molto tempo|tempo|un sacco|la giornata|la serata|la situazione))'
          + `(?![^.!?]{0,40}\\b(?:in calendario|nel calendario|sul calendario|al calendario|evento)\\b)`, 'i'),
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
        new RegExp(`\\b${PRON}apert[oa]\\b`, 'i'),
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
        new RegExp(`${HO}lett[oa]\\b${PONTE(72)}\\b(?:documento|file|pdf|bolletta|contratto|estratto conto|fattura|appunto)\\b`, 'i'),
      ],
    },
    {
      id: 'impostazione',
      tipi: ['IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'COMANDO_FINESTRA', 'STILE_PAGINA', 'RIPRISTINA_STILE_PAGINA'],
      avviso: 'l\'impostazione è rimasta com\'era',
      frasi: [
        new RegExp(`${HO}(?:impostato|attivato|disattivato|acceso|spento|cambiato|modificato|applicato|messo)\\b${PONTE(72)}`
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
        new RegExp(`\\b${PRON}(?:aggiunt|mess|segnat|inserit)[oa]\\b${PONTE(32)}\\b(?:in calendario|nel calendario|al calendario)\\b`, 'i'),
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
        new RegExp(`\\b${PRON}(mess|impostat|programmat|fissat|aggiunt|salvat|annotat|cancellat|tolt|rimoss|spostat|attivat|disattivat|inviat|mandat|segnat|avviat)[oa]\\b`, 'i'),
        new RegExp(`\\b(?:te |ve |glie)?l[ei] ho\\s+${AVV}(mess|impostat|programmat|fissat|aggiunt|salvat|annotat|cancellat|tolt|rimoss|spostat|attivat|disattivat|inviat|mandat|segnat|avviat)[ei]\\b`, 'i'),
      ],
    },
  ];

  // I `tipi` che non sono strumenti ma SEGNI di contesto: chi chiama il
  // presidio li aggiunge quando quel contesto c'era. Elencati qui perché la
  // sentinella degli unit test, che pretende che ogni tipo sia uno strumento
  // vero, sappia distinguerli da un nome scritto male.
  const TIPI_DI_CONTESTO = ['CONTESTO_FILE', 'CONTESTO_IMMAGINE'];

  // Le azioni che si limitano a GUARDARE. Contano per le famiglie che le
  // nominano (una ricerca regge «ho cercato sul web»), ma non possono essere
  // la cosa che l'utente si sente confermare col pronome: «te l'ho messa alle
  // 19» non lo regge una ricerca. Insieme ai segni di contesto — che non sono
  // azioni del tutto — bastavano a zittire il presidio per intero: a chiunque
  // tenesse un appunto aperto nell'editor il segno dei file arrivava a OGNI
  // turno, e il caso della segnalazione tornava muto come prima.
  const TIPI_DI_SOLA_LETTURA = ['CERCA_WEB', 'LEGGI_DOCUMENTO', 'LEGGI_FILE', 'LEGGI_TRASPARENZA', 'CAPACITA_DETTAGLIO'];
  const NON_REGGONO_IL_PRONOME = new Set([...TIPI_DI_CONTESTO, ...TIPI_DI_SOLA_LETTURA]);

  // Negazioni e ipotesi: se stanno nella stessa proposizione, PRIMA della
  // dichiarazione, non c'è nessuna rivendicazione da verificare.
  // Giro 4: «invece», «prima», «quando» e «appena» stavano qui dentro e sono
  // congiunzioni, non negazioni. Davanti a una dichiarazione già al passato
  // raccontano quando la cosa è stata fatta, non che non è stata fatta, e
  // zittivano il presidio su frasi vere come «non ho trovato l'evento, invece
  // ti ho messo la sveglia alle 19». «Se» resta: introduce un'ipotesi.
  // Giro 5: «volevo» era qui dentro, e zittiva «Volevo dirti che ti ho messo la
  // sveglia alle 19». Lì non nega niente: introduce la frase. L'ipotesi che
  // «volevo» doveva coprire («volevo metterti la sveglia ma non ci sono
  // riuscito») non ha nessun «ho + participio» da coprire.
  const SMENTITE = /\b(?:non|senza|nessun\w*|mai|se|vuoi|vorresti|posso|potrei|dovrei|devo|avrei|potevo)\b/i;
  // Dove finisce la proposizione che precede un punto del testo. Le
  // congiunzioni accentate («però», «perché», «così») vogliono i confini
  // scritti a mano: con `\b` non avrebbero mai staccato niente, e «non ho
  // trovato l'evento però ti ho messo la sveglia» restava coperta dal «non»,
  // mentre la stessa frase con «ma» veniva vista. «Invece» sta qui per lo
  // stesso motivo di «però»: stacca, non nega.
  // Giro 6: il punto e la virgola FRA DUE CIFRE non staccano niente. Sono i
  // segni con cui in italiano si scrive un orario, e tagliando lì «Ho messo la
  // sveglia alle 19.30» si leggeva «…alle 19»: la sveglia delle 19:30, che
  // esisteva davvero, veniva smentita.
  const PUNTO = '(?:(?<!\\d)\\.|\\.(?!\\d))';
  const VIRGOLA = '(?:(?<!\\d),|,(?!\\d))';
  // Dove finisce una frase, con la stessa cautela sull'orario.
  const FINE_FRASE = new RegExp(`${PUNTO}|[!?\\n]`);
  const STACCHI = new RegExp(`${PUNTO}|${VIRGOLA}|[!?;:\\n—]|${INIZIO}(?:ma|però|invece|mentre|quindi|così|perché|siccome)${FINE}`, 'gi');
  // «Eccola qui sotto»: la cosa dichiarata è dentro la risposta, non da
  // un'altra parte. Non c'è nessuno strumento che possa averla fatta, quindi
  // non c'è niente da avvisare.
  const NELLA_RISPOSTA = /\b(?:qui sotto|qua sotto|qui sopra|qua sopra|qui di seguito|di seguito|nella risposta|qui in chat|eccol[aoie])\b/i;
  // …e la stessa cosa detta senza dire dov'è. Quando la frase racconta la
  // FORMA che Filo ha dato a un testo («te l'ho messa in ordine alfabetico»,
  // «te l'ho aggiunta alla lista»), la cosa è la risposta: non esiste nessuno
  // strumento che mette in ordine alfabetico, e smentirla era un'accusa su un
  // cammino che un utente nuovo percorre subito. Il prezzo è che una lista
  // davvero salvata fra gli appunti, raccontata così, non viene più smentita:
  // meglio tacere che avere torto.
  const FORMA_DEL_TESTO = new RegExp(
    `\\b(?:in ordine|in colonna|in tabella|in elenco|in punti|in grassetto|in corsivo`
    + `|per data|per nome|per prezzo|per ordine`
    + `|alla lista|nella lista|all${AP}elenco|nell${AP}elenco`
    + `|più (?:breve|corta|corto|lunga|lungo|chiara|chiaro|semplice|semplici))\\b`, 'i');

  // Dove finisce la proposizione che SEGUE un punto del testo. Senza i due
  // punti: dentro «19:30» quelli sono un orario, non uno stacco, e tagliare
  // lì faceva leggere le 19 al posto delle 19:30.
  const STACCHI_DOPO = new RegExp(`${PUNTO}|${VIRGOLA}|[!?;\\n—]|${INIZIO}(?:ma|però|invece|mentre|quindi|così|perché|siccome)${FINE}`, 'gi');

  function proposizionePrima(testo, indice) {
    const prima = testo.slice(0, indice);
    let taglio = -1;
    STACCHI.lastIndex = 0;
    let m;
    while ((m = STACCHI.exec(prima))) taglio = m.index + m[0].length - 1;
    return prima.slice(taglio + 1);
  }

  // Una domanda alternativa: il punto interrogativo è di là dalla virgola, ma
  // la domanda riguarda ancora la cosa dichiarata («ho aperto la pagina
  // giusta, o mi sono sbagliato?»).
  const ALTERNATIVA = /(?:^|[\s,;])(?:o|oppure|o no|vero|giusto)(?:[\s,;]|$)/i;

  // La dichiarazione è dentro una domanda? («Ho aperto la pagina giusta?»)
  //
  // Giro 5: si guardava fino al primo `.!?\n`, e la virgola non contava. Così
  // «Ti ho messo la sveglia alle 19, va bene?» passava per una domanda e il
  // presidio taceva, mentre la stessa frase col punto veniva vista. La virgola
  // stacca già la proposizione PRIMA della dichiarazione: deve staccare anche
  // quella dopo. Resta domanda ciò che lo è davvero: il punto interrogativo
  // nella stessa proposizione, o una domanda alternativa di là dalla virgola.
  function dentroUnaDomanda(testo, indice) {
    const dopo = testo.slice(indice);
    const fine = dopo.search(FINE_FRASE);
    if (fine < 0 || dopo[fine] !== '?') return false;
    const corpo = dopo.slice(0, fine);
    const stacco = corpo.search(/[,;:—]/);
    if (stacco < 0) return true;
    return ALTERNATIVA.test(corpo.slice(stacco));
  }

  // La cosa dichiarata sta nella risposta stessa? Si guarda il resto della
  // proposizione: «te l'ho scritta qui sotto», «l'ho aggiunta alla lista qui
  // sopra», o i due punti che introducono il testo consegnato.
  function puntaAllaRisposta(testo, fine) {
    const dopo = testo.slice(fine);
    const stop = dopo.search(FINE_FRASE);
    const resto = stop >= 0 ? dopo.slice(0, stop) : dopo;
    if (NELLA_RISPOSTA.test(resto)) return true;
    if (FORMA_DEL_TESTO.test(resto)) return true;
    return /:\s*$/.test(stop >= 0 ? dopo.slice(0, stop + 1) : dopo);
  }

  // La radice di un participio, per capire se due frasi raccontano la STESSA
  // cosa: «ho messo la sveglia» e «te l'ho messa» sono un fatto solo, «ho messo
  // la sveglia» e «te l'ho segnata» sono due.
  function radice(parola) {
    return String(parola || '').toLowerCase().replace(/[aeio]+$/, '');
  }

  // Il participio di una dichiarazione, preso dal pezzo che ha fatto match.
  // Le paroline in mezzo («ti ho già messo») si saltano: prese per il verbo,
  // due dichiarazioni diverse sembravano la stessa cosa detta due volte.
  const VERBO_DOPO_HO = new RegExp(`\\bho\\s+${AVV}([a-zàèéìíòóùú]{3,})`, 'i');
  function verboDi(pezzo) {
    const m = String(pezzo || '').match(VERBO_DOPO_HO);
    return m ? radice(m[1]) : '';
  }
  // I verbi che creano qualcosa a un'ora: lì l'ora nominata è la prova. Chi
  // sposta o cancella no — dopo «te l'ho cancellata alle 19» la sveglia delle
  // 19 non deve esistere, e pretenderla sarebbe l'accusa al contrario.
  const VERBI_CHE_CREANO = new Set(['mess', 'impostat', 'programmat', 'fissat', 'creat', 'aggiunt', 'piazzat', 'settat', 'puntat', 'avviat', 'accés', 'acces', 'lanciat']);

  // Le ore scritte a lettere. «Ho messo la sveglia alle sette», con la sveglia
  // delle 7 che esiste davvero, veniva smentita perché l'ora si leggeva solo
  // in cifre — e in italiano l'ora si dice a lettere quanto in cifre.
  const ORE_A_PAROLE = {
    una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8,
    nove: 9, dieci: 10, undici: 11, dodici: 12, mezzogiorno: 12, mezzanotte: 0,
  };
  // «alle 7 di sera» sono le 19: senza questo l'avviso era doppiamente
  // sbagliato, perché smentiva una sveglia che c'era all'ora giusta.
  const POMERIGGIO = /^[\s,]*(?:di|del|della|nel|nella)?\s*(?:sera|serata|pomeriggio)\b/i;
  const MATTINO = /^[\s,]*(?:di|del|della|al|nella)?\s*(?:mattina|mattino|notte)\b/i;

  // Le preposizioni con cui in italiano si dice l'ora. Giro 5: si leggeva
  // solo «alle», quindi «ti ho messo la sveglia per le 19» e «la sveglia
  // delle 19» non venivano lette affatto, e la sveglia delle 19 che esisteva
  // veniva smentita.
  // Col numero la preposizione nuda «a» resta fuori: «a 3» non è un'ora.
  // «Dalle» ed «entro le» restano fuori: aprono un intervallo o una scadenza
  // («dormi dalle 22»), non promettono una sveglia a quell'ora.
  const PREP_ORA_NUM = `(?:alle|all${AP}|per\\s+le|per\\s+l${AP}|delle|verso\\s+le|verso\\s+l${AP})`
    + '(?:\\s+ore)?';
  const PREP_ORA = `(?:${PREP_ORA_NUM}|a)`;
  // La mezz'ora e il quarto d'ora, che in italiano si dicono così e basta.
  // «Alle 7 e mezza», con la sveglia delle 7:30 che c'è, veniva smentita
  // perché l'ora si leggeva 7:00.
  const MEZZA = /^[\s,]*e\s+mezz[ao]\b/i;
  const UN_QUARTO = /^[\s,]*e\s+un\s+quarto\b/i;
  const MENO_UN_QUARTO = /^[\s,]*meno\s+un\s+quarto\b/i;
  const E_MINUTI = /^[\s,]*e\s+([0-5]?\d)\b/i;
  // I minuti detti a parole. «Alle 19 e trenta», con la sveglia delle 19:30
  // che esiste, veniva smentita: si leggevano solo «e mezza» e «e un quarto».
  const MINUTI_A_PAROLE = {
    cinque: 5, dieci: 10, quindici: 15, venti: 20, venticinque: 25, trenta: 30,
    trentacinque: 35, quaranta: 40, quarantacinque: 45, cinquanta: 50, cinquantacinque: 55,
  };
  const E_MINUTI_A_PAROLE = new RegExp(`^[\\s,]*e\\s+(${Object.keys(MINUTI_A_PAROLE).join('|')})${FINE}`, 'i');

  // Gli orari nominati in una frase: «alle 19:00», «alle 19», «alle 7.30»,
  // «per le 19», «alle sette», «alle 7 e mezza», «alle 7 di sera»,
  // «a mezzogiorno».
  function orariNelTesto(frase) {
    const out = new Set();
    const s = String(frase || '');
    const metti = (ora, minuti, dopo) => {
      let h = Number(ora);
      if (!Number.isFinite(h) || h < 0 || h > 23) return;
      let coda = String(dopo || '');
      let min = Number(minuti) || 0;
      // I minuti detti a parole valgono solo se l'ora era secca.
      if (!min) {
        let q;
        if (MEZZA.test(coda)) { min = 30; coda = coda.replace(MEZZA, ''); }
        else if (UN_QUARTO.test(coda)) { min = 15; coda = coda.replace(UN_QUARTO, ''); }
        else if (MENO_UN_QUARTO.test(coda)) { min = 45; h = (h + 23) % 24; coda = coda.replace(MENO_UN_QUARTO, ''); }
        else if ((q = coda.match(E_MINUTI))) { min = Number(q[1]); coda = coda.slice(q[0].length); }
        else if ((q = coda.match(E_MINUTI_A_PAROLE))) {
          min = MINUTI_A_PAROLE[q[1].toLowerCase()]; coda = coda.slice(q[0].length);
        }
      }
      if (h >= 1 && h <= 11 && !MATTINO.test(coda) && POMERIGGIO.test(coda)) h += 12;
      out.add(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    };
    let m;
    // L'ora si scrive coi due punti, col punto e anche con la virgola: «alle
    // 19,30» è la stessa ora di «alle 19:30».
    const conMinuti = /\b([01]?\d|2[0-3])[:.,]([0-5]\d)\b/g;
    while ((m = conMinuti.exec(s))) metti(m[1], m[2], s.slice(m.index + m[0].length));
    const soloOra = new RegExp(`${INIZIO}${PREP_ORA_NUM}\\s+([01]?\\d|2[0-3])\\b(?![:.]\\d)`, 'gi');
    while ((m = soloOra.exec(s))) metti(m[1], '00', s.slice(m.index + m[0].length));
    const aParole = new RegExp(`${INIZIO}${PREP_ORA}\\s+(${Object.keys(ORE_A_PAROLE).join('|')})${FINE}`, 'gi');
    while ((m = aParole.exec(s))) {
      metti(ORE_A_PAROLE[m[1].toLowerCase()], '00', s.slice(m.index + m[0].length));
    }
    return out;
  }

  // La frase nomina un appunto che ESISTE già? Si confrontano i titoli dei
  // file e degli appunti che Filo ha davanti a ogni turno: un appunto salvato
  // ieri non lascia nessuna azione in questa conversazione, e senza questo
  // «l'ho salvato fra gli appunti della spesa» era un'accusa in ogni chat
  // nuova. Si guarda il TITOLO, non la sola esistenza di appunti: «l'ho
  // salvato» e basta resta una dichiarazione da verificare.
  function nominaUnAppunto(frase, titoli) {
    const s = String(frase || '').toLowerCase();
    for (const t of (Array.isArray(titoli) ? titoli : [])) {
      const pulito = String(t || '').trim().toLowerCase();
      if (pulito.length >= 4 && s.includes(pulito)) return true;
    }
    return false;
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
        // Giro 5: questo valeva solo per il pronome. Vale per tutte: se la
        // frase dice che la cosa è nella risposta («te l'ho scritto qui
        // sotto», «te l'ho messa in ordine alfabetico»), non esiste nessuno
        // strumento che possa averla fatta e non c'è niente da smentire.
        if (puntaAllaRisposta(testo, fine)) continue;
        return {
          frase: frasePiena(testo, m.index, fine),
          clausola: clausolaDi(testo, m.index, fine),
          verbo: verboDi(m[0]),
        };
      }
    }
    return null;
  }

  // La sola PROPOSIZIONE in cui sta la dichiarazione. La frase intera serve a
  // farla leggere all'utente; per capire se la cosa esiste davvero serve solo
  // il pezzo che la dichiara. Senza, in «Ho messo la sveglia alle 19, e te
  // l'ho segnata» l'ora della prima proposizione faceva da prova anche alla
  // seconda, che parla di un appunto.
  function clausolaDi(testo, da, a) {
    const pre = proposizionePrima(testo, da);
    const inizio = Math.max(0, da - pre.length);
    const dopo = testo.slice(a);
    STACCHI_DOPO.lastIndex = 0;
    const m = STACCHI_DOPO.exec(dopo);
    return testo.slice(inizio, m ? a + m.index : testo.length);
  }

  // Dalla dichiarazione alla frase intera in cui sta: «ho messo» da solo non
  // dice niente, «Ti ho messo una sveglia alle 19:00» sì.
  function frasePiena(testo, da, a) {
    const prima = testo.slice(0, da);
    // Il punto fra due cifre non chiude niente: tagliando lì, la frase
    // mostrata all'utente si fermava a «Ho messo la sveglia alle 19».
    let inizio = 0;
    const apre = new RegExp(FINE_FRASE.source, 'g');
    let m;
    while ((m = apre.exec(prima))) inizio = m.index + 1;
    const dopo = testo.slice(a);
    const fine = dopo.search(FINE_FRASE);
    const frase = testo.slice(inizio, fine >= 0 ? a + fine + 1 : testo.length).trim();
    return frase.length > 160 ? `${frase.slice(0, 157)}…` : frase;
  }

  // Un'azione che è stata CHIAMATA ma non ha fatto nascere niente non regge la
  // frase che la dà per fatta: la sveglia con l'orario che Filo non sa leggere
  // lasciava l'utente senza sveglia e senza avviso, che è esattamente la
  // lamentela del feedback. Restano buone le azioni che hanno prodotto
  // qualcosa (`_output`: una ricerca senza risultati è comunque partita), quelle
  // in attesa di un OK dell'utente e quelle che il main ha TENUTO (`_kept`):
  // l'evento di calendario, la pulizia delle schede e la cancellazione
  // dell'archivio non si eseguono da sole, mettono in chat un bottone che
  // l'utente preme. Filo ha fatto tutto quello che poteva fare, e senza questo
  // la sua risposta veniva buttata, rifatta e poi smentita.
  // Una sveglia CHIAMATA e non riuscita resta fuori: lì il main non tiene
  // niente (né bottone né riga), ed è la porta del giro 2.
  function haFattoQualcosa(a) {
    if (!a || typeof a !== 'object') return true;
    if (a._executed !== false) return true;
    return !!(a._output || a._confirm || a._kept);
  }

  // Le azioni CHIAMATE il cui effetto non c'è ancora: quelle in attesa
  // dell'OK dell'utente e quelle che il main ha TENUTO come bottone da
  // premere. Filo ha fatto tutto quello che poteva fare, ma la sveglia a
  // quell'ora ancora non esiste: lì l'ora non può fare da prova, o l'avviso
  // accuserebbe Filo di non aver fatto una cosa che sta aspettando l'utente.
  function tipiInAttesa(azioni) {
    const out = new Set();
    for (const a of (Array.isArray(azioni) ? azioni : [])) {
      if (!a || typeof a !== 'object') continue;
      if (!(a._confirm || (a._kept && a._executed === false))) continue;
      const t = String((a.type || a.tipo) || '').toUpperCase();
      if (t) out.add(t);
    }
    return out;
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
  function rileva(testo, azioni, stato, opzioni) {
    const t = String(testo || '');
    if (!t.trim()) return [];
    const presenti = (azioni instanceof Set) ? azioni : insiemeDiTipi(azioni);
    // Chi chiama può restringere le famiglie da guardare. Serve all'Aiuto,
    // che di Filo fa solo un pezzo: lì «ho aperto il menu» o «ho cercato sul
    // web» sono cose che quel pannello fa per strade sue, e accusarlo di non
    // averle fatte sarebbe il falso allarme di sempre.
    const ammesse = opzioni && opzioni.famiglie
      ? new Set(opzioni.famiglie instanceof Set ? [...opzioni.famiglie] : opzioni.famiglie)
      : null;
    const orari = new Set(Array.isArray(stato?.orariSveglie) ? stato.orariSveglie : []);
    const attesaDaStato = stato && stato.tipiInAttesa;
    const attesa = new Set(attesaDaStato
      ? (attesaDaStato instanceof Set ? [...attesaDaStato] : attesaDaStato)
      : tipiInAttesa(azioni));
    const titoli = Array.isArray(stato?.titoliAppunti) ? stato.titoliAppunti : [];
    // La cosa dichiarata ESISTE già, anche se in questo turno non è partito
    // niente? Vale per l'ora di una sveglia che c'è e per il titolo di un
    // appunto che c'è. Prima valeva solo per la sveglia, e solo se la frase
    // ripeteva la parola «sveglia» con l'ora in cifre.
    const esisteGia = (fam, d) => {
      const nominati = orariNelTesto(d.clausola || d.frase);
      if (fam.orari && orari.size && [...nominati].some((o) => orari.has(o))) return true;
      // Il titolo di un appunto che esiste regge la frase che lo nomina, ma
      // non una frase che promette un'ORA: un'ora è una sveglia, e un appunto
      // non la prova. Senza questa riga bastava tenere un appunto intitolato
      // «spesa» perché «ti ho messo il promemoria per la spesa alle 18»
      // passasse senza una parola, con nessun promemoria da nessuna parte.
      if (fam.appunti && titoli.length && !nominati.size && nominaUnAppunto(d.clausola || d.frase, titoli)) return true;
      return false;
    };
    // L'ORA DECIDE. Quando la frase promette una sveglia (o un timer) a
    // un'ora precisa, la prova non è che in questa conversazione sia partita
    // un'azione di quel genere: è che a quell'ora la sveglia ci sia davvero.
    // Filo le sveglie ce le ha sotto gli occhi, con le loro ore.
    // Restituisce true (la frase è vera), false (manca) o null (qui l'ora non
    // decide: si torna alle azioni). Chi sposta o cancella resta fuori: dopo
    // «te l'ho cancellata alle 19» quell'ora NON deve esistere.
    const oraDecide = (fam, d) => {
      const creazione = fam.oreProva || (fam.pronome && VERBI_CHE_CREANO.has(d.verbo));
      if (!fam.orari || !creazione) return null;
      // Un'azione di questa famiglia sta aspettando l'utente: l'effetto non
      // c'è ancora, e l'ora non può fare da prova.
      if (attesa.size && (fam.pronome || fam.tipi.some((x) => attesa.has(x)))) return null;
      const nominati = orariNelTesto(d.clausola || d.frase);
      if (!nominati.size) return null;
      // TUTTE le ore nominate, non una: «ti ho messo la sveglia alle 19 e
      // quella alle 21» con una sola sveglia chiamata lasciava la seconda
      // senza niente e senza una parola.
      return [...nominati].every((o) => orari.has(o));
    };
    const out = [];
    // I tipi che stanno già reggendo una dichiarazione: un'azione sola non può
    // reggerne due diverse.
    const impegnati = new Set();
    // I verbi delle dichiarazioni già rette: servono a capire se il pronome
    // sta ripetendo la stessa cosa o ne sta nominando un'altra.
    const radiciRette = new Set();
    let pronome = null;
    for (const fam of FAMIGLIE) {
      if (ammesse && !fam.pronome && !ammesse.has(fam.id)) continue;
      const d = dichiarazione(t, fam);
      if (!d) continue;
      if (fam.pronome) { pronome = d; continue; }
      const ora = oraDecide(fam, d);
      if (ora === true) {
        // L'azione che l'ha fatta, se c'è, resta impegnata qui: non può
        // reggere anche la dichiarazione dopo, detta col pronome.
        for (const x of fam.tipi) if (presenti.has(x)) impegnati.add(x);
        if (d.verbo) radiciRette.add(d.verbo);
        continue;
      }
      if (ora === false) {
        out.push({ id: fam.id, avviso: fam.avviso, tipi: fam.tipi.slice(), frase: d.frase });
        continue;
      }
      const retta = fam.tipi.filter((x) => presenti.has(x));
      if (retta.length) {
        for (const x of retta) impegnati.add(x);
        if (d.verbo) radiciRette.add(d.verbo);
        continue;
      }
      // Nessuna azione: la cosa può esistere lo stesso.
      if (esisteGia(fam, d)) {
        if (d.verbo) radiciRette.add(d.verbo);
        continue;
      }
      out.push({ id: fam.id, avviso: fam.avviso, tipi: fam.tipi.slice(), frase: d.frase });
    }
    // Il pronome parla solo se nessuna famiglia ha già saputo dire di cosa si
    // tratta, e se non è rimasta nessuna azione libera a reggerlo. Se la
    // dichiarazione col pronome ripete lo stesso verbo di una già retta («ho
    // messo la sveglia… te l'ho messa alle 19»), è lo stesso fatto detto due
    // volte, non un secondo fatto mai successo.
    // «Libera» non vuol dire «qualunque»: un'azione che si limita a guardare
    // (una ricerca, una lettura) e un segno di contesto non possono essere la
    // cosa che l'utente si sente confermare. Bastava una ricerca nello stesso
    // turno — o un appunto aperto nell'editor — perché il pronome non venisse
    // più guardato affatto, ed è il turno di prosecuzione della segnalazione.
    if (pronome && !out.length && !(ammesse && !ammesse.has('senza-nome'))) {
      const PRONOME = FAMIGLIE[FAMIGLIE.length - 1];
      const manca = { id: 'senza-nome', avviso: 'non è partito niente', tipi: [], frase: pronome.frase };
      // Anche qui l'ora decide, quando c'è e quando il verbo crea qualcosa:
      // «te l'ho messa alle 19», con la sveglia delle 19 che non esiste, è
      // falsa anche se in questa conversazione una sveglia era già partita.
      const ora = oraDecide(PRONOME, pronome);
      if (ora === false) { out.push(manca); return out; }
      if (ora === true) return out;
      const libere = [...presenti].some((x) => !impegnati.has(x) && !NON_REGGONO_IL_PRONOME.has(x));
      const ripete = pronome.verbo && radiciRette.has(pronome.verbo);
      if (!libere && !ripete && !esisteGia(PRONOME, pronome)) out.push(manca);
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
  // Il nome dello strumento dentro un involucro JSON, quando c'è.
  function tipoDichiarato(s) {
    const m = String(s).match(/"type"\s*:\s*"([A-Za-z_]{3,})"/);
    return m ? m[1].toUpperCase() : '';
  }

  function involucro(s, nomi) {
    if (!s) return false;
    // Il vecchio involucro del protocollo, o un oggetto vuoto al posto della
    // risposta: in chat sono un blocco di codice e basta. La graffa di chiusura
    // non si pretende: un involucro tagliato a metà è comunque un turno buttato.
    if (/^\{/.test(s)) {
      if (/"(?:text|actions)"\s*:/.test(s)) return true;
      // Il solo `"type"` non basta: un JSON qualunque può averlo, e l'utente
      // che chiede «scrivimi un JSON» si vedeva buttare la risposta. Il nome
      // si confronta con quelli veri quando li abbiamo.
      const t = tipoDichiarato(s);
      if (t) return !nomi || nomi.has(t);
    }
    if (/^\{\s*\}$/.test(s)) return true;
    // Una lista di azioni scritta invece che chiamata.
    if (/^\[\s*\{[\s\S]*"type"\s*:/.test(s)) {
      const t = tipoDichiarato(s);
      return !nomi || !t || nomi.has(t);
    }
    // La busta a tag dei modelli aperti. Quando finisce nel testo invece che
    // nel canale degli strumenti è lo stesso guasto: in chat resta un blocco
    // di codice e la sveglia non c'è. Il tag si nomina per esteso: un `<div>`
    // dentro una risposta non è una chiamata.
    if (/^<\s*\/?\s*(?:tool_call|tool▁call|tool_use|function_call|function_calls|invoke|antml:invoke)\b/i.test(s)) return true;
    // Le altre due buste dei modelli aperti: quella a parentesi quadre dei
    // Mistral e quella fra barre verticali. Da sole non venivano riconosciute,
    // e in chat restava un blocco di codice con dentro la sveglia che non c'è.
    if (/^\[TOOL_CALLS\]/i.test(s)) return true;
    if (/^<\|[^|>]{0,32}tool[^|>]{0,32}\|>/i.test(s)) return true;
    // Il nome di uno strumento con i suoi argomenti, anche preceduto dallo
    // spazio dei nomi che alcuni modelli ci mettono davanti
    // («functions.SVEGLIA({…})»). Il nome si confronta con quelli VERI quando
    // li abbiamo: senza, una parola tutta maiuscola con una parentesi dietro
    // passerebbe per una chiamata.
    const m = s.match(/^(?:(?:functions?|tools?)\s*\.\s*)?([A-Z][A-Z_]{3,})\s*(?:\{|\()/);
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

  // Dove comincia, dentro una riga, un pezzo di formato macchina. Le buste
  // esplicite valgono ovunque nella riga: «Ok. <tool_call>{…}</tool_call>»
  // sulla stessa riga della prosa è lo stesso turno buttato. Una graffa o una
  // quadra invece contano solo a inizio riga, perché in mezzo a una frase sono
  // punteggiatura.
  const BUSTE = /<\s*\/?\s*(?:tool_call|tool▁call|tool_use|function_call|function_calls|invoke|antml:invoke)\b|<\|[^|>]{0,32}tool[^|>]{0,32}\|>|\[TOOL_CALLS\]/i;

  // La chiamata NUDA appoggiata alla prosa, sulla stessa riga: «Fatto!
  // SVEGLIA({"ora":"19:00"})». Vale ovunque nella riga come le buste, perché
  // una parola tutta maiuscola seguita da una graffa non è punteggiatura. La
  // parentesi vuole la graffa subito dietro: senza, «il formato HTML (…)»
  // basterebbe a far scattare il controllo. Il nome poi lo confronta
  // `involucro` con quelli veri.
  const CHIAMATA_NUDA = /(?:(?:functions?|tools?)\s*\.\s*)?\b[A-Z][A-Z_]{3,}\s*(?:\{|\(\s*\{)/;

  function inizioFormato(riga, primaRigaLibera) {
    const busta = riga.search(BUSTE);
    if (busta >= 0) return busta;
    const nuda = riga.search(CHIAMATA_NUDA);
    if (nuda >= 0) return nuda;
    // Sulla prima riga, fuori da un recinto, l'inizio del testo l'ha già
    // guardato `nudo`: qui cercheremmo la stessa cosa due volte.
    if (primaRigaLibera) return -1;
    // Il segno di elenco davanti non cambia niente: «- {"type":…}» è la
    // stessa chiamata lasciata scritta, con un trattino davanti.
    const m = /^(\s*(?:(?:[-*•+]|\d+[.)])\s+)?)([[{]|(?:functions?|tools?)\s*\.\s*[A-Z]|[A-Z][A-Z_]{3,}\s*[{(])/.exec(riga);
    return m ? m[1].length : -1;
  }

  function formatoSospetto(testo, nomiStrumenti) {
    const grezzo = String(testo || '').trim();
    if (!grezzo) return false;
    const nomi = Array.isArray(nomiStrumenti) ? new Set(nomiStrumenti)
      : (nomiStrumenti instanceof Set ? nomiStrumenti : nomiDegliStrumenti());
    const righe = grezzo.split('\n');
    // Tutta la risposta è formato macchina, anche se recintata coi tre apici:
    // una risposta che è SOLO un involucro non è mai un esempio per l'utente.
    const nudo = grezzo.replace(/^```[a-z_]*\s*/i, '').replace(/```\s*$/, '').trim();
    if (involucro(nudo, nomi)) return true;
    // Il formato macchina in coda, dopo la risposta per l'utente. Si parte da
    // ogni riga che potrebbe aprirlo e si guarda da lì alla fine. Le righe
    // dentro un recinto di tre apici si guardano come le altre: un modello
    // abituato a recintare i blocchi di codice ci mette dentro anche la
    // chiamata, e prima bastavano tre apici perché il turno passasse intero.
    let recinto = false;
    let apertura = -1;
    for (let i = 0; i < righe.length; i++) {
      if (/^\s*```/.test(righe[i])) { recinto = !recinto; apertura = recinto ? i : -1; continue; }
      // Un esempio annunciato resta un esempio. Fuori dal recinto conta la
      // riga prima del pezzo; dentro, la riga prima dei tre apici.
      if (annunciatoComeEsempio(righe, recinto ? apertura : i)) continue;
      const da = inizioFormato(righe[i], i === 0 && !recinto);
      if (da < 0) continue;
      const coda = [righe[i].slice(da), ...righe.slice(i + 1)].join('\n')
        .trim().replace(/```[\s\S]*$/, '').trim();
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

  // Le famiglie che l'Aiuto — l'altra chat, il pannello sulla pagina — può
  // fare SOLO emettendo un'azione tipizzata di Filo, e che non lasciano
  // niente sullo schermo. Se il modello le racconta senza emetterle, non è
  // successo niente e nessuno se ne accorgerebbe.
  const FAMIGLIE_AIUTO = ['sveglia', 'timer', 'sveglia-tolta', 'sveglia-spostata',
    'promemoria', 'appunto', 'segnalazione', 'calendario', 'memoria-cancellata', 'schede'];

  global.SN_AZIONI_DICHIARATE = {
    FAMIGLIE,
    FAMIGLIE_AIUTO,
    TIPI_DI_CONTESTO,
    TIPI_DI_SOLA_LETTURA,
    rileva,
    insiemeDiTipi,
    tipiInAttesa,
    tipiDallaCronologia,
    orariNelTesto,
    formatoSospetto,
    spintaAzioniMancanti,
    spintaFormato,
    avvisoPerUtente,
    avvisoFormatoPerUtente,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
