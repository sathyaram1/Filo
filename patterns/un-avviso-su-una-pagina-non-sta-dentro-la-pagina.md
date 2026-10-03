# Un avviso su una pagina non sta dentro la pagina

[← Tutti i pattern](../PATTERNS.md)

Un avviso che protegge l'utente **da** una pagina (il sito pericoloso, il sito
sospetto) si disegna in una **vista sopra la scheda**, mai nel documento della
pagina: lì dentro lo script del sito sente quello che ci si scrive, lo copre e
lo cancella.

## Il caso (#813.5)

L'avviso del sito pericoloso era una modale in uno shadow root dentro la pagina
segnalata. Tre strade portavano allo stesso stato, «la password arriva a chi la
vuole rubare»:

- **sentire**: il mondo isolato separa gli oggetti JavaScript, non gli eventi.
  `keydown` e `input` sono *composed*, attraversano lo shadow e arrivano agli
  ascolti della pagina su `window`: chi scriveva la password nella casella del
  «confermo» la consegnava carattere per carattere;
- **coprire**: un `popover` della pagina, aperto dopo, entra nello strato in
  cima sopra la modale e la nasconde, mentre i tasti continuano ad andare nella
  casella invisibile;
- **cancellare**: `document.write` a caricamento finito, o la sostituzione dei
  figli di `<html>`, butta via anche il nostro nodo. Il kit di phishing che
  mostra «Caricamento…» e poi riscrive la pagina toglieva l'avviso per sempre.

Ogni pezza dentro la pagina (riaprire la modale, rimettere l'host in fondo,
osservare lo strato in cima) chiudeva una porta e ne lasciava altre: la pagina
ha sempre l'ultima parola sul proprio documento. E dentro la pagina il menu del
tasto destro di Filo restava sotto la modale, inerte.

## La regola

- **La vista**: `src/main/avvisoSito.js`, una per finestra, nata al primo avviso
  e tenuta (nascosta) per i successivi, così il prossimo copre subito. Pagina
  `filo://shell/avviso-sito.html`, preload minimo (lo stato entra; scelta e
  punto del tasto destro escono, con l'id della scheda che si vedeva).
- **Copre la scheda intera**, con i suoi bordi, in cima alle schede e sotto gli
  avvisi della barra (`layout()` posa prima lei, poi `avvisi`). Il fondo scuro
  è della **vista** (`setBackgroundColor`), non della sua pagina: la scheda è
  coperta anche nei millisecondi in cui la pagina dell'avviso si carica. Il
  `backdrop-filter` non attraversa le viste: il fondo è quasi opaco.
- **Lo stato sta nel main, per scheda** (`tab.sbAvviso`, `_sbMostra` in
  `src/main/tabs/tabSafebrowse.js`). Il content script manda solo indirizzo e
  indizi; un verdetto in ritardo per un sito da cui la scheda è andata via non
  vale; una pagina che non è un sito (filo://, about:blank) toglie l'avviso.
- **La tastiera è dell'avviso**, al contrario degli avvisi della barra. Quando
  compare la prende a chi scriveva nella pagina (la barra che scrive la tiene);
  `_tastieraAllaSchedaAttiva` la dà all'avviso se la scheda è coperta; se il
  fuoco torna alla pagina (finestra che torna in primo piano, menu che si
  chiude, `focus()` della pagina) torna all'avviso al giro dopo; e un tasto che
  arrivasse comunque alla scheda coperta viene fermato (`before-input-event`).
  Il mouse non si può fermare così: lo ferma la vista sopra.
- **I tasti del browser** (Ctrl+T/W, Alt+cifra, indietro) premuti nell'avviso li
  decide la scheda: la vista li rigira al suo `before-input-event`, marcati
  `daAvvisoSito` perché la guardia qui sopra li lasci passare.
- **Le scelte le valida il main**: «Procedi» solo con «confermo» scritto e solo
  sul pericoloso; i messaggi che una pagina raggiunge non portano più né
  conferma né chiusura.
- **Il tasto destro** apre il menu di Filo (finestra figlia, sopra tutto).
  Quello che si fa *sul* sito sotto l'avviso — chiedere a Filo, segnalare il
  falso allarme — si fa in una scheda di Filo che se lo prende all'apertura
  (`CASA_RICHIESTA`, una volta sola): un pannello nella pagina starebbe sotto
  l'avviso, e se fosse sopra la pagina sentirebbe quello che ci si scrive.
- **Il «Continua» del sospetto si arma dopo un secondo**: l'avviso compare
  mentre l'utente scrive o clicca nella pagina, e quell'Invio non è per lui
  ([Una conferma non è un avviso sopra un fatto già compiuto](una-conferma-non-e-un-avviso-sopra-un-fatto-gia-compiuto.md)).

Vicini: [La shell non disegna sopra la pagina](la-shell-non-disegna-sopra-la-pagina.md)
(la vista in cima), [Un pezzo di Filo dentro un sito ubbidisce solo
all'utente](un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md) (quello
che resta nel documento del sito, e il suo limite: il sito può coprirlo).

## Provarlo

`tests/safebrowse.spec.mjs`. I locator e la tastiera di Playwright vanno
diritti al renderer che indichi, scavalcando sia la pila delle viste sia il
fuoco: non dicono cosa vede e dove scrive l'utente. Quindi si guarda la
copertura dal main (la vista è quella dell'avviso, in cima, con i bordi della
scheda, e il fuoco è suo) e si scrive come la tastiera vera, nel webContents
che ha il fuoco (`getFocusedWebContents().sendInputEvent`); la pagina tiene il
conto dei tasti che sente e deve restare a zero.
