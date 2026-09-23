# Un testo scritto in una casella si salva da solo, o lo perdi

[← Tutti i pattern](../PATTERNS.md)

Una casella dove l'utente scrive deve spedire quello che c'è dentro da
**qualunque uscita**: dopo una pausa mentre scrive, quando il cursore la lascia,
e prima di ogni azione che porta via il pannello. Se l'unica strada è il tasto
"Salva", tutte le altre buttano via il testo in silenzio.

Il caso: nella dashboard di gestione la riga per chi ha segnalato si spediva solo
col suo tasto. Scriverla e poi premere "Risolto" — il gesto più naturale che
esista, perché quella riga si scrive proprio mentre si chiude la segnalazione —
mandava via il solo cambio di stato: al mittente arrivava la chiusura senza
nessuna riga, e il testo appena scritto non esisteva più. Le porte erano tre, e
tutte finivano nello stesso punto: il pannello si ridipinge e riempie la casella
col valore salvato.

- **Ogni porta si chiude nello stesso punto.** Non basta far partire la frase
  insieme al tasto: portano via il pannello anche il clic sulla stessa scheda
  nella lista, il cambio di sezione, l'apertura di un'altra scheda. Il
  salvataggio va messo dove il pannello cambia padrone, prima che l'indirizzo
  di destinazione cambi: un istante dopo, quel testo finirebbe sull'elemento
  sbagliato.
- **L'azione che chiude aspetta la scrittura, e non parte se fallisce.** Se la
  frase non arriva a destinazione, cambiare stato la perde per sempre: meglio
  fermarsi, dirlo, e lasciare il testo davanti agli occhi.
- **"È cambiato qualcosa?" si chiede a quello che è PARTITO, non a quello che la
  pagina ricorda.** Finché la risposta non torna, il valore memorizzato è ancora
  quello di prima: un ripensamento scritto in quella finestra verrebbe
  inghiottito. E una scrittura fallita lascia il valore IGNOTO, che non combacia
  con niente: da lì si riprova.
- **Il salvataggio automatico tocca solo quello che l'utente ha scritto lui.**
  Senza questa guardia, girare fra gli elementi riscriverebbe testi che nessuno
  ha toccato, ripuliti degli spazi o tagliati al limite del campo.
- **Il tasto esplicito resta, e risponde sempre.** Premuto quando non c'è più
  niente da spedire dice che la riga è a destinazione, non "nessuna modifica":
  chi lo preme vuole sapere se il suo testo è arrivato.
- **Dove:** `salvaFraseSubito`, `salvaFraseAutomatico`, `fraseAlSicuro`,
  `applyAction` in `src/pages/manage/manage.js`; gli ascoltatori di
  `.fb-usernote` e `.fb-notes` in `src/pages/feedback/feedback.js`, che così
  facevano già. Test: `tests/manage-frase-non-si-perde.spec.mjs`.

## La stessa regola quando a ridipingere è qualcosa che arriva da fuori

Nella bacheca il form «Ancora rotto?» si apriva dentro una scheda, e la lista
delle schede si ricostruisce da zero a ogni `renderList()`. A chiamarlo non è
solo l'utente: lo chiamano anche il caricamento dei dati che finisce, un voto
che torna dal server e un login. Chi stava scrivendo la spiegazione si vedeva
sparire form e testo, senza un messaggio: nessuna «uscita» era stata premuta,
eppure il testo era perso lo stesso.

- **Quello che l'utente ha aperto e scritto vive FUORI dal nodo che muore.** Un
  form ricostruito rilegge apertura e testo da uno stato tenuto per id, e lo
  butta solo su «Annulla» o a invio riuscito.
- **Anche il cursore è roba dell'utente.** Ridipingere sposta il fuoco altrove:
  si salvano fuoco e selezione prima di svuotare, e si rimettono dopo.
- **Un caricamento partito prima e arrivato dopo è vecchio.** Se nel frattempo
  le schede sono state decise da qualcun altro, la risposta della rete non le
  sostituisce: vincerebbe l'ordine d'arrivo invece dell'intenzione.
- **Dove:** `bozzeRiapertura`, `renderReopen`, `renderList` e `loadData` in
  `src/pages/board/board.js`. Test: i due casi sul ridisegno in
  `tests/board-reopen.spec.mjs`.

## Anche la pagina che sparisce, e anche col cursore ancora dentro

Le pagine che salvano da sé, senza pulsante, avevano tre buchi tutti figli
della stessa causa. Il salvataggio aspetta qualche centesimo prima di partire;
per non perdere l'ultima modifica si appoggia a un avviso d'uscita; e conta una
modifica solo quando il cursore lascia il campo. Sei giri di verifica hanno
riaperto la stessa famiglia da sei porte diverse.

- **Toccare È modificare.** Un campo ancora sotto il cursore non ha mandato
  nessun `change`: senza contarlo, nessuna uscita lo salva, per quanto si
  aspetti. Le pagine ascoltano anche `input`, e quel tocco basta a far partire
  il salvataggio d'uscita e a spegnere la conferma di prima.
- **L'avviso di fine pagina parte in tutte e due le forme.** Il main avvisa una
  scheda che sta per sparire (`src/main/congedo.js`), e il preload lo consegna
  come `beforeunload` E come `pagehide`: l'Editor ascoltava solo il primo e
  perdeva l'ultima frase a ogni chiusura di scheda.
- **La regola sta in un posto solo.** `src/shared/salvaRimandato.js`
  (`SN_SALVA`): attesa, spegnimento della conferma, salvataggio da qualunque
  uscita. Le Preferenze, le Opzioni, «Altro» e Sicurezza la chiedono lì invece
  di riscriversela, e una sentinella diventa rossa se una torna a riscriversi
  l'uscita in casa.
- **L'avviso arriva a tutti, ma serve solo a chi ha qualcosa in sospeso.** Il
  settimo giro ha trovato le porte rimaste: una pagina che l'avviso non lo
  ascoltava affatto (Sicurezza) e i campi che si confermano al blur — la
  rinomina di un documento, la riga di un elenco — che in sospeso non mettono
  niente. `SN_SALVA.campoAlVolo()` è quella metà: chi scrive registra la
  conferma del campo, l'uscita la fa partire, e chi conferma a mano la toglie.
- **Prima di sparire c'è tempo per UN messaggio.** Il congedo aspetta la
  risposta della pagina, quindi il salvataggio d'uscita deve spedire subito,
  non dopo una rilettura: il Correttore rileggeva l'elenco prima di riscriverlo
  e quel giro in più arrivava dopo la fine della scheda.
- **Dove:** `src/shared/salvaRimandato.js`, il congedo in
  `src/preload/internal-preload.js`. Test:
  `tests/unit/salvaRimandato.test.mjs` e `tests/uscite-che-salvano.spec.mjs`
  (la rinomina di una chat sta in `tests/cronologia-chat.spec.mjs`).
