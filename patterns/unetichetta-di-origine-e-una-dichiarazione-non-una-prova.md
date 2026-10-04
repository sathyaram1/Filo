# Un'etichetta di origine è una dichiarazione, non una prova

[← Tutti i pattern](../PATTERNS.md)

Quando Filo dice da dove viene una cosa — un'immagine generata con l'AI, uno
scatto firmato da una fotocamera — sta riportando quello che quella cosa dice di
sé. **Il silenzio non è un verdetto, e non si trasforma mai nel suo contrario.**

La regola, in tre pezzi:

- **Se non c'è etichetta, non si scrive niente.** Mai «immagine reale», mai
  «autentica», mai «nessun segno di AI». Le etichette si perdono a ogni
  ricompressione, uno screenshot le butta via, i social le cancellano e molti
  generatori non le scrivono affatto: l'assenza è il caso più comune, non
  un'informazione. Dove l'utente fa la domanda esplicita («questa foto è fatta
  con l'AI?») il silenzio non basta più, e allora si risponde che il file non
  porta etichette **e che questo non prova niente**.
- **La forza della dichiarazione si vede.** Una firma verificata («lo dichiara
  OpenAI nelle credenziali firmate») e un'etichetta scritta nel file senza firma
  («lo dichiara il file stesso») non sono la stessa frase e non hanno lo stesso
  peso a schermo. In mezzo ci sono i casi che vanno detti per nome: firma che non
  torna, firmatario fuori dall'elenco, file cambiato dopo la firma. Quando una
  firma non regge non si riferisce nemmeno cosa affermava: ripeterlo è darle voce.
- **Chi ha firmato si riconosce da una cosa sola: l'elenco ufficiale.** La catena
  del certificato deve arrivare a un'autorità dell'elenco dei firmatari che
  pubblica chi gestisce lo standard, e il certificato deve essere fatto per
  firmare credenziali. Il nome scritto nel certificato non conta: un certificato
  «OpenAI» se lo fa chiunque in un minuto. L'elenco Filo lo scarica da sé e lo
  tiene su disco; **finché non l'ha mai avuto dice «firma valida, firmatario non
  verificato»**, che non è «sconosciuto»: sono due stati diversi e hanno due frasi
  diverse. Un elenco scaricato male non prende il posto di quello buono.
- **Un certificato scaduto oggi non accusa una firma di ieri.** La firma vale se
  è stata fatta quando il certificato valeva, e lo dice solo una marca temporale
  la cui firma regge e la cui autorità sta nel secondo elenco ufficiale, quello
  delle autorità di marcatura (#946). Senza una marca così, il certificato
  scaduto rende le credenziali «incomplete».
- **Quello che la firma non copre non è firmato.** In C2PA il claim elenca le
  asserzioni con la loro impronta: si legge solo quello che combacia, e il
  legame duro sui byte del file decide se le credenziali parlano ancora di
  *questa* immagine. Un'asserzione fuori dall'elenco è testo che chiunque ha
  potuto infilare nel file dopo. Le impronte si calcolano come le calcola lo
  standard (sul contenuto del box, senza intestazione), e **le prove usano anche
  file scritti dall'SDK di riferimento** (`tests/fixtures/provenienza/`): un
  lettore e un generatore di prova scritti dalla stessa mano sbagliano insieme e
  passano insieme, ed è così che al primo giro #711 taceva su ogni file vero.
- **La storia del file conta.** Un'immagine generata e poi ritagliata in un
  programma che tiene le credenziali dice «generata» nel manifesto del passo
  prima: si segue l'ingrediente, se la sua impronta è quella firmata dal passo
  dopo e se la sua firma regge, e a dichiarare è chi ha firmato quel manifesto.
- **Dai pixel non si stima niente.** Niente classificatori a percentuale, e il
  modello che descrive l'immagine non parla della sua origine. Un marchio
  invisibile (TrustMark, quello di Stable Diffusion) è un messaggio noto, non una
  stima, e se arriverà (#889) si leggerà dove l'immagine è già decodificata per
  mostrarla, mai nel processo principale: un decoder d'immagini lì è una porta
  aperta a chiunque mandi un file.

**I nomi dentro l'etichetta li scrive chi ha fatto il file.** Il soggetto di un
certificato e il generatore dichiarato sono contenuto esterno a tutti gli
effetti: a schermo si scrivono come testo e accorciati, verso un modello passano
imbustati ([Il canale fidato non trasporta testo di
fuori](il-canale-fidato-non-trasporta-testo-di-fuori.md)). La frase la compone
Filo, i nomi no.

**Il controllo vale su tutti i cammini che portano alla stessa cosa.** Il
riquadro «Spiega immagine» compare su quattro rami del menu del tasto destro
(immagine cliccata, immagine dentro un link, sotto un velo, sotto un velo dentro
un link): il controllo sta dentro il riquadro, non dentro i rami, e gira sugli
stessi byte che la descrizione ha già scaricato — mai un secondo download. Le foto
dei siti veri stanno quasi sempre su un altro dominio, che lo script della pagina
non può leggere: quei byte li scarica il main, come «Salva immagine come…»
(#946; prima descrizione e origine tacevano proprio sui siti veri, e le prove
servite dallo stesso host non se ne accorgevano). Una copia negli appunti perde
le etichette (gli appunti ricodificano l'immagine): l'esito letto sull'originale
al momento di «Copia immagine» si ricorda per i pixel della copia, e la chat lo
ritrova quando l'immagine torna incollata. Nell'Aiuto della pagina si leggono le immagini che l'utente ha davanti, dalle
più grandi, a ogni sua domanda. In
chat lo stesso controllo si fa su **ogni** immagine allegata, senza provare a
indovinare se l'utente stava chiedendo proprio quello: capirlo dall'intento
sarebbe [una promessa affidata al
modello](una-promessa-fatta-allutente-non-puo-dipendere-dal-modello.md).

Il codice: `src/shared/provenienzaImmagine.js` (lettura dei contenitori, JUMBF,
COSE, catena fino all'elenco, ingredienti, verdetto e frase),
`src/main/services/firmatariC2pa.js`
(l'elenco: scaricarlo, tenerlo, e l'unica lettura che usano menu, chat e Aiuto),
`tests/helpers/immagineFirmata.mjs` (immagini di prova firmate davvero: autorità,
certificato, firma e legame duro, così la prova diventa rossa se il lettore
smette di verificare).
