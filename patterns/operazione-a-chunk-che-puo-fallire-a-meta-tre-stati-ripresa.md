# Operazione a chunk che può fallire a metà: tre stati, ripresa, avviso onesto

[← Tutti i pattern](../PATTERNS.md)

Un lavoro spezzato in N richieste al modello (traduzione di pagina, e in futuro
qualsiasi elaborazione lunga applicata al DOM) **fallisce quasi sempre a metà**,
non del tutto: la rete cade al terzo pezzo, il credito finisce a metà strada. Il
booleano "fatto / non fatto" è quindi il modello di stato sbagliato — mente
all'utente e gli fa buttare (e ripagare) il lavoro già riuscito.

- **Tre stati, non due**: assente / **parziale** / completa. Il menu offre azioni
  diverse nei tre casi ("Traduci" / "Riprendi traduzione" / "Mostra originale").
- **Su una pagina viva, "completa" scade.** I siti che si allungano scorrendo e
  quelli che cambiano schermata senza ricaricare aggiungono testo DOPO che il
  lavoro si è dichiarato finito: se il menu in quello stato offre solo il ritorno
  all'originale, l'unico modo di tradurre tre righe nuove è buttare (e ripagare)
  l'intera pagina. Serve un quarto stato — **completa ma con roba nuova** → "Traduci
  il testo nuovo" — che riusa la stessa ripresa. Accorgersene costa una
  `MutationObserver` che alza soltanto un flag (l'apertura del menu deve restare
  istantanea: niente scansioni lì dentro); il conto vero lo rifà la traduzione,
  che rilegge la pagina e salta ciò che è già marcato. L'osservatore ignora la UI
  di Filo iniettata nella pagina (prefisso `sn-`) e non ha bisogno di staccarsi
  mentre traduciamo: le nostre sostituzioni nascono **già marcate**
  (`data-sn-translated` scritto nella stessa esecuzione in cui si sostituiscono i
  figli), quindi il filtro le scarta da sé.
- **Il testo arrivato DURANTE il lavoro conta come quello arrivato dopo.**
  Scorrere mentre si aspetta è il comportamento normale: se la sorveglianza parte
  solo a lavoro finito, quelle righe non le vede nessuno e l'avviso finale
  dichiara tradotta una pagina che sotto gli occhi è mezza in lingua originale.
  Sorvegliare **da prima di cominciare** e rifare un giro (con un tetto: su un
  sito che carica all'infinito rincorrerlo non finirebbe mai) costa solo il testo
  nuovo, perché la rilettura salta ciò che è già marcato. Se dopo il tetto ne è
  arrivato dell'altro, lo dice e lascia la voce di menu.
- **"Nascosto adesso" non è "da non tradurre mai".** Una fisarmonica chiusa, una
  scheda in secondo piano, un "leggi tutto" ripiegato: quel testo non si traduce
  (l'utente potrebbe non aprirlo mai, e lo pagherebbe), ma i sottoalberi saltati
  **per motivi di visibilità** si segnano a parte — sono un motivo di salto
  diverso da `translate="no"`/UI di Filo. Quando uno di quelli torna visibile, per
  chi guarda lo schermo è identico al testo che il sito ha appena aggiunto, e il
  menu deve offrire la stessa cosa: "Traduci il testo nuovo", non "butta via
  tutto e ricomincia".
- **Un lavoro lungo si deve poter fermare, e fermarlo deve durare.** Mentre la
  traduzione lavora l'icona del menu è il **ritorno all'originale** (prima lì
  c'era "Traduci la pagina", che a lavoro in corso non faceva niente: un vicolo
  cieco). E il ritorno indietro deve reggere contro le richieste già spedite: un
  **numero d'ordine del giro** sulle unità di lavoro fa buttare via le risposte in
  volo, invece di lasciarle ricadere sulla pagina qualche secondo dopo e
  ritradurla a metà. E l'avviso "sto lavorando" si chiude **nell'istante** in cui
  l'utente ferma, non quando le richieste già spedite si decidono a tornare. Un
  riquadro "in corso" accanto a "annullata" gli dice che nessuno l'ha ascoltato.
  Quindi l'handle dell'avviso di avanzamento vive dove arriva anche
  l'annullamento, non solo dentro la funzione che lavora. Vale per qualsiasi
  lavoro asincrono annullabile, non solo qui.
- **La ripresa non ripaga ciò che è già fatto**: i pezzi conclusi si marcano nel
  DOM (`data-sn-translated`) e si escludono **prima** di costruire le richieste,
  non dopo aver ricevuto la risposta. Escluderli dopo significa pagare due volte
  gli stessi token.
- **Saltare il pezzo fatto, non il suo sottoalbero**: nel walker di estrazione un
  elemento già elaborato è `FILTER_SKIP`, mai `FILTER_REJECT`. Con REJECT i
  blocchi *annidati* che l'interruzione non ha ancora toccato diventano
  irraggiungibili e nessuna ripresa può più completarli.
- **L'avviso dice a che punto si è fermato e perché**: "interrotta dopo X di Y" +
  la frase di `SN_CHAT_ERRORS` (la regola "mai il messaggio grezzo" vale per i
  toast di pagina esattamente come per le bolle di chat) + come riprendere. Mai
  un messaggio di successo su un lavoro monco.
- **"Il modello ha risposto a vuoto" non è un errore, ed è un motivo a sé.** La
  richiesta è partita, la risposta è tornata, semplicemente non conteneva testo:
  fabbricare un `Error` per farla passare da `SN_CHAT_ERRORS` produce "Qualcosa è
  andato storto. Riprova", che non dice niente e contraddice la riga successiva,
  dove si spiega come riprendere. Il ripiego per l'errore mancante esisteva già
  ("alcuni blocchi sono tornati vuoti dal modello"): la risposta vuota deve
  arrivarci, non scavalcarlo. In generale: prima di tradurre un guasto in una
  frase, chiedersi se un guasto c'è stato davvero.
- **Se l'icona cambia mestiere, l'azione che ha lasciato scoperta torna come
  voce**: nello stato parziale l'icona serve a riprendere, quindi "Mostra
  originale" compare come voce etichettata del menu (stesso schema di
  "Interrompi lettura", che appare solo mentre la sintesi è in corso).
- **Avanzamento reale mentre lavora**: il totale dei pezzi è noto, quindi
  l'avviso "in corso" mostra `fatti/totale` invece di una frase fissa.
- **Dove:** `src/content/translatePage.js` (stato + ripresa),
  `src/content/extractContext.js` (`extractTranslatableBlocks`),
  `src/content/menuIcons.js` + `src/content/content.js` (menu). Test:
  `tests/translate-page.spec.mjs`, `tests/verify-407-stress.spec.mjs`.
