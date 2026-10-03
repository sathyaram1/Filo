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

## Quando l'uscita è chiudere la scheda

In Sicurezza le liste di domini si salvavano solo al `change`, cioè quando il
cursore lasciava il campo dentro la pagina. Chi scriveva un sito e passava a
un'altra scheda, o la chiudeva, perdeva la riga: la vedeva scritta, provava il
sito e concludeva che la lista non funzionava (#590.2).

- **Chiudere una scheda non dà alla pagina nessun evento.** Filo la chiude con
  `webContents.close()`: niente `beforeunload`, `pagehide` o `visibilitychange`.
  Quello che non è partito prima non parte più.
- **Quindi il testo parte mentre si scrive**, dopo una pausa breve, e subito al
  primo segno di uscita: il Ctrl, Cmd o Alt premuto da solo (arriva alla pagina
  prima della lettera di Ctrl+W, Ctrl+Tab o Alt+cifra, che il main si tiene), il
  fuoco che esce dalla finestra, la scheda che esce di vista.
- **Il Ctrl non è sempre un segno nuovo.** Chi incolla e chiude tiene il Ctrl
  giù da prima dell'incolla (Ctrl+V e subito Ctrl+W, o Cmd+V e Cmd+Q): fra la
  modifica e la chiusura alla pagina non arriva niente. Aspetta la pausa solo chi
  batte un carattere; incolla, trascinamento, taglio, annulla e parola cancellata
  col Ctrl partono subito (si riconoscono dall'`inputType` dell'evento `input`).
- **In una scheda di Filo il cambio di scheda non è `visibilitychange`.**
  `document.hidden` resta falso anche in secondo piano: l'uscita e il ritorno
  li annuncia il main col broadcast `TAB_IN_VISTA`. `visibilitychange` scatta
  solo quando la pagina si ricarica o si naviga altrove.
- **L'avviso sulle righe sbagliate aspetta l'uscita vera, e si accende anche se
  il testo è già partito.** Mentre si scrive, «faceb» è una riga a metà; il
  fuoco che esce per un menu del tasto destro non è un'uscita.
- **Una riga scartata non sparisce.** Quello che non è un dominio non blocca
  niente, ma si salva a parte e torna nella casella con l'avviso: chi scrive
  «facebook» e chiude con Ctrl+W l'avviso non l'ha mai visto. Torna al posto in
  cui era scritta: si salva con quanti domini validi la precedevano.
- **Tutte le caselle della pagina passano dallo stesso punto.** Una casella si
  iscrive fra quelle da spedire e ne eredita pausa e uscite. La terza porta di
  #590.2 era una casella rimasta fuori: quella dei siti fidati per i cookie,
  perché aveva il suo «Aggiungi».
- **Una casella con «Aggiungi» è una casella anche lei.** Il sito scritto vale
  subito, anche senza il tasto; all'uscita vera passa nell'elenco, dove lo si
  ritrova riaprendo la pagina. Quello che non è un dominio si salva come bozza e
  torna nella casella con l'avviso.
- **Quello che parte mentre si scrive è uno stato a metà.** Chi lo riceve lo
  salva e lo usa per le aperture nuove, ma non ne trae effetti visibili altrove
  finché non tiene. Cancellata e riscritta l'ultima lettera di un sito, la
  scheda ferma sulla pagina «Sito bloccato» riapriva il sito e tornava
  bloccata; scritto «sito.it» con una pausa prima di «.br», la scheda aperta su
  sito.it veniva bloccata e ricaricata, perdendo quello che c'era dentro. La
  regola è una per le due direzioni: il salvataggio fatto mentre si scrive
  arriva marcato `mentreScrive`, e le schede aperte seguono la lista solo
  quando sta ferma per tre secondi, o subito quella che l'utente guarda. Una
  lista cambiata da ogni altra strada vale subito.
- **Nei test** la tastiera di Playwright non passa dal `before-input-event` e
  Playwright fa credere alla pagina di avere sempre il fuoco, quindi niente
  `blur`: Ctrl+W si prova con `sendInputEvent`, prima il Ctrl da solo e poi la
  lettera.
- **Dove:** pausa e uscite in `SN_CASELLE` (`src/shared/caselleAlSicuro.js`);
  `uscita`, `righe`, `save` e `saveCookies` in
  `src/pages/security/security.js`; `riapplicaListaBloccati`, `_seguiLista` e
  `activate` in `src/main/tabs.js`. Test:
  `tests/security-liste-non-si-perdono.spec.mjs` e i casi sulla riga a metà
  in `tests/siteBlock-strade.spec.mjs`.

## Le altre pagine delle impostazioni passano dallo stesso punto

In Altro, Modelli e Preferenze le caselle si salvavano solo al `change`, o dopo
una pausa che Ctrl+W tagliava: un dominio escluso, il limite di spesa, le
chiavi, le ore dell'archivio automatico tornavano com'erano (#590.5).

- **Una pagina, un modulo.** Ogni pagina crea il suo `SN_CASELLE.crea()`,
  iscrive chi salva e gli passa ogni `input`; pausa, Ctrl da solo, fuoco che
  esce, `TAB_IN_VISTA` e ricarica li ascolta il modulo. Una casella nuova non
  scrive i suoi ascoltatori di uscita: si iscrive.
- **Un valore che a metà ha effetto aspetta la pausa lunga** (tre secondi,
  `PAUSA_LUNGA_MS`) o l'uscita. Scrivendo «15» il limite di spesa passerebbe
  da «1» e fermerebbe le richieste di quell'istante; con una chiave tronca la
  richiesta verrebbe rifiutata e pagata coi crediti; un modello scritto a metà
  fallirebbe; il nome di una categoria a metà finirebbe nelle altre pagine.
  Senza nessuna pausa no: la scheda chiusa col mouse arriva alla pagina al più
  come fuoco che esce, e le prove non lo sanno riprodurre. Incollare parte
  subito.
  Un numero che serve a vedere l'effetto mentre lo si regola, come il colore
  delle schede, tiene la pausa breve.
- **Una scelta finita parte subito.** Nell'editor dei modelli per azione il
  segmento a metà arriva come `scrivendo`; la scelta dalla tendina, un
  segmento aggiunto o tolto e il valore confermato o respinto partono al
  momento.
- **Quello che parte prima della conferma passa dallo stesso controllo.** Un
  modello che l'azione respinge, lasciato col clic, torna indietro; salvato da
  pausa, Ctrl+W o cambio di scheda finiva salvato lo stesso. Chi salva prima
  legge il segmento a metà già controllato (respinto vale l'ultimo accettato),
  e all'uscita vera il segmento si conferma come al clic, avviso compreso.
- **Gli avvisi aspettano l'uscita anche qui.** Una riga nuova del registro dei
  modelli, scritta partendo dalla stringa, a metà non ha ancora il nickname:
  mentre si scrive una riga corretta si ripulisce ma una nuova non si accende,
  e il «Salvato» non compare finché una riga resta fuori.
- **Un effetto che non si disfa parte solo confermato.** Rinominare una
  categoria col nome di un'altra le fonde. Il nome a metà, partito da solo,
  passava da «Lavoro» togliendo una parola a «Lavoro vecchio», e le fondeva
  prima che si finisse di scrivere. Ora il nome salvato senza conferma arriva
  con `unisci: false`: un nome già preso resta in attesa, con l'avviso nella
  riga, e fonde solo col tasto o con Invio. La conferma va in fila dietro il
  `change` del suo stesso clic, così vede com'è finito.
- **All'uscita la casella dice il valore in uso.** Un numero fuori scala torna
  al valore salvato, un nome di categoria svuotato torna al nome che la
  categoria ha davvero.
- **Dove:** `caselle` in `src/pages/options/altro.js`,
  `src/pages/options/options.js`, `src/pages/preferences/preferences.js`. Test:
  `tests/impostazioni-caselle-non-si-perdono.spec.mjs`.
