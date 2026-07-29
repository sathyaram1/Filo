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
      version: '0.2.165', date: '2026-07-29',
      features: [
        'Ora Filo conosce i tuoi documenti dell’editor senza doverli avere tutti sotto gli occhi: ogni file tiene un riassunto di un paio di righe che si scrive da solo dal contenuto e resta aggiornato mentre lavori. Quando parli con Filo, lui vede il riassunto di ogni file (appunti inclusi) e, se per risponderti gli serve davvero un documento per intero, se lo apre e lo legge al momento. Col tasto destro sul titolo di un documento puoi anche rigenerare il riassunto quando vuoi.',
      ],
      fixes: [
        'Accedere alle app Google in cui sei loggato (Documenti, Fogli, Drive, Gmail, Calendar…) è più affidabile: su queste pagine Filo non applica più il proprio disturbo anti-tracciamento, che lì non ti protegge da nulla (sei già identificato dal tuo account Google) ma poteva far scattare il blocco «questo browser o questa app potrebbero non essere sicuri». La protezione anti-tracciamento resta piena su tutto il resto, ricerca Google compresa.',
      ],
    },
    {
      version: '0.2.164', date: '2026-07-25',
      fixes: [
        'Nella dashboard di gestione i feedback con una conversazione molto lunga tornano a essere gestibili: prima, superata una certa lunghezza, il server rifiutava qualsiasi modifica e il feedback restava bloccato — non lo si poteva spostare di stato, commentare né archiviare, e l’errore dava la colpa ai permessi di amministratore. Ora la conversazione ha un tetto molto più alto, i turni più vecchi vengono accorciati automaticamente quando serve (con una riga che lo dichiara) e, se una modifica viene comunque rifiutata, il messaggio dice il motivo giusto.',
      ],
    },
    {
      version: '0.2.163', date: '2026-07-25',
      features: [
        'Gli appunti ora vivono nell’editor invece che in un elenco a parte: quando chiedi a Filo di prendere nota, lo scrive lui stesso in un file di testo. Continua sullo stesso file finché resti sull’argomento e ne apre uno nuovo quando l’argomento cambia (o se dici «apri un nuovo appunto»). Così gli appunti diventano testo vero, che puoi rileggere, modificare e riordinare come qualsiasi documento, e ogni scrittura automatica è annullabile. I tuoi appunti già salvati vengono spostati in un file «Appunti» dell’editor, senza perderli.',
        'Nell’editor i documenti senza nome prendono un titolo da soli: quando il testo supera un centinaio di parole, Filo propone un titolo basato sul contenuto. Il titolo resta modificabile a mano, e col tasto destro sul titolo apri un menu per rigenerarlo, rinominarlo, duplicare o eliminare il documento.',
      ],
    },
    {
      version: '0.2.162', date: '2026-07-25',
      features: [
        'Nell’editor, ogni volta che Filo modifica da solo un documento (per esempio quando chiedi alla chat di formattare il testo) crea un punto di ripristino: compare un breve avviso con «Annulla» per tornare subito com’era. Ogni documento tiene il suo storico, che resta disponibile anche dopo aver chiuso e riaperto Filo, così una modifica automatica è sempre reversibile.',
        'Ora puoi tornare alla pagina precedente premendo Ctrl+Z, come alternativa alla freccia «Indietro». Mentre scrivi in un campo di testo Ctrl+Z resta «annulla», così non perdi mai la possibilità di correggere ciò che stai scrivendo.',
      ],
    },
    {
      version: '0.2.161', date: '2026-07-24',
      features: [
        'L’editor ora gestisce più documenti separati invece di uno solo: dal selettore in alto a sinistra puoi creare un nuovo documento, passare dall’uno all’altro, rinominarli ed eliminarli. Ogni documento tiene il suo testo, i suoi commenti e i suoi moduli, e alla riapertura ritrovi l’ultimo su cui stavi lavorando. Il documento che avevi finora diventa automaticamente il primo della lista, senza perdere nulla.',
        'Nella pagina «Modelli predefiniti» ogni modello ha ora un livello di ragionamento regolabile: puoi lasciarlo su «Auto» (decide il modello, come prima), chiedere «Nessuno» per risposte più rapide ed economiche, oppure «Basso/Medio/Alto» per uno sforzo di ragionamento crescente sui modelli che lo supportano.',
      ],
      fixes: [
        'Nell’editor le scorciatoie da tastiera dei moduli con i tasti numerici ora funzionano anche premendo Shift: ad esempio «Ctrl+Shift+1» attiva davvero il modulo. Prima queste combinazioni non venivano riconosciute.',
        'Quando Filo non è ancora attivo, il messaggio nella home ora ti invita prima di tutto ad accedere con un profilo (è gratis e non richiede alcuna chiave), lasciando la chiave API personale come alternativa per chi la preferisce. Prima suggeriva solo di impostare una chiave, un passaggio tecnico che la maggior parte delle persone non desidera.',
        'Nella dashboard di gestione le immagini allegate ai feedback ora si vedono: la conversazione le mostra come anteprime cliccabili (il clic le apre a schermo intero) invece di lasciare un riquadro vuoto. Se un’immagine non può essere mostrata, passandoci sopra col mouse compare il motivo.',
        'Nel Deck builder MTG il calcolatore di probabilità si aggiorna da solo: appena cambi il turno, le categorie richieste o il mazzo, la stima parte subito e continua a raffinarsi per un istante convergendo verso il valore vero, poi si ferma. Non c’è più il bottone «Calcola» e la percentuale non oscilla più a ogni ricalcolo. Un puntino accanto al risultato pulsa mentre la stima si sta ancora affinando.',
        'Nel Deck builder MTG, dentro il calcolatore di probabilità i nomi delle categorie ora si leggono per intero: il campo dove scrivi quante carte ti servono occupa uno spazio più contenuto e lascia il posto all’etichetta, anche quando allarghi il pannello delle statistiche.',
        'Il Deck builder MTG ora riempie tutta la pagina: sparita la cornice che lo racchiudeva e lo spazio vuoto ai bordi, le tre colonne (chat, mazzo, statistiche) arrivano fino ai margini dello schermo, separate solo dai divisori verticali che puoi ancora trascinare.',
      ],
    },
    {
      version: '0.2.160', date: '2026-07-24',
      features: [
        'Nella dashboard di gestione c’è una nuova ricerca «a senso»: la lente in alto a destra apre un campo dove descrivere con parole tue il feedback che cerchi, anche con un ricordo vago e non con le parole esatte usate all’epoca. Filo capisce il significato e ti mostra i feedback più pertinenti, ordinati per rilevanza e presi da qualunque scheda (Ricevuti, In coda, Risolti, Archiviati). Cliccando un risultato si apre la conversazione; con la «×» o il tasto Esc chiudi la ricerca e torni alla lista. Se il modello non è disponibile, la ricerca ripiega automaticamente sulle parole così trovi comunque qualcosa.',
      ],
      fixes: [
        'Salvare un’immagine da una pagina web ora funziona davvero: con «Salva immagine come…» dal clic destro il file viene scaricato e si apre la finestra per scegliere dove metterlo, con una conferma a salvataggio riuscito. Prima, per le immagini ospitate su un sito diverso da quello della pagina (cioè quasi tutte), la scheda abbandonava la pagina e mostrava solo l’immagine, senza scaricare nulla. Ora vengono salvate anche le immagini dei siti che le proteggono dal collegamento esterno, e se il download non riesce (immagine irraggiungibile o connessione interrotta) te lo dice invece di restare in silenzio.',
        'Sull’avviso a schermo intero «Sito pericoloso», il pulsante «Torna indietro» ora ti fa davvero uscire dal sito anche quando l’avviso compare in una scheda appena aperta (senza una pagina precedente su cui tornare). Prima, in quel caso, premere «Torna indietro» aveva lo stesso effetto di confermare il sito: veniva marcato come sicuro per quella scheda, così se lo stesso dominio si ripresentava (per un redirect o un link) l’avviso di pericolo non compariva più.',
      ],
    },
    {
      version: '0.2.159', date: '2026-07-24',
      fixes: [
        'Inviare un feedback non crea più doppioni: se l’invio sembrava fallito (es. connessione lenta) ma in realtà era andato a buon fine, ripremere «Invia» non aggiunge più una seconda, terza o quarta copia dello stesso messaggio. Se invece modifichi il testo o gli allegati prima di reinviare, resta un messaggio distinto. In più, ora l’app attende più a lungo prima di segnalare un problema di rete, così un invio lento ma riuscito ti mostra il vero esito.',
        'Il riordino delle schede ora chiude anche le pagine interne di troppo, non solo i siti: le schede «Nuova scheda»/home aperte più volte vengono collassate in una sola e le pagine di impostazioni che non stai più usando vengono chiuse (restano sempre raggiungibili). Prima venivano toccati solo i siti web, quindi capitava che chiudesse un sito lasciando aperte home doppie e impostazioni.',
        'Nella pagina Crediti un uso leggero di Filo ora si vede: se hai consumato solo frazioni di credito, il grafico e il saldo lo mostrano (es. «0,3» crediti) invece di dire «Non hai ancora consumato crediti» e lasciare il saldo fermo.',
        'Nel menu App le voci «Deck builder MTG» (prima «Mazzi») e «Bacheca» hanno di nuovo la loro icona, come tutte le altre voci: prima comparivano senza simbolo. La «Bacheca» ha un\'icona a lavagna, coerente con quello che è.',
      ],
    },
    {
      version: '0.2.158', date: '2026-07-24',
      fixes: [
        'In «Tab archiviate» il click sinistro su una scheda archiviata ora la riapre subito (come le card di «Aperti per dopo»); Invio da tastiera fa lo stesso, mentre il tasto destro (o Shift+F10) apre come prima il menu Riapri/Elimina.',
        'Salvando con «Salva per dopo» una pagina che avevi già salvato (e non ancora riaperto) non compaiono più due schede identiche in «Aperti per dopo»: la voce esistente viene aggiornata (con titolo e anteprima più recenti) e riportata in cima, senza doppioni da rimuovere a mano.',
        'I timer lunghi ora si leggono come un vero conto alla rovescia: un timer di 2 ore mostra «2:00:00» invece di «120:00», e uno di 8 ore «8:00:00» invece di «480:00». Anche il riquadro di conferma in chat indica la durata per esteso (es. «2 h», «1 h 30 min», «30 sec») invece di arrotondare ai minuti, così un timer di 30 secondi non appare più come «0 min».',
        'Nella Cronologia AI la casella «Cerca» ora cerca solo tra i testi che vedi davvero nelle voci (richiesta, risposta, tipo di azione, modello e indirizzo): non trova più parole «fantasma» come «selection», «title» o «url» che comparivano da nessuna parte e facevano restare visibili quasi tutte le voci.',
        'Nella Cronologia AI ora puoi rimuovere una singola voce: passando il mouse su una richiesta compare il tasto «Rimuovi», così puoi togliere un elemento privato o sbagliato senza dover svuotare tutto lo storico.',
        'Nell’Editor, assegnando una scorciatoia da tastiera a un modulo della griglia non è più possibile impostare una lettera singola senza un tasto modificatore (Ctrl o Alt): il campo ora lo segnala e non la salva, così quella lettera non viene più «rubata» mentre scrivi nel documento, in chat o nella casella cerca/sostituisci. Le scorciatoie di questo tipo eventualmente già salvate vengono comunque ignorate mentre stai scrivendo.',
        'Nell’Editor, il modulo che cambia pagina della griglia (le frecce ‹ ›) è ora un modulo unico e protetto: essendo l’unico modo per raggiungere le altre pagine, non si può più eliminare per sbaglio dalla modalità modifica né aggiungerne un secondo dalla lista dei moduli, così non resti bloccato né sulla prima pagina né con un doppione ingombrante che non puoi togliere.',
        'Nell’Editor, una sezione chiusa con la freccetta accanto al titolo ora resta chiusa mentre scrivi: prima, digitando un carattere qualsiasi, la freccia scattava in posizione «aperta» ma il testo restava nascosto e servivano due click per rivederlo. Ora la freccia dice sempre la verità e un solo click riapre la sezione; se aggiungi testo a una sezione chiusa, resta nascosto in modo coerente finché non la riapri.',
        'Quando Filo esegue comandi nel terminale, anche le opzioni meno comuni di scaricamento che salvano dati accessori su un file scelto (i cookie del sito, l’identificativo della risposta, una traccia di debug o il log dell’operazione) ora richiedono la conferma scritta riservata alle azioni delicate, non più il semplice clic: così un sito remoto non può far scrivere di nascosto in un file sensibile con una conferma leggera.',
        'Nella dashboard di gestione, un allegato con un nome file molto lungo senza spazi ora va a capo dentro la bolla invece di sbordare e far comparire una barra di scorrimento orizzontale nella conversazione.',
        '«Salva per dopo» ora registra la pagina all’istante: prima, se il sito si ricaricava o faceva un redirect nel decimo di secondo subito dopo il click, il salvataggio poteva perdersi in silenzio (nessuna conferma, nessuna scheda in «Aperti per dopo»). Ora la scheda viene salvata subito e l’anteprima si aggiunge dopo; se qualcosa va storto compare un avviso invece del silenzio.',
      ],
    },
    {
      version: '0.2.157', date: '2026-07-23',
      fixes: [
        'Le scorciatoie da tastiera per spiegare (Alt+E) e tradurre (Alt+T) il testo selezionato e per aprire la barra Aiuto (Alt+H) ora funzionano anche sulle schermate interne di Filo (Editor, Preferenze, Opzioni, Cronologia, Feedback, Bacheca…), dove prima restavano mute; anche la voce «Aiuto» del menu tasto destro sulla linguetta di una scheda interna ora apre la barra Aiuto.',
        'Importando un mazzo nel deck builder, una carta scritta con quantità 0 nella lista (es. «0 Sol Ring») non viene più aggiunta di nascosto con una copia: ora l’anteprima la segnala tra le righe non valide e la esclude dall’import.',
        'Quando chiedi a Filo di impostare un valore numerico scrivendolo all’italiana con il punto delle migliaia (es. «imposta il limite di spesa mensile a 2.500 euro»), ora capisce 2500 e non più 2,50: il punto delle migliaia non viene più scambiato per la virgola dei decimali.',
        'Trascinando una scheda per riordinarla, se in quell’istante una scheda cambiava stato (finiva di caricare, cambiava titolo, partiva o si fermava un audio, arrivava l’icona del sito) poteva comparire per un attimo una copia doppia della scheda trascinata e il riordino finiva in un punto diverso da dove l’avevi rilasciata: ora la scheda resta una sola e si ferma esattamente dove la lasci.',
        'Quando molte notifiche arrivano insieme (ad esempio una pagina che apre tanti popup bloccati, o il riavvio con più schede su siti bloccati) non si accatastano più fino a coprire lo schermo e a spingere le prime fuori dalla finestra: ora restano al massimo le più recenti, sempre visibili e con la «×» per chiuderle a portata di mano.',
        'Quando chiedi a Filo di inviare un feedback lungo agli sviluppatori a tuo nome, l’anteprima nel riquadro di conferma non mostra più un carattere rotto se un’emoji cade nel punto in cui il testo viene accorciato: ora l’emoji resta intera.',
        'Cliccando il suggerimento «Riordina e archivia le schede» nella schermata iniziale ora compare il popup di conferma di Filo, come già accade dal pulsante nella chat, e non più l’avviso grigio di sistema del browser.',
        'Nel deck builder, quando sposti a mano una carta in un altro gruppo (tasto destro → «Sposta in gruppo…»), lo spostamento ora vale solo nella vista in cui l’hai fatto: cambiando raggruppamento (per costo di mana, per colore…) la carta torna nel gruppo giusto di quella vista invece di trascinarsi dietro il gruppo forzato altrove.',
        'Nel deck builder, il numero accanto all’intestazione di ogni gruppo ora conta le copie totali di carte e non più le righe distinte: con 10 terre uguali il gruppo «Terre» dice 10, in linea con il pannello Composizione e con il totale in alto.',
      ],
    },
    {
      version: '0.2.156', date: '2026-07-23',
      fixes: [
        'Nella pagina Crediti, i movimenti recenti ora spiegano da dove arriva ogni ricompensa: il voto in Bacheca, il rimborso di «Ancora rotto?» e il bonus della segnalazione automatica non compaiono più come un generico «Ricompensa».',
        'I titoli generati in automatico per i feedback pieni di emoji, e le etichette di timer e sveglie con emoji, non mostrano più un carattere rotto (il rettangolino o il punto interrogativo) quando il testo viene accorciato: ora l’emoji resta intera.',
        'Il pulsante «Ancora rotto?» nella Bacheca è più robusto quando la connessione ha un intoppo: non crea più segnalazioni doppie dello stesso miglioramento.',
        'Quando Filo esegue comandi nel terminale, le copie di cartelle Windows che cancellano file in modo permanente (robocopy con /MIR, /PURGE, /MOVE) ora richiedono la conferma scritta riservata alle azioni irreversibili, non più il semplice clic: così una copia che svuota una cartella non parte per sbaglio.',
        'Nella pagina Cronologia AI ogni voce ora ha un nome leggibile anche per «Descrivi immagine», dettatura, trascrizione OCR di una regione, «Modifica» del testo selezionato e «Spiega» un link, dove prima compariva un codice interno; e il menu «filtra per tipo» ora elenca tutte le azioni davvero presenti, così puoi filtrare la cronologia anche per queste.',
        'La scorciatoia «Salva per dopo» (Alt+S) ora funziona solo sulle pagine web: se la premi mentre sei su una schermata di Filo (Nuova scheda, Opzioni, Cronologia, Bacheca…) non chiude più la scheda di colpo né aggiunge una voce inutile in «Aperti per dopo».',
      ],
    },
    {
      version: '0.2.154', date: '2026-07-23',
      features: [
        'Ora puoi vedere e gestire gli appunti di Filo: dall’icona degli appunti in alto a destra nella nuova scheda si apre un pannello con tutte le note che gli hai chiesto di prendere, e da lì puoi cancellarne una singola o svuotarle tutte.',
        'Nella cronologia degli appunti (la freccia accanto a "Incolla") ora puoi rimuovere una singola voce con la "×" o svuotare tutta la cronologia: utile se hai copiato una password o un testo privato e non vuoi lasciarlo tra le cose incollabili.',
      ],
      fixes: [
        'Ora puoi mettere in pausa e riprendere un timer: sulla sua scheda in alto nella nuova scheda trovi il pulsante ⏸ per fermarlo e ▶ per farlo ripartire da dove era.',
        'In Preferenze, i campi "Archivia dopo questo periodo di inattività (ore)" e "Durata" delle notifiche ora mostrano subito il valore realmente in uso: se scrivi un numero fuori scala (troppo grande o negativo) e lasci il campo, questo si riallinea al valore effettivamente salvato invece di continuare a mostrare il numero digitato.',
        'La barra degli indirizzi ora apre correttamente gli indirizzi con una porta (es. "localhost:3000", "127.0.0.1:8080", "example.com:8443/admin") e i nomi locali come "localhost": prima venivano scambiati per una ricerca su Google. Per i server locali e gli indirizzi di rete privata (router, dispositivi su IP privato) usa "http", per i siti pubblici "https".',
      ],
    },
    {
      version: '0.2.153', date: '2026-07-22',
      features: [
        'Nel deck builder puoi trascinare una carta su una categoria per spostarla: quando sei raggruppato per tag, rilasciandola su un tag ti chiede se aggiungerlo a quelli che ha già o sostituirli tutti (e non ti chiede nulla quando non c\'è ambiguità); trascinandola su "Senza tag" le togli tutti i tag. Nelle altre viste (tipo, costo, colore) il trascinamento sposta la carta nel gruppo scelto.',
      ],
      fixes: [
        'Quando chiedi a Filo di cercare qualcosa sul web (es. "trova il video di X"), ora la ricerca viene eseguita davvero e Filo ti risponde con i risultati e i link reali: prima compariva solo un riquadro "Cerco..." che non portava a nulla.',
        'In Impostazioni → Sicurezza, il campo "Domini in blacklist" ora controlla ciò che scrivi come già faceva il campo "Siti fidati": una voce senza estensione (es. "facebook" invece di "facebook.com") o un indirizzo intero incollato viene sistemata o segnalata, così non credi più di aver bloccato un sito che invece resta apribile.',
        'Il blocco dei siti in blacklist non si aggira più passando da una pagina il cui indirizzo comincia per "google.", "yahoo." o "yandex." (es. "yahoo.qualcosa.com"): prima queste venivano scambiate per motori di ricerca e lasciavano aprire il sito bloccato. I motori di ricerca veri continuano a funzionare come eccezione.',
      ],
    },
    {
      version: '0.2.151', date: '2026-07-22',
      features: [
        'Nel deck builder la ricerca in chat capisce meglio le richieste "a parole": quando cerchi un effetto o un tema (es. "carte che riportano creature dal cimitero", "pedine che si moltiplicano") ora getta una rete più ampia, includendo sinonimi e modi diversi di dire la stessa cosa, e poi passa i risultati al setaccio tenendo solo le carte che fanno davvero quello che chiedevi. Le stesse ricerche ripetute sono più veloci perché il giudizio sulle carte già viste viene riutilizzato.',
      ],
      fixes: [
        'Nel deck builder, la chat con Filo non propone più carte fuori dai colori del commander: anche quando la ricerca o il suggerimento dovrebbero pescarle, ora vengono scartate prima di arrivare tra i risultati (e Filo ti avvisa se ne ha esclusa qualcuna).',
        'Nei "Modelli predefiniti", i modelli che elimini ora restano eliminati: prima, cancellando un modello di serie e salvando, questo riappariva alla riapertura del menu. Se poi lo riaggiungi, torna disponibile come prima.',
      ],
    },
    {
      version: '0.2.150', date: '2026-07-21',
      features: [],
      fixes: [
        'I feedback che invii con un\'immagine allegata ora vengono valutati tenendo conto anche di ciò che l\'immagine mostra: prima veniva considerato solo il testo scritto, così una segnalazione fatta soprattutto con uno screenshot poteva essere fraintesa.',
      ],
    },
    {
      version: '0.2.146', date: '2026-07-18',
      features: [],
      fixes: [
        'Nel deck builder, quando una colonna si riempie (chat con tante risposte, mazzo con tante carte, statistiche) ora scorre correttamente al suo interno invece di allungarsi oltre lo schermo. In particolare la barra per scrivere in fondo alla chat resta sempre visibile: prima, con abbastanza contenuto, veniva spinta fuori dallo schermo e sembrava non ci fosse dove scrivere.',
      ],
    },
    {
      version: '0.2.145', date: '2026-07-18',
      features: [
        'Nel deck builder, quando imposti il commander di un mazzo ancora senza nome, il mazzo prende automaticamente il nome del commander. Se poi cambi commander, il nome si aggiorna da solo; se invece hai già scelto un nome tuo, resta quello.',
      ],
      fixes: [
        'Nell\'editor, pagina "Revisione", il modulo Commenta ora ha un pulsante "Nuovo commento" nella lista dei commenti: puoi aggiungerne un secondo (e altri) con un click, senza dover per forza usare la scorciatoia da tastiera o cancellare quelli esistenti. Corretta anche la didascalia del modulo che alla larghezza minima appariva tagliata ("comment" invece di "commenti").',
      ],
    },
    {
      version: '0.2.144', date: '2026-07-17',
      features: [],
      fixes: [
        'Nel deck builder, cliccando un nome di carta citato nel testo di una risposta il carosello ora sfoglia con le frecce tutte le carte nominate in quel messaggio (come già faceva per gli elenchi di risultati), invece di restare bloccato su una sola. Il click funziona anche al primo colpo, senza dover prima passare il mouse sul nome.',
        'Nel deck builder, la carta attualmente mostrata nel carosello è ora evidenziata ovunque appaia: il suo nome nel testo perde la sottolineatura e prende uno sfondo colorato, e lo stesso vale per la sua riga nei risultati e nell\'elenco del mazzo — a colpo d\'occhio si vede a che punto della lista sei.',
      ],
    },
    {
      version: '0.2.143', date: '2026-07-17',
      features: [],
      fixes: [
        'Il deck builder ora raggiunge davvero l\'archivio delle carte: la ricerca in chat trova le carte, i nomi citati nelle risposte (es. [[Sol Ring]]) mostrano l\'anteprima passandoci sopra il mouse, e impostare il commander o importare una lista funziona. Prima ogni richiesta all\'archivio veniva rifiutata e la chat rispondeva "problema tecnico di accesso al database".',
        'Chiedere in chat un commander con certe caratteristiche ("un commander izzet che costa 4…") ora fa partire una vera ricerca tra le carte leggendarie, invece di una risposta che si scusa di non poter cercare.',
      ],
    },
    {
      version: '0.2.142', date: '2026-07-17',
      features: [],
      fixes: [
        'Nella pagina "Aperti per dopo" il link "← Tutte le categorie" non compare più quando la categorizzazione automatica è disattivata: si vede solo quando stai guardando dentro una categoria e serve davvero per tornare indietro.',
        'Nella gestione del correttore, una parola molto lunga senza spazi aggiunta al dizionario personale non allarga più la pagina: ora va a capo dentro la sua riga e il pulsante "Rimuovi" resta sempre visibile e cliccabile.',
        'Il comando timer della barra di Filo ora rifiuta le durate scritte a metà (es. "5:" o ":30") invece di avviare un timer con una durata diversa da quella che intendevi: in quei casi risponde con l\'uso corretto, come già faceva per le durate non numeriche.',
        'Quando una ricerca non trova nulla, le pagine "Tab archiviate", "Cronologia AI", "Aperti per dopo" e la dashboard dei feedback ora dicono chiaramente "Nessun risultato per la ricerca" invece di mostrare il messaggio di archivio vuoto: niente più impressione di aver perso i propri dati.',
      ],
    },
    {
      version: '0.2.141', date: '2026-07-17',
      features: [],
      fixes: [
        'Nell\'Editor, i commenti della pagina "Revisione" non perdono più l\'evidenziazione quando chiudi e riapri il documento: la frase commentata resta segnata e cliccandola si apre il commento. L\'evidenziazione ritrova la frase giusta anche se nel frattempo hai modificato il testo intorno, e ora funziona anche quando selezioni un testo che attraversa più paragrafi.',
        'Importare un mazzo copiato da Archidekt o TappedOut ora funziona anche quando i titoli delle sezioni hanno il numero di carte fra parentesi (es. "Commander (1)", "Deck (99)"): il comandante viene riconosciuto come tale, le carte di Maybeboard e Sideboard restano fuori dal mazzo e i titoli non compaiono più fra le righe non riconosciute. Inoltre una riga vuota dentro il Maybeboard non fa più rientrare nel mazzo le carte che la seguono.',
      ],
    },
    {
      version: '0.2.140', date: '2026-07-17',
      features: [],
      fixes: [
        'Quando un sito non si carica (indirizzo con un refuso, server spento, connessione assente) la scheda non resta più completamente bianca: ora compare una pagina che spiega cosa è andato storto in italiano, mostra il sito che hai cercato di aprire e offre un tasto "Riprova". Se eri offline, la pagina si ricarica da sola appena torni in rete. Anche "Ricarica" dal menu della scheda ritenta il sito. Lo stesso vale se una scheda si blocca all\'improvviso: invece del bianco compare la spiegazione con il tasto per ricaricarla.',
      ],
    },
    {
      version: '0.2.139', date: '2026-07-16',
      features: [],
      fixes: [
        'Le miniature di "Salva per dopo" ora mostrano la pagina pulita: il menu del tasto destro non finisce più fotografato dentro l\'anteprima. Lo stesso vale per gli screenshot e i ritagli fatti dal menu: il menu non compare più nell\'immagine catturata.',
      ],
    },
    {
      version: '0.2.138', date: '2026-07-16',
      features: [
        'Timer e sveglie ora mostrano anche una notifica di sistema quando scattano: l\'avviso ti raggiunge pure se stai guardando un\'altra scheda o hai Filo ridotto a icona.',
      ],
      fixes: [
        'Le sveglie chieste a Filo ("mettimi una sveglia alle 7") ora suonano davvero all\'orario stabilito, come i timer: prima compariva solo un\'etichetta e all\'ora fissata non succedeva nulla. La sveglia programmata si vede in alto nella nuova scheda con il suo orario e puoi toglierla con la ×; se l\'orario è già passato oggi, viene messa per domani.',
        'Nel deck builder, il tetto di budget scritto con la virgola (es. "40,50", come tutti i prezzi dell\'app) ora viene capito correttamente: prima diventava cento volte più grande senza nessun avviso. Se scrivi qualcosa che non è un numero, il tetto resta com\'era e compare un avviso. Anche il budget mostrato nell\'intestazione del mazzo ora usa la virgola, come il resto dei prezzi.',
      ],
    },
    {
      version: '0.2.137', date: '2026-07-16',
      features: [],
      fixes: [
        'Nel deck builder, "Sposta in un altro mazzo" non fa più sparire le copie quando il mazzo di destinazione contiene già quella carta: ora le quantità si sommano (10 Island spostate su un mazzo con 1 Island → 11). Lo stesso vale per "Copia in un altro mazzo", che prima non faceva nulla in quel caso. Inoltre entrambe le azioni ora mostrano sempre una conferma di esito, anche in caso di errore.',
        'Nella dashboard di gestione dei feedback ora compaiono anche i file allegati alla segnalazione (log, PDF, documenti), con nome e link per aprirli — prima si vedevano solo le immagini.',
        'La protezione che impedisce ai siti di aprire indirizzi pericolosi ora copre anche i reindirizzamenti automatici delle pagine, non solo i click e i popup.',
        'Se una pagina ti reindirizza automaticamente verso un indirizzo di posta o di telefono (mailto:, tel:), ora si apre l\'app corrispondente invece di non succedere nulla.',
        'Nell\'Editor, il pulsante "Sostituisci" di Cerca e sostituisci ora passa alla corrispondenza successiva dopo ogni sostituzione, invece di tornare in cima al documento; e se il testo sostitutivo contiene la parola cercata non resta più bloccato sulla stessa parola.',
      ],
    },
    {
      version: '0.2.135', date: '2026-07-15',
      features: [],
      fixes: [
        'Nell\'Editor, i font con nome composto da più parole (Times New Roman, Comic Sans, Courier New…) ora restano applicati anche dopo aver chiuso e riaperto il documento: prima la scelta del font si perdeva silenziosamente al salvataggio.',
        'Il QR code della pagina (tasto destro → "QR code della pagina") ora è davvero leggibile: inquadrandolo con la fotocamera del telefono si apre il link. Prima l\'immagine compariva ma nessun lettore riusciva a riconoscerla.',
      ],
    },
    {
      version: '0.2.133', date: '2026-07-15',
      features: [
        'Nella chat dei mazzi ora puoi vedere il ragionamento di Filo: mentre pensa scorre in diretta nella bolla, e a risposta arrivata resta disponibile in un blocco "Ragionamento" che si apre e si chiude con un click.',
      ],
      fixes: [
        'Se una ricerca di carte scritta da Filo viene rifiutata dall\'archivio (il vecchio errore "400"), ora Filo riprova da solo correggendo la ricerca; se non ci riesce ti spiega il problema in italiano e ti invita a riformulare, invece di fermarsi con un codice incomprensibile.',
        'Nella chat dei mazzi anche i problemi del servizio AI (sovraccarico, chiave non valida, modello non disponibile) ora vengono spiegati in italiano con un suggerimento su cosa fare, invece di mostrare un codice tecnico.',
      ],
    },
    {
      version: '0.2.131', date: '2026-07-14',
      features: [],
      fixes: [
        'L\'etichetta "in lavorazione" sui feedback ora resta accesa per tutta la durata effettiva del lavoro (prima si spegneva quasi subito), e un feedback la cui lavorazione si interrompe a metà torna da solo in coda invece di restare bloccato.',
      ],
    },
    {
      version: '0.2.130', date: '2026-07-14',
      features: [],
      fixes: [
        'In modalità terminale, quando l\'assistente scarica un file scegliendo dove salvarlo (con comandi come curl o wget verso un percorso preciso), ora ti viene chiesta la conferma più rigorosa — quella in cui devi digitare "conferma" — perché un download del genere può sovrascrivere file delicati del tuo computer, non solo un file qualsiasi.',
      ],
    },
    {
      version: '0.2.129', date: '2026-07-14',
      features: [],
      fixes: [
        'In modalità terminale, i comandi Git che modificano il repository (creare un tag o un branch, impostare o rimuovere una configurazione, aggiungere o togliere un remote) ora chiedono conferma prima di partire, invece di essere eseguiti al volo come una semplice lettura.',
        'La costruzione mazzi ora usa tutta la larghezza della finestra invece di restare stretta al centro, e il ritorno ai Mazzi è un\'icona accanto al titolo della colonna: layout più pulito e più spazio per lavorare.',
        'Nella costruzione mazzi le colonne regolabili si adattano ora alla dimensione della finestra: rimpicciolendo la finestra o riaprendo un mazzo su uno schermo più piccolo l\'area centrale del mazzo non sparisce più e il pannello statistiche non si sovrappone.',
        'Nel box "Invia feedback" ora trascinare un file applica gli stessi limiti di tipo del pulsante "Allega": vengono accettate solo immagini, PDF, testo, markdown, CSV e JSON, così non è più possibile allegare file potenzialmente pericolosi (come pagine HTML).',
      ],
    },
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
      version: '0.2.115', date: '2026-07-05',
      features: [],
      fixes: [
        'Rafforzata la sicurezza: qualsiasi azione interna di Filo che apre una scheda (menu del tasto destro, apertura di nuove schede, riapertura dall\'archivio) ora blocca i tentativi di aprire percorsi di file locali o altri schemi non sicuri, invece di lasciarli passare.',
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
