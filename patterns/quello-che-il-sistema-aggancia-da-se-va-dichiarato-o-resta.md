# Quello che il sistema aggancia da sé va DICHIARATO, o resta quello di Electron

Un'app Electron non parte nuda: dove il sistema si aspetta qualcosa e l'app non lo
dichiara, il motore ci mette il SUO. È un difetto invisibile a chi sviluppa su Windows,
perché lì quel qualcosa spesso non si vede.

Il caso vero (#527): la barra dei menu. Su Windows e Linux la finestra di Filo è senza
cornice, la barra non viene attaccata a niente e nessuno se ne accorge. Su Mac la barra è
dell'**applicazione** — in cima allo schermo, sempre presente — e Filo mostrava quella di
serie di Electron: in inglese, con i link al sito di un altro prodotto, e con otto voci
che si prendevano `Cmd+W`, `Cmd+R`, `Cmd+Z` e `Cmd +/-/0` **prima** che il tasto
arrivasse alla pagina. Chiudere una scheda chiudeva la finestra con dentro tutte le altre.

**Regola.** Ogni tasto che compare in una barra dei menu deve fare esattamente quello che
l'app fa già per quel tasto:

- i `role` di Electron si usano SOLO dove il tasto non è dell'app (`cut`, `copy`,
  `paste`, `selectAll`, `hide`, `minimize`, `quit`);
- dove il tasto è dell'app, la voce **non ha `role`**: ha un `click` che chiama la stessa
  funzione della scorciatoia. Un `role` lì significa "il comportamento di Electron al
  posto del nostro";
- niente acceleratori inventati che la barra registrerebbe solo dove è attaccata: un
  tasto che funziona su Mac e non su Windows è la stessa asimmetria da cui il difetto
  nasce.

**Togliere non è una via d'uscita.** Su Mac Chromium non ha scorciatoie di modifica
proprie: `Cmd+C`, `Cmd+V`, `Cmd+A` le lascia apposta al menu dell'applicazione. Una barra
assente spegne copia e incolla in ogni campo di testo. Si sostituisce, non si rimuove.

**`registerAccelerator: false` non serve su Mac**: Electron lo onora solo su Windows e
Linux. Là è giusto usarlo (il tasto lo gestiscono già le pagine, la voce mostra la
scritta e basta); su Mac l'unico modo di non prendersi un tasto è non scriverlo.

**Un tasto della barra è tolto a tutto il resto — e va tolto anche sulla carta.** La
barra arriva prima di chiunque, quindi ogni suo tasto smette di essere disponibile per
altro: né per un'altra funzione dell'app, né per una scorciatoia che l'app lascia
scegliere all'utente. `Cmd+0` era promesso insieme allo zoom al 100% e alla decima
scheda: vinceva lo zoom, e alla decima scheda non ci si arrivava mai — mentre due elenchi
continuavano a dire che sì. Nell'Editor la stessa causa rientrava dall'altra porta: una
scorciatoia di modulo assegnata a un tasto della barra si salvava, sembrava valida e non
partiva mai.

La cura è **una lista sola dei tasti già presi**, chiesta da chiunque ne assegni uno:
`SN_TASTI.riservato(accel)` in `src/shared/tasti.js`. La lista non si tiene allineata a
mano — una sentinella negli unit test la confronta con gli acceleratori della barra vera e
diventa rossa se divergono. E dove un tasto si sposta, si spostano insieme il
comportamento (`indiceSaltoScheda`), il suo nome (`etichettaSaltoScheda`) e la sua
descrizione (`descrizioneSaltoScheda`): tenerli in file diversi è come sono nate le due
promesse contraddittorie.

Corollario: **una pagina che si tira fuori da un comportamento va comunque avvisata.**
L'editor scala il foglio invece della finestra e si esclude dallo zoom del preload
(`dataset.filoOwnZoom`); finché il tasto gli arrivava, se lo gestiva da sé. Su Mac non gli
arriva mai, quindi il preload ora gli CONSEGNA il verso (`filo:zoom-in/out/reset` sul
`document`) invece di limitarsi a non fare niente — altrimenti lo zoom dell'editor su Mac
non succedeva affatto. Il verso sta nel nome dell'evento: fra il mondo isolato del preload
e quello della pagina un `detail` non passa.

**Quando una scorciatoia esiste in due posti, la regola che decide sta in un terzo.**
`Ctrl/Cmd+Z` annulla dentro un campo di testo e torna indietro fuori: la domanda "si sta
scrivendo qui?" arriva dalla pagina (Windows, Linux) e dalla barra (Mac). La regola vive
in `src/shared/campoTesto.js`; la pagina la chiama, il main ne manda la **sorgente** a
valutare dentro la pagina. Due copie sarebbero divergute al primo ritocco.

**Dove:** `src/main/menu.js` (la barra), `src/shared/campoTesto.js` (la regola), test:
`tests/unit/macSupport.test.mjs` (forma della barra, in millisecondi, anche su Windows) e
`tests/barra-menu.spec.mjs` (le voci azionate davvero, sull'app viva).
