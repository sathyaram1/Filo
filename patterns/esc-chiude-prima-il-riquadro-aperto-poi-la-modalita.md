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
nessuna prova vale all'infinito. Se la pagina non risponde affatto — nessun
content script, renderer bloccato — il main esce da solo allo scadere
dell'attesa. Se qualcuno rivendica ogni Esc, il conteggio delle rivendicazioni
di fila lo ferma: **una** sola per gli indizi delle pagine di Filo (il tasto
consumato, la pagina che si alleggerisce), quindi il secondo Esc esce comunque;
**tre** per la roba nostra, dove la prova è solida e il tetto serve solo a non
lasciare scritto «per sempre» da nessuna parte, visto che tre riquadri impilati
chiusi uno per Esc sono già più di quanti ne esistano. Il conteggio torna a zero
appena l'utente fa qualcos'altro, così riaprire un'immagine le ridà il suo
tasto. Il caso peggiore è un'uscita in ritardo di mezzo istante, mai una
modalità senza uscite.

**Chi apre un riquadro nuovo non deve sapere niente di tutto questo**: gli basta
marcare la radice con `SN_FILO_UI.mark()` come già si fa, e dichiarare il tasto
nel proprio gestore di Esc. Le prove stanno in
`tests/esc-riquadri-schermo-intero.spec.mjs`, con cinque famiglie di riquadri
diverse e nessuna iscrizione da nessuna parte.

**Il nome della voce cambia con lo stato, anche a menu aperto.** Se la modalità
si spegne per un'altra strada mentre il menu è sotto gli occhi, la voce va
ridisegnata sul posto (`SN_MENU_ICONS.redrawIconRows`): «Esci da schermo
intero» su uno schermo che intero non è più promette il contrario di quello che
fa.
