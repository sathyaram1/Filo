# Il menu del sito è una voce del menu di Filo

[← Tutti i pattern](../PATTERNS.md)

Sulle pagine web il tasto destro è di Filo: il ponte del page-preload prende il
`contextmenu` per primo e il sito non lo vede (#589.4). Un sito che ha un menu
suo (Google Docs, Figma) lo perdeva, e l'unica strada era Maiusc, che non stava
scritta da nessuna parte. Decisione dell'owner D62 (#975): il menu del sito
diventa una voce in cima al menu di Filo, e Filo impara.

## Le regole

- **Riconoscere senza lasciar fare.** All'apertura del menu una sonda nel mondo
  della pagina manda al punto cliccato un tasto destro finto. Il primo ascolto
  del sito che ne legge posizione, bersaglio o tasti si ferma lì con
  un'eccezione nostra, prima di poter disegnare qualcosa; anche chi annulla
  senza guardare conta. L'eccezione non arriva né alla console né agli errori
  del sito. React ascolta tutto dalla radice: lì decidono le sue proprietà
  `onContextMenu` sul percorso, e la radice legge l'evento senza fermarsi.
- **Un errore costa una voce in più, mai un clic a vuoto.** Un sito che annulla
  il menu del browser e non mostra niente (blocca e basta) fa comparire la
  voce. Sceglierla gli passa il tasto destro; se entro mezzo secondo il
  documento non cambia (i pezzi di Filo non contano), torna il menu di Filo e
  su quel punto la voce non torna più, finché la pagina resta.
- **Il clic che arriva al sito è vero.** Nel frame principale lo rifà il main
  con `sendInputEvent` sul punto del tasto destro: i siti che guardano
  `isTrusted` aprono il loro menu. Il ponte lascia passare il primo tasto destro
  entro un secondo e mezzo dalla voce. In un riquadro di un altro sito il clic
  del main non arriva, e il tasto destro parte finto dal content script.
- **Al sito il tasto destro, a Filo Maiusc.** Sui siti dell'elenco
  `menuDelSito` il ponte scambia i due gesti. Dove il sito non annulla, si apre
  il menu di Filo, non quello del browser. La voce resta anche lì, con la
  freccia per rimettere il tasto destro a Filo.
- **La proposta una volta, fuori dalla pagina.** Il main conta le scelte per
  sito; alla terza propone con un avviso della finestra, che il sito non copre
  né imita. Il «Sì» vale solo per un sito a cui la proposta è stata fatta
  davvero. In incognito non si conta e non si propone.
- **Il sito è quello del frame che chiede**, ricavato dal main, mai scritto nel
  messaggio. A ogni frame arriva solo la voce dell'elenco che lo riguarda, come
  per i siti esclusi.

## Dove

- sonda e passaggio: `src/preload/menu-del-sito.js`, ponte in `src/preload/page-preload.js`;
- voce e scelte: `src/content/menuDelSito.js`, agganciata ai menu in `src/content/content.js`;
- clic vero, conti e proposta: `src/main/services/menuDelSito.js`;
- elenco: Preferenze («Menu dei siti col tasto destro») e chiave `menu_del_sito` dalla chat.

Prove: `tests/menu-del-sito.spec.mjs`, `tests/unit/menuDelSito.test.mjs`.
