# Esc chiude prima il riquadro aperto, poi la modalità

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Un Esc che il main intercetta per uscire da una modalità (oggi lo
schermo intero) non è suo finché la pagina non ha finito col tasto. Il main
mette l'uscita **in attesa** e la fa partire solo se nessuno se l'è preso. Chi
se lo prende lo dichiara come si fa nel web: `preventDefault()` e
`stopPropagation()` nel proprio gestore. Nessun riquadro deve iscriversi da
nessuna parte.

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

**Come si decide, oggi.** Il main (`handleFullscreenEscape` in
`src/main/tabs.js`) distingue tre casi:

- tasto dalla barra di Filo, o da una scheda che non è quella davanti: la
  pagina non lo vedrà mai, si esce subito;
- tasto dalla pagina che è entrata a schermo pieno col suo pulsante (player
  video): è suo, come prima;
- tasto dalla pagina davanti: l'uscita va **in attesa** (`ESC_ATTESA_MS`) e non
  si fa nessun `preventDefault`, così il tasto arriva al documento.

Nel documento, `src/content/content.js` guarda due cose a giro finito (un
`setTimeout(0)` dopo il keydown) e, se nessuno l'ha usato, chiede l'uscita:

- **i pezzi di UI di Filo che c'erano un istante prima.** Ognuno porta il
  marchio di casa (`SN_FILO_UI`) e chi si chiude si stacca dal documento: se
  uno di quelli è sparito, il tasto era suo. Si guardano uno a uno e non quanti
  sono, perché nello stesso istante ne può nascere un altro (chiudendo la
  selezione di un'area compare l'avvisino che dice com'è andata).
- **su una pagina di Filo**, in più, basta che qualcuno abbia consumato il
  tasto: lì tutto quello che c'è sullo schermo è roba nostra, comprese le
  immagini a tutta pagina, che non si staccano dal documento ma si accendono
  con una classe. Sui siti no: un sito che si mangia i tasti non deve poterci
  chiudere dentro allo schermo intero.

**Non si resta mai chiusi dentro.** È la parte che conta più della regola. Se la
pagina non risponde affatto — nessun content script, renderer bloccato — il main
esce da solo allo scadere dell'attesa. Se una pagina di Filo si prendesse ogni
Esc senza chiudere niente, il **secondo** Esc di fila esce comunque (il conteggio
torna a zero appena l'utente fa qualcos'altro, così riaprire un'immagine le
ridà il suo tasto). Il caso peggiore è un'uscita in ritardo di mezzo istante,
mai una modalità senza uscite.

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
