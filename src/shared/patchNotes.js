// SINGOLA SORGENTE del recap aggiornamento (popup all'avvio) e del calcolo
// "quante patch sei indietro". Vedi CLAUDE.md → "Patch notes".
//
// Ogni volta che chiudi un fix o aggiungi una feature VISIBILE all'utente,
// aggiungi una riga al blocco della versione corrente (features/fixes), in
// italiano e NON tecnica. Le voci interne (refactor/test/infra) NON vanno qui.
//
// Formato (lista ordinata dalla versione PIÙ RECENTE alla più vecchia):
//   { version: '0.2.50', date: '2026-06-18',
//     features: ['Testo per l’utente…'],
//     fixes: ['Testo per l’utente…'] }

(function (global) {
  'use strict';

  const NOTES = [
    // ↓ Nuove versioni in cima.
    {
      version: '0.2.128', date: '2026-07-13',
      features: [],
      fixes: [
        'Rafforzata la protezione quando chiedi a Filo di modificare l\'aspetto di una pagina: il controllo che impedisce al CSS generato di avviare richieste di rete nascoste non è più aggirabile con sintassi camuffate.',
        'In modalità terminale, i comandi che cambiano lo stato del sistema (come impostare l\'orologio o rinominare il computer) ora chiedono conferma prima di partire, invece di essere eseguiti al volo come una semplice lettura.',
      ],
    },
    {
      version: '0.2.127', date: '2026-07-13',
      features: [
        'Ora puoi scegliere il modello AI anche per le funzioni dei mazzi (chat di ricerca carte, parere su una carta, etichette automatiche), sia nelle Opzioni sia nei modelli predefiniti condivisi.',
      ],
      fixes: [
        'Risolto un errore («flash is not a valid model ID») che poteva bloccare le funzioni AI senza modello personalizzato: ora tornano a usare correttamente i modelli integrati di riserva.',
        'Il salvataggio delle impostazioni e della sessione su disco non va più in errore quando molte modifiche arrivano ravvicinate: prima alcune scritture potevano andare perse.',
      ],
    },
    {
      version: '0.2.126', date: '2026-07-12',
      features: [],
      fixes: [
        '"Salva immagine come…" ora funziona anche sulle immagini dei siti che rifiutano i download "anonimi" (protezione hotlink): la richiesta presenta la pagina di provenienza, come farebbe un browser normale.',
        'Se il salvataggio di un\'immagine si interrompe a metà (connessione instabile o server che tronca il file), ora ricevi un messaggio d\'errore invece di nessun riscontro.',
      ],
    },
    {
      version: '0.2.125', date: '2026-07-11',
      features: [],
      fixes: [
        '"Salva immagine come…" ora scarica davvero l\'immagine anche quando è ospitata su un altro sito (prima la scheda finiva sull\'immagine a schermo intero senza salvare nulla). A salvataggio completato compare una conferma.',
      ],
    },
    {
      version: '0.2.124', date: '2026-07-11',
      features: [],
      fixes: [
        'Se il servizio AI si interrompe a metà risposta (spiegazioni, traduzioni, spiegazione link), Filo ora riparte da zero con quello di riserva: niente più risposte "incollate" con un pezzo troncato seguito dalla risposta completa.',
      ],
    },
    {
      version: '0.2.123', date: '2026-07-11',
      features: [],
      fixes: [
        'Il popup con cui Filo ti chiede conferma per le azioni sensibili è ora blindato: gli script delle pagine web non possono più vederlo né premere "OK" al posto tuo.',
      ],
    },
    {
      version: '0.2.122', date: '2026-07-11',
      features: [],
      fixes: [
        'Rafforzata ancora la sicurezza: anche quando un\'azione interna di Filo cambia l\'indirizzo di una scheda già aperta, ora vengono bloccati i tentativi di caricare percorsi di file locali o altri schemi non sicuri.',
      ],
    },
    {
      version: '0.2.117', date: '2026-07-09',
      features: [
        'Nella dashboard di gestione ogni feedback ora mostra la conversazione completa: il testo originale, il tuo eventuale commento di approvazione, i report di chi ha implementato e l\'esito dei controlli di verifica, ognuno nella sua bolla.',
        'I feedback in lavorazione salgono in cima alla lista "In coda" e mostrano a che punto sono: implementazione, controllo funzionalità e controllo sicurezza, con l\'indicazione se un\'istanza ci sta lavorando in quel momento.',
      ],
      fixes: [],
    },
    {
      version: '0.2.114', date: '2026-07-05',
      features: [],
      fixes: [
        'Rafforzata la sicurezza: alcune azioni interne di Filo (menu del tasto destro, apertura di nuove schede) ora bloccano i tentativi di aprire percorsi di file locali o altri schemi non sicuri, invece di lasciarli passare.',
      ],
    },
    {
      version: '0.2.113', date: '2026-07-05',
      features: [
        'Nell\'app Mazzi puoi importare/esportare un mazzo come lista di testo (dal menu del mazzo): incolli una lista tipo "1 Sol Ring" per riga, Filo mostra un\'anteprima di conferma con le carte riconosciute prima di aggiungerle, segnalando quelle che non ha capito. L\'export genera lo stesso formato, pronto da copiare.',
        'Puoi anche incollare una lista di carte direttamente in chat, anche scritta male o con nomi in italiano: Filo la riconosce, propone l\'elenco da confermare e un tasto per aggiungerle tutte al mazzo in un colpo solo.',
      ],
      fixes: [],
    },
    {
      version: '0.2.111', date: '2026-07-04',
      features: [],
      fixes: [
        'Corretto un problema che poteva far fallire l\'accesso con "Continua con Google" (o altri provider come Microsoft/GitHub) su alcuni siti.',
        'Nelle Opzioni, aggiungere un modello senza nickname (o con un nickname già usato) non fa più sparire la riga in silenzio: ora viene evidenziata con una spiegazione, e la conferma di salvataggio lo segnala invece di dare un falso "Salvato".',
      ],
    },
    {
      version: '0.2.109', date: '2026-07-04',
      features: [
        'Nell\'app Mazzi il riquadro sotto l\'anteprima della carta è diventato modulare: col tasto destro scegli cosa mostra — dati della carta, mini curva di mana con evidenziato dove cadrebbe la carta, prezzo con ristampe e legalità, o il parere di Filo. Funziona anche nel carosello.',
        'Arriva il parere di Filo sulle carte: col modulo attivo, al passaggio del mouse Filo giudica la carta rispetto al TUO mazzo (sinergie, curva, ridondanze). I pareri vengono ricordati; se poi modifichi il mazzo restano leggibili con un pallino "da aggiornare" e un tasto per rigenerarli. In chat "valuta il mazzo" prepara i pareri di tutte le carte più una sintesi complessiva.',
        'Auto-tag del mazzo dalla chat: scrivi "tagga il mazzo con ramp, draw, removal" e Filo assegna i tag carta per carta. I giudizi già dati vengono ricordati anche per gli altri mazzi, e i tag alimentano raggruppamento, calcolatore di probabilità e richieste come "il ramp di mazzo X".',
      ],
      fixes: [],
    },
    {
      version: '0.2.108', date: '2026-07-04',
      features: [
        'Nell\'app Mazzi il pannello destro ora mostra le statistiche complete del mazzo: curva di mana con costo medio, mana richiesto e prodotto per colore, composizione per tipo con totale su 100 e i check di legalità Commander (singleton, colori, carte bandite).',
        'Arriva il budget del mazzo: imposti un tetto in euro dal menu del mazzo o scrivendolo in chat ("budget 40 euro"), e totale speso e residuo restano sempre in vista — con lo sforamento evidenziato in rosso.',
        'Nuovo calcolatore di probabilità: chiedi "che probabilità ho di avere 2 ramp e 3 terre al turno 10?" in chat, o usa il pannello dentro le statistiche. Le categorie sono i tag delle tue carte (più le terre), e il calcolo è istantaneo e gratuito.',
      ],
      fixes: [],
    },
    {
      version: '0.2.107', date: '2026-07-03',
      features: [],
      fixes: [
        'Nella dashboard di gestione i pallini della priorità ora si riempiono davvero: prima restavano sempre vuoti anche quando la priorità era impostata.',
        'I giudici dei feedback non saltano più il voto: i modelli che "ragionano" prima di rispondere venivano tagliati e il feedback restava non valutato (bianco). Ora hanno lo spazio per finire, e anche la priorità automatica e il commento di Filo arrivano più affidabilmente.',
      ],
    },
    {
      version: '0.2.106', date: '2026-07-03',
      features: [
        'Nell\'app Mazzi il pannello di destra prende vita: passa il mouse su una carta — nei risultati di ricerca, nel mazzo o su un nome citato in chat — e vedi subito l\'immagine con prezzo, tag e se è già nel mazzo. Cliccala e si apre il carosello per valutare le carte una a una: frecce per scorrere, Invio o Spazio per aggiungere/rimuovere (la carta entra subito nel gruppo giusto del mazzo), Esc per chiudere. Tasto destro sul riquadro sotto l\'anteprima per scegliere cosa mostrare.',
      ],
      fixes: [],
    },
    {
      version: '0.2.105', date: '2026-07-03',
      features: [
        'Nell\'app Mazzi arriva la chat con Filo: scrivi una ricerca secca ("draghi rossi") o una frase ("modi per dare fretta alle creature") e ottieni una lista di carte, già filtrata sui colori del tuo commander. Ogni riga ha un tasto per aggiungere o togliere la carta dal mazzo al volo; le liste vecchie si richiudono in una riga di sintesi e si riaprono con un click. Puoi anche chiedere pareri sul mazzo o pescare carte da un altro tuo mazzo ("il ramp del mazzo X").',
      ],
      fixes: [],
    },
    {
      version: '0.2.104', date: '2026-07-03',
      features: [
        'Nella dashboard di gestione puoi approvare in blocco tutti i feedback allineati con un solo click: entrano subito nella coda di lavoro.',
        'Puoi confermare un attacco o uno spam segnalato: esce dai Ricevuti e resta consultabile negli Archiviati sotto il nuovo filtro "Bloccati confermati".',
      ],
      fixes: [
        'La coda di lavoro dei feedback e la dashboard ora vedono la stessa lista: un feedback approvato è davvero in coda e viene lavorato, senza più code "fantasma".',
      ],
    },
    {
      version: '0.2.103', date: '2026-07-02',
      features: [
        'Nell\'app Mazzi il banco di lavoro prende forma: tre colonne (ricerca, mazzo, statistiche) con divisori che puoi trascinare a piacere — la disposizione viene ricordata. Cliccando sul nome del mazzo si apre il menu di gestione: cambia mazzo, nuovo, duplica, rinomina, budget, elimina.',
        'La colonna del mazzo mostra le carte con i simboli di mana ufficiali, raggruppate per tipo (o per tag, costo, colore) in gruppi richiudibili. Tasto destro su una carta per rimuoverla, spostarla di gruppo o in un altro mazzo, nominarla commander o aprirla su Scryfall. L\'app avvisa se qualcosa non è legale in Commander (doppioni, carte fuori colore, carte bandite).',
      ],
      fixes: [],
    },
    {
      version: '0.2.102', date: '2026-07-02',
      features: [
        'Nuova app "Mazzi" (nel menu App): la libreria dei tuoi mazzi Commander di Magic — crea, duplica, rinomina ed elimina mazzi. La costruzione con ricerca carte, statistiche e chat arriverà nelle prossime versioni.',
      ],
      fixes: [
        'Il tasto destro sulle schede archiviate torna ad aprire il loro menu (Riapri/Elimina) invece del menu generale di Filo.',
      ],
    },
    {
      version: '0.2.101', date: '2026-07-02',
      features: [
        'Nell\'archivio delle tab, le schede chiuse sono ora raggruppate per giorno in righe orizzontali compatte: tasto destro su una scheda per riaprirla o eliminarla.',
      ],
      fixes: [],
    },
    {
      version: '0.2.97', date: '2026-07-01',
      features: [],
      fixes: [
        'In "Bacheca", se voti un miglioramento o segnali "Ancora rotto?" senza aver fatto l\'accesso, ora basta accedere una volta sola: l\'azione si completa da sola, senza doverla ripetere.',
      ],
    },
    {
      version: '0.2.96', date: '2026-06-30',
      features: [
        'Nella dashboard di gestione i feedback su cui tutti i giudici sono d\'accordo (allineati) ora hanno un bordo blu, così li riconosci a colpo d\'occhio.',
        'Puoi approvare un feedback allineato e metterlo in coda con un pulsante dedicato, senza dover attivare la modalità automatica.',
      ],
      fixes: [
        'Attivando la modalità automatica ora anche i feedback allineati già ricevuti in precedenza passano in coda (prima restavano nei Ricevuti); disattivandola tornano in attesa di approvazione.',
      ],
    },
    {
      version: '0.2.94', date: '2026-06-30',
      features: [
        'Nella dashboard di gestione, i feedback "In coda" mostrano ora la priorità con dei pallini e puoi cambiarla con un clic: la coda si riordina mettendo per prima la priorità più alta.',
        'Nella tab Automazioni puoi ora impostare il "Timeout dei giudici" (in secondi): se usi modelli che ragionano a lungo, alza il valore così fanno in tempo a rispondere e i feedback non restano "non filtrati".',
      ],
      fixes: [
        'Ri-valutare i feedback "non filtrati" ora dice la verità: conta solo i feedback in cui un giudice mancante ha davvero votato e non li segna più come "valutati" se sono rimasti senza verdetto. Se i giudici continuano a non rispondere si ferma da solo, invece di spendere altri crediti a vuoto, e ti avvisa che probabilmente c\'è un problema di modelli o di credito.',
        'Resi coerenti i colori dei verdetti dei giudici nella dashboard di gestione: scala rosso → giallo → verde → blu (attacco, spam, design, allineato). Ora i pallini, il bordo della scheda e le etichette usano lo stesso colore per la stessa classe.',
        'Quando i giudici non riescono a valutare un feedback, la dashboard ora dice il motivo preciso (credito OpenRouter esaurito, chiave non valida, provider sovraccarico, modello inesistente o timeout) invece di un messaggio generico, e non spreca tempo a ritentare gli errori che non si risolvono da soli (come il credito esaurito).',
      ],
    },
    {
      version: '0.2.93', date: '2026-06-29',
      features: [
        'Nella dashboard di gestione, ri-valutare i feedback "non filtrati" ora procede uno alla volta e mostra un\'animazione sul feedback che i giudici stanno valutando in quel momento.',
      ],
      fixes: [],
    },
    {
      version: '0.2.89', date: '2026-06-28',
      features: [
        'La schermata dei modelli di supporto ora ti fa configurare i giudici di sicurezza come i "Modelli predefiniti": imposti una chiave dedicata (diversa da quelle del resto di Filo), dai un nickname ai modelli che i giudici possono usare e scegli quale modello usa ogni giudice.',
      ],
      fixes: [],
    },
    {
      version: '0.2.76', date: '2026-06-24',
      features: [
        'Votare nella "Bacheca" ora premia: il primo voto ✅/❌ su ogni miglioramento ti regala 10 crediti, con una piccola animazione.',
        'Nella "Bacheca" puoi segnalare con "Ancora rotto?" un miglioramento che in realtà non funziona: la segnalazione torna in lavorazione collegata all\'originale (costa pochi crediti, per evitare segnalazioni a caso).',
        'Filo ora segnala automaticamente quando non riesce a fare qualcosa che gli chiedi: nessun URL o testo personale, solo una nota anonima a chi sviluppa l\'app. Puoi disattivarlo in Impostazioni → Sicurezza. Tenerlo attivo ti regala 10 crediti extra al giorno.',
      ],
      fixes: [],
    },
    {
      version: '0.2.75', date: '2026-06-24',
      features: [
        'Nuova "Bacheca": ritrovi i miglioramenti già rilasciati e puoi dire con un tocco se funzionano o no. La trovi nel menu App.',
      ],
      fixes: [],
    },
    {
      version: '0.2.71', date: '2026-06-23',
      features: [
        'Quando chiedi all’assistente «puoi fare…?» o «come si fa…?», ora risponde in modo affidabile su cosa Filo sa (e non sa) fare, con le indicazioni giuste su come usarlo.',
      ],
      fixes: [],
    },
    {
      version: '0.2.69', date: '2026-06-22',
      features: [
        'Nella dashboard di gestione c’è ora un interruttore "Modalità automatica" sempre in vista, per attivare o disattivare al volo l’operatività automatica di Filo.',
      ],
      fixes: [],
    },
    {
      version: '0.2.68', date: '2026-06-22',
      features: [
        'Nuova dashboard di gestione: puoi vedere in un colpo d’occhio i feedback bloccati dal sistema di sicurezza, con i dettagli dei giudici e il parere di Filo.',
      ],
      fixes: [
        'Nell’editor il conteggio di parole e caratteri ora è corretto anche quando il testo va a capo o è su più paragrafi o elenchi: prima le parole a cavallo di un a-capo venivano fuse e contate come una sola.',
      ],
    },
    {
      version: '0.2.66', date: '2026-06-21',
      features: [
        'Nuova sezione Red-team: metti alla prova i giudici di sicurezza di Filo. La apri dall’icona in alto a destra nella home (ora in rosso) e invii i tuoi attacchi dal menu del tasto destro.',
        'Puoi diventare red teamer verificato: inserisci nella sezione Red-team il codice di invito che hai ricevuto e si lega al tuo account, sbloccando statistiche e leaderboard.',
      ],
      fixes: [],
    },
    {
      version: '0.2.58', date: '2026-06-19',
      features: [],
      fixes: [
        'Nei "Siti fidati" (Impostazioni → Sicurezza, Privacy massima), se scrivi qualcosa che non è un dominio valido ora compare un avviso che lo spiega, invece di sparire in silenzio senza aggiungere nulla.',
      ],
    },
    {
      version: '0.2.53', date: '2026-06-18',
      features: [],
      fixes: [
        'L’icona Home del menu del tasto destro ora ti riporta davvero alla home, sostituendo la pagina su cui sei (prima apriva la lista "Aperti per dopo").',
        'Durante una lettura ad alta voce, "Interrompi lettura" compare nel menu del tasto destro di qualsiasi scheda — non solo di quella dove la lettura è partita — e da lì puoi fermarla.',
        'Rafforzata la protezione dei tuoi dati: le chiavi dei servizi AI sono ora salvate cifrate e i siti che visiti non possono raggiungere i file del tuo computer.',
        'I link email (mailto:) e telefono (tel:) nelle pagine ora aprono il tuo programma di posta o avviano la chiamata, invece di non fare nulla.',
        'Se un link che Filo sta per aprire contiene tuoi dati personali, ora ti chiede conferma mostrandoti l’indirizzo completo, così una pagina malevola non può fartene uscire di nascosto.',
      ],
    },
    {
      version: '0.2.52', date: '2026-06-18',
      features: [
        'Quando attivi la modalità terminale, Filo può svolgere compiti a più passi da solo: esegue un comando, ne legge l’output e prosegue col successivo finché non ha finito, senza che tu debba rilanciarlo ogni volta. Sui comandi rischiosi chiede comunque conferma.',
        'Se ricevi crediti in regalo, Filo te lo comunica con un avviso all’apertura (una volta sola).',
      ],
      fixes: [
        'Concatenare comandi sicuri (come spostarsi in una cartella ed elencarne subito il contenuto) non chiede più la conferma riservata alle azioni irreversibili: la richiesta scatta solo se almeno un comando della sequenza è davvero rischioso.',
      ],
    },
    {
      version: '0.2.51', date: '2026-06-18',
      features: [],
      fixes: [
        'Ora puoi scegliere un modello OpenRouter che legge le immagini (es. una "vision") per la descrizione delle immagini: prima veniva rifiutato anche quando era adatto.',
      ],
    },
    {
      version: '0.2.50', date: '2026-06-17',
      features: [
        'Quando Filo si aggiorna ti mostra un recap delle novità e delle correzioni, con un pulsante per condividerlo.',
        'Quando un tuo feedback viene risolto, Filo ti ringrazia, ti spiega cosa è cambiato e ti premia con crediti in base alla priorità.',
        'Mentre Filo pensa nella nuova scheda, ora scorre il suo ragionamento reale (per i modelli che lo forniscono), non più frasi generiche.',
        'Ora puoi zoomare le pagine web tenendo Ctrl e usando la rotella o pizzicando il trackpad, oppure con Ctrl + / Ctrl - / Ctrl 0.',
      ],
      fixes: [
        'I comandi eseguiti da Filo e le loro risposte ora si vedono sempre, in riquadri ben leggibili: i comandi senza output (come spostarsi tra cartelle) mostrano dove sei finito.',
        'Nelle impostazioni, il menu per scegliere il modello ora ha lo stile di Filo invece dei colori grigi di sistema, coerente con gli altri menu a tendina.',
        'Le schede che riproducono audio ora si riconoscono di nuovo a colpo d’occhio: bagliore del colore del sito e icona dell’altoparlante a fine scheda (prima non comparivano).',
        'Il login con Google (e altri "Continua con…") nei siti aperti in Filo ora funziona: la finestra di accesso non viene più scambiata per un popup pubblicitario e bloccata.',
        'Il correttore ortografico ora suggerisce in italiano e non più parole inglesi a caso sulle parole italiane.',
      ],
    },
    {
      version: '0.2.49', date: '2026-06-17',
      features: [
        'Nuova pagina Crediti nel profilo: vedi il saldo e un grafico di come hai usato i crediti.',
        'Ogni feedback che invii ti regala 5 crediti: le monete volano verso il tuo profilo.',
      ],
      fixes: [],
    },
  ];

  // Confronto versioni stile semver leggero ('0.2.49' vs '0.2.5' → corretto).
  function cmpVersion(a, b) {
    const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  // Note delle versioni STRETTAMENTE successive a `lastSeen` (escluso), fino a
  // `current` incluso. Se `lastSeen` è nullo/assente → tutte (primo avvio non
  // mostra nulla a sorpresa: lo decide il chiamante). Ordinate dalla più recente.
  function since(lastSeen, current = latestVersion()) {
    return NOTES
      .filter((n) => cmpVersion(n.version, current) <= 0
        && (!lastSeen || cmpVersion(n.version, lastSeen) > 0))
      .sort((x, y) => cmpVersion(y.version, x.version));
  }

  // Quante "patch" (versioni con note) separano lastSeen da current.
  function countBehind(lastSeen, current = latestVersion()) {
    return since(lastSeen, current).length;
  }

  function latestVersion() {
    return NOTES.length ? NOTES[0].version : '0.0.0';
  }

  global.SN_PATCH_NOTES = { NOTES, cmpVersion, since, countBehind, latestVersion };
})(typeof globalThis !== 'undefined' ? globalThis : self);
