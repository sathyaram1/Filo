# I riquadri di Filo su un sito stanno sopra la scheda

[← Tutti i pattern](../PATTERNS.md)

Spiegazione e traduzione (la risposta in streaming), Modifica, feedback, attacco red-team e il pannello Aiuto aperti su
un sito non entrano nel documento del sito: si disegnano nello **strato dei riquadri**, una WebContentsView trasparente grande
quanto la scheda, una per pagina, con la sua pagina `filo://riquadri/`. Sulle pagine `filo://` restano nel documento:
lì non c'è codice di altri.

- **Perché:** nel documento, anche dentro uno shadow root chiuso, il sito leggeva quello che l'utente scrive o seleziona
  (`getSelection()` dopo Ctrl+A o una copia, `window.find`, gli `input` che escono dallo shadow), e la ricerca nella
  pagina trovava il testo dei riquadri (#1071, #1509.1) e la domanda e le risposte dell'Aiuto (#1509.3). Nessuna pezza dentro il documento chiude queste strade: il
  testo non deve stare dove il sito lo raggiunge. Stessa cura del menu
  ([Il menu del tasto destro sta in uno strato sopra la scheda](il-menu-del-tasto-destro-sta-in-uno-strato-sopra-la-scheda.md)).
- **Chi apre:** i moduli dei riquadri (`SN_FEEDBACK_UI.open`, `SN_EDITBOX.openEditBox`, `SN_REDTEAM_ATTACK_UI.open`,
  `SN_POPUP.openStreaming`) su un sito chiedono `RIQUADRO_APRI` (`src/content/riquadriSopraLaScheda.js`); il main
  (`src/main/stratoDeiRiquadri.js`) crea o riusa lo strato della pagina e gli consegna la richiesta. Se lo strato non si
  può fare, il riquadro si apre nel documento come prima, non sparisce.
- **L'Aiuto lavora sulla pagina sotto** (#1509.3): conversazione e pannello stanno nello strato; quello che tocca la
  pagina (la foto, lo schema, le immagini a vista, l'attesa dopo un passo, le azioni del menu, la cornice sul passo
  indicato) lo fa il suo frame principale, `src/content/aiutoPagina.js`. Lo strato chiede `AIUTO_ALLA_PAGINA`, il main
  lo gira alla pagina (`AIUTO_DALLO_STRATO`) e aspetta `AIUTO_ESITO`, con un tetto di tempo per operazione
  (`OP_PAGINA`): chiede solo lo strato, risponde solo il frame principale. Nota, valore proposto e «Accetta» del passo
  stanno nello strato: la pagina gli manda dove sta il bersaglio (`posa`, anche per scostare il pannello) e il clic
  dell'utente sul passo (`azione`), con `AIUTO_ALLO_STRATO`; il valore entra nel campo solo all'Accetta. Nel documento del sito resta la facciata di `SN_SIDEBAR`: apre
  lo strato e tiene lo stato che il pannello le manda, per la barra laterale e il menu. L'uscita di un'azione di pagina
  (cercare, aprire un link) torna allo strato e passa da `runFiloAction`, con la sua conferma.
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
- **La cornice:** la vista è grande quanto la scheda, così i riquadri si posano come nella pagina, ma una `View` la
  ritaglia alla zona dei pezzi a schermo (con un margine per l'ombra), che lo strato ridice a ogni cambio. Fuori dalla
  cornice la pagina riceve i suoi gesti veri: trascinamenti, file dal computer, dita, che il vuoto non sa rigirare (con
  l'Aiuto aperto, che resta, era la pagina intera a non riceverli). Chromium ritaglia anche i trascinamenti solo se la
  vista è stata attaccata già tagliata: la si riattacca alla prima volta che la cornice la taglia (`_riattacca`). Un
  pezzo senza una scatola sua (il menu, nell'ombra) o un modale fanno la cornice grande quanto la scheda.
- **Il vuoto è della pagina:** dentro la cornice, fuori dai riquadri, clic, rotella e trascinamenti tornano alla scheda
  (`src/main/vuotoDellaVista.js`, `src/renderer/vuoto.js`), solo se veri, perché lì arrivano come gesti dell'utente;
  un riquadro che copre la pagina (feedback, Modifica, red-team) è tutto suo. Per la barra laterale lo strato non copre
  la pagina (`paginaScoperta`): le sue azioni di pagina e l'icona Aiuto restano, e un input sullo strato vale come sulla
  pagina. Un gesto sullo strato è dell'interfaccia di Filo (`gestoNelloStrato`): vale per gli appunti e
  il menu di Filo, mai per finestre e permessi del sito.
- **Tastiera ed Esc:** chi apre un riquadro ci scrive, quindi lo strato prende la tastiera; quando non ha più niente la
  rende alla pagina. Esc premuto sulla pagina chiude il riquadro più in alto prima di ogni modalità (l'Aiuto non si
  chiude con Esc, come nella pagina, e con solo lui aperto il tasto resta della pagina); la scorciatoia che
  lavora sulla selezione va nello strato se la tastiera è lì. I tasti che la scheda prende prima della pagina (chiudi,
  apri, indietro, salto di scheda, barra laterale) valgono anche scrivendo nello strato, per la scheda sotto
  (`tastoDellaScheda`). Così lo zoom: Ctrl +/-/0 e Ctrl+rotella sopra un riquadro vanno alla pagina
  (`zoomDaTasto`, `rotellaZoom` in `src/main/tabs/tabZoom.js`), lo strato resta a zoom 1.
- **Sostituisci torna alla pagina:** il campo e la selezione della Modifica restano nel content script che l'ha chiesta;
  dallo strato torna solo il testo scelto (`RIQUADRO_SOSTITUISCI`), col fuoco già rimesso alla scheda.
- **Vita:** lo strato se ne va con la pagina (navigazione, chiusura, renderer morto), e con lui l'Aiuto, che lo dice alla
  pagina; vuoto resta pronto un minuto, poi libera il suo processo. Un Aiuto chiuso mentre Filo risponde lo tiene vivo:
  la risposta resta da aprire. L'Aiuto sale sopra la pila degli avvisi della barra come nella pagina: il main scrive
  `--filo-avvisi-barra` anche nello strato. Anche la finestrella di accesso ha il suo, grande quanto la finestra.
- **Test:** `tests/riquadri-fuori-dal-sito.spec.mjs` e `tests/aiuto-fuori-dal-sito.spec.mjs` (la lamentela: il sito non
  legge niente, nemmeno cercando; l'Aiuto lavora sulla pagina; con lui aperto un trascinamento vero arriva alla pagina,
  coi gesti del sistema di `tests/helpers/gestiVeri.mjs`, solo su Linux con X), e gli
  spec che guardano i riquadri con `tests/helpers/riquadri.mjs`, che li trova nella scheda o nello strato
  (`nelloStrato`, `paginaDelloStrato`) e ci clicca col mouse dello strato. Nessuno l'ha provato su un Mac o su un Linux
  desktop vero.
