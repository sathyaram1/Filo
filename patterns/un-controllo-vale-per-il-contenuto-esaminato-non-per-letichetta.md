# Un controllo vale per il CONTENUTO esaminato, non per l'etichetta

[← Tutti i pattern](../PATTERNS.md)

Chi controlla qualcosa e poi registra «controllato» deve dire **cosa** ha
controllato, con un nome che non si possa riusare per un'altra cosa. Un ramo,
una cartella, un id di pratica sono etichette: chi lavora può cambiare quello
che c'è sotto, e di solito ne ha il permesso per costruzione. L'immagine è di
chi ha aperto il feedback #485: è come firmare «il documento nella cartella X»
invece di «questa esatta versione». Basta sostituire il foglio e la firma resta
lì, buona, su un contenuto che nessuno ha guardato.

La forma giusta, ogni volta che un esito attraversa il tempo:

- **L'esito si registra con l'impronta del contenuto esaminato** (per il
  codice: lo sha del commit). Un esito senza impronta si rifiuta prima di
  scrivere qualsiasi cosa: non si distingue da uno dato su un contenuto
  qualunque.
- **L'impronta la timbra lo strumento, e una dichiarata può solo
  CONFERMARLA.** Chiederla a chi consegna è la scommessa già persa sulla
  provenienza dei feedback. Accettarla senza confronto è peggio: la difesa si
  spegne scrivendo un argomento in più. Confermare però vuol dire riconoscere
  la stessa VERSIONE, non ricopiarla lettera per lettera: la forma abbreviata
  che gli strumenti stampano a schermo è lo stesso commit, e rifiutarla è
  attrito per chi fa la cosa giusta. Sotto le sette lettere no: un pezzo così
  corto combacia anche con commit diversi, quindi non conferma niente.
- **Chi legge l'esito lo confronta col contenuto vero**, risolto da lui una
  volta sola. Se non combaciano l'esito è decaduto, e il controllo va rifatto
  invece che dato per buono.
- **Il decadimento si REGISTRA, non si stampa e basta, e lo registra chi ha
  il permesso di farlo.** Accorgersene su una macchina e fermarsi lì lascia
  l'esito «buono» dove lo leggono gli altri: è lo stesso difetto spostato di un
  passo. Ma il passo che un rifiuto detta dev'essere uno che il server
  concede a CHI legge il rifiuto: un comando che il suo ruolo non può eseguire
  lascia il lavoro con due via libera e nessuno che lo porti avanti. Quindi
  l'esito di un ALTRO lo giudica chi fonde, dallo stato vero (il server
  confronta la punta col commit verificato, tollera le sole prove del giro
  tolte, e altrimenti azzera la verifica e la rimette in giro da sé); il
  rifiuto locale resta sull'esito di chi lo legge, col rimedio che lui può
  fare: rileggere il pezzo nuovo e registrare di nuovo il proprio verdetto.
  Mai nominare qualcuno che dovrebbe farlo (per esempio «chi ha cambiato il
  ramo»: quasi sempre una sessione ormai chiusa).
- **Ogni passo a valle parla dell'impronta, fino all'ultimo.** Timbrarla sugli
  esiti non chiude niente se poi l'azione finale si chiede per etichetta: il
  giro intero va letto, non il pezzo appena toccato.
- **L'esito vale per un commit, quindi si registra DA un commit.** Con file
  fuori dai commit il salvataggio automatico li committa subito dopo, la punta
  si sposta, e l'esito nasce già decaduto. Chi registra pretende una directory
  pulita e lo dice con l'elenco.
- **Chi non può fare il confronto lo DICE, e lo dice per ogni esito.**
  Un controllo che tace quando non sa rispondere è peggio di uno assente: chi
  legge crede di essere protetto. E l'astensione si dichiara **uno per uno**:
  dirla solo quando non si sa niente lascia passare in silenzio il caso in cui
  si sa metà, che è il peggiore dei tre — sembra controllato più degli altri.
- **La memoria su cui il confronto si regge la scrive OGNI strada che registra
  un esito.** Se la scrive una strada sola, l'altra non è una scorciatoia: è
  l'interruttore della difesa. Ci si arriva senza forzare niente, scegliendo
  l'ingresso documentato che quella riga non ha. La forma giusta è una porta
  unica, chiamata da tutte le strade, e un solo posto dove sta scritto quali
  esiti valgono per un commit.
- **L'impronta deve descrivere quello che chi legge andrà DAVVERO a
  prendere, e il controllo è un'UGUAGLIANZA.** Se l'esaminato sta qui e il
  lettore scarica da un'altra parte, l'impronta è giusta e il contenuto no: si
  controlla che là ci sia quello, prima di chiedere. «C'è arrivato» non basta:
  un contenuto può stare nella storia senza essere quello che il lettore
  prende, e allora ad arrivare è il resto, che nessuno ha guardato. Le due
  direzioni vogliono rimedi opposti e vanno distinte: se là manca si spedisce,
  se là c'è di più non si spedisce niente (sovrascrivere butterebbe via lavoro
  che qui non c'è) e il giro si rifà su quel contenuto. È il gemello del
  rifiuto per i file fuori dai commit — lì la punta si sposta in avanti dopo
  l'ok, qui non si è mai mossa dove conta. La punta vera si chiede a chi la
  tiene, non al ricordo locale di dov'era; il controllo che parla con la rete
  ha un tetto sul tempo, e se la rete non risponde la risposta è «non l'ho
  potuto controllare», mai una conclusione tratta dal ricordo.
- **Chi controlla il contenuto di un'etichetta dev'essere posizionato su
  quell'etichetta.** Se lo strumento legge tutto dalla cartella che ha sotto
  (i file fuori dai commit, la versione, gli esiti registrati) ma il nome
  glielo passa chi lo chiama, i controlli parlano di una cosa e la richiesta
  ne nomina un'altra. Il nome e la cartella devono combaciare, e se non
  combaciano ci si ferma lì: è l'unica posizione da cui i controlli dopo hanno
  un senso.
- **I comandi che un rifiuto detta puntano agli attrezzi di chi lo legge.**
  Un rimedio scritto con un percorso relativo riporta dentro la cosa da cui il
  lettore era stato mandato via — e un comando che si copia da un rifiuto vale
  quanto uno scritto in uno script: se il progetto pretende
  `origin sorgente:destinazione`, lo pretende anche lì.

Lo stesso difetto è tornato quattro volte, un piano più in alto ogni volta, e
ogni volta era già stato chiuso di sotto:

1. la fusione scaricava il diff di un ramo e poi fondeva **il ramo per nome**:
   bastava spingere un commit fra le due chiamate (chiuso il 2026-08-21);
2. l'approvazione dell'owner copriva «quel ramo» invece di «quel contenuto»
   (chiuso insieme, e ricordato in
   [Un cancello automatico che blocca deve avere una via d'uscita](un-cancello-automatico-che-blocca-deve-avere-una-via-duscita.md));
3. la critica della verifica era registrata sul nome del ramo (2026-09-13);
4. il verdetto del controllo di sicurezza e la **richiesta di fusione** lo
   erano ancora (2026-09-20, feedback #485);
5. chiuse quelle, il confronto restava disarmabile da sotto: la memoria di
   quale contenuto avesse l'ok la scriveva una sola delle due strade, chi
   sapeva metà taceva, e nessuno guardava se l'esaminato fosse arrivato dove
   chi fonde va a prenderlo (2026-09-20, stesso feedback, terza verifica);
6. e il controllo appena nato chiedeva se l'esaminato fosse ARRIVATO là, non
   se fosse QUELLO che chi fonde trova: un ramo più avanti su origin passava
   in silenzio, e ad atterrare era il commit in cima (2026-09-20, stesso
   feedback, quarta verifica).

Dove vive: `ROUTINE-AUTH-SPEC.md` §11 («Un esito vale per la versione
esaminata»), `scripts/dispatch.mjs`, `scripts/routine-channel.mjs`,
`scripts/merge-gate.mjs`, `scripts/lib/dirty-tree.mjs`; la guardia sempre
accesa è `tests/unit/esitoPerCommit.test.mjs`.

Da ricordare: il muro vero è il posto che non si può convincere, cioè il
server. Il lato che consegna può chiudere il **cammino onesto** e far arrivare
l'impronta; finché chi fonde legge ancora l'etichetta, il campo arriva e non
viene guardato. Chiudere metà porta è utile, ma va detto che è metà.
