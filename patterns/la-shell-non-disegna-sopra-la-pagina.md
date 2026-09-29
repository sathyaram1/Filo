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
  una zona morta sopra la pagina. La sua pagina manda le misure in modo sincrono a
  ogni disegno: nata nascosta e grande zero, il ResizeObserver può non partire
  mai. Ogni `addChildView` di una scheda finisce sopra di lei, quindi il layout la
  riporta in cima. Preload minimo (lo stato entra, misure e clic escono), e il
  canale dello stato si accetta solo dalla shell della sua finestra.
- **La tastiera non è sua.** Una WebContentsView che carica la sua pagina
  DENTRO la finestra si prende il fuoco: chi stava scrivendo nella scheda perde i
  tasti, e il cursore continua a lampeggiare nel campo. Quindi carica fuori ed
  entra nella finestra alla prima posa; e se l'utente cliccandola le ha dato la
  tastiera, quando sparisce la restituisce alla scheda.
- **L'angolo si divide.** Le pile di Filo dentro la pagina (content script,
  editor) stanno nello stesso angolo: la vista scrive la sua altezza nella scheda
  attiva (`--filo-avvisi-barra`, foglio d'autore: uno di origine `user` non si
  toglie più) e quelle pile ci salgono sopra.
- **Il modello resta dov'era.** La vista disegna e riporta i clic; tetto, tempi,
  chiavi e azioni restano nella shell. Il DOM della shell diventa un modello
  **nascosto** (`visibility: hidden`): un test che ne chiede la visibilità o ci
  clicca sopra fallisce, invece di dire verde su una cosa che nessuno vede.
- **Il tema** della shell (token dell'utente, incognito) la vista non ce l'ha: la
  shell glielo manda insieme allo stato, come valori calcolati delle variabili, e
  lo rimanda quando cambia.
- **Test:** si guarda la vista (fixture `avvisi` in `tests/fixtures/electron.mjs`),
  si controlla che sia l'ultima fra le viste della finestra e dentro l'area della
  pagina, e si clicca lì. `tests/avvisi-sopra-pagina.spec.mjs`.
