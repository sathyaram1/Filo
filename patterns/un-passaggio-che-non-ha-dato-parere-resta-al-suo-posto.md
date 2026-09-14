# Un passaggio che non ha dato parere resta al suo posto, grigio

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Quando una cosa attraversa una sequenza fissa di passaggi, la UI
li mostra tutti, sempre nello stesso ordine e sempre della stessa lunghezza: un
passaggio che non ha (ancora) dato un parere resta al suo posto, grigio, e
cliccato dice PERCHÉ è grigio. Non si salta, non si accorcia la fila, non si
nasconde la riga.

**Il caso che l'ha fatto nascere.** Una segnalazione di Filo attraversa cinque
controlli: il filtro d'ingresso, i giudici, quello che Claude segnala mentre
lavora, l'audit di sicurezza sul fix e il cancello di fusione. La dashboard ne
mostrava due. Gli altri tre esistevano solo quando andavano male — l'audit
lasciava traccia solo se bocciava, la segnalazione di Claude finiva in mezzo
alla conversazione, la fusione ferma viveva in un riquadro a parte sopra la
lista. Guardando una scheda non si poteva rispondere a «a che punto è, e cosa
ha detto chi l'ha guardata»: si poteva solo rispondere a «cosa è andato
storto», e solo per due passaggi su cinque.

Il rimedio è una fila di cinque forme — triangolo, cerchi, rombo, pentagono,
quadrato — che c'è sempre tutta. Un passaggio senza parere non sparisce: è un
contorno tratteggiato che occupa il suo posto. Così la fila si legge a colpo
d'occhio come una barra di avanzamento, e la posizione di una forma è un fatto
stabile — la terza è sempre la terza, e l'occhio impara dove guardare.

**Quello che non ha funzionato.** La riga dei giudici nasconde sé stessa quando
non ci sono verdetti (`hidden`), ed è proprio il caso in cui l'owner vorrebbe
sapere che i giudici non hanno votato. Una fila a lunghezza variabile — solo i
passaggi che hanno risposto — sembra più pulita e dice meno: con tre forme non
si capisce se i passaggi erano tre o se due sono saltati.

**Il grigio deve parlare.** Un contorno tratteggiato che al clic non fa niente
è indistinguibile da una UI rotta (vedi
[Un controllo che RIFIUTA non rifiuta mai in silenzio (e si può scavalcare)](un-controllo-che-rifiuta-non-rifiuta-mai-in-silenzio.md)).
Cliccato, ogni grigio apre la sua spiegazione: «l'audit si controlla sul lavoro
fatto, arriva quando c'è un fix da guardare», «il giudice non ha risposto —
tempo scaduto, credito esaurito o modello non configurato».

**Dove vive.** La tabella dei cinque livelli è logica PURA in
`src/shared/manageReview.js` (`livelli`, `livelloL1`…`livelloL5`): esito,
colore, titolo sotto il puntatore e contenuto del pannello sono dati, provati
da `tests/unit/manageReview.test.mjs` senza aprire Filo. Il markup sta in
`src/pages/manage/manage.js` (`renderLivelliRow`, `openSidebarLivello`) e le
forme in `src/pages/manage/manage.html`. Lo spec è
`tests/livelli-forme.spec.mjs`.

**Vicino.** [Le cose che aspettano una decisione dell'owner stanno in UN posto:
i Ricevuti](le-cose-che-aspettano-una-decisione-dellowner.md) — è lo stesso
principio applicato al quadrato: una fusione ferma non è una superficie a
parte, è la segnalazione da cui nasce.
