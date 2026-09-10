# Un numero aggregato porta a cosa ha contato

[← Tutti i pattern](../PATTERNS.md)

«In coda: 12» non è una risposta: è mezza risposta. La domanda che segue è
sempre la stessa — *quali dodici?* — e senza una strada per arrivarci si torna
a mano su un'altra pagina a ricostruire il filtro a memoria. Sulla scheda
«Statistiche feedback» (#496) questa mancanza è stata trovata in quattro giri
di verifica diversi, una superficie per giro: prima le righe di ripartizione,
poi le priorità, poi la legenda di una torta, poi le fette e le barrette.

- **Ogni numero è un tasto.** Riga di ripartizione, voce di legenda, fetta di
  torta, barretta di un istogramma: se dice un numero, si apre su ciò che ha
  contato. Un tasto vero, non un `div` con un listener: si raggiunge da
  tastiera, il puntatore cambia forma sopra di lui e il fondo risponde
  all'hover.
- **Nessuna eccezione dentro la stessa schermata.** Due elenchi disegnati
  uguali devono rispondere uguale. Due torte affiancate di cui una si apre e
  l'altra no, o una legenda che si apre mentre la fetta gemella tace, sono
  differenze che si scoprono solo cliccando e non ottenendo niente — ed è
  esattamente lì che è nato il giro di verifica in più.
- **Anche il tasto destro.** «Voglio fare qualcosa qui» su un numero vuol dire
  due cose: fammi vedere le segnalazioni contate, e portami via questo numero
  (copia riga e numero). Se sull'elemento il tasto destro apre il menu generale
  della pagina — quello che esce anche su uno spazio bianco — la promessa del
  tasto destro di Filo lì non è mantenuta.
- **L'elenco arriva fino all'oggetto vero.** Aprire una riga e trovare dodici
  titoli non basta se da un titolo non si arriva alla segnalazione: la catena
  si chiude quando il clic porta alla scheda giusta, col dettaglio aperto.
- **Anche l'elenco ha un tetto, e lo dichiara.** Dietro un numero possono
  esserci quattrocento elementi. Si taglia, ma dicendo quanti ne restano e come
  vederli (CLAUDE.md § Limiti: mai un troncamento muto).
- **Le conferme stanno fuori dal flusso.** «Copiato» inserito nel flusso della
  pagina spinge giù tutto per qualche secondo e poi lo riporta su: chi ha
  copiato da un numero in fondo si vede scappare la riga sotto il puntatore due
  volte. Posizione fissa.
- **Dove:** `statsSegnalazioni()` / `insertStatsDrill()` / `openStatsMenu()` in
  `src/pages/manage/manage.js`, con le chiavi `data-drill` scritte dalle righe
  (`statsCard`), dalla legenda e dalle fette. Test:
  `tests/manage-feedback-stats.spec.mjs`.
