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
  torna, ente che non si riconosce, file cambiato dopo la firma. Quando una firma
  non regge non si riferisce nemmeno cosa affermava: ripeterlo è darle voce.
- **Quello che la firma non copre non è firmato.** In C2PA il claim elenca le
  asserzioni con la loro impronta: si legge solo quello che combacia, e il
  legame duro sui byte del file decide se le credenziali parlano ancora di
  *questa* immagine. Un'asserzione fuori dall'elenco è testo che chiunque ha
  potuto infilare nel file dopo.

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
stessi byte che la descrizione ha già scaricato — mai un secondo download. In
chat lo stesso controllo si fa su **ogni** immagine allegata, senza provare a
indovinare se l'utente stava chiedendo proprio quello: capirlo dall'intento
sarebbe [una promessa affidata al
modello](una-promessa-fatta-allutente-non-puo-dipendere-dal-modello.md).

Il codice: `src/shared/provenienzaImmagine.js` (lettura dei contenitori, JUMBF,
COSE, verdetto e frase), `tests/helpers/immagineFirmata.mjs` (immagini di prova
firmate davvero: certificato, firma e legame duro, così la prova diventa rossa
se il lettore smette di verificare).
