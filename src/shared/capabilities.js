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
      invoke: 'Pulsante "+" nella barra delle schede, oppure dal menu del tasto destro → "Nuova scheda".',
    },
    {
      id: 'close-tab', title: 'Chiudi la scheda', category: 'navigation',
      desc: 'Chiude la scheda corrente; la pagina chiusa finisce nell’archivio, da cui puoi riaprirla.',
      invoke: 'Pulsante di chiusura sulla scheda, oppure menu del tasto destro → "Chiudi pagina".',
      doesNot: 'Le finestre in incognito e le pagine interne di Filo non vengono archiviate.',
    },
    {
      id: 'navigate-back-forward', title: 'Indietro / Avanti', category: 'navigation',
      desc: 'Torna alla pagina precedente o va a quella successiva nella cronologia della scheda.',
      invoke: 'Frecce nella barra in alto, oppure menu del tasto destro → "Indietro" / "Avanti". Ctrl+Z torna alla pagina precedente (quando non stai scrivendo in un campo di testo).',
    },
    {
      id: 'reload', title: 'Ricarica la pagina', category: 'navigation',
      desc: 'Ricarica la pagina corrente.',
      invoke: 'Pulsante di ricarica nella barra in alto, oppure menu del tasto destro → "Ricarica".',
    },
    {
      id: 'home', title: 'Vai alla home', category: 'navigation',
      desc: 'Apre la home di Filo nella scheda corrente, con suggerimenti e aggiornamenti.',
      invoke: 'Pulsante Home nella barra, oppure menu del tasto destro → "Home".',
    },
    {
      id: 'address-bar', title: 'Barra degli indirizzi', category: 'navigation',
      desc: 'Digita un indirizzo per navigare, o un termine per cercare sul web.',
      invoke: 'Barra degli indirizzi in alto.',
    },
    {
      id: 'incognito', title: 'Finestra in incognito', category: 'navigation',
      desc: 'Apre una nuova finestra privata e isolata: la sessione è effimera e non viene archiviata.',
      invoke: 'Menu del tasto destro → "Nuova finestra incognito".',
    },
    {
      id: 'fullscreen', title: 'Schermo intero', category: 'navigation',
      desc: 'Nasconde la barra delle schede e degli indirizzi così la pagina occupa tutta la finestra.',
      invoke: 'Menu del tasto destro → "Schermo intero" / "Esci da schermo intero".',
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
      desc: 'Gestisci le correzioni automatiche (errore → correzione) e il dizionario personale di parole da non segnalare.',
      invoke: 'Pagina filo://spellcheck/spellcheck.html.',
    },
    {
      id: 'editor', title: 'Editor di testo', category: 'writing',
      desc: 'Un editor per scrivere e impaginare testo con moduli a blocchi; il contenuto viene salvato da solo. È anche il posto degli appunti: quando chiedi a Filo di prendere nota, scrive lui stesso in un file qui dentro. Puoi tenere più documenti separati: il selettore in alto a sinistra mostra il nome del file aperto e apre l\'elenco dei documenti, da cui crei un nuovo file, passi da uno all\'altro, li rinomini ed elimini; alla riapertura ritrovi l\'ultimo documento su cui stavi lavorando. Eliminare un documento è immediato ma annullabile: subito dopo compare un avviso con "Annulla" che riporta indietro il file — testo, commenti, moduli e storico — al suo posto. Nella pagina "Revisione" puoi attaccare commenti a frasi selezionate: il testo commentato resta evidenziato anche dopo aver chiuso e riaperto il documento, e cliccandolo riapri il commento. Ogni modifica che Filo fa da solo al documento (formattare il testo su richiesta della chat, oppure scrivere un appunto) crea un punto di ripristino: subito dopo compare un avviso con "Annulla" per tornare com\'era, e lo storico di ogni documento resta disponibile anche dopo aver chiuso e riaperto Filo, così una modifica automatica è sempre reversibile. Anche le tue modifiche manuali significative creano un punto di ripristino: quando scrivi o cancelli molto a mano e poi ti fermi un momento, o quando cambi documento, Filo salva da solo lo stato — così se poi vuoi tornare a un punto precedente lo ritrovi nello storico, senza aver dovuto salvare nulla. Dallo "Storico versioni" (nel menu documenti in alto a sinistra o col tasto destro sul titolo) puoi sfogliare TUTTE le versioni salvate, dalla più recente alla più vecchia, con data, sorgente (le modifiche di Filo sono evidenziate) e un\'anteprima del testo; clicchi una versione per vederne l\'anteprima completa e la ripristini quando vuoi — anche il ripristino è annullabile, perché prima salva lo stato attuale come nuova versione. I documenti senza nome prendono un titolo da soli: quando il testo supera un centinaio di parole Filo propone un titolo basato sul contenuto (una volta sola, e mai se hai già dato tu un nome al file); il titolo resta modificabile a mano. Ogni documento tiene anche un breve riassunto del suo contenuto, scritto da solo e aggiornato mentre lavori: serve a Filo per sapere di cosa parlano i tuoi file senza tenerli aperti. Col tasto destro sul titolo apri un menu per rigenerare il titolo o il riassunto, rinominare, duplicare o eliminare il documento.',
      invoke: 'Menu del tasto destro → "Editor", oppure filo://editor/editor.html. Il selettore documenti è in alto a sinistra; col tasto destro sul titolo apri il menu (storico versioni, rigenera titolo, rigenera riassunto, rinomina, duplica, elimina). Dopo una modifica automatica di Filo, l\'avviso "Annulla" in basso a destra la annulla; per tornare a una versione più lontana apri lo "Storico versioni" dal menu documenti o dal tasto destro sul titolo.',
      doesNot: 'Lo storico tiene i punti di ripristino delle modifiche automatiche di Filo, dei ripristini e delle tue modifiche manuali SIGNIFICATIVE (quando scrivi o cancelli molto), non ogni singola battuta né le piccole correzioni.',
    },
    {
      id: 'deck-builder', title: 'Deck builder MTG (Commander)', category: 'writing',
      desc: 'Costruttore di mazzi Commander salvati sul tuo computer: libreria dei mazzi, banco di lavoro a tre colonne regolabili, elenco carte con simboli di mana raggruppato per tipo/tag/costo/colore, commander con avvisi di legalità (doppioni, colori, carte bandite); se il mazzo non ha ancora un nome tuo, impostare il commander gli dà automaticamente il nome del commander (e lo aggiorna se cambi commander). Nel banco di lavoro c\'è la chat con Filo: cerchi carte con una query secca o una frase in linguaggio naturale (risultati già filtrati sui colori del commander, con tasto per aggiungerle al mazzo) — per le ricerche "a parole" che descrivono un effetto o un tema Filo getta una rete ampia (sinonimi e formulazioni diverse) e poi passa i risultati al setaccio tenendo solo le carte che rispettano davvero la richiesta, riusando i giudizi già dati per le ricerche ripetute; chiedi pareri o peschi carte da un altro tuo mazzo; mentre Filo pensa il suo ragionamento scorre in diretta nella bolla e resta poi consultabile in un blocco "Ragionamento" apribile e richiudibile con un click, e se una ricerca viene rifiutata dall\'archivio carte Filo la corregge e riprova da solo (o spiega il problema in chiaro). Passando il mouse su una carta (nei risultati, nel mazzo o nei nomi citati in chat) il pannello destro mostra l\'anteprima con immagine, prezzo e tag (le carte bifronte hanno un tasto per girarle e vedere il retro, o basta cliccare la carta); cliccandola si apre il carosello per valutare le carte una a una con la tastiera (frecce per scorrere, Invio per aggiungere/rimuovere, Esc per chiudere) — cliccando un nome citato nel testo il carosello sfoglia tutte le carte nominate in quel messaggio, e la carta mostrata è evidenziata nel testo e negli elenchi. Sotto l\'anteprima (e nel carosello) c\'è un riquadro modulare: col tasto destro scegli cosa mostra — dati della carta, mini curva di mana con evidenziato dove cadrebbe la carta, prezzo con ristampe e legalità, oppure il parere di Filo sulla carta rispetto al tuo mazzo (calcolato quando serve e ricordato; se poi modifichi il mazzo il parere resta visibile con un pallino "da aggiornare" e un tasto per rigenerarlo). In chat puoi chiedere "valuta il mazzo" per avere una sintesi e il parere pronto su tutte le carte, e "tagga il mazzo con ramp, draw, removal" per far assegnare i tag a Filo carta per carta (i giudizi già dati vengono ricordati anche per gli altri mazzi); i tag alimentano raggruppamento, calcolatore di probabilità e richieste tipo "il ramp di mazzo X". Puoi anche trascinare una carta dell\'elenco su una categoria per spostarla: raggruppato per tag, rilasciarla su un tag chiede se aggiungerlo a quelli già presenti o sostituirli tutti (nessuna domanda quando non c\'è scelta da fare), e "Senza tag" toglie tutti i tag; nelle viste per tipo/costo/colore il trascinamento sposta la carta nel gruppo scelto. A riposo il pannello destro mostra le statistiche del mazzo: curva di mana con costo medio, mana richiesto e prodotto per colore, composizione per tipo con totale su 100, check di legalità, budget in euro (tetto impostabile dal menu del mazzo o in chat con "budget 40 euro", con totale e residuo sempre visibili) e un calcolatore di probabilità di pescata (per tag e turno, dal pannello o chiedendo in chat "che probabilità ho di avere 2 ramp e 3 terre al turno 10?"); nel pannello la stima si aggiorna da sola appena cambi turno, categorie o mazzo, raffinandosi fino a convergere senza bisogno di ricalcolare a mano. Puoi anche importare/esportare un mazzo come lista di testo (formato "1 Sol Ring" per riga, quello di Moxfield/Archidekt) dal menu del mazzo: l\'import mostra sempre un\'anteprima di conferma con le carte riconosciute (e segnala quelle che non ha capito) prima di scrivere qualunque cosa; l\'export genera lo stesso formato, pronto da copiare. In alternativa puoi incollare la lista direttamente in chat, anche scritta male o con nomi in italiano: Filo la interpreta, propone l\'elenco da confermare carta per carta o tutto insieme, e risolve i nomi su Scryfall prima di aggiungerli.',
      invoke: 'Menu App → "Deck builder MTG", oppure filo://decks/decks.html. Tasto destro su carte e mazzi per le azioni; click sul nome del mazzo per gestirlo (include "Importa…"/"Esporta…"); la barra in basso a sinistra del banco di lavoro è la chat/ricerca (incolla lì una lista per l\'import via chat); click su una carta per sfogliarla nel carosello; trascina una carta dell\'elenco su un\'altra categoria per spostarla (o taggarla, in vista per tag); le statistiche sono nel pannello destro a riposo.',
      doesNot: 'Non gioca partite. L\'import non gestisce sideboard/maybeboard (vengono ignorati) né commander in coppia (partner): solo la prima carta della sezione "Commander" diventa il commander del mazzo, le altre entrano come carte normali.',
    },

    // ─────────────────────── Lettura e traduzione ───────────────────────────
    {
      id: 'translate-page', title: 'Traduci l’intera pagina', category: 'reading',
      desc: 'Traduce tutto il testo della pagina mantenendo impaginazione, link e immagini; puoi tornare all’originale.',
      invoke: 'Menu del tasto destro → "Traduci la pagina" / "Mostra originale".',
    },

    // ─────────────────── Immagini e cattura schermo ──────────────────────────
    {
      id: 'explain-image', title: 'Spiega un’immagine', category: 'media',
      desc: 'Descrive un’immagine della pagina, direttamente lì sotto.',
      invoke: 'Clic destro su un’immagine → "Spiega immagine".',
    },
    {
      id: 'copy-download-image', title: 'Copia o scarica un’immagine', category: 'media',
      desc: 'Copia l’immagine negli appunti o la scarica sul computer.',
      invoke: 'Clic destro su un’immagine → "Copia immagine" / scarica.',
    },
    {
      id: 'search-image', title: 'Cerca un’immagine sul web', category: 'media',
      desc: 'Cerca sul web a partire da un’immagine della pagina (ricerca per immagine).',
      invoke: 'Clic destro su un’immagine → cerca immagine.',
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
      invoke: 'Menu del tasto destro → "Aperti per dopo".',
    },
    {
      id: 'archive', title: 'Cronologia delle schede', category: 'save',
      desc: 'La cronologia principale: le schede chiuse raggruppate per giorno, una riga per giorno, colorate come le tab in alto; puoi cercarle anche per contenuto e riaprirle.',
      invoke: 'Icona «Cronologia» in alto a destra nella home (o dalla home → "Cronologia"), pagina filo://archive/archive.html. Clicca una scheda per riaprirla; tasto destro per il menu Riapri/Elimina.',
    },
    {
      id: 'history', title: 'Cronologia delle richieste AI', category: 'save',
      desc: 'L’elenco delle richieste fatte all’AI (spiegazioni, traduzioni, aiuto…), filtrabile e ricercabile; puoi rimuovere una singola voce oppure svuotarla del tutto.',
      invoke: 'Pagina filo://history/history.html. Passa il mouse su una voce e clicca «Rimuovi» per toglierla; «Cancella tutto» svuota l’intera cronologia.',
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
      desc: 'Segnala un problema o una richiesta a chi sviluppa Filo, anche con immagini allegate, e segui le risposte in un thread. L’invio è immediato: se sei senza connessione Filo tiene da parte il feedback e lo spedisce da solo appena la rete torna, anche dopo aver chiuso e riaperto l’app.',
      invoke: 'Menu del tasto destro → "Feedback", oppure filo://feedback/feedback.html.',
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
      invoke: 'Chiedi all’assistente di prendere nota di qualcosa; per rivederli o modificarli apri l’Editor (l’icona con il foglio degli appunti) e scegli il file nel selettore documenti in alto a sinistra.',
      doesNot: 'Non esiste più un archivio appunti separato: vivono nei file dell’editor, sul tuo computer.',
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
      desc: 'La pagina iniziale con azioni suggerite, un messaggio in evidenza e gli aggiornamenti recenti.',
      invoke: 'filo://home/home.html (pulsante Home o nuova scheda).',
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
      desc: 'Imposta le chiavi dei servizi AI (OpenRouter, Google Gemini, Tavily), scegli i modelli per ciascuna azione e un limite di spesa mensile. Puoi anche affidarti ai modelli predefiniti di Filo.',
      invoke: 'Menu del tasto destro → "Opzioni Filo", oppure filo://options/options.html.',
      doesNot: 'Le chiavi sono salvate cifrate in locale.',
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
