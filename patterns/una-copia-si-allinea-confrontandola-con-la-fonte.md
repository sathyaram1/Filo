# Una copia si allinea confrontandola con la fonte, non con un segno messo al guasto

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Quando una copia di lavoro (una cartella, una cache) va tenuta
allineata a una fonte (il server, il feedback), cosa mandare si decide
confrontando la copia con quello che la fonte ha davvero: un'impronta o un'ora
che la fonte stessa ha dato, salvata accanto alla copia. Mai da un segno
«questo non è partito» scritto quando qualcosa va storto.

## Il caso

Le schede dei feedback (#1785) si salvano nel feedback; la cartella sul PC è la
copia di lavoro. Il comando segnava «non salvata» una scheda quando il server
rispondeva di no, e al giro dopo mandava solo quelle col segno. Tre verifiche
di fila hanno trovato una porta nuova della stessa causa: le schede scritte
prima che il feedback le tenesse (il censimento, con le riletture di Opus) non
avevano segni, e una sessione morta fra la scrittura e la risposta del server
non arrivava a metterlo. Restavano nella cartella, la nuvola le riscriveva a
pagamento e al giro dopo la sua copia cancellava le riletture.

Un segno messo al momento del guasto copre solo i guasti che il codice vede
arrivare: non il processo ucciso, non i dati nati prima del codice, non la
copia portata da un'altra macchina.

## La cura

Chi legge la fonte (qui `elenca`) scrive accanto alla copia cosa la fonte ha
(`nelFeedback`, l'ora della scheda salvata); ogni salvataggio riuscito lo
aggiorna subito, sul disco. Da mandare è ciò che è buono, fresco e diverso da
quello: un confronto che non dipende da come è finito il giro prima. I segni
restano solo per le decisioni della fonte che rimandare non cambia (un no
definitivo), e chi riscrive la copia non se li porta dietro.

Il confronto vale quanto la lettura su cui poggia: chi manda (anche `scrivi` e
`rileggi`) rilegge la fonte subito prima. Un indice di ore prima, o scritto
prima che portasse l'ora, fa sovrascrivere una scheda più nuova (#1785.2 giro 2).

Prove: `tests/unit/feedbackCloud.test.mjs`.
