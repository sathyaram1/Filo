// SINGOLA SORGENTE del "manifesto delle capacità" di Filo: l'elenco curato di
// TUTTO ciò che Filo sa fare, visibile all'utente. Serve all'agente dentro
// Filo per rispondere con verità a "puoi fare X?" e per riconoscere "non posso
// fare Y", e come base per il feedback autonomo.
//
// Pattern: IIFE su globalThis come patchNotes.js. Caricato dal loader
// (src/main/services/loader.js) e disponibile come globalThis.SN_CAPABILITIES.
//
// REGOLA DI SINCRONIZZAZIONE (anti-stale, come "Patch notes"): ogni volta che
// aggiungi/modifichi/rimuovi una capacità VISIBILE all'utente, aggiorna QUI la
// voce corrispondente. Una voce che mente (descrive una feature che non c'è più,
// o ne manca una nuova) è peggio che assente: l'agente prometterebbe il falso.
//
// Formato di una voce:
//   {
//     id:       'kebab-case-stabile',   // identificatore stabile (non cambiarlo)
//     title:    'Titolo per l’utente',  // breve, in italiano
//     category: 'una di CATEGORIES',
//     desc:     'Cosa fa, in termini utente. Niente nomi di file/funzioni.',
//     invoke:   'Come si attiva (shortcut / voce di menu / pagina).',
//     doesNot:  'Confine: cosa NON fa (opzionale, ma prezioso per F4).',
//   }
//
// `desc`/`invoke`/`doesNot` sono per l'utente finale, non tecnici.

(function (global) {
  'use strict';

  // Categorie: l'indice compatto (vedi index()) le usa per il raggruppamento.
  const CATEGORIES = {
    navigation: 'Navigazione e schede',
    selection: 'Azioni sul testo selezionato',
    writing: 'Scrittura e correzione',
    reading: 'Lettura e traduzione',
    media: 'Immagini e cattura schermo',
    links: 'Link',
    clipboard: 'Appunti',
    save: 'Salva per dopo e archivio',
    assistant: 'Assistente e agente di pagina',
    pages: 'Pagine interne',
    settings: 'Impostazioni',
    credits: 'Crediti',
  };

  const CAPABILITIES = [
    // ─────────────────────────── Navigazione e schede ───────────────────────
    {
      id: 'new-tab', title: 'Apri una nuova scheda', category: 'navigation',
      desc: 'Apre una nuova scheda sulla home di Filo.',
      invoke: 'Pulsante "+" nella barra delle schede, il menu del tasto destro → "Nuova scheda", oppure la scorciatoia Ctrl+T (Cmd+T su Mac) — che funziona anche mentre stai guardando un sito.',
    },
    {
      id: 'close-tab', title: 'Chiudi la scheda', category: 'navigation',
      desc: 'Chiude la scheda corrente; la pagina chiusa finisce nell’archivio, da cui puoi riaprirla.',
      invoke: 'Pulsante di chiusura sulla scheda, il menu del tasto destro → "Chiudi pagina", oppure la scorciatoia Ctrl+W (Cmd+W su Mac) — che funziona anche mentre stai guardando un sito.',
      doesNot: 'Le finestre in incognito e le pagine interne di Filo non vengono archiviate.',
    },
    {
      id: 'navigate-back-forward', title: 'Indietro / Avanti', category: 'navigation',
      desc: 'Torna alla pagina precedente o va a quella successiva nella cronologia della scheda.',
      invoke: 'Menu del tasto destro → "Indietro" / "Avanti" (dentro "Altro…"). Ctrl+Z torna alla pagina precedente (quando non stai scrivendo in un campo di testo).',
    },
    {
      id: 'reload', title: 'Ricarica la pagina', category: 'navigation',
      desc: 'Ricarica la pagina corrente.',
      invoke: 'Menu del tasto destro → "Ricarica", oppure la scorciatoia Ctrl+R (Cmd+R su Mac) — che funziona anche mentre stai guardando un sito.',
    },
    {
      id: 'home', title: 'Vai alla home', category: 'navigation',
      desc: 'Apre la home di Filo nella scheda corrente, con suggerimenti e aggiornamenti.',
      invoke: 'Icona Home in alto a destra nella home (la nuova scheda), oppure menu del tasto destro → "Home".',
    },
    {
      id: 'address-bar', title: 'Apri un indirizzo', category: 'navigation',
      desc: 'Scrivi un indirizzo per navigare, o un termine per cercare sul web. Funziona anche con gli indirizzi locali: un server di sviluppo (localhost:3000), un IP (127.0.0.1:8080), il router di casa (192.168.1.1) e i nomi dei dispositivi della tua rete (nas.lan, raspberrypi.local, fritz.box). Se un indirizzo non risulta esistere te lo dice, e puoi aprirlo lo stesso.',
      invoke: 'In una nuova scheda scrivi "/" seguito dall\'indirizzo nel campo "Chiedi qualsiasi cosa" (per esempio /example.com o /localhost:3000). Da un sito, Ctrl+L (Cmd+L su Mac) apre la home dove digitare il nuovo indirizzo.',
    },
    {
      id: 'incognito', title: 'Finestra in incognito', category: 'navigation',
      desc: 'Apre una nuova finestra privata e isolata: la sessione è effimera e non viene archiviata.',
      invoke: 'Menu del tasto destro → "Nuova finestra incognito".',
    },
    {
      id: 'fullscreen', title: 'Schermo intero', category: 'navigation',
      desc: 'Nasconde la barra delle schede così la pagina occupa tutta la finestra.',
      invoke: 'Menu del tasto destro → "Schermo intero" / "Esci da schermo intero", oppure chiedilo all’assistente ("metti a schermo intero", "togli lo schermo intero"). Esci in ogni momento con Esc.',
      doesNot: 'Non preme il pulsante di schermo intero del lettore video dentro un sito (es. quello di YouTube): agisce sulla finestra di Filo, non sui comandi della pagina.',
    },
    {
      id: 'page-zoom', title: 'Ingrandisci o rimpicciolisci la pagina', category: 'navigation',
      desc: 'Cambia la dimensione di tutta la pagina — testo e immagini — sia sui siti sia sulle pagine di Filo (home, impostazioni, cronologia…). Lo zoom resta com’è finché non lo riporti al 100%.',
      invoke: 'Ctrl + per ingrandire, Ctrl - per rimpicciolire, Ctrl 0 per tornare al 100%; oppure tieni Ctrl e usa la rotella, o pizzica sul trackpad. In alternativa un clic sulla rotella entra in modalità zoom: la rotella da sola ingrandisce e rimpicciolisce, e un badge in alto mostra la percentuale, che puoi anche scrivere a mano.',
      doesNot: 'Non cambia la dimensione della barra delle schede di Filo: per quella c’è la dimensione del testo nelle impostazioni. Nell’editor di testo lo zoom scala il foglio del documento, non la finestra.',
    },
    {
      id: 'network-error-page', title: 'Pagina d’errore quando un sito non si carica', category: 'navigation',
      desc: 'Se un sito non è raggiungibile (indirizzo sbagliato, server spento, sei offline) o una scheda si blocca, compare una pagina che spiega il problema in italiano con un tasto "Riprova". Se eri offline, riprova da sola appena torni in rete.',
      invoke: 'Automatico quando un caricamento fallisce; "Riprova" sulla pagina o "Ricarica" dal menu ritentano il sito.',
      doesNot: 'Non aggira i blocchi di sicurezza: i siti segnalati come pericolosi restano gestiti dagli avvisi dedicati.',
    },
    {
      id: 'auto-archive', title: 'Archiviazione automatica delle schede', category: 'navigation',
      desc: 'Le schede lasciate inattive a lungo vengono archiviate da sole; il riordino collassa anche le schede «Nuova scheda»/home aperte più volte in una sola e chiude le pagine di impostazioni che non stai più usando (restano sempre raggiungibili), per tenere pulita la barra.',
      invoke: 'Automatico (soglia e attivazione in Preferenze); a richiesta con il comando /pulisci o il pulsante «Riordina e archivia le schede» nella home.',
      doesNot: 'Non tocca le finestre in incognito, la scheda attiva, le schede con audio in riproduzione o con un modulo compilato non inviato, né le pagine di lavoro interne di Filo (Editor, Bacheca, Mazzi, Cronologia).',
    },
    {
      id: 'reorder-tabs', title: 'Riordina le schede per colore', category: 'navigation',
      desc: 'Riordina al volo tutte le schede aperte per colore, come succede quando riapri Filo, mettendo vicine quelle dello stesso sito o tinta.',
      invoke: 'Comando /riordina dalla nuova scheda.',
      doesNot: 'Non chiude né archivia nessuna scheda: le riordina soltanto (per chiudere quelle non più utili c’è /pulisci).',
    },
    {
      id: 'open-in-background', title: 'Apri una scheda in secondo piano', category: 'navigation',
      desc: 'Filo può aprire una pagina senza portartici davanti: tu resti dove sei e quello che hai chiesto — un brano, una radio, un podcast — parte lo stesso nella scheda dietro.',
      invoke: 'Chiedilo a parole all’assistente ("mettimi questa canzone", "apri senza cambiare scheda"): quando ciò che apre serve solo da ascoltare, la scheda nasce in secondo piano. Il riferimento che resta nella conversazione ti porta a quella scheda quando vuoi.',
      doesNot: 'Se chiedi di guardare o leggere qualcosa, la scheda si apre davanti come sempre.',
    },

    // ─────────────────────── Azioni sul testo selezionato ────────────────────
    {
      id: 'explain-selection', title: 'Spiega il testo selezionato', category: 'selection',
      desc: 'Dà una spiegazione del testo che hai selezionato, direttamente sopra la selezione.',
      invoke: 'Seleziona il testo e usa Alt+E, oppure menu del tasto destro → "Spiegazione". "Approfondisci" apre una spiegazione più estesa.',
    },
    {
      id: 'translate-selection', title: 'Traduci il testo selezionato', category: 'selection',
      desc: 'Traduce il testo selezionato e mostra il risultato in un riquadro.',
      invoke: 'Seleziona il testo e usa Alt+T, oppure menu del tasto destro → "Traduci".',
    },
    {
      id: 'edit-selection', title: 'Riscrivi il testo selezionato', category: 'writing',
      desc: 'Riscrive il testo selezionato secondo la tua richiesta e ti propone la nuova versione da sostituire o copiare. Pulsanti rapidi: più formale, più informale, riassumi, traduci, correggi; oppure scrivi un’istruzione libera.',
      invoke: 'In un campo modificabile, seleziona il testo e dal menu del tasto destro scegli "Modifica".',
    },
    {
      id: 'read-aloud', title: 'Leggi ad alta voce', category: 'reading',
      desc: 'Legge ad alta voce il testo selezionato, evidenziando le parole mentre le pronuncia.',
      invoke: 'Seleziona il testo e dal menu del tasto destro scegli "Leggi". Per fermare: "Interrompi lettura" (anche da un’altra scheda).',
      doesNot: 'La voce, la velocità e il tono si regolano in Preferenze.',
    },
    {
      id: 'search-web', title: 'Cerca sul web', category: 'selection',
      desc: 'Cerca sul web il testo che hai selezionato, aprendo i risultati in una nuova scheda.',
      invoke: 'Seleziona il testo e usa la voce di ricerca nel menu del tasto destro.',
    },

    // ─────────────────────── Scrittura e correzione ──────────────────────────
    {
      id: 'spellcheck', title: 'Correttore mentre scrivi', category: 'writing',
      desc: 'Mentre scrivi in un campo di testo, segnala gli errori: zigzag rosso per l’ortografia (suggerimenti del sistema) e zigzag blu per gli errori di contesto rilevati dall’AI.',
      invoke: 'Automatico quando scrivi in un’area di testo; clic destro su una parola segnalata per i suggerimenti.',
      doesNot: 'Il correttore contestuale (blu) lavora su testi né troppo corti né enormi e può essere disattivato.',
    },
    {
      id: 'spellcheck-manage', title: 'Gestisci correttore e dizionario', category: 'writing',
      desc: 'Gestisci le correzioni automatiche (da → a, anche su più parole come "x es" → "per esempio", che si espandono mentre scrivi) e il dizionario personale di parole da non segnalare.',
      invoke: 'Pagina filo://spellcheck/spellcheck.html.',
    },
    {
      id: 'editor', title: 'Editor di testo', category: 'writing',
      desc: 'Un editor per scrivere e impaginare testo con moduli a blocchi; il contenuto viene salvato da solo. È anche il posto degli appunti: quando chiedi a Filo di prendere nota, scrive lui stesso in un file qui dentro. Puoi tenere più documenti separati: il selettore in alto a sinistra mostra il nome del file aperto e apre l\'elenco dei documenti, da cui crei un nuovo file, passi da uno all\'altro, li rinomini ed elimini; alla riapertura ritrovi l\'ultimo documento su cui stavi lavorando. Eliminare un documento è immediato ma annullabile: subito dopo compare un avviso con "Annulla" che riporta indietro il file — testo, commenti, moduli e storico — al suo posto. Gli avvisi si impilano, quindi un secondo avviso non porta via l\'"Annulla" del primo; e in ogni caso i documenti eliminati restano nel cestino (gli ultimi dodici), che trovi in fondo al menu documenti o col tasto destro sul titolo quando c\'è qualcosa dentro: da lì vedi il testo di ciascuno, lo rimetti al suo posto — con i suoi commenti, i suoi riquadri e il suo storico versioni — anche dopo aver chiuso e riaperto Filo, oppure lo elimini per sempre confermando. Nella pagina "Revisione" puoi attaccare commenti a frasi selezionate: il testo commentato resta evidenziato anche dopo aver chiuso e riaperto il documento, e cliccandolo riapri il commento. Ogni modifica che Filo fa da solo al documento (formattare il testo su richiesta della chat, oppure scrivere un appunto) crea un punto di ripristino: subito dopo compare un avviso con "Annulla" per tornare com\'era, e lo storico di ogni documento resta disponibile anche dopo aver chiuso e riaperto Filo, così una modifica automatica è sempre reversibile. Anche le tue modifiche manuali significative creano un punto di ripristino: quando scrivi o cancelli molto a mano e poi ti fermi un momento, o quando cambi documento, Filo salva da solo lo stato — così se poi vuoi tornare a un punto precedente lo ritrovi nello storico, senza aver dovuto salvare nulla. Dallo "Storico versioni" (nel menu documenti in alto a sinistra o col tasto destro sul titolo) puoi sfogliare TUTTE le versioni salvate, dalla più recente alla più vecchia, con data, sorgente (le modifiche di Filo sono evidenziate) e un\'anteprima del testo; clicchi una versione per vederne l\'anteprima completa e la ripristini quando vuoi — anche il ripristino è annullabile: prima salva lo stato attuale come nuova versione e subito dopo compare un avviso con "Annulla" che rimette il documento com\'era. Il ripristino riporta indietro il testo del documento e i suoi commenti: il nome che gli hai dato, la conversazione avuta con Filo nel riquadro chat e la disposizione dei riquadri del banco di lavoro restano come sono adesso, e il pannello te lo dice prima che tu prema. I documenti senza nome prendono un titolo da soli: quando il testo supera un centinaio di parole Filo propone un titolo basato sul contenuto (una volta sola, e mai se hai già dato tu un nome al file); il titolo resta modificabile a mano. Ogni documento tiene anche un breve riassunto del suo contenuto, scritto da solo e aggiornato mentre lavori: serve a Filo per sapere di cosa parlano i tuoi file senza tenerli aperti. Col tasto destro sul titolo apri un menu per rigenerare il titolo o il riassunto, rinominare, duplicare o eliminare il documento. Ogni titolo del documento ha accanto una freccia che chiude e riapre la sua sezione, per tenere sotto controllo i testi lunghi. Nella pagina "Revisione" c\'è anche il riquadro "Cerca / Sostituisci": scorri le corrispondenze avanti e indietro (coi tasti Prec/Succ o con Invio e Maiusc+Invio dal campo Cerca), sostituisci quella selezionata o tutte insieme; se una corrispondenza si trova in una sezione chiusa, la sezione si apre da sola e la vista ci arriva sopra, così non ti viene mai cambiata una parola che non hai potuto vedere. Le sezioni aperte dalla ricerca sono un prestito: mentre scrivi la parola da cercare Filo aspetta che tu ti fermi prima di aprire qualcosa, tiene aperta solo la sezione del risultato in cui sei, e appena passi a un altro risultato — o svuoti il campo Cerca, o premi Esc — richiude quelle che aveva aperto lui, lasciando come stanno quelle che hai aperto tu e quelle in cui è stata sostituita una parola. Puoi anche incollare immagini dentro il foglio (per esempio copiate da una pagina web): restano salvate insieme al testo e le ritrovi dove le avevi messe anche dopo aver chiuso e riaperto Filo.',
      invoke: 'Menu del tasto destro → "Editor", oppure filo://editor/editor.html. Il selettore documenti è in alto a sinistra; col tasto destro sul titolo apri il menu (storico versioni, rigenera titolo, rigenera riassunto, rinomina, duplica, elimina). Dopo una modifica automatica di Filo, l\'avviso "Annulla" in basso a destra la annulla; per tornare a una versione più lontana apri lo "Storico versioni" dal menu documenti o dal tasto destro sul titolo.',
      doesNot: 'Lo storico tiene i punti di ripristino delle modifiche automatiche di Filo, dei ripristini e delle tue modifiche manuali SIGNIFICATIVE (quando scrivi o cancelli molto), non ogni singola battuta né le piccole correzioni. Ripristinare una versione non riporta indietro il nome del documento, la conversazione con Filo né la disposizione dei riquadri: quelli restano com\'erano prima di premere.',
    },
    {
      id: 'deck-builder', title: 'Deck builder MTG (Commander)', category: 'writing',
      desc: 'Costruttore di mazzi Commander salvati sul tuo computer: libreria dei mazzi, banco di lavoro a tre colonne regolabili, elenco carte con simboli di mana raggruppato per tipo/tag/costo/colore, commander con avvisi di legalità (doppioni, colori, carte bandite); se il mazzo non ha ancora un nome tuo, impostare il commander gli dà automaticamente il nome del commander (e lo aggiorna se cambi commander); puoi anche rimuovere il commander e tornare a «Nessun commander» (dal menu del mazzo o col tasto destro sulla riga del commander), e la carta che avevi scelto rientra nel mazzo. Nel banco di lavoro c\'è la chat con Filo: cerchi carte con una query secca o una frase in linguaggio naturale (risultati già filtrati sui colori del commander, con tasto per aggiungerle al mazzo); se dici a parole che vuoi costruire attorno a un commander (o qual è il commander del mazzo) e il mazzo non ne ha ancora uno, Filo lo imposta da solo e da lì filtra le ricerche sui suoi colori (un commander già impostato non viene toccato) — per le ricerche "a parole" che descrivono un effetto o un tema Filo getta una rete ampia (sinonimi e formulazioni diverse) e poi passa i risultati al setaccio tenendo solo le carte che rispettano davvero la richiesta, riusando i giudizi già dati per le ricerche ripetute; chiedi pareri o peschi carte da un altro tuo mazzo; mentre Filo pensa il suo ragionamento scorre in diretta nella bolla e resta poi consultabile in un blocco "Ragionamento" apribile e richiudibile con un click, e se una ricerca viene rifiutata dall\'archivio carte Filo la corregge e riprova da solo (o spiega il problema in chiaro). Passando il mouse su una carta (nei risultati, nel mazzo o nei nomi citati in chat) il pannello destro mostra l\'anteprima con immagine, prezzo e tag (le carte bifronte hanno un tasto per girarle e vedere il retro, o basta cliccare la carta); cliccandola si apre il carosello per valutare le carte una a una con la tastiera (frecce per scorrere, Invio per aggiungere/rimuovere, Esc per chiudere) — cliccando un nome citato nel testo il carosello sfoglia tutte le carte nominate in quel messaggio, e la carta mostrata è evidenziata nel testo e negli elenchi. Sotto l\'anteprima (e nel carosello) c\'è un riquadro modulare: col tasto destro scegli cosa mostra — dati della carta, mini curva di mana con evidenziato dove cadrebbe la carta, prezzo con ristampe e legalità, oppure il parere di Filo sulla carta rispetto al tuo mazzo (calcolato quando serve e ricordato; se poi modifichi il mazzo il parere resta visibile con un pallino "da aggiornare" e un tasto per rigenerarlo). In chat puoi chiedere "valuta il mazzo" per avere una sintesi e il parere pronto su tutte le carte, e "tagga il mazzo con ramp, draw, removal" per far assegnare i tag a Filo carta per carta (i giudizi già dati vengono ricordati anche per gli altri mazzi); i tag alimentano raggruppamento, calcolatore di probabilità e richieste tipo "il ramp di mazzo X". Puoi anche trascinare una carta dell\'elenco su una categoria per spostarla: raggruppato per tag, rilasciarla su un tag chiede se aggiungerlo a quelli già presenti o sostituirli tutti (nessuna domanda quando non c\'è scelta da fare), e "Senza tag" toglie tutti i tag; nelle viste per tipo/costo/colore il trascinamento sposta la carta nel gruppo scelto. A riposo il pannello destro mostra le statistiche del mazzo: curva di mana con costo medio, mana richiesto e prodotto per colore, composizione per tipo con totale su 100, check di legalità, budget in euro (tetto impostabile dal menu del mazzo o in chat con "budget 40 euro", con totale e residuo sempre visibili) e un calcolatore di probabilità di pescata (per tag e turno, dal pannello o chiedendo in chat "che probabilità ho di avere 2 ramp e 3 terre al turno 10?"); nel pannello la stima si aggiorna da sola appena cambi turno, categorie o mazzo, raffinandosi fino a convergere senza bisogno di ricalcolare a mano. Puoi anche importare/esportare un mazzo come lista di testo (formato "1 Sol Ring" per riga, quello di Moxfield/Archidekt) dal menu del mazzo: l\'import mostra sempre un\'anteprima di conferma con le carte riconosciute (e segnala quelle che non ha capito) prima di scrivere qualunque cosa; l\'export genera lo stesso formato, pronto da copiare. In alternativa puoi incollare la lista direttamente in chat, anche scritta male o con nomi in italiano: Filo la interpreta, propone l\'elenco da confermare carta per carta o tutto insieme, e risolve i nomi su Scryfall prima di aggiungerli.',
      invoke: 'Menu App → "Deck builder MTG", oppure filo://decks/decks.html. Tasto destro su carte e mazzi per le azioni; click sul nome del mazzo per gestirlo (include "Importa…"/"Esporta…"); la barra in basso a sinistra del banco di lavoro è la chat/ricerca (incolla lì una lista per l\'import via chat); click su una carta per sfogliarla nel carosello; trascina una carta dell\'elenco su un\'altra categoria per spostarla (o taggarla, in vista per tag); le statistiche sono nel pannello destro a riposo.',
      doesNot: 'Non gioca partite. L\'import non gestisce sideboard/maybeboard (vengono ignorati) né commander in coppia (partner): solo la prima carta della sezione "Commander" diventa il commander del mazzo, le altre entrano come carte normali.',
    },

    // ─────────────────────── Lettura e traduzione ───────────────────────────
    {
      id: 'translate-page', title: 'Traduci l’intera pagina', category: 'reading',
      desc: 'Traduce tutto il testo visibile della pagina — titolo, sommario, didascalie, riquadri laterali, voci di menu e testo dei link, non solo i paragrafi, compreso il testo dentro i componenti con cui sono costruiti i siti moderni — mantenendo impaginazione, link, immagini e illustrazioni; mentre lavora mostra a che punto è arrivata, e puoi tornare all’originale quando vuoi. Se si interrompe a metà (rete che salta, credito finito) te lo dice, con il motivo e il punto in cui si è fermata, e puoi riprenderla: completa solo i pezzi mancanti senza rifare quelli già tradotti.',
      invoke: 'Menu del tasto destro → "Traduci la pagina"; a traduzione finita la stessa icona diventa "Mostra originale", se si è interrotta diventa "Riprendi traduzione" (e "Mostra originale" resta lì sotto come voce).',
      doesNot: 'Non traduce il testo dentro le immagini, i video, i riquadri di codice, le illustrazioni (grafici, loghi, icone disegnate nella pagina) e le formule, che restano intatte con i loro colori; non traduce le pagine dove non trova testo (in quel caso te lo dice). Se un sito tiene chiusi certi suoi componenti, quel testo non è leggibile da nessuno script e resta nella lingua originale: in quel caso l’avviso dice che la pagina è tradotta solo in parte.',
    },

    // ─────────────────── Immagini e cattura schermo ──────────────────────────
    {
      id: 'explain-image', title: 'Spiega un’immagine', category: 'media',
      desc: 'Descrive un’immagine della pagina, direttamente lì sotto.',
      invoke: 'Clic destro su un’immagine → "Spiega immagine".',
    },
    {
      id: 'copy-download-image', title: 'Copia o scarica un’immagine', category: 'media',
      desc: 'Copia l’immagine negli appunti, ne copia l’indirizzo, oppure la scarica sul computer scegliendo dove. Le immagini pesanti compaiono fra gli scaricamenti in alto con il loro avanzamento, come un file qualsiasi.',
      invoke: 'Clic destro su un’immagine → "Copia immagine" / "Copia URL immagine" / "Salva immagine come…".',
      doesNot: 'Quando l’immagine non ha un vero indirizzo (il sito la scrive dentro la pagina o ci mette un frammento di codice) Filo te lo dice invece di riempirti gli appunti con una stringa che non apre niente: l’immagine puoi comunque copiarla o salvarla.',
    },
    {
      id: 'search-image', title: 'Cerca un’immagine sul web', category: 'media',
      desc: 'Cerca sul web a partire da un’immagine della pagina (ricerca per immagine).',
      invoke: 'Clic destro su un’immagine → cerca immagine.',
    },
    {
      id: 'video-audio-controls', title: 'Comanda un video o un audio della pagina', category: 'media',
      desc: 'Sul tasto destro di un filmato o di un audio trovi le sue azioni: riproduci o metti in pausa, togli e rimetti l’audio, cambia velocità (l’etichetta mostra sempre quella attuale; un clic accelera di uno scatto, la freccia apre l’elenco da 0,25× a 2×), ripeti in continuo, mostra o nascondi i controlli del lettore. Funziona anche quando i comandi del player coprono il filmato.',
      invoke: 'Clic destro sul video o sull’audio → la voce che ti serve.',
      doesNot: 'Non scarica i sottotitoli, non ritaglia il filmato e non tocca i lettori che non usano un vero video della pagina (per esempio quelli dentro contenuti incorporati protetti).',
    },
    {
      id: 'video-pip', title: 'Guarda un video in finestra mobile', category: 'media',
      desc: 'Stacca il video dalla pagina in una finestrella che resta in vista mentre navighi altrove.',
      invoke: 'Clic destro sul video → "Apri in finestra mobile" (la stessa voce lo richiude).',
    },
    {
      id: 'copy-download-video', title: 'Copia l’indirizzo o salva un video/audio', category: 'media',
      desc: 'Copia l’indirizzo del filmato o dell’audio, oppure lo salva come file sul computer scegliendo dove. Mentre scarica, il filmato compare fra gli scaricamenti in alto con barra e percentuale, e da lì puoi annullarlo: non c’è un limite di dimensione, anche un film lungo arriva.',
      invoke: 'Clic destro sul video o sull’audio → "Copia URL video" / "Salva video come…".',
      doesNot: 'I contenuti trasmessi in streaming a pezzi (i grandi siti di video) non hanno un file da salvare: in quel caso Filo lo dice invece di salvare un file rotto. Allo stesso modo, se la sorgente del filmato non è un vero indirizzo Filo lo dice invece di copiarla. Un salvataggio già avviato si può annullare ma non mettere in pausa.',
    },
    {
      id: 'download-progress', title: 'Scarica file e segui l’avanzamento', category: 'save',
      desc: 'Quando clicchi un link a un file (PDF, ZIP, allegato) Filo lo scarica mostrando l’avanzamento in tempo reale con un indicatore in alto, tra le schede — barra e percentuale — e a fine scaricamento ti avvisa con "Apri file" e "Apri cartella"; se qualcosa va storto (rete caduta, errore del server, spazio finito) te lo dice invece di restare in silenzio. I file scaricati restano in un elenco che sopravvive alla riapertura di Filo. Se il file parte da una scheda aperta apposta dal sito — una scheda bianca o una pagina "il download partirà a breve…" che non hai mai toccato — Filo la chiude da solo appena il download parte e ti riporta alla pagina di partenza, con un avviso "Riapri" per rimetterla se ti serviva.',
      invoke: 'Parte cliccando un link a un file, oppure dal clic destro sul link → "Salva file"; ci finiscono anche le immagini e i filmati salvati dal clic destro ("Salva immagine come…", "Salva video come…"). L’indicatore in alto tra le schede apre l’elenco degli scaricamenti, dove puoi metterli in pausa, riprenderli, annullarli, aprirli o mostrarli nella cartella.',
      doesNot: 'Un file preso da un link finisce direttamente nella cartella Download di sistema, senza chiederti dove ogni volta (le immagini e i filmati salvati dal clic destro invece te lo chiedono, e quelli si possono annullare ma non mettere in pausa). L’elenco degli scaricamenti e i suoi comandi restano dentro Filo: i siti che visiti non possono leggerlo né comandarlo. Le finestre in incognito non ci finiscono.',
    },
    {
      id: 'screenshot', title: 'Cattura schermo', category: 'media',
      desc: 'Cattura la pagina visibile come immagine. Puoi anche selezionare solo una porzione dello schermo.',
      invoke: 'Menu del tasto destro → "Screenshot" o "Screenshot di una parte".',
    },
    {
      id: 'ocr', title: 'Trascrivi testo da una porzione', category: 'media',
      desc: 'Selezioni un’area dello schermo e ne estrae il testo, copiandolo negli appunti.',
      invoke: 'Menu del tasto destro → "Trascrivi".',
    },
    {
      id: 'color-picker', title: 'Contagocce colore', category: 'media',
      desc: 'Preleva il colore di un punto qualsiasi dello schermo e ne copia il codice negli appunti.',
      invoke: 'Menu del tasto destro → "Color picker".',
      doesNot: 'Disponibile solo dove il sistema lo supporta.',
    },
    {
      id: 'qr-code', title: 'QR code della pagina', category: 'media',
      desc: 'Genera un QR code dell’indirizzo della pagina corrente, da scaricare o condividere.',
      invoke: 'Menu del tasto destro → "QR code della pagina".',
    },

    // ─────────────────────────────── Link ────────────────────────────────────
    {
      id: 'explain-link', title: 'Spiega un link', category: 'links',
      desc: 'Spiega dove porta un link senza aprirlo, e segnala se sembra sospetto (phishing).',
      invoke: 'Clic destro su un link → "Spiega link".',
      doesNot: 'Non apre il link; l’analisi di sicurezza è basata su indizi nell’indirizzo, non su un database in tempo reale.',
    },
    {
      id: 'save-link', title: 'Salva un link per dopo', category: 'links',
      desc: 'Mette da parte un link nella lista "Aperti per dopo".',
      invoke: 'Clic destro su un link → "Salva link per dopo".',
    },
    {
      id: 'share-copy-link', title: 'Condividi o copia un link', category: 'links',
      desc: 'Condivide un link col sistema operativo o ne copia l’indirizzo.',
      invoke: 'Clic destro su un link → "Condividi link" / "Copia URL".',
      doesNot: 'Se il link non porta davvero da nessuna parte (al posto dell’indirizzo il sito ci ha messo un frammento di codice) Filo te lo dice invece di copiare una stringa che non apre niente.',
    },

    // ────────────────────────────── Appunti ──────────────────────────────────
    {
      id: 'paste-clipboard', title: 'Incolla con cronologia', category: 'clipboard',
      desc: 'Incolla testo o immagini dagli appunti; puoi scegliere da una cronologia ricercabile di ciò che hai copiato di recente, rimuovere una singola voce (es. una password copiata per sbaglio) o svuotare tutta la cronologia.',
      invoke: 'In un campo modificabile, menu del tasto destro → "Incolla"; la freccia apre la cronologia. Nella cronologia: "×" accanto a una voce per rimuoverla, "Svuota cronologia" in fondo per cancellarle tutte.',
    },
    {
      id: 'copy-cut', title: 'Copia e taglia', category: 'clipboard',
      desc: 'Copia o taglia il testo selezionato.',
      invoke: 'Menu del tasto destro → "Copia" / "Taglia".',
    },

    // ──────────────────────── Salva per dopo e archivio ──────────────────────
    {
      id: 'save-for-later', title: 'Salva la pagina per dopo', category: 'save',
      desc: 'Mette da parte la pagina corrente (titolo, indirizzo, anteprima) e chiude la scheda, per riprenderla quando vuoi. Se salvi una pagina che avevi già messo da parte, aggiorna la voce esistente e la riporta in cima invece di crearne un doppione.',
      invoke: 'Alt+S, oppure menu del tasto destro → "Salva per dopo".',
      doesNot: 'Salva i riferimenti e un’anteprima, non lo stato della pagina (moduli compilati, sessione). Vale solo per le pagine web: sulle schermate interne di Filo non fa nulla.',
    },
    {
      id: 'open-for-later', title: 'Aperti per dopo', category: 'save',
      desc: 'La lista delle pagine e dei link che hai messo da parte, pronti da riaprire.',
      invoke: 'Menu «App» → «Aperti per dopo», oppure Impostazioni → «Altro» → «Aperti per dopo»; indirizzo filo://home/home.html. Anche cliccando la conferma che appare dopo «Salva per dopo». Clicca una scheda per riaprirla.',
      doesNot: 'Non è la home: l’icona Home (in alto a destra e nel menu del tasto destro) porta alla nuova scheda, non a questa lista.',
    },
    {
      id: 'archive', title: 'Cronologia delle schede', category: 'save',
      desc: 'La cronologia principale: le schede chiuse raggruppate per giorno, una riga per giorno, colorate come le tab in alto; puoi cercarle anche per contenuto e riaprirle.',
      invoke: 'Icona «Cronologia» in alto a destra nella home (o dalla home → "Cronologia"), pagina filo://archive/archive.html. Clicca una scheda per riaprirla; tasto destro per il menu Riapri/Elimina.',
    },
    {
      id: 'history', title: 'Cronologia delle richieste AI', category: 'save',
      desc: 'L’elenco delle richieste fatte all’AI (spiegazioni, traduzioni, aiuto…), filtrabile e ricercabile, con il costo di ogni richiesta e quanta parte del testo mandato al modello è stata riusata da una richiesta precedente invece di essere rielaborata; puoi rimuovere una singola voce oppure svuotarla del tutto.',
      invoke: 'Pagina filo://history/history.html. Passa il mouse su una voce e clicca «Rimuovi» per toglierla; «Cancella tutto» svuota l’intera cronologia.',
    },
    {
      id: 'downloads-list', title: 'Elenco degli scaricamenti', category: 'navigation',
      desc: 'La lista di tutti i file scaricati, dal più recente: per ciascuno vedi nome, dimensione, stato (completato, interrotto, annullato o in corso), data e dove è stato salvato; gli scaricamenti in corso mostrano barra e percentuale dal vivo. Per ogni voce puoi aprire il file, aprire la cartella che lo contiene, copiarne il percorso, ri-scaricarlo o toglierlo dalla lista; «Svuota elenco» rimuove tutti quelli conclusi. Se un file scaricato non è più al suo posto (l’hai spostato, rinominato o cestinato) la voce si riconosce a colpo d’occhio — attenuata, col nome barrato — e al posto di «Apri file» ti offre di ri-scaricarlo. Puoi anche cercare tra gli scaricamenti.',
      invoke: 'Menu «App» → «Scaricamenti», oppure il pulsante «Vedi tutti» sull’indicatore degli scaricamenti in alto; indirizzo filo://downloads/downloads.html. Clic su una voce completata per aprire il file, tasto destro per il menu con tutte le azioni.',
      doesNot: 'Non ti fa scegliere dove salvare ogni file (finiscono nella cartella Download di sistema) e non riguarda «Salva immagine/video come…» dal tasto destro.',
    },

    // ──────────────────── Assistente e agente di pagina ──────────────────────
    {
      id: 'help-sidebar', title: 'Assistente di pagina (Aiuto)', category: 'assistant',
      desc: 'Apre un assistente laterale che vede la pagina e ti aiuta passo passo: può evidenziare elementi, suggerire dove cliccare, aprire menu nascosti e proporre cosa scrivere in un campo (lo invii tu).',
      invoke: 'Alt+H.',
      doesNot: 'Non invia i moduli al posto tuo: ogni azione che modifica la pagina richiede una tua conferma.',
    },
    {
      id: 'web-search-assistant', title: 'Ricerca sul web dell’assistente', category: 'assistant',
      desc: 'Durante l’aiuto, l’assistente può fare alcune ricerche sul web per rispondere meglio.',
      invoke: 'Automatico all’interno dell’assistente di pagina.',
    },
    {
      id: 'feedback', title: 'Manda un feedback', category: 'assistant',
      desc: 'Segnala un problema o una richiesta a chi sviluppa Filo, anche con immagini allegate, e segui le risposte in un thread. L’invio è immediato: se sei senza connessione Filo tiene da parte il feedback e lo spedisce da solo appena la rete torna, anche dopo aver chiuso e riaperto l’app. Puoi anche chiederlo a Filo in chat ("segnala che X non funziona") e ci pensa lui a scriverlo; e quando è Filo a dirti che una cosa non sa farla o che non ha un dato che gli hai chiesto, la segnalazione compare già scritta e ti viene mostrata subito per intero in un riquadro di conferma (una volta per conversazione, e niente parte senza il tuo OK).',
      invoke: 'Menu del tasto destro → "Feedback", oppure filo://feedback/feedback.html; in chat basta chiederlo a parole.',
    },
    {
      id: 'transparency-docs', title: 'Perché Filo fa così (trasparenza)', category: 'assistant',
      desc: 'Le scelte dichiarate di Filo, scritte per esteso e con le fonti: quali modelli AI usa e quali aziende esclude, e perché. Le stesse pagine le puoi leggere anche senza connessione, e puoi chiederne conto a Filo in chat — le rilegge e risponde con quello che c’è scritto, invece di improvvisare. Le sezioni su privacy, sicurezza e su come Filo si sostiene sono in arrivo.',
      invoke: 'Pagina filo://transparency/transparency.html; in chat basta chiedere perché Filo usa un certo modello o un’azienda invece di un’altra.',
      doesNot: 'Non è un riassunto scritto dall’assistente: è il testo dell’autore di Filo, e quando cambia idea la pagina riporta la data dell’ultima revisione.',
    },
    {
      id: 'filo-assistant', title: 'Chiedi a Filo (assistente)', category: 'assistant',
      desc: 'L’assistente conversazionale di Filo: gli scrivi a parole cosa ti serve e ti risponde, tenendo conto di ciò che gli hai detto in passato. Conosce anche i tuoi documenti dell’editor (appunti inclusi) tramite un breve riassunto di ciascuno, sempre aggiornato: così sa di cosa parlano senza doverli tenere tutti aperti, e quando per risponderti gli serve un documento per intero lo legge al momento. Oltre a rispondere può fare cose per te — aprire pagine, cercare sul web, impostare timer, prendere appunti, regolare preferenze — chiedendoti conferma per le azioni delicate.',
      invoke: 'Apri una nuova scheda (la sua pagina iniziale è l’assistente) e scrivi nel campo "Chiedi qualsiasi cosa"; in alternativa filo://dashboard/dashboard.html.',
      doesNot: 'Non interviene sulla pagina web che stai guardando: per farti assistere SU una pagina aperta usa l’assistente laterale (Alt+H). Le risposte si basano sui tuoi dati locali, non condivide nulla all’esterno senza chiedertelo.',
    },
    {
      id: 'generate-dashboard', title: 'Dashboard personale di Filo', category: 'assistant',
      desc: 'Quando apri una nuova scheda, Filo prepara un breve messaggio per te e qualche suggerimento utile, in base a ciò che stavi facendo e a ciò che ricorda di te.',
      invoke: 'Si genera da sola all’apertura di una nuova scheda; il messaggio centrale si può nascondere dalle Preferenze ("Commento nella home").',
      doesNot: 'I suggerimenti nascono dai tuoi dati locali e non vengono inviati all’esterno.',
    },
    {
      id: 'agent-actions', title: 'Filo agisce al posto tuo', category: 'assistant',
      desc: 'Su tua richiesta Filo può compiere azioni per te: aprire pagine o file, cercare sul web, impostare timer e sveglie, salvare appunti, regolare preferenze e aspetto, archiviare schede, persino inviare un feedback a tuo nome.',
      invoke: 'Chiedile a parole all’assistente (nuova scheda) oppure all’assistente laterale di pagina (Alt+H).',
      doesNot: 'Le azioni delicate ti vengono prima descritte e partono solo dopo la tua conferma; le più rischiose (cancellazioni irreversibili) chiedono di digitare "conferma". Non esegue nulla di delicato di nascosto.',
    },
    {
      id: 'filo-memory', title: 'Memoria di Filo', category: 'assistant',
      desc: 'Filo ricorda nel tempo chi sei e come preferisci le cose (un profilo e le preferenze che impara dalle conversazioni), così le risposte diventano più su misura.',
      invoke: 'Si costruisce da sola mentre usi l’assistente; per farle dimenticare tutto chiedi a Filo di cancellare la memoria (ti chiederà di digitare "conferma").',
      doesNot: 'Resta solo sul tuo computer. Ricorda ciò che emerge dalle conversazioni con l’assistente, non il contenuto delle pagine che visiti.',
    },
    {
      id: 'filo-notes', title: 'Appunti di Filo', category: 'assistant',
      desc: 'Puoi chiedere a Filo di prendere nota di qualcosa ("prendi nota che…"): lo scrive direttamente in un file dell’editor. Continua sullo stesso file finché resti sull’argomento e ne apre uno nuovo quando l’argomento cambia (o se chiedi "apri un nuovo appunto"). Gli appunti diventano così testo vero, che puoi rileggere, modificare e riordinare insieme agli altri documenti. Ogni volta che Filo scrive crea un punto di ripristino, quindi la modifica è sempre annullabile.',
      invoke: 'Chiedi all’assistente di prendere nota di qualcosa; la conferma «Salvato» che compare in chat apre l’Editor con un click. Ci arrivi anche dall’icona con il foglio degli appunti (menu App o menu del tasto destro): il file giusto lo scegli nel selettore documenti in alto a sinistra. Gli appunti presi prima che diventassero documenti si trovano nel file "Appunti", nello stesso elenco.',
      doesNot: 'Non esiste più un archivio appunti separato da cui elencarli, cancellarne uno o svuotarli tutti: sono file dell’editor sul tuo computer, quindi si rileggono, si modificano e si eliminano da lì come qualsiasi altro documento.',
    },
    {
      id: 'filo-timers', title: 'Timer', category: 'assistant',
      desc: 'Chiedi a Filo di farti da timer ("timer di 10 minuti per la pasta"): il conto alla rovescia compare in alto nella nuova scheda e, allo scadere, parte un avviso sonoro che puoi fermare, più una notifica di sistema. Puoi mettere in pausa un timer e riprenderlo quando vuoi.',
      invoke: 'Chiedi un timer all’assistente; i timer attivi e quelli che stanno suonando si vedono in alto nella nuova scheda. Sulla scheda del timer trovi ⏸ per metterlo in pausa e ▶ per riprenderlo.',
      doesNot: 'La suoneria si sente quando la nuova scheda è aperta; la notifica di sistema arriva comunque finché Filo è in esecuzione, anche ridotto a icona. Con Filo completamente chiuso non suona nulla.',
    },
    {
      id: 'filo-alarms', title: 'Sveglie', category: 'assistant',
      desc: 'Chiedi a Filo una sveglia ("mettimi una sveglia alle 7 per lavoro", "sveglia tra 3 ore"): all’orario stabilito parte un avviso sonoro nella nuova scheda e una notifica di sistema. Se l’orario è già passato oggi, la sveglia viene messa per domani.',
      invoke: 'Chiedi la sveglia all’assistente; le sveglie programmate compaiono in alto nella nuova scheda con il loro orario e puoi rimuoverle con la ×.',
      doesNot: 'Non suona se Filo è completamente chiuso: il browser deve restare in esecuzione (va bene anche ridotto a icona). Per svegliarti al mattino affidati anche a una sveglia vera.',
    },
    {
      id: 'filo-notifications', title: 'Avvisi di Filo', category: 'assistant',
      desc: 'Filo può mostrarti dei brevi avvisi in alto nella nuova scheda (promemoria o segnalazioni discrete) che puoi chiudere quando li hai visti.',
      invoke: 'Compaiono in alto nella nuova scheda; chiudili con la loro "X".',
      doesNot: 'Restano dentro Filo: non sono notifiche del sistema operativo.',
    },

    // ─────────────────────────── Pagine interne ──────────────────────────────
    {
      id: 'home-page', title: 'Home di Filo', category: 'pages',
      desc: 'La pagina della nuova scheda: al centro l’assistente a cui chiedere qualsiasi cosa, azioni e suggerimenti, un messaggio in evidenza e gli aggiornamenti recenti. In alto a destra ci sono le icone per Red Team, Cronologia, Impostazioni, App e Profilo.',
      invoke: 'Apri una nuova scheda, l\'icona Home in alto a destra nella home, oppure indirizzo filo://newtab/.',
    },
    {
      id: 'red-team', title: 'Red Team', category: 'pages',
      desc: 'Il programma per mettere alla prova la sicurezza di Filo: provi a farne aggirare le difese e, per i tentativi riconosciuti come attacchi reali, guadagni crediti e sali in classifica. La pagina raccoglie le tue statistiche e i tuoi record, la classifica dei partecipanti e le regole del gioco. Per partecipare davvero serve un codice di invito, che leghi al tuo account e sblocca le statistiche personali.',
      invoke: 'Icona a scudo rosso in alto a destra nella home (nuova scheda), oppure indirizzo filo://redteam/redteam.html.',
      doesNot: 'Senza un codice di invito puoi leggere regole e classifica ma non accumulare punteggi. La creazione dei codici di invito è riservata a chi gestisce Filo.',
    },
    {
      id: 'patch-notes', title: 'Recap degli aggiornamenti', category: 'pages',
      desc: 'All’avvio di una nuova versione, un riquadro riassume le novità e le correzioni in parole semplici.',
      invoke: 'Compare da solo all’avvio dopo un aggiornamento.',
    },
    {
      id: 'board', title: 'Bacheca dei miglioramenti', category: 'pages',
      desc: 'La pagina dove ritrovi i miglioramenti già rilasciati e puoi dire se funzionano o no, votando con un tocco. Leggono tutti; per votare basta accedere. Il primo voto su ogni miglioramento regala 10 crediti, e puoi sempre cambiare idea o ritirare il voto. Se un miglioramento risulta ancora rotto, puoi segnalarlo con "Ancora rotto?": pochi crediti di spesa per evitare segnalazioni a caso, e la segnalazione torna nell\'iter normale collegata all\'originale.',
      invoke: 'Menu App → "Bacheca", oppure filo://board/board.html.',
      doesNot: 'Non mostra segnalazioni in lavorazione né dettagli tecnici o di sicurezza: solo i miglioramenti già usciti. Ogni miglioramento si può segnalare come "ancora rotto" una volta sola.',
    },

    // ───────────────────────────── Impostazioni ──────────────────────────────
    {
      id: 'options-models', title: 'Modelli e chiavi AI', category: 'settings',
      desc: 'Imposta le chiavi dei servizi AI (OpenRouter, Google Gemini, Tavily), scegli il modello di OGNI funzione che ne usa uno — con la possibilità di indicarne più d’uno come ripiego, provati in ordine — e un limite di spesa mensile. Puoi anche affidarti ai modelli predefiniti di Filo.',
      invoke: 'Menu del tasto destro → "Opzioni Filo", oppure filo://options/options.html.',
      doesNot: 'Le chiavi sono salvate cifrate in locale. Nessuna funzione usa un modello che non hai impostato: se a una funzione manca il modello, o punta a uno che non esiste, quella funzione si ferma e lo segnala quando la usi — non ne sceglie uno per conto suo.',
    },
    {
      id: 'open-weights-only', title: 'Solo modelli a pesi aperti', category: 'settings',
      desc: 'Un interruttore spegne tutti i modelli proprietari — Anthropic compresa, cioè anche quelli scelti da chi fa Filo — e lascia lavorare solo modelli a pesi aperti serviti da fornitori indipendenti. Vale anche quando usi i crediti di Filo. Le funzioni che partivano da un modello proprietario passano da sole al suo equivalente aperto, e le Opzioni dicono subito quante cambiano e quali si fermano.',
      invoke: 'Opzioni → «Solo modelli a pesi aperti», oppure chiedendolo a Filo ("usa solo modelli a pesi aperti").',
      doesNot: 'Le poche funzioni senza equivalente aperto (lettura ad alta voce, dettatura, indicizzazione dell’archivio) si fermano e lo dicono: non tornano di nascosto su un modello proprietario, nemmeno se il sostituto non risponde. Non governa i modelli che girano sui server di Filo, come i giudici dei feedback.',
    },
    {
      id: 'model-usage-census', title: 'Dove Filo usa un modello', category: 'settings',
      desc: 'L’elenco completo dei punti in cui Filo usa un modello, anche quelli che non si vedono: riordino delle schede, riassunti, memoria, etichette dei mazzi, giudizi sui feedback, indicizzazione dell’archivio. Per ognuno c’è scritto se il modello lo scegli tu, se lo sceglie chi gestisce Filo, o se quel punto un modello non lo usa affatto.',
      invoke: 'Opzioni → sezione dei modelli (l’elenco sta sotto le funzioni impostabili).',
      doesNot: 'Non esiste un punto in cui Filo usi un modello deciso dal codice e non modificabile da nessuno: se ne comparisse uno, l’elenco non sarebbe più completo.',
    },
    {
      id: 'preferences', title: 'Preferenze', category: 'settings',
      desc: 'Tema (chiaro/scuro/sistema), dimensione del testo delle pagine interne, archiviazione automatica delle schede, stile dell’assistente, voce/velocità/tono della lettura, e notifiche.',
      invoke: 'Pagina filo://preferences/preferences.html.',
    },
    {
      id: 'security', title: 'Sicurezza e privacy', category: 'settings',
      desc: 'Protezione dalla fuga del tuo indirizzo IP, blocco dei popup, gestione dei cookie (manuale / predefinita / privacy massima) e lista dei siti fidati.',
      invoke: 'Pagina filo://security/security.html.',
    },
    {
      id: 'data-export-import', title: 'Esporta e importa i tuoi dati', category: 'settings',
      desc: 'Salva tutto quello che Filo sa di te (memorie degli agenti, pagine salvate, cronologia, appunti copiati, costi e impostazioni) in un unico file .zip, e lo ricarica quando vuoi — sullo stesso computer come backup, o su un altro per portarti dietro il tuo Filo. Le immagini copiate finiscono nell\'archivio come file veri, sfogliabili, e al ritorno tornano al loro posto. Prima di scrivere qualsiasi cosa, l\'importazione ti dice cosa contiene il file scelto (di quando è il backup, quante sezioni e quante immagini) e chiede conferma: quello che hai già non viene cancellato, le liste si uniscono senza duplicati e, dove lo stesso dato esiste da entrambe le parti, vince quello del backup. Le impostazioni ripristinate (tema, sicurezza, cookie) diventano attive subito, senza riavviare.',
      invoke: 'Impostazioni → Sicurezza, in fondo: "Esporta dati (.zip)" e "Importa dati (.zip)".',
      doesNot: 'Non è un backup automatico né in cloud: il file lo salvi tu, dove vuoi. Importando non si cancella nulla di quello che c\'è già, quindi non è un modo per riportare Filo a uno stato passato esatto. Legge solo archivi esportati da Filo, non backup di altri browser.',
    },
    {
      id: 'auto-feedback', title: 'Segnalazione automatica dei problemi', category: 'settings',
      desc: 'Quando Filo non riesce a fare qualcosa che gli chiedi, invia automaticamente una segnalazione anonima e generica a chi sviluppa l\'app — senza includere URL o testo personale. Tenerlo attivo premia con 10 crediti extra al giorno.',
      invoke: 'Impostazioni → Sicurezza → "Segnalazione automatica dei problemi".',
      doesNot: 'Non invia mai URL, testo delle conversazioni o dati personali: solo una nota generica sulla funzione mancante.',
    },
    {
      id: 'theme', title: 'Tema chiaro / scuro', category: 'settings',
      desc: 'Sceglie l’aspetto chiaro, scuro o automatico per le pagine di Filo.',
      invoke: 'Preferenze → Tema.',
    },

    // ────────────────────────────── Crediti ──────────────────────────────────
    {
      id: 'credits', title: 'Crediti e consumi', category: 'credits',
      desc: 'Mostra il saldo dei crediti, quando si ricaricano e un grafico di come li hai spesi tra le varie azioni. Puoi anche chiedere a Filo in chat quanti crediti ti restano: te lo dice al volo, senza aprire la pagina.',
      invoke: 'Chiedendolo a Filo in chat ("quanti crediti mi restano?"), oppure dalla pagina filo://credits/credits.html per il dettaglio e il grafico.',
    },
  ];

  // ── API ────────────────────────────────────────────────────────────────────

  // Indice COMPATTO (id + titolo + categoria), pensato per stare sempre in
  // contesto all'agente senza pesare: il dettaglio si recupera con get(id).
  function index() {
    return CAPABILITIES.map((c) => ({ id: c.id, title: c.title, category: c.category }));
  }

  // Dettaglio completo di una capacità per id (o undefined).
  function get(id) {
    return CAPABILITIES.find((c) => c.id === id);
  }

  // Tutte le capacità di una categoria.
  function byCategory(category) {
    return CAPABILITIES.filter((c) => c.category === category);
  }

  // Tutte le capacità (copia per non far mutare l'originale).
  function all() {
    return CAPABILITIES.slice();
  }

  // ── Rendering per il prompt dell'agente (F2) ────────────────────────────────
  //
  // Indice COMPATTO da tenere sempre in contesto all'agente di chat: una riga per
  // capacità (titolo + id stabile), raggruppata per categoria. Pesa poco (~44
  // righe) e basta all'agente per capire SE Filo sa fare una cosa; per il COME
  // esatto (invoke) e i limiti (doesNot) c'è renderDetailForPrompt(ids), che
  // l'agente recupera on-demand con l'azione CAPACITA_DETTAGLIO. L'id tra []
  // serve all'agente per chiedere il dettaglio della voce giusta.
  function renderIndexForPrompt() {
    const lines = [];
    for (const [cat, label] of Object.entries(CATEGORIES)) {
      const items = CAPABILITIES.filter((c) => c.category === cat);
      if (!items.length) continue;
      lines.push(`${label}:`);
      for (const c of items) lines.push(`  - ${c.title} [${c.id}]`);
    }
    return lines.join('\n');
  }

  // Dettaglio completo (cosa fa / come si attiva / limiti) di una o più capacità
  // per id, formattato per essere reinserito nel contesto dell'agente come
  // OSSERVAZIONE (dati, non istruzioni). Gli id sconosciuti vengono segnalati
  // esplicitamente così l'agente non finge di averli trovati.
  function renderDetailForPrompt(ids) {
    const list = Array.isArray(ids) ? ids : (ids ? [ids] : []);
    if (!list.length) return '(nessuna capacità richiesta)';
    const blocks = [];
    for (const rawId of list) {
      const id = String(rawId || '').trim();
      const c = get(id);
      if (!c) {
        blocks.push(`• "${id}": nessuna capacità con questo id (Filo non sa fare questa cosa).`);
        continue;
      }
      let b = `• ${c.title} [${c.id}]\n  Cosa fa: ${c.desc}\n  Come si attiva: ${c.invoke}`;
      if (c.doesNot) b += `\n  Limiti: ${c.doesNot}`;
      blocks.push(b);
    }
    return blocks.join('\n\n');
  }

  global.SN_CAPABILITIES = {
    CATEGORIES, CAPABILITIES, index, get, byCategory, all,
    renderIndexForPrompt, renderDetailForPrompt,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
