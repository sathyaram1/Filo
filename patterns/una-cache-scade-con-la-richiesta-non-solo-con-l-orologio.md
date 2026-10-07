# Una cache scade con la richiesta, non solo con l'orologio

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Quello che tieni in memoria porta con sé la richiesta che l'ha
prodotto, e vale solo se quella richiesta è identica a quella di adesso. Il
tempo dice se è vecchio; non dice se è la risposta a un'altra domanda.

## Il caso

I cambi delle valute si scaricano una volta al giorno e restano in memoria.
Quando «Spiega» ha smesso di chiedere dieci valute scelte a mano e ha cominciato
a chiederle tutte, chi aveva usato la spiegazione nelle ore prima
dell'aggiornamento si è portato dietro l'elenco corto: fresco secondo
l'orologio, quindi riusato senza discutere, e per un giorno intero «3000 rupie»
tornava a non avere un cambio.

È il caso generale di un aggiornamento: il codice nuovo trova in casa la
risposta di una domanda che non fa più. Vale per qualunque cosa si conservi a
scadenza — un elenco scaricato, un riassunto, un indice, una risposta a modello.

## La cura

Nel dato salvato c'è la richiesta che l'ha prodotto (l'indirizzo intero, o la
chiave che lo determina). Alla lettura si confronta: diversa, il dato non è
fresco per definizione, e si riscarica.

Il vantaggio non è chiudere questo buco, è che si chiude da solo la prossima
volta: chi cambia la richiesta non deve ricordarsi di alzare un numero di
versione, e chi non lo sapeva non lascia in giro utenti serviti col vecchio.

Il ripiego a rete giù segue la stessa logica: un dato preso con un'altra
richiesta non è un ripiego valido per questa: meglio un valore dichiarato
approssimativo, che almeno copre quello che serve adesso.

## Dove

- `src/main/services/fxRates.js`, sentinelle in
  `tests/unit/fxPromptLine.test.mjs`.
