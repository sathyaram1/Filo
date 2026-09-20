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

Il secondo giro di verifica ha trovato altre tre cose che non hanno bisogno di
prova, e ognuna faceva partire anche il rimbalzo, quindi la risposta buona
spariva da sotto gli occhi dell'utente prima di essere smentita:

- **quello che Filo consegna DENTRO la risposta.** L'utente chiede una mail,
  Filo scrive «te l'ho scritta qui sotto» e la mail è lì: non esiste nessuno
  strumento che possa averla scritta. I verbi del consegnare un testo non
  stanno nella conferma col pronome, e una frase che rimanda alla risposta
  stessa («qui sotto», «qui sopra», i due punti che introducono il testo) non
  conta;
- **un'immagine mandata in chat.** Arriva al modello dentro il messaggio, come
  i riassunti dei file dell'editor: per dire quanto c'è scritto sulla bolletta
  fotografata non serve nessuno strumento;
- **una sveglia che ESISTE.** Messa ieri, in un'altra sessione, non lascia
  nessuna azione in questa conversazione, e «sì, l'ho messa alle 19» diventava
  un'accusa a ogni riavvio. Si confronta l'ora nominata nella frase con le
  sveglie vere: un'altra ora non copre niente, che è il caso della
  segnalazione.

Tre cose imparate dal primo giro di verifica:

- **il formato macchina arriva anche in CODA.** «Scrive la risposta buona come
  preambolo e chiude con un oggetto» era il secondo sintomo della segnalazione,
  e guardando solo l'inizio del testo bastava una frase davanti perché il turno
  passasse intero. Si guarda ogni riga che potrebbe aprirlo, fuori dai blocchi
  recintati coi tre apici (lì dentro è un esempio per l'utente, non un guasto),
  e nemmeno quando la riga prima annuncia un esempio: chi chiede «fammi vedere
  com'è fatta un'azione» deve poterla vedere;
- **una regola con una vocale accentata davanti a `\b` non scatta mai.** In
  JavaScript `\b` guarda solo l'ASCII: dopo la à di «modalità» non c'è nessun
  confine, e la regola nasce spenta, verde e inutile. Tre erano scritte così.
  Adesso lo impedisce una sentinella negli unit test;
- **la conferma col pronome è la forma normale.** Quando la cosa l'ha appena
  nominata l'utente si risponde «l'ho messa alle 19», non «ho messo la
  sveglia»: era la forma più probabile, ed era l'unica che passava intera. Il
  pronome però non dice DI COSA si tratta, e scrivere «la sveglia non c'è» su
  un appunto sarebbe peggio di tacere: la regge un'azione del turno rimasta
  libera, scatta solo nel caso muto, e l'avviso lì resta generico.

Il terzo giro di verifica ha rimesso in piedi la stessa domanda — cosa vale
come prova — e ha trovato che era stata richiusa su una forma sola per parte.
La regola che ne esce è che **ogni risposta a quella domanda va scritta per la
categoria intera, non per la frase che l'ha fatta nascere**:

- **un'azione che mette un bottone in chat è un'azione fatta.** L'evento di
  calendario, la pulizia delle schede e la cancellazione dell'archivio non si
  eseguono da sole: il main le TIENE e preme l'utente. Contate come «mai
  chiamate» facevano buttare la risposta, rifarla e poi smentire Filo per una
  cosa che aveva fatto per intero — e il tasto «Fallo adesso» non portava da
  nessuna parte, perché Filo poteva solo riproporre lo stesso bottone. Una
  sveglia chiamata e non riuscita resta fuori: lì in chat non resta niente;
- **«qualunque azione libera» era troppo larga.** Un'azione che si limita a
  GUARDARE (una ricerca, una lettura) non può essere la cosa che l'utente si
  sente confermare col pronome, e un segno di contesto non è un'azione del
  tutto. Bastava avere un file aperto nell'editor — quel segno arriva a ogni
  turno — perché il presidio non parlasse mai più: funzionava su un Filo vuoto
  e smetteva appena veniva usato. Il comando di terminale resta l'eccezione, e
  per scelta: un comando può davvero salvare o cancellare qualunque cosa;
- **la prova che sta nello stato vale per tutte le frasi, non per una.** La
  sveglia che esiste reggeva solo la forma lunga che ripete la parola
  «sveglia» con l'ora in cifre, cioè la forma meno probabile subito dopo la
  domanda: il pronome, la parola «promemoria» e l'ora detta a lettere («alle
  sette», «alle 7 di sera», che sono le 19) restavano un'accusa. Lo stesso
  vale per gli appunti: un appunto salvato ieri regge la frase che lo nomina;
- **il formato interno ha più di una busta.** Oltre al vecchio involucro, alla
  lista di azioni e al nome dello strumento con le parentesi, i modelli aperti
  lo emettono avvolto in un tag (`<tool_call>…`) o preceduto dallo spazio dei
  nomi (`functions.SVEGLIA({…})`). Nel testo sono lo stesso guasto: in chat
  resta un blocco di codice e la sveglia non c'è.

Il quarto giro di verifica ha aggiunto due cose, e la prima è la più grossa.

- **il presidio vale per OGNI chat che può agire, non per quella dove è nato.**
  Filo ha due chat: quella della home e l'Aiuto, il pannello che si apre sulle
  pagine. L'Aiuto parla in JSON e da lì Filo manda segnalazioni, copia, cerca,
  comanda la finestra. Una sua risposta in prosa, o chiusa con un oggetto
  vuoto, non esegue niente: l'utente leggeva «ho mandato la segnalazione» e
  non partiva nulla, oppure perdeva anche la frase e leggeva «(risposta
  vuota)». Sono le due forme che la segnalazione descriveva, e lì il
  fallimento era rimasto muto perché il presidio stava nell'altra chat. Adesso
  l'Aiuto fa gli stessi due gradini: rimbalzo una volta, con la riga nel log
  che dice perché la risposta è sparita, e poi la frase all'utente. La
  risposta scritta prima dell'oggetto vuoto non si butta più;
- **le parole che zittiscono il presidio vanno rilette una per una.** Fra le
  negazioni c'erano «invece», «prima», «quando» e «appena», che sono
  congiunzioni: davanti a una dichiarazione già al passato raccontano quando
  la cosa è successa, non che non è successa, e «non ho trovato l'evento,
  invece ti ho messo la sveglia alle 19» non scattava. Stessa famiglia del
  «però» del primo giro, dall'altra parte;
- **i tre apici non sono un salvacondotto.** Un modello abituato a recintare i
  blocchi di codice ci mette dentro anche la chiamata, e il turno passava
  intero. Adesso si guarda anche dentro il recinto, e l'esempio resta un
  esempio grazie alla riga che lo annuncia («ecco un esempio di come si
  scrive»), non grazie agli apici. Per non buttare la risposta a chi chiede un
  JSON qualunque, il nome dentro `"type"` si confronta con gli strumenti veri;
- **il titolo di un appunto non prova un'ora.** Un appunto che esiste regge la
  frase che lo nomina, ma chi ne teneva uno intitolato «spesa» non veniva più
  avvisato di nessun promemoria che nominasse la spesa. Se la frase promette
  un'ora, la prova è una sveglia, non un appunto.

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
sotto la bolla in `src/pages/dashboard/dashboard.js`. Il gemello dell'Aiuto sta
in `src/content/sidebar.js`, accanto a `parseAssistantOutput`.
