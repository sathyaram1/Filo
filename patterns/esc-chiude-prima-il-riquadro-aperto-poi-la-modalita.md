# Esc chiude prima il riquadro aperto, poi la modalità

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Un Esc che il main intercetta per uscire da una modalità (oggi lo
schermo intero) non è suo finché la pagina non ha finito col tasto. Il main
mette l'uscita **in attesa** e la fa partire solo se nessuno se l'è preso. Chi
se l'è preso non deve dirlo a nessuno: lo si vede da fuori, perché il riquadro
che si chiude sparisce. Nessun riquadro si iscrive da nessuna parte e nessuno
deve ricordarsi di dichiarare niente.

**Il caso.** #514 chiedeva che Esc facesse uscire dallo schermo intero. La prima
soluzione lo intercettava in `before-input-event`, cioè prima che il documento
lo vedesse: da lì lo schermo intero si spegneva sempre, ma i riquadri di Filo
restavano aperti sopra la pagina. La seconda insegnava al main tre riquadri —
il menu del tasto destro, la risposta, l'immagine della gestione feedback — che
gli annunciavano apertura e chiusura. Un giro dopo si sono trovate cinque
porte identiche che quell'elenco non conosceva: l'immagine ingrandita nella
home, quella nella pagina dei feedback, la domanda di conferma, il QR code,
la selezione di una parte dello schermo. Una lista scritta a mano invecchia
male: chi scrive il riquadro numero sette non sa che esiste.

La terza soluzione tolse la lista e chiese invece una riga a ogni riquadro
(`preventDefault()` più `stopPropagation()` nel proprio gestore). Un giro dopo
saltarono fuori altre quattro porte, tutte dentro le pagine di Filo: il menu di
ordinamento e la barra di ricerca della gestione, il menu del tasto destro sul
titolo nell'editor, il menu del tasto destro nella cronologia. Nessuno di loro
sapeva di doverla scrivere, quella riga. **Una regola che chiede qualcosa a chi
scrive il riquadro nuovo è una lista travestita**: non serve tenerla
aggiornata, ma si scopre incompleta esattamente allo stesso modo, un giro per
porta.

**Come si decide, oggi.** Il main (`handleFullscreenEscape` in
`src/main/tabs.js`) distingue tre casi:

- tasto dalla barra di Filo, o da una scheda che non è quella davanti: la
  pagina non lo vedrà mai, si esce subito;
- tasto dalla pagina che è entrata a schermo pieno col suo pulsante (player
  video): è suo, come prima;
- tasto dalla pagina davanti: l'uscita va **in attesa** (`ESC_ATTESA_MS`) e non
  si fa nessun `preventDefault`, così il tasto arriva al documento.

Nel documento, `src/content/content.js` guarda tre cose a giro finito (un
`setTimeout(0)` dopo il keydown) e, se nessuno l'ha usato, chiede l'uscita:

- **i pezzi di UI che abbiamo disegnato noi e che c'erano un istante prima.**
  L'elenco lo tiene `SN_FILO_UI.aperti()`, e ci finisce solo chi passa da
  `mark()`. Chi si chiude si stacca dal documento: se uno di quelli è sparito,
  il tasto era suo. Si guardano uno a uno e non quanti sono, perché nello stesso
  istante ne può nascere un altro (chiudendo la selezione di un'area compare
  l'avvisino che dice com'è andata).
- **su una pagina di Filo**, in più, che la pagina si sia **alleggerita** nel
  giro del tasto: un elemento in meno nel documento, o uno in più nascosto. I
  riquadri che disegnano le pagine interne (i menu del tasto destro della
  cronologia e dell'editor, il menu di ordinamento e la barra di ricerca della
  gestione) non passano da `mark()` e non dichiarano niente; sparire è l'unica
  cosa che fanno tutti. Conta solo quella direzione: una pagina che sta
  **aggiungendo** roba, come una risposta che arriva a pezzi, non deve poter
  rivendicare il tasto.
- **su una pagina di Filo**, sempre in più, che qualcuno abbia consumato il
  tasto: lì tutto quello che c'è sullo schermo è roba nostra, comprese le
  immagini a tutta pagina, che non si staccano dal documento ma si accendono
  con una classe. Sui siti no: un sito che si mangia i tasti non deve poterci
  chiudere dentro allo schermo intero.

**L'attributo dice «saltami», l'elenco dice «l'ho disegnato io».** Sono due
domande diverse e una sola non basta per entrambe. `data-sn-ui` sta nel
documento, e il documento è del sito: a chi cammina sulla pagina per tradurla
l'attributo basta (un sito che se lo mette addosso si esclude dalla traduzione, e
peggio per lui), ma a chi decide di chi era un tasto no. Un sito che si marcava
un elemento invisibile e se lo toglieva a ogni Esc si teneva l'utente dentro
allo schermo intero a tempo indeterminato. L'elenco vive nel mondo isolato dei
content script e la pagina non può scriverci: da lì passa la decisione.

**Non si resta mai chiusi dentro.** È la parte che conta più della regola, e
nessuna prova vale all'infinito. Se la pagina non risponde affatto (nessun
content script, renderer bloccato) il main esce da solo allo scadere
dell'attesa. Se qualcuno rivendica ogni Esc, il conteggio delle rivendicazioni
di fila lo ferma.

**I tetti si contano separati, per FORZA della prova, non per pagina.** È il
difetto del giro 7: contando insieme prove che non valgono uguale, due riquadri
aperti insieme sopra una pagina di Filo costavano la modalità — il primo Esc
chiudeva quello sopra, il secondo chiudeva quello sotto **e** spegneva lo
schermo intero, che nessuno aveva chiesto di lasciare (la ricerca della gestione
sotto l'immagine a tutta pagina; la domanda di conferma sopra l'immagine
ingrandita della home). Il taglio giusto è quello che si è visto succedere:

- **prova forte** — qualcosa è sparito davvero: un pezzo nostro staccato dal
  documento, o (solo su una pagina di Filo) la pagina che si è alleggerita.
  Tetto **tre**: tre riquadri impilati chiusi uno per Esc sono già più di
  quanti ne esistano, e il tetto serve solo a non lasciare scritto «per
  sempre» da nessuna parte.
- **prova debole** — nessuno si è visto sparire, ma su una pagina di Filo
  qualcuno il tasto se l'è preso. Tetto **uno**: chi si prendesse ogni Esc
  senza chiudere niente si ferma al secondo.

Una prova forte riazzera il conto delle deboli: la pagina sta dimostrando di
fare qualcosa, non di mangiare tasti. Entrambi i conteggi tornano a zero appena
l'utente fa qualcos'altro, così riaprire un'immagine le ridà il suo tasto. Il
caso peggiore è un'uscita in ritardo di mezzo istante, mai una modalità senza
uscite.

**Il tetto che vale sta nel main, non nella pagina.** Il conteggio tenuto dal
content script è il primo filtro, non la garanzia: sta nel mondo isolato, ma
vive dentro la pagina, e il documento arriva a farlo ripartire da zero. Un sito
scritto apposta se ne serviva così: teneva da parte un riquadro di Filo vero
(il menu del tasto destro appena chiuso resta un nodo del suo documento), se lo
riattaccava invisibile e se lo ristaccava a ogni Esc per far credere che il
tasto fosse servito a chiudere qualcosa di nostro, e intanto azzerava il conto
con un `mousedown` finto fabbricato dal documento. Sei Esc, dentro. Per questo
lo stesso tetto (`ESC_RIVENDICAZIONI_MAX` in `src/main/tabs.js`) è contato
anche dal main, che conta le rivendicazioni arrivate mentre un'uscita era in
attesa e, superate tre di fila, smette di credere alla pagina ed esce. Riparte
da zero solo su cose che la pagina non può fabbricare: l'input vero
(`input-event` della WebContents, tutto tranne l'Esc stesso) e il cambio di
modalità. **Regola generale: un limite contro l'abuso di una pagina non può
essere contato dentro quella pagina**, per isolato che sia il mondo in cui
gira. La prova sta in `tests/verify-514-g6.spec.mjs` («sito ladro»), con la
controprova della stessa pagina senza gli eventi finti.

**Chi apre un riquadro nuovo non deve fare niente.** Un riquadro disegnato sopra
un sito passa già da `SN_FILO_UI.mark()`, perché il marchio serve anche a chi
traduce la pagina; uno disegnato da una pagina di Filo non deve nemmeno quello,
gli basta chiudersi. Le prove stanno in
`tests/esc-riquadri-schermo-intero.spec.mjs` (cinque famiglie di riquadri sopra
i siti) e in `tests/verify-514-g5.spec.mjs` (quattro riquadri delle pagine di
Filo, più il sito che si traveste da riquadro nostro).

**Il nome della voce cambia con lo stato, anche a menu aperto.** Se la modalità
si spegne per un'altra strada mentre il menu è sotto gli occhi, la voce va
ridisegnata sul posto (`SN_MENU_ICONS.redrawIconRows`): «Esci da schermo
intero» su uno schermo che intero non è più promette il contrario di quello che
fa.
