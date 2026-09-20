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
- **Il decadimento si REGISTRA, non si stampa e basta.** Accorgersene su una
  macchina e fermarsi lì lascia l'esito «buono» dove lo leggono gli altri: è
  lo stesso difetto spostato di un passo. Il rifiuto nomina il passo che
  rimette il lavoro in verifica, col comando pronto, invece di nominare
  qualcuno che dovrebbe farlo (per esempio «chi ha cambiato il ramo»: quasi
  sempre una sessione ormai chiusa).
- **Ogni passo a valle parla dell'impronta, fino all'ultimo.** Timbrarla sugli
  esiti non chiude niente se poi l'azione finale si chiede per etichetta: il
  giro intero va letto, non il pezzo appena toccato.
- **L'esito vale per un commit, quindi si registra DA un commit.** Con file
  fuori dai commit il salvataggio automatico li committa subito dopo, la punta
  si sposta, e l'esito nasce già decaduto. Chi registra pretende una directory
  pulita e lo dice con l'elenco.
- **Chi non può fare il confronto lo DICE.** Un controllo che tace quando non
  sa rispondere è peggio di uno assente: chi legge crede di essere protetto.

Lo stesso difetto è tornato quattro volte, un piano più in alto ogni volta, e
ogni volta era già stato chiuso di sotto:

1. la fusione scaricava il diff di un ramo e poi fondeva **il ramo per nome**:
   bastava spingere un commit fra le due chiamate (chiuso il 2026-08-21);
2. l'approvazione dell'owner copriva «quel ramo» invece di «quel contenuto»
   (chiuso insieme, e ricordato in
   [Un cancello automatico che blocca deve avere una via d'uscita](un-cancello-automatico-che-blocca-deve-avere-una-via-duscita.md));
3. la critica della verifica era registrata sul nome del ramo (2026-09-13);
4. il verdetto del controllo di sicurezza e la **richiesta di fusione** lo
   erano ancora (2026-09-20, feedback #485).

Dove vive: `ROUTINE-AUTH-SPEC.md` §11 («Un esito vale per la versione
esaminata»), `scripts/dispatch.mjs`, `scripts/routine-channel.mjs`,
`scripts/merge-gate.mjs`, `scripts/lib/dirty-tree.mjs`; la guardia sempre
accesa è `tests/unit/esitoPerCommit.test.mjs`.

Da ricordare: il muro vero è il posto che non si può convincere, cioè il
server. Il lato che consegna può chiudere il **cammino onesto** e far arrivare
l'impronta; finché chi fonde legge ancora l'etichetta, il campo arriva e non
viene guardato. Chiudere metà porta è utile, ma va detto che è metà.
