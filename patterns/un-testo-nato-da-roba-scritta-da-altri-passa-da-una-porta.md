# Un testo nato da roba scritta da altri passa da una porta sola

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Quando Filo mostra all'utente un testo che è nato dopo aver letto
contenuto scritto da altri — una mail, una pagina, un documento — quel testo
passa da **una funzione sola**, che applica prima controlli deterministici e poi
un **secondo modello, diverso** da quello che il testo l'ha scritto. Nessuna
superficie scrive direttamente nella colonna degli avvisi: una sentinella negli
unit test tiene la porta chiusa.

## Perché

La notifica è un canale di attacco, ed è il canale più efficace che Filo abbia:
l'utente si fida di Filo, non del mittente. Una mail scritta bene fa scrivere a
Filo «la tua banca chiede di confermare le credenziali, apri qui», e quella
frase arriva con l'autorità dell'app.

Nel registro dei livelli di sicurezza
([Le azioni di Filo hanno un livello statico](azioni-di-filo-livello-di-sicurezza-statico-nel-registro.md))
il testo verso l'utente non è nemmeno un'azione: costa zero e passa sempre. Non
è una dimenticanza — un testo *non fa* niente — ma è esattamente il buco da cui
si entra quando il testo è la cosa che convince una persona ad agire.

## Le tre parti della regola, e perché nessuna basta da sola

**La porta unica.** Il controllo vale quanto vale la porta: se una superficie
qualunque può scrivere un avviso per conto suo, il controllo è decorativo. Per
questo `SN_FILO_MEMORY.addNotification` ha un solo chiamante
(`src/main/services/textGuardian.js`), e chi propone un avviso dichiara da dove
viene il contenuto. Anche gli avvisi che scrive Filo stesso passano di lì: non
perché servano il controllo — sono compiti puliti e non chiamano nessun modello
— ma perché una seconda porta «solo per i casi sicuri» è comunque una seconda
porta, e prima o poi ci passa qualcos'altro.

**Il modello diverso.** Due contesti sullo stesso modello condividono le stesse
debolezze e cadono insieme: un secondo giudizio che gira sullo stesso modello è
lo stesso giudizio, chiesto due volte. Il codice toglie dalla catena del
guardiano i nickname del modello che ha scritto il testo
(`catenaGuardiano`, in `src/shared/textGuard.js`), e se non resta niente NON
lascia passare: mette l'avviso in coda. Un controllo che non si può fare non è
un controllo superato.

**La fiducia è del compito, non del messaggio.** È l'errore che il primo giro di
verifica ha trovato, ed è quello che rende il resto decorativo: legare il
controllo al messaggio in cui la ricerca è avvenuta protegge la prima risposta e
nessun'altra. Quello che Filo ha letto **resta nella conversazione** — è
`observationsForPrompt` che ce lo rimette — e continua a parlare al modello,
quindi basta una domanda di seguito («e adesso cosa devo fare?») perché la frase
che la pagina voleva far dire a Filo arrivi intera, e per giunta scorrendo in
diretta. Il conto si fa sulle azioni che hanno davvero prodotto un'osservazione
(`fontiContaminantiInContesto`): quando lo storico viene tagliato e quella pagina
esce dal contesto, il compito torna pulito, perché il testo di altri non c'è più.

**Quello che Filo scrive DI SUO va ripulito lo stesso.** La riga di blocco si
compone con due pezzi che vengono da fuori: il motivo, scritto dal modello
guardiano *dopo* aver letto il testo dell'estraneo, e la fonte, che per una mail
è il mittente — e il mittente se lo sceglie chi manda la mail. Un contenuto che
si fa bloccare apposta e detta il motivo si farebbe consegnare l'indirizzo della
truffa dalla voce di Filo, proprio nella riga che dovrebbe rassicurare, e per di
più come collegamento cliccabile. `ripulisci` toglie da quei pezzi tutto ciò che
porta da qualche parte (resta detto che un indirizzo c'era), tiene l'indirizzo di
posta del mittente, che è la cosa che serve sapere, e butta il pezzo intero se
dopo la pulizia fa ancora scattare un controllo statico o se è lungo come una
pagina. La regola generale: **il testo che Filo scrive attorno a contenuto non
fidato è contenuto non fidato anche lui.**

**I controlli statici prima.** Le forme riconoscibili — codici usa e getta,
codici di recupero, password, chiavi, coordinate bancarie, collegamenti la cui
destinazione non è quella che l'etichetta promette — si fermano in locale, senza
modello, e quindi anche a rete staccata. Costano zero e non hanno un fornitore
che possa essere giù.

## La frase di adesso non è l'unica uscita: c'è quello che resta scritto

Un turno che ha letto roba di altri non deve dire niente all'utente per fargli
arrivare la frase dell'estraneo. Gli basta **lasciarla nello stato di Filo** e
aspettare. Il nome di un timer parla quando il timer suona; un appunto parla
quando l'utente apre l'editor; una regola fissata nella memoria e lo «stile
dell'agente» parlano in **ogni conversazione successiva**, che è pulita, dove il
secondo modello non gira e non avrebbe ragione di girare. Il contenuto di un
estraneo, passando per lo stato di Filo, è diventato roba di Filo: lavato.

Le tre porte sono uscite nell'ordine, un giro di verifica per porta, e la ragione
è sempre stata la stessa: l'elenco dei campi da sorvegliare si teneva **a mano**,
e a mano arrivava fino al campo che qualcuno si era ricordato. Adesso quell'elenco
sta in `CAMPI_SORVEGLIATI` (`src/shared/textGuard.js`) e copre **ogni azione del
registro**, comprese quelle che non hanno niente da sorvegliare: una sentinella lo
confronta con il registro vero e diventa rossa appena nasce un'azione che non ha
dichiarato cosa lascia scritto. Un tipo che la tabella non conosce non vale
«niente da sorvegliare»: vale «sorveglia tutte le stringhe», che sbaglia per
eccesso di prudenza.

Quando il controllo non dà il via libera, due esiti diversi e dichiarati:
`svuota` toglie le parole e lascia vivere l'azione (un timer che si chiama
«Timer» resta un timer utile), `annulla` la lascia perdere (un appunto senza
testo, una regola senza regola, uno stile senza stile non sono niente di utile).
In tutti e due i casi il testo finisce nel registro degli avvisi fermati, e al
modello torna scritto che il controllo l'ha fermato e di non riscriverlo in altre
parole: al secondo tentativo la frase sarebbe la stessa, dettata dalla stessa
pagina.

Il caso delle **preferenze** merita una riga a parte. Quasi tutte sono un
interruttore o una parola scelta da un elenco, e chiamare un secondo modello per
un «tema: scuro» è lo spreco che questo lavoro deve evitare. Ma «stile
dell'agente» è testo libero, e quel testo entra nelle **istruzioni** di ogni
conversazione futura: è la porta peggiore delle tre. Quindi il registro delle
preferenze dichiara `testoLibero` (`src/shared/preferences.js`) e solo quelle
passano dal guardiano. Anche qui la garanzia non è la buona volontà: una
sentinella prova ogni preferenza con una stringa riconoscibile e, se quella
stringa arriva intera dentro l'impostazione, pretende che `testoLibero` sia
dichiarato — `true` per guardarlo, `false` per dire che non sono parole (una
chiave API non compare mai in chiaro, e ogni controllo statico la fermerebbe: lì
la difesa è la conferma di livello 2, non il guardiano del testo).

## «Avviso» e «risposta» non sono i posti, sono due dei posti

Il quinto giro di verifica ha trovato la porta dove nessuno guardava, e non era
un campo dimenticato: era una superficie intera. Il **saluto della nuova scheda**
e i **suggerimenti** accanto li scrive un modello a cui diamo, fra gli altri
ingredienti, i titoli delle pagine che l'utente ha salvato e i riassunti dei suoi
file. Il titolo di una pagina lo sceglie chi l'ha scritta. Bastava salvare quella
pagina una volta perché dettasse la prima cosa che l'utente legge a ogni scheda
nuova, con la voce di Filo, due centimetri sopra la riga «ho fermato un avviso».
E il suggerimento è peggio della frase: è un bottone di cui lo stesso modello
sceglie etichetta e indirizzo, e si apriva con un clic solo.

La lezione non è «aggiungere la home all'elenco». È che l'elenco va scritto al
contrario: non «quali superfici controllo», ma **quali testi verso l'utente
nascono da un modello che aveva davanti parole di estranei**. Quando ci si
chiede quello, la home è ovvia. Regola pratica per la prossima superficie: se un
modello riceve nel prompt un titolo, un riassunto o un testo che viene da fuori,
e quello che scrive finisce sotto gli occhi dell'utente, passa da qui.

Due scelte concrete che valgono per chi aggiunge la prossima superficie:

- **una chiamata sola per tutto il blocco**, non una per riga. Saluto e bottoni
  sono la stessa cosa, e mostrarne metà dopo un blocco è peggio che non mostrarne
  niente. Il testo che il guardiano giudica contiene anche **dove porta** ogni
  bottone: è la parte che fa il danno.
- **il mestiere del produttore viaggia col controllo**, non solo il suo nome.
  L'interruttore «solo modelli a pesi aperti» sceglie un sostituto diverso a
  seconda del mestiere, quindi ricostruire la catena del produttore col mestiere
  sbagliato dà la lista sbagliata da escludere, e il guardiano può finire proprio
  sul modello da cui doveva stare alla larga. È il danno del terzo giro, che
  rientrerebbe da qui.

Non passano ancora da questa porta «spiega», «traduci» e i riassunti di una
scheda: il feedback che ha creato il guardiano li mette per iscritto fra le cose
che verranno dopo. Sono testo nato da una pagina, quindi prima o poi ci passano.

## I due modi di sbagliare, e solo uno si vede

Se il guardiano lascia passare un inganno, nessuno se ne accorge finché non fa
danno. Se ferma cose innocue, lo si vede subito — e lo si spegne. Per questo:

- i controlli statici sono deliberatamente **stretti**: un codice a sei cifre
  blocca solo se accanto c'è una parola che lo chiama codice, un'etichetta che è
  una frase («apri il riepilogo») non conta come inganno. Indovinare le
  intenzioni è mestiere del modello;
- il blocco **spiega cosa ha visto**, mai che ha avuto un dubbio: «Ho fermato un
  avviso nato da una mail di X: chiedeva le tue credenziali»;
- i blocchi restano **scritti** in Preferenze → «Avvisi fermati», col testo
  fermato leggibile (chiuso, e inerte): senza, un falso positivo è
  indistinguibile da un blocco giusto;
- il tasso si **misura**, su un banco di mail finte etichettate
  (`tests/fixtures/bancoMail.mjs`, misurato da `tests/unit/bancoMail.test.mjs`):
  zero falsi positivi ammessi sui controlli deterministici.

## Quando il guardiano non risponde

Non è un caso limite: è il caso normale di una funzione che dipende dalla rete.
L'avviso **non compare e non si perde** — va in coda «in attesa del controllo»,
visibile come riga (mai col testo non ancora controllato), e riparte al giro
dopo. Un avviso che arriva dieci minuti dopo non ha fatto danno; uno che arriva
senza controllo sì.

Due frizioni imparate scrivendolo: la coda va **frenata** (la colonna della home
chiede le notifiche anche una volta al secondo: senza freno, una coda che non si
svuota costa sessanta chiamate al minuto a chi non ha fatto niente di sbagliato),
e la riga in attesa deve essere **togliibile**, altrimenti un guardiano che non
torna lascia sullo schermo una riga che non si può levare in nessun modo.

E «non risponde» non è una causa sola. La rete che va e viene si aggiusta
aspettando; un modello che manca, o che è lo stesso che ha scritto la risposta,
non si aggiusta aspettando — ogni risposta nata da una ricerca resterebbe in coda
per sempre, e la sola persona che può sistemarlo non saprebbe nemmeno che c'è da
sistemare. Le due frasi sono diverse (`fraseControlloFermo`, `fraseInAttesa`), e
quella della configurazione dice dove si imposta il modello.

La coda ha un tetto, e il tetto va **largo**: qui dentro finisce ogni risposta
nata da una ricerca finché il guardiano non torna, e con un modello del guardiano
mai impostato non ne esce nessuna. Cento voci erano pochi giorni d'uso. E quando
il tetto si raggiunge davvero, la voce più vecchia **non sparisce in silenzio**:
chi esce era una cosa promessa («te la mostro appena riesco»), quindi va nel
registro degli avvisi fermati con scritto che nessuno l'ha mai controllata. Un
taglio muto su una promessa lo si scopre settimane dopo, e non lo si scopre mai.

## Chi ha scritto il testo viaggia col testo

L'indipendenza del modello non è una regola che si applica una volta: va portata
dietro. Un testo che aspetta in coda riparte più tardi, e se chi lo rimette in
fila non si porta dietro **quale modello l'ha scritto**, al secondo giro non c'è
più nessuno da escludere: il controllo parte sul primo modello della sua lista,
che può essere proprio quello. È successo alle risposte della chat: finivano in
coda senza quel dato e ricomparivano giudicate da sé, pochi secondi dopo che il
codice si era rifiutato di farlo.

Due cose insieme, perché una sola non basta: chi propone dichiara il produttore
**anche quando mette in coda**, e la porta si rifiuta di controllare un testo
contaminato di cui non sa chi l'ha scritto (coda, mai «passa»: un controllo che
non si può fare non è un controllo superato).

## La frase è sorvegliata, il gesto anche

Una pagina avvelenata ha due uscite verso la persona: quello che Filo le **dice**
e quello che Filo **fa**. Sorvegliare solo la prima lascia il buco più grosso:
la pagina scriveva «apri questo indirizzo», il guardiano fermava la frase, e
intanto Filo aveva già aperto il sito della truffa, perché aprire un link è
livello 1. Dal turno in cui la classe di fiducia scende, le azioni portano il
marchio `_contaminato` (lo mette il main, mai l'LLM) e `NAVIGA` sale a livello 2:
l'indirizzo si vede prima di andarci. È lo stesso meccanismo del flag
anti-esfiltrazione, con una causa diversa.

## «Codice» non è una parola-spia

Il controllo deterministico è nato fermando ogni gettone corto vicino alla parola
«codice». In italiano commerciale quella parola qualifica quasi sempre
qualcos'altro: codice sconto, codice ordine, codice cliente, codice postale,
codice di tracciamento. Fermarli tutti vuol dire far sparire la posta normale di
chiunque, ed è il modo più rapido di farsi spegnere.

Quello che distingue una truffa non è che un codice esista: è che qualcuno
chieda di **comunicarlo, inoltrarlo, digitarlo**. Quindi o una parola
inequivocabile (otp, monouso, usa e getta), oppure la parola generica
più la richiesta di passarlo — e un qualificatore innocuo chiude comunque la
questione.

E «inequivocabile» va preso alla lettera: vuol dire che la parola nomina la
**natura** del codice, non la sua funzione. «Di accesso», «di ingresso», «di
sblocco», «di attivazione», «di conferma» nominano una funzione, e in italiano
quella funzione ce l'hanno soprattutto le cose fisiche: il portone, il cancello,
la cassetta delle chiavi, la SIM, la prenotazione. Tenerle fra le parole forti
faceva sparire la mail di chi affitta casa, cioè una delle mail per cui il
guardiano esiste. E la cosa che il codice apre non sta attaccata alla parola
«codice»: sta dopo la funzione («il codice di attivazione della SIM»). Attaccata
alla frase del codice, però — una parola concreta trovata a caso lì intorno non
basta, o «comunica il codice 483920 per sbloccare la consegna» diventerebbe la
mail di un corriere. Stessa storia per le carte: Luhn da solo non basta, un numero lungo su
dieci lo passa per caso, e serve anche il prefisso di un circuito vero.

Il qualificatore innocuo va riconosciuto **con l'articolo in mezzo**, che in
italiano è la forma normale: si scrive «il codice dell'ordine» molto più spesso
di «il codice ordine». La prima versione conosceva solo la forma secca, e la
risposta continuava a sparire a chi chiedeva il codice del suo ordine, della
promozione, del coupon. Un elenco di qualificatori che si allunga a mano è un
elenco che sbaglia: quello che lo tiene onesto è il **banco delle mail simulate**,
con la regola che **ogni frase innocua trovata fermata da un giro di verifica
entra nel banco**. Per due giri il banco ha detto zero falsi positivi mentre la
posta di un negozio spariva davvero, perché conteneva solo frasi che giravano
intorno alla regola.

## Dove vive

- `src/shared/textGuard.js` — logica pura: classi di fiducia, controlli statici,
  frasi di blocco, prompt e verdetto, regola di indipendenza del modello, e
  `CAMPI_SORVEGLIATI`, cioè cosa ogni azione lascia scritto per dopo.
- `src/shared/preferences.js` — quali preferenze sono testo libero
  (`testoLibero`), le sole che paghino un secondo modello.
- `tests/fixtures/bancoMail.mjs` — il banco su cui si misurano i falsi positivi;
  ogni frase innocua trovata fermata da un giro di verifica entra qui.
- `src/main/services/textGuardian.js` — la porta: ordine dei controlli, coda,
  registro dei blocchi.
- `src/main/services/handlers.js` — il cablaggio (modello, segreti) e il punto in
  cui la risposta della chat ci passa quando il turno è contaminato.
- `tests/unit/textGuardGate.test.mjs` — la sentinella che tiene la porta chiusa.

Vicino: [Un mittente nuovo si classifica su DUE assi](un-mittente-nuovo-si-classifica-su-due-assi.md), che è
la stessa idea applicata a chi scrive un feedback.
