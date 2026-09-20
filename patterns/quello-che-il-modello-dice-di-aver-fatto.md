# Quello che il modello dice di aver fatto si confronta con quello che ha fatto

[← Tutti i pattern](../PATTERNS.md)

Sul banco di prova dell'agente, in #517, il modello chiudeva il turno così: «Ti
ho messo una sveglia alle 19:00 per ognuna di quelle notti». Non aveva chiamato
nessuno strumento. Il testo arrivava in chat, la sveglia no, e l'utente lo
scopriva la mattina in cui non suonava. Il prompt lo vietava già, per iscritto,
in due punti. Non è servito: il divieto è una promessa affidata al modello, e
il fallimento era muto dalle due parti, perché nessuno confrontava le parole
con le azioni.

La regola: **in un giro agentico, quello che il modello DICE di aver fatto si
confronta con le azioni che ha davvero emesso in quel turno. Una dichiarazione
senza azione non si consegna all'utente.**

Due gradini, e sono diversi per prezzo:

1. **Il rimbalzo** costa una chiamata e non si vede. La risposta torna al
   modello con dentro la sua stessa frase e le tre uscite: chiama lo strumento
   adesso, oppure scrivi che era già fatto prima, oppure riscrivi la risposta
   senza dirlo fatto. Una volta sola per turno: due rimbalzi di fila vogliono
   dire che il modello insiste, e un ciclo costa all'utente l'attesa.
2. **L'avviso** costa la fiducia, quindi scatta solo dopo il rimbalzo e solo se
   la dichiarazione non la regge nemmeno un turno precedente della stessa
   conversazione. Dice cosa NON è successo («la sveglia non c'è»), non cosa è
   andato storto: all'utente serve sapere che la sveglia non suonerà.

Il riconoscimento sta in `src/shared/azioniDichiarate.js`, logica pura, una
famiglia per tipo di azione. Due scelte tengono basso il numero di falsi
allarmi, e si perdono facilmente riscrivendo le espressioni:

- **solo la prima persona al passato** («ho messo», «ti ho aperto»). Lo STATO
  che arriva al modello contiene le sveglie e i timer attivi: «la sveglia delle
  7 è impostata» è una constatazione vera, e un participio da solo la
  scambierebbe per una rivendicazione;
- **niente negazioni e niente ipotesi**: si guarda la proposizione che precede
  la frase, e «non ho messo nessuna sveglia» o «se ho aperto la pagina
  sbagliata» non contano.

I tipi che reggono una famiglia sono generosi DENTRO la famiglia: tutte le
strade che Filo ha per fare quella cosa. Fuori dalla famiglia no, e il secondo
giro di verifica ha spiegato perché: finché una sveglia reggeva anche l'appunto
e l'evento in calendario, una cosa fatta ne assolveva tre mai fatte, e la frase
che le dichiarava tutte insieme passava intera. L'eccezione è «promemoria», che
in italiano è tutte e tre.

**Un'azione conta se ha fatto nascere qualcosa.** La sveglia chiesta con un
orario che Filo non sa leggere viene chiamata e non crea niente: lì il presidio
taceva, e l'utente restava senza sveglia e senza avviso, cioè esattamente la
lamentela della segnalazione con una porta diversa. Restano buone le azioni che
hanno prodotto un output (una ricerca senza risultati è comunque partita) e
quelle in attesa dell'OK dell'utente, che in chat si vedono.

**Un'azione sola non regge due dichiarazioni diverse.** Se la sveglia sta già
reggendo la frase sulla sveglia, la frase accanto («e te l'ho segnata») non ha
più niente che la regga, a meno che non ripeta lo stesso verbo: lì è lo stesso
fatto detto due volte.

**Generosi non basta: devono essere COMPLETI.** Un avviso che accusa Filo di
non aver fatto una cosa che ha fatto si smette di leggere, e il presidio torna
muto — solo più caro, perché ogni falso allarme costa anche il rimbalzo. Quindi
ogni famiglia elenca tutte le strade vere, comprese quelle che non sembrano:
un programma o una cartella si aprono con un comando di shell, non esiste uno
strumento «apri un programma». E ciò che Filo fa SENZA azioni non ha famiglia:
i riassunti dei file dell'editor sono già in contesto a ogni turno (per dire
cosa c'è scritto in un file non serve aprirlo), e quello che impara lo scrive
in memoria un passaggio che parte da solo a turno finito, quindi «l'ho
memorizzato» è vero. Per lo stesso motivo la cronologia si guarda intera, non
solo i venti messaggi che vanno al modello.

Tre cose imparate dal primo giro di verifica:

- **il formato macchina arriva anche in CODA.** «Scrive la risposta buona come
  preambolo e chiude con un oggetto» era il secondo sintomo della segnalazione,
  e guardando solo l'inizio del testo bastava una frase davanti perché il turno
  passasse intero. Si guarda ogni riga che potrebbe aprirlo, fuori dai blocchi
  recintati coi tre apici (lì dentro è un esempio per l'utente, non un guasto);
- **una regola con una vocale accentata davanti a `\b` non scatta mai.** In
  JavaScript `\b` guarda solo l'ASCII: dopo la à di «modalità» non c'è nessun
  confine, e la regola nasce spenta, verde e inutile. Tre erano scritte così.
  Adesso lo impedisce una sentinella negli unit test;
- **la conferma col pronome è la forma normale.** Quando la cosa l'ha appena
  nominata l'utente si risponde «l'ho messa alle 19», non «ho messo la
  sveglia»: era la forma più probabile, ed era l'unica che passava intera. Il
  pronome però non dice DI COSA si tratta, e scrivere «la sveglia non c'è» su
  un appunto sarebbe peggio di tacere: la regge qualunque azione del turno,
  scatta solo nel caso muto, e l'avviso lì resta generico.

Il rimbalzo non è invisibile per l'utente quanto sembra: la risposta già
comparsa a schermo viene cancellata, e una risposta che si cancella da sola
senza una parola sembra un guasto. Nel blocco di attività resta la riga che
dice perché. E l'avviso non è un vicolo cieco: ha il tasto che rifà la
richiesta, come la bolla d'errore, invece di far riscrivere tutto all'utente.

Il cugino di questa regola è [Una promessa fatta all'utente non può dipendere
dal modello](una-promessa-fatta-allutente-non-puo-dipendere-dal-modello.md):
lì è l'app che promette e il codice che deve mantenere, qui è il modello che
dichiara e il codice che deve verificare. Stessa radice: un invariante non può
dipendere dall'umore di un LLM.

Il giro sta in `handleFiloChat` (`src/main/services/handlers.js`), l'avviso
sotto la bolla in `src/pages/dashboard/dashboard.js`.
