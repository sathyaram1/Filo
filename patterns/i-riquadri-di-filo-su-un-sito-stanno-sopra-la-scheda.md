# I riquadri di Filo su un sito stanno sopra la scheda

[← Tutti i pattern](../PATTERNS.md)

Spiegazione e traduzione (la risposta in streaming), Modifica, feedback e attacco red-team aperti su un sito non
entrano nel documento del sito: si disegnano nello **strato dei riquadri**, una WebContentsView trasparente grande
quanto la scheda, una per pagina, con la sua pagina `filo://riquadri/`. Sulle pagine `filo://` restano nel documento:
lì non c'è codice di altri.

- **Perché:** nel documento, anche dentro uno shadow root chiuso, il sito leggeva quello che l'utente scrive o seleziona
  (`getSelection()` dopo Ctrl+A o una copia, `window.find`, gli `input` che escono dallo shadow), e la ricerca nella
  pagina trovava il testo dei riquadri (#1071, #1509.1). Nessuna pezza dentro il documento chiude queste strade: il
  testo non deve stare dove il sito lo raggiunge. Stessa cura del menu
  ([Il menu del tasto destro sta in uno strato sopra la scheda](il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md)).
- **Chi apre:** i moduli dei riquadri (`SN_FEEDBACK_UI.open`, `SN_EDITBOX.openEditBox`, `SN_REDTEAM_ATTACK_UI.open`,
  `SN_POPUP.openStreaming`) su un sito chiedono `RIQUADRO_APRI` (`src/content/riquadriSopraLaScheda.js`); il main
  (`src/main/stratoDeiRiquadri.js`) crea o riusa lo strato della pagina e gli consegna la richiesta. Se lo strato non si
  può fare, il riquadro si apre nel documento come prima, non sparisce.
- **Lo strato parla come la pagina sotto**, col suo frame principale (`senderInfo` in `src/main/ipc.js`): bozze per
  sito, settings ritagliati, porte aperte ai siti. Non ha un potere in più del content script della pagina, e le spinte
  che vanno alla pagina gli arrivano ritagliate per lei (`spingiAllaScheda`), tranne gli avvisi, che mostra la pagina.
  Non descrive la scheda: per colore, attività, Aiuto e avvisi vale come un riquadro incorporato (`IS_SUBFRAME`).
- **Dentro lo strato gira Filo intero** (menu, correttore, Detta, Modifica sul testo di un riquadro), nel mondo isolato e
  in sandbox come sui siti: `src/preload/riquadri-preload.js`, impacchettato da `src/main/preloadPacchetto.js`.
- **Si posa prima di aprire:** lo strato prende le misure della pagina e il riquadro le aspetta, o una risposta nata in
  una vista larga zero sceglierebbe il lato sbagliato. L'ancora di una risposta arriva in px della pagina e il main la
  porta in px della vista (zoom); da un riquadro incorporato vale l'ultimo punto del puntatore sulla scheda, seguito da
  quando la scheda nasce (non da quando nasce lo strato: la prima risposta finirebbe in alto a sinistra).
- **Subito sopra la sua scheda:** avvisi della barra, conferme, barra laterale e menu restano sopra, come sopra la
  pagina. Si vede solo con la sua scheda davanti, senza l'avviso del sito pericoloso, e solo se ha qualcosa aperto.
- **Il vuoto è della pagina:** fuori dai riquadri clic, rotella e trascinamenti tornano alla scheda
  (`src/main/vuotoDellaVista.js`, `src/renderer/vuoto.js`), solo se veri, perché lì arrivano come gesti dell'utente;
  il dito che scorre passa come rotella, e un trascinamento che entra nel vuoto (un file, un pezzo di pagina) toglie lo
  strato finché il mouse non torna sulla pagina, perché un rilascio non si può rigirare;
  un riquadro che copre la pagina (feedback, Modifica, red-team) è tutto suo. Un gesto sullo strato è dell'interfaccia di Filo (`gestoNelloStrato`): vale per gli appunti e
  il menu di Filo, mai per finestre e permessi del sito.
- **Tastiera ed Esc:** chi apre un riquadro ci scrive, quindi lo strato prende la tastiera; quando non ha più niente la
  rende alla pagina. Esc premuto sulla pagina chiude il riquadro più in alto prima di ogni modalità; la scorciatoia che
  lavora sulla selezione va nello strato se la tastiera è lì. I tasti che la scheda prende prima della pagina (chiudi,
  apri, indietro, salto di scheda, barra laterale) valgono anche scrivendo nello strato, per la scheda sotto
  (`tastoDellaScheda`). Così lo zoom: Ctrl +/-/0 e Ctrl+rotella sopra un riquadro vanno alla pagina
  (`zoomDaTasto`, `rotellaZoom` in `src/main/tabs/tabZoom.js`), lo strato resta a zoom 1.
- **Sostituisci torna alla pagina:** il campo e la selezione della Modifica restano nel content script che l'ha chiesta;
  dallo strato torna solo il testo scelto (`RIQUADRO_SOSTITUISCI`), col fuoco già rimesso alla scheda.
- **Vita:** lo strato se ne va con la pagina (navigazione, chiusura, renderer morto); vuoto resta pronto un minuto, poi
  libera il suo processo, e il suo vuoto smette di seguire il puntatore della pagina: un ascoltatore rimasto a cercare
  la vista buttata era un errore del processo principale, cioè Filo bloccato. Anche la finestrella di accesso ha il suo,
  grande quanto la finestra.
- **Test:** `tests/riquadri-fuori-dal-sito.spec.mjs` (la lamentela: il sito non legge niente, nemmeno cercando), e gli
  spec che guardano i riquadri con `tests/helpers/riquadri.mjs`, che li trova nella scheda o nello strato
  (`nelloStrato`, `paginaDelloStrato`) e ci clicca col mouse dello strato. Nessuno l'ha provato su un Mac o su un Linux
  desktop vero.
