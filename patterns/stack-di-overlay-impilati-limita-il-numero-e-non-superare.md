# Stack di overlay impilati: limita il numero e non superare mai il viewport

[← Tutti i pattern](../PATTERNS.md)

Qualsiasi contenitore che **impila elementi nell'angolo** (toast/notifiche in
basso a destra, e in futuro simili) deve avere **due argini**, altrimenti una
raffica di eventi (es. una tempesta di popup bloccati, o il ripristino con molte
schede su siti in blacklist) lo fa crescere all'infinito: le card più vecchie
finiscono **fuori dal viewport** insieme al loro tasto di chiusura, diventando
irraggiungibili.

- **Tetto al numero** di card vive contemporaneamente: quando ne arriva una che
  sfora, rimuovi subito la più vecchia (non aspettare il suo timeout). Tieni le
  **più recenti** (le più rilevanti in una raffica). In una raffica estrema le
  azioni delle notifiche più vecchie (es. «Apri comunque») si perdono: è un
  compromesso accettabile — l'utente può rifare l'azione, e il contrario
  (schermo coperto, X fuori campo) è peggio.
- **Tetto all'altezza:** `max-height: calc(100vh - margini)` + `overflow-y:auto`
  come rete di sicurezza per finestre molto basse, dove anche il piccolo gruppo
  non entrerebbe. Quando c'è overflow, tieni in vista la card più recente
  (`scrollTop = scrollHeight`) e attiva `pointer-events` sul contenitore (con
  `pointer-events:none` di base non si potrebbe afferrare la scrollbar; una
  classe `.scrolling` la riabilita solo quando serve, così le aree vuote
  continuano a lasciar passare i click al contenuto sotto).
- **Mai UN solo elemento riusato.** Un contenitore-avviso singolo che si riazzera
  a ogni messaggio distrugge il contenuto precedente **insieme ai suoi bottoni**:
  un'azione offerta lì (un "Annulla") può sparire prima che l'utente la prema, e
  basta un avviso che arriva da solo per farla evaporare. Ogni avviso è una card
  con il SUO timer; il tetto sopra tiene la crescita sotto controllo.
- **Tronca i dati che vengono da fuori.** Il testo di un avviso spesso contiene
  una stringa che decide qualcun altro (il nome file che manda il server, il
  titolo di una pagina): senza un tetto, una card sola diventa un muro di testo
  che copre lo schermo — il tetto al *numero* di card non basta. Accorcia **in
  mezzo** (`inizio…estensione`), così resta leggibile sia l'inizio sia il pezzo
  che dice di cosa si tratta. Vedi `shortName()` in
  `src/main/services/downloads.js`, test `tests/unit/downloadNames.test.mjs`.
- **UN contenitore per angolo, non uno per avviso.** Ogni riquadro ancorato con
  `position: fixed` allo stesso angolo è cieco rispetto agli altri: due che
  compaiono a pochi secondi l'uno dall'altro si disegnano nello stesso punto e
  non se ne legge nessuno (#409). Vale anche fra **famiglie diverse** di avviso:
  un toast, una pill interattiva e una conferma cliccabile che condividono
  l'angolo devono condividere anche la pila. Il caso più frequente non è nemmeno
  l'utente che fa due cose di fila: è **un'azione sola** che mostra prima
  «sto lavorando» e poi l'esito.
- **Non tutti gli avvisi sono sfrattabili.** Il tetto butta via i più vecchi, ma
  un avviso che porta **l'unico comando** per una cosa in corso (fermare una
  registrazione, raggiungere la lista dove è appena finita una pagina) va marcato
  come non sfrattabile: perderlo non è "un messaggio in meno", è una funzione che
  sparisce a metà.
- **⚠️ `overflow` + animazione d'ingresso = falso overflow, e uno `scroll`
  parassita.** Se le card entrano con `transform: translateY(Npx)`, quello sposto
  allarga l'area scrollabile del contenitore: `scrollHeight > clientHeight`
  risulta vero anche con una card sola, il contenitore si dichiara "in overflow",
  riaccende i `pointer-events` (una zona morta sopra la pagina) e — assegnando
  `scrollTop` — **emette un evento `scroll`**. Chi ascolta lo scroll in capture su
  `window` (il menu del tasto destro: `src/content/menu.js`) lo legge come "la
  pagina si è mossa" e **si chiude da solo**. Confronta con una tolleranza pari
  allo sposto d'ingresso e scrivi `scrollTop` solo se cambia davvero.
- **Dove:** `NOTIFS` (`enforceCap`/`syncOverflow`) in `src/renderer/shell.js`;
  `.shell-notifs` in `src/renderer/shell.css`. Test
  `tests/notifications.spec.mjs` (la raffica non straripa e resta chiudibile).
  Stesso pattern nell'editor: `showEditorToast`/`.ed-toasts` in
  `src/pages/editor/editor.{js,css}`, test `tests/editor-trash.spec.mjs`.
  Lato **pagina visitata** (content script): `mountToast`/`unmountToast` +
  `.sn-toasts` in `src/content/popup.js` e `src/styles/popup.css` — ci passano
  toast, `.sn-dictate-pill` e `.sn-save-confirm`. Test `tests/toast-stack.spec.mjs`.
