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

## Dove vive

- `src/shared/textGuard.js` — logica pura: classi di fiducia, controlli statici,
  frasi di blocco, prompt e verdetto, regola di indipendenza del modello.
- `src/main/services/textGuardian.js` — la porta: ordine dei controlli, coda,
  registro dei blocchi.
- `src/main/services/handlers.js` — il cablaggio (modello, segreti) e il punto in
  cui la risposta della chat ci passa quando il turno è contaminato.
- `tests/unit/textGuardGate.test.mjs` — la sentinella che tiene la porta chiusa.

Vicino: [Un mittente nuovo si classifica su DUE assi](un-mittente-nuovo-si-classifica-su-due-assi.md), che è
la stessa idea applicata a chi scrive un feedback.
