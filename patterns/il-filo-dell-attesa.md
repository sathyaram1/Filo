# Il filo dell'attesa: un nodo è un pensiero e le azioni che ne sono nate

[← Tutti i pattern](../PATTERNS.md)

Quello che la chat della home mostra mentre Filo lavora (#578). Prima c'era una
rotella e una riga «Sta ragionando · …» con l'ultima frase del ragionamento
ancora incompleta: cresceva a strappi, si riaccorciava a ogni frase nuova e
troncava le parole a metà, e le azioni si vedevano solo aprendo la cronologia.
Il banco di prova con tutte le alternative (scartate comprese) sta sul ramo
`claude/attesa-filo`, in `prove/attesa.html`.

Il disegno sta in `src/pages/dashboard/filo-attesa.js` (`SN_FILO_ATTESA`: il
filo, i nodi, il gomitolo e i titoli); cosa succede lo decide il blocco
(`createActivity` in `dashboard-attivita.js`, vedi
[il blocco di attività](in-chat-il-blocco-di-attivita-della-domanda-chiuso.md)).

- **Nessuna scritta di stato, da nessuna parte.** A sinistra del blocco corre
  un filo verticale del colore d'accento. Il movimento dice cosa succede:
  mentre il modello ragiona ondeggia pieno; mentre uno strumento lavora si
  tende e quasi si ferma (il lavoro è altrove); fermato dall'utente si taglia
  e la punta si affloscia. Ondeggia solo sotto l'ultimo nodo: quello che è già
  annodato è già successo e sta fermo.
- **La trama.** Sulla riga viva scorre una riga sola di ragionamento grezzo,
  piccola, sfumata ai bordi, opacità intorno a 0.5: non si legge, si
  intravede, e ogni tanto ci si becca una parola. Un clic apre la sezione.
- **Un nodo è un pensiero e le azioni che ne sono nate.** Quando il modello
  chiama strumenti il filo si annoda su quella riga e al posto della trama
  compare l'azione mentre accade («Cerco sul web…»); con l'esito il titolo
  diventa quello definitivo. Gli strumenti chiamati insieme (lo stesso giro)
  fanno un nodo solo: sono una decisione sola. L'ultimo pensiero, quello che
  decide come rispondere, non ha azioni e non fa nodo: è la coda, e si legge
  solo srotolando il gomitolo (prima della risposta non si deve intravedere).
- **I titoli si calcolano, non si generano** (`titoloNodo`, tabella `TITOLI`;
  prove in `tests/unit/filoAttesa.test.mjs`). Un'azione: «Cercato sul web ·
  orari treni». Più azioni dello stesso tipo: il plurale dal verbo e dal
  conto, al massimo tre dettagli e poi `+N` («Aperte tre pagine · a, b, c»).
  Tipi diversi: si contano («3 azioni · sveglia, appunto, pagina»). Un'azione
  non riuscita o in attesa di conferma tiene la frase della sua riga: il
  titolo non promette il contrario. Un tipo d'azione nuovo va in `TITOLI`.
- **I nodi sono tutti uguali**: un puntino pieno, raggio ~3.4 px, niente alone
  né forme per tipo (rimandate di proposito: le prove stanno in
  `prove/nodi.html` e `prove/nodi2.html` sullo stesso ramo). Si forma come un
  cappio che si stringe (~450 ms) e il puntino compare nell'ultimo tratto;
  all'esito dà uno strappo (raggio +⅓ e ritorno, sotto i 200 ms). **Il filo
  non mente sull'esito**: se nessuna azione del nodo è riuscita il cappio si
  stringe e si riapre, e il puntino non si forma mai. Passando il mouse su un
  nodo compare il titolo esteso; i nodi stanno sulla loro riga e scendono con
  lei se una sezione sopra si apre.
- **Una sezione aperta alla volta**: dentro, il ragionamento per intero e,
  staccati da una riga sottile, gli esiti con la loro icona.
- **Il gomitolo.** Quando comincia la risposta il filo si avvolge e resta una
  riga sola: il riassunto (`summarizeActivity`) e la durata del lavoro. Sono
  gli stessi punti del filo mandati sulla spirale per lunghezza d'arco, non una
  figura nuova: un lavoro lungo fa un gomitolo più grosso, e srotolare è la
  stessa animazione al contrario. Il riassunto si sposta quanto serve a
  lasciare a un gomitolo grosso l'aria di uno piccolo (prova J dello spec).
  Se dopo il testo arriva un'azione, quel
  testo era una nota: il gomitolo si srotola e il lavoro continua.
- **Fermare.** Mentre Filo lavora il posto dell'invio lo prende un quadrato
  (`#stopBtn`, stesso posto, colore d'accento) e Invio fa la stessa cosa:
  fermare è urgente, e sul telefono il passaggio del mouse non esiste. Il filo
  si taglia subito, senza aspettare il main; la riga in corso diventa «Fermato
  qui» col ragionamento a metà aperto, e al posto della risposta resta una riga
  che lo dice. Il blocco NON si arrotola: chi ferma ha visto qualcosa che non
  gli torna. Nel main (`MSG.FILO_CHAT_STOP`, solo la scheda che ha avviato il
  turno) la chiamata in volo si interrompe e nessuna azione nuova parte; quelle
  già partite finiscono e restano raccontate. Una risposta già finita invece
  arriva: fermare riguarda il lavoro che resta. Uno stop arrivato mentre il
  turno prepara ancora la richiesta (saldo, batteria, rete) si tiene da parte
  e vale quando il turno si registra: il modello non parte (prova K).
- **Fermato vuol dire finito, per la scheda.** Al clic il turno chiude subito
  la sua parte a schermo (voce nello storico, riga «fermato», posto per le
  azioni ancora in volo) e la chat torna dell'utente: riprendi e seguito si
  possono dare subito. L'azione già partita finisce nel main e il suo esito
  arriva nel blocco, che si chiude allora; il turno dopo parte solo quando
  quell'esito è nello storico, così non la rifà (prove L, L2). Lo stato «sta
  lavorando» della scheda non deve mai sopravvivere al clic: è la regola su
  cui sono caduti tre giri di verifica.
- **Riprendere non riesegue niente.** Finché l'utente non scrive altro, il
  tasto d'invio offre «riprendi»: il turno fermato sta nello storico con le
  azioni fatte (`interrotto`, `fermato`), il modello le vede come già fatte e
  riparte con un turno interno. Rimandare una mail già mandata è un danno, non
  uno spreco.
- **Lo stop resta scritto dove si decide di riprendere.** Ogni meccanismo che
  ricostruisce il lavoro in sospeso deve sapere che è stato fermato, o lo rifà
  da solo. L'accoglienza riparte da sé quando trova in fondo un messaggio
  dell'utente senza risposta: lo stop si segna nel suo stato (`fermato`), una
  scheda nuova o la pagina ricaricata mostrano «fermato» e «riprendi» invece di
  ripartire, e il segno cade con «riprendi» o con un messaggio nuovo (prova M).
- **Il secondo colpo non riprende.** Chi ferma insiste (doppio clic, Invio due
  volte o tenuto): per un attimo dopo lo stop il posto resta un quadrato spento
  e Invio a vuoto non riprende; la ripetizione del tasto non conta mai. Il
  «Riprendi» del tasto destro è una scelta deliberata e vale subito.
- **Preferenze.** Con `prefers-reduced-motion` il filo non ondeggia, niente si
  anima e il gomitolo compare già fatto. Opacità della trama e durate del
  cappio e dell'avvolgimento sono token estetici (`filo.trama.opacity`,
  `filo.nodo.durata`, `filo.gomitolo.durata`): nelle impostazioni avanzate e
  chiedendolo a Filo.
- Test: `tests/filo-attesa.spec.mjs` (filo, nodi, gomitolo, fermare e
  riprendere, con screenshot), `tests/dashboard-chat-attivita.spec.mjs`.
