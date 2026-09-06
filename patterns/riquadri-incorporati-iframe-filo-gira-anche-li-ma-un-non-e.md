# Riquadri incorporati (iframe): Filo gira anche lì, ma un riquadro non è la pagina

Le pagine vere sono piene di riquadri di altri siti: un video dentro un articolo,
una mappa, un blocco commenti, un modulo. Sono `iframe`, e i preload girano nei
sottoframe **solo** con `nodeIntegrationInSubFrames` (attivo per le schede
esterne, MAI per le pagine `filo://`: lì un riquadro esterno erediterebbe il
preload privilegiato). Senza, dentro il riquadro Filo semplicemente non esiste —
il tasto destro non produce nulla, e per l'utente è un buco nero senza spiegazione
(#405).

Quattro regole quando si tocca qualcosa che vive nel content script:

- **Costo pigro.** Una pagina può avere decine di riquadri che l'utente non tocca
  mai. Nel sottoframe `page-preload.js` non carica NIENTE finché non arriva la
  prima interazione vera (tasto destro, clic, tasto premuto, una scorciatoia
  indirizzata a quel frame); il primo tasto destro viene **rigiocato** appena
  l'handler è pronto, così non serve cliccare due volte.
- **Frame vs pagina.** Ciò che riguarda l'ELEMENTO cliccato funziona identico nel
  riquadro. Ciò che riguarda la PAGINA no: colore della scheda, segnali di
  attività, banner cookie/sito pericoloso, avvisi di sistema, e le azioni globali
  del menu (traduci, condividi, salva, QR, screenshot, feedback, sidebar Aiuto).
  Quelle o restano al frame principale, o gli vengono **rimandate**
  (`MSG.RUN_IN_TOP_FRAME` → `MSG.TOP_FRAME_COMMAND`): eseguirle nel riquadro
  significherebbe condividere l'indirizzo del player invece dell'articolo, o
  disegnare un pannello a tutta superficie dentro un rettangolo di 300 px.
- **I frame non si parlano da soli.** Eventi del mouse e chiamate JS non
  attraversano il confine di un iframe di un'altra origine: ogni coordinamento
  passa dal main (chiusura dei menu degli altri frame, consegna dei suggerimenti
  ortografici nativi a `params.frame`, stream AI verso `event.senderFrame`,
  scorciatoie di selezione verso l'ultimo frame usato). `webContents.send`
  raggiunge **solo** il frame principale: per parlare a tutti serve
  `mainFrame.framesInSubtree`.
- **Un'azione di pagina che tocca il TESTO deve entrare nei riquadri** (#407).
  "Frame vs pagina" dice dove l'azione si esegue, non fin dove arriva: un post
  incorporato o un blocco commenti è testo che l'utente legge, e lasciarlo in
  lingua originale sotto un avviso "Pagina tradotta" è la bugia della
  segnalazione, in un caso più stretto. Il frame principale non può toccarlo (è
  un'altra origine), ma il content script gira già lì dentro: gli si passa
  parola, e ogni riquadro lavora su se stesso. Quattro conseguenze che si pagano
  se si saltano. **Il giro passa dal main**, non da `postMessage`: una postMessage
  la sa scrivere anche il sito, e si ritroverebbe a comandare un riquadro che non
  è suo; il main invece conosce l'albero dei frame e sa chi è il frame
  principale. **Il riquadro va svegliato**: per il costo pigro lì dentro non c'è
  ancora niente di montato, quindi il messaggio che lo comanda deve far partire
  `ensureContentScripts()` e farsi consegnare dopo (stesso cammino delle
  scorciatoie). **Chi non risponde entra nell'avviso**: un riquadro chiuso a
  chiave dal `sandbox` non ha script e non risponderà mai, e il conto dei
  riquadri che si VEDONO (grandi abbastanza da starci del testo) meno quelli che
  si sono fatti vivi è ciò che fa dire "una parte è rimasta fuori" invece di
  "fatto". E se si può tradurre lì dentro si deve poter tornare indietro lì
  dentro: il ritorno all'originale passa parola con lo stesso giro.
  **In un riquadro SENZA indirizzo il preload non entra affatto**, e questo si
  scopre solo provandolo: un `iframe` vuoto riempito dalla pagina stessa
  (`about:blank`, `srcdoc`) resta senza Filo dentro, e quasi tutti i riquadri
  pubblicitari nascono così. Lì non c'è nessuno a cui passare parola e nessuno
  che risponda, quindi due cose insieme: il documento lo legge chi ospita (è
  della stessa origine e `contentDocument` si apre), e quel riquadro esce dal
  conto di chi deve rispondere, o ogni pagina che ne ha uno si prenderebbe a
  torto l'avviso "una parte è rimasta fuori". Entrare così vale SOLO per i
  riquadri senza indirizzo: in quelli con un indirizzo vero il content script
  c'è e traduce da sé, e leggerli anche da fuori è pagare due volte.

Il menu si adatta anche allo spazio: se il riquadro è più basso del menu, il menu
diventa scorrevole invece di essere tagliato.

**Dove:** `_makeView` in `src/main/tabs.js`, `src/preload/page-preload.js`,
`IS_SUBFRAME` in `src/content/content.js` e `src/content/menuIcons.js`, ponte in
`src/main/services/handlers/nav.js`. Test: `tests/iframe-context-menu.spec.mjs`,
`tests/translate-page.spec.mjs`.
