# La shell non disegna sopra la pagina: ci vuole una vista in cima

[← Tutti i pattern](../PATTERNS.md)

Quello che la **shell** deve mostrare nell'area della pagina e che deve restarci
(una pila di avvisi, un riquadro che non spinge giù la pagina) si disegna in una
**WebContentsView sua, in cima** alle viste della finestra. Non nel DOM della shell.

- **Perché:** la shell è il webContents della finestra, e ogni scheda è una
  WebContentsView figlia disegnata SOPRA di lei. Un elemento della shell con
  `position: fixed` nell'area pagina esiste, ha misure, risponde ai clic di
  Playwright, e l'utente non lo vede. Gli avvisi in basso a destra («Scaricato»
  con «Apri file» e «Apri cartella», «Scaricamento non riuscito», i blocchi dei
  siti) sono rimasti invisibili con tutti i test verdi (#588.5).
- **Tre strade, a seconda di cosa serve:**
  1. può spingere giù la pagina → `reserveTop` (pannello scaricamenti, domanda
     dei permessi);
  2. è di passaggio e ancorata a un pulsante della barra → finestra figlia
     (`src/main/popup-menu.js`, `src/main/popup-tooltip.js`);
  3. resta sopra la pagina e segue la finestra → vista in cima, come
     `src/main/avvisiSopraPagina.js`.
- **La vista:** nasce al primo bisogno (una finestra che non ne ha non paga un
  processo in più), ha sfondo trasparente ed è grande **quanto il contenuto**:
  una vista trasparente prende i clic su tutta la sua area, e ogni pixel in più è
  una zona morta sopra la pagina. Il vuoto che resta (il margine dell'ombra, lo
  spazio accanto a una carta più stretta) è **della pagina**: la vista le rigira i
  gesti che ci cadono (clic, doppio clic, tasto destro, rotella, e un trascinamento
  fino al rilascio, anche se passa sopra una carta) e mostra il puntatore che
  mostrerebbe la pagina (Electron chiama `pointer` la freccia e `hand` la mano;
  l'ultimo detto dalla scheda vale anche rientrando nel vuoto, dove la pagina non
  lo ridice). La sua pagina manda le misure in modo sincrono a
  ogni disegno: nata nascosta e grande zero, il ResizeObserver può non partire
  mai. Ogni `addChildView` di una scheda finisce sopra di lei, quindi il layout la
  riporta in cima. Preload minimo (lo stato entra; misure, clic, tasto destro, puntatore sopra le carte e gesti del vuoto escono), e il
  canale dello stato si accetta solo dalla shell della sua finestra.
- **La tastiera non è sua.** Una WebContentsView che carica la sua pagina
  DENTRO la finestra si prende il fuoco: chi stava scrivendo nella scheda perde i
  tasti, e il cursore continua a lampeggiare nel campo. Quindi carica fuori ed
  entra nella finestra alla prima posa; e se un clic le dà la tastiera la
  restituisce subito alla scheda, al giro dopo l'evento `focus` (durante l'evento
  il fuoco risulta ancora a chi l'aveva, e restituirlo non farebbe niente).
- **L'angolo si divide.** Quello che Filo ancora in basso a destra dentro la
  pagina (le pile di avvisi del content script e dell'editor, il riquadro Aiuto,
  anche spostato a mano finché resta nell'angolo) sta nello stesso angolo: la vista scrive la sua altezza
  nella scheda attiva (`--filo-avvisi-barra`, foglio d'autore: uno di origine
  `user` non si toglie più) e tutto ci sale sopra. Il valore nuovo si inserisce
  SOPRA il vecchio e solo dopo si toglie il precedente: un foglio inserito mentre
  la scheda carica può finire nel documento nuovo senza che se ne tenga la
  chiave, e con «togli e rimetti» restava lì col suo valore. Un riquadro nuovo in
  quell'angolo usa la stessa variabile nel suo `bottom`: lo controlla
  `tests/unit/angoloAvvisiBarra.test.mjs` sui fogli di `src/styles` e `src/pages`
  (una posizione scritta da JS la sentinella non la vede). Il valore è in px CSS della scheda,
  quindi dipende dal suo zoom: il preload della pagina segnala ogni cambio di zoom,
  da qualunque parte arrivi (`filo:zoom-cambiato`), e il main lo riscrive.
- **Il tasto destro** su una carta apre il menu di Filo con le sue azioni e
  «Chiudi»; la scelta passa dallo stesso canale del clic. In fondo alla finestra
  il menu si apre sopra il punto.
- **Il modello resta dov'era.** La vista disegna e riporta i clic; tetto, tempi,
  chiavi e azioni restano nella shell. Col puntatore sopra una carta i tempi
  aspettano (la vista dice solo quando entra ed esce, la shell ferma e riparte, e
  a chi era agli sgoccioli lascia due secondi); la pila che si svuota scioglie la
  pausa, perché la vista che sparisce non riceve l'uscita del puntatore. Il DOM della shell diventa un modello
  **nascosto** (`visibility: hidden`): un test che ne chiede la visibilità o ci
  clicca sopra fallisce, invece di dire verde su una cosa che nessuno vede.
- **Il tema** della shell (token dell'utente, incognito) la vista non ce l'ha: la
  shell glielo manda insieme allo stato, come valori calcolati delle variabili, e
  lo rimanda quando cambia.
- **Test:** si guarda la vista (fixture `avvisi` in `tests/fixtures/electron.mjs`),
  si controlla che sia l'ultima fra le viste della finestra e dentro l'area della
  pagina, e si clicca lì. Il vuoto si prova con `sendInputEvent` dentro la vista:
  passa dal suo renderer come un gesto vero, ma salta la scelta fra le viste che
  fa il sistema, che si vede solo col mouse vero (xdotool sullo schermo virtuale).
  `tests/avvisi-sopra-pagina.spec.mjs`.
