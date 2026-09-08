# Un'area che si prende «quello che avanza» pretende un tetto su ciò che le sta sopra

[← Tutti i pattern](../PATTERNS.md)

La dashboard di gestione aveva le tre aree con un'altezza scritta a mano
(`calc(100vh - 180px)`): senza il banner di sola lettura restavano cento pixel
vuoti in fondo, col banner la pagina scrollava di altrettanto. La cura è stata
smettere di scrivere il numero e far dire al layout «prenditi quello che
avanza» (#498). Giusto, e incompleto: da quel momento le aree non hanno più
una misura loro, e chiunque cresca sopra di loro gliela mangia.

Sopra c'erano quattro cose. Tre hanno un'altezza che non dipende dai dati: il
banner, la riga che spiega perché le sezioni non si disegnano, la barra di
ricerca. La quarta è il riquadro delle fusioni che aspettano il via libera
dell'owner, e quella cresce quanto sono le richieste. Una richiesta prende già
266 pixel; le richieste valgono una settimana, quindi si accumulano. Con due, le
aree scendevano al loro minimo e la pagina ricominciava a scorrere. Con tre,
delle aree restava l'intestazione dei Ricevuti in fondo allo schermo: lo stesso
sintomo di partenza, ricomparso da un'altra porta.

- **Regola:** quando dai a un'area `flex: 1` e le fai prendere lo spazio
  residuo, guarda che cosa le sta sopra nella stessa colonna e chiediti quale
  di quelle cose cresce coi dati. Ognuna che cresce prende un tetto
  (`max-height` legato al viewport) più `overflow-y: auto`, e in una colonna
  flex anche `min-height: 0`, senza cui l'elemento si rifiuta di scendere sotto
  la propria altezza naturale e il tetto non morde.
- **Il tetto non tronca.** Chi guarda deve sapere che sotto c'è dell'altro:
  l'intestazione del riquadro dice già quante sono («3 fusioni aspettano il tuo
  via libera») e il resto si raggiunge scorrendo. Un tetto che taglia via
  richieste senza dirlo è la cosa che CLAUDE.md § Limiti vieta.
- **Il minimo dell'area non è una difesa.** `min-height: 300px` sulle aree non
  impedisce niente: quando la somma sfora, la pagina scrolla e l'area esce
  dallo schermo lo stesso. Il tetto va su chi cresce, non su chi subisce.
- **Un tetto senza pressione non morde.** Il tetto dice quanto un blocco può
  CHIEDERE. Se la colonna che lo contiene è `min-height: 100vh`, cioè può
  crescere oltre la finestra, nessuno lo obbliga a rinunciare a niente: la
  somma di testata, tetto e minimo dell'area esce dal fondo lo stesso, e la
  pagina ricomincia a scorrere. Si è visto appena la finestra è scesa sotto i
  745 pixel o l'utente ha alzato lo zoom di Filo di due tacche: due fusioni in
  attesa e delle aree restava di nuovo la sola intestazione dei Ricevuti.
  Perché il tetto morda, la colonna vuole `height: 100vh`, così la pressione
  esiste davvero e il blocco sopra si stringe. Nella pagina di gestione
  l'altezza fissa vale solo sulle schede-lista (`:has(> #panel-list.mg-panel--active)`):
  Statistiche, Modelli, Automazioni e Log hanno contenuti più alti della
  finestra e devono continuare a far scorrere la pagina.
- **Chi cede è chi cresce, e non fino a sparire.** Sotto pressione il blocco
  sopra prende `flex: 0 1 auto` (si stringe) e l'area resta al suo minimo. Ma
  il minimo del blocco non è zero: tanto quanto basta a leggere l'intestazione
  che dice quante cose contiene, altrimenti sparisce senza dirlo. Nella pagina
  di gestione sono `--mg-attesa-min: min(64px, 15vh)` per il riquadro e
  `--mg-aree-min: min(300px, 60vh)` per le aree, che su una finestra molto
  bassa cedono anche loro invece di uscire dal fondo.
- **Come si verifica:** un test che disegna 1, 2, 3 e 6 elementi nel blocco
  sopra e controlla che la pagina non torni a scorrere e che l'area resti sopra
  la metà di quanto aveva a blocco vuoto. Senza il tetto quegli assert devono
  diventare rossi: la controprova sta in
  `tests/verify-498-giro9.spec.mjs`, che rimette a mano i valori di prima.
- **Dove:** `--mg-attesa-max` e `.mg-merge-approvals` in
  `src/pages/manage/manage.html`, test in `tests/manage-layout.spec.mjs`.
- Vale anche l'altra metà della stessa lezione: se una misura serve a due
  regole (l'aria sotto la barra delle sezioni, e il margine negativo con cui la
  barra di ricerca si tira su per starle attaccata), si scrive una volta sola in
  una variabile. Ricopiata a mano, quando la prima cambia la seconda resta
  indietro: la barra delle sezioni è salita, il campo di ricerca si è tirato su
  della misura di prima ed è finito a due pixel dalla riga.
