# Una lista chiede i campi che mostra, il dettaglio il documento intero

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Chi ELENCA chiede una proiezione — i soli campi che la riga
mostra, o su cui la pagina ordina e filtra — e chi APRE un elemento chiede il
documento intero. La proiezione è dichiarata in un posto solo e il suo
complemento accanto, perché un campo nuovo deve finire in uno dei due elenchi e
mai in nessuno.

**Il caso.** Una sola apertura della dashboard di gestione scaricava
cinquecento feedback INTERI: dieci MB, ripetibili ogni minuto. Quasi tutto il
peso stava in cinque campi che nessuna riga mostra mai — il report della
lavorazione (fino a 60 KB), i livelli del controllo di sicurezza (fino a 40
KB), il commento di revisione, gli allegati. Le righe disegnate con quei dati
erano titolo, numero, stato e pallini della priorità: poche centinaia di byte.
Il parametro per chiedere meno esisteva già e non lo usava nessuno, perché non
c'era un posto dove fosse scritto QUALI campi servono a una riga.

**Perché l'elenco dei campi sta nel codice e non nella testa di chi scrive.**
Una proiezione è un elenco chiuso: quello che non nomini non arriva, e non
arriva in silenzio — nessun errore, solo un campo `undefined` che si legge come
«questo feedback non ce l'ha». Il campo dimenticato si scopre settimane dopo,
da una riga che mostra il titolo sbagliato o da un conteggio che non torna. La
difesa è una sola dichiarazione con la sua sentinella: i due elenchi sommati
devono coprire ogni campo che le regole del database ammettono
(`tests/unit/feedbackCampiLista.test.mjs`).

**La porta gemella, che è quella pericolosa.** Una riga d'elenco non è una base
per una SCRITTURA. Dove si APPENDE a un campo lungo — una risposta in coda a
una conversazione — leggere la riga proiettata vuol dire leggere una stringa
vuota, e riscriverla cancella tutto quello che c'era. Non è un difetto che si
vede: la scrittura riesce. Prima di appendere si prende il documento intero e
si aspetta, anche quando il caricamento del dettaglio è già partito da solo:
«quasi sempre è già arrivato» non è una garanzia (`feedbackCompleto` in
`src/pages/manage/manage.js`).

**E se il documento intero non arriva.** Prendere il documento prima di
scrivere protegge solo finché quella lettura riesce. Se fallisce, va in
timeout, o torna vuota perché il documento non c'è più, chi chiede «dammelo
intero» si ritrova in mano la riga proiettata di prima, che è indistinguibile
da un feedback senza note: la scrittura riparte e cancella il report, come se
non ci fosse stata nessuna difesa. Quindi la funzione che completa NON torna
mai una riga ancora proiettata: torna niente, e chi ha chiesto lo dice
all'utente invece di procedere o di tacere. La lettura mancata si SEGNA sulla
riga, per tre motivi: il pannello può dire «non è arrivato» invece di restare
su «Caricamento…» a tempo indeterminato, può offrire un «Riprova», e riaprire
la stessa riga non ricompra all'infinito una lettura che continua a non
arrivare. E la lettura del dettaglio ha sempre un tempo massimo: senza, una
richiesta appesa blocca dietro di sé tutti i tasti che scrivono.

**Il conto dell'attesa: un ridisegno in più.** Quando il documento arriva il
pannello si ridisegna, e ridisegnare RIEMPIE le sue caselle col feedback: su
una bozza in corso vuol dire cancellarla. Chi preme subito dopo legge la
casella ormai vuota, e la segnalazione si riapre senza il motivo mentre tutto
sembra riuscito. Due regole, e valgono per qualunque ridisegno automatico:
aspettare che la bozza non ci sia più prima di ridisegnare (e ridisegnare
appena sparisce, o il pannello resta a dire «Caricamento…»), e leggere quello
che l'utente ha scritto PRIMA di ogni `await`, non dopo.

**Dove una scheda È il dettaglio.** Se l'elenco mostra già tutto — la pagina
dei feedback disegna la conversazione dentro ogni scheda — la proiezione da
sola svuoterebbe la pagina. Lì si completa la SEZIONE che si sta guardando, una
volta sola, dicendolo mentre si fa. Costa una lettura per scheda vista, e la fa
solo chi quella sezione la apre davvero.

**Nel codice.** `CAMPI_LISTA` e `CAMPI_DETTAGLIO` in `src/shared/feedback.js`;
il marchio `_proiezione` che distingue «non ce l'ha» da «non l'ho chiesto»
(`soloLista`); `completaDettaglio` in `src/pages/manage/manage.js` e
`completaDettagli` in `src/pages/feedback/feedback.js`.

Vicino: [Una pagina dei più recenti non è tutto](una-pagina-dei-piu-recenti-non-e-tutto.md).
