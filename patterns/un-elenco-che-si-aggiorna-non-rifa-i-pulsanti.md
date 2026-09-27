# Un elenco che si aggiorna da solo non rifà i pulsanti

[← Tutti i pattern](../PATTERNS.md)

Un elenco che si ridisegna a ogni evento (avanzamento di uno scaricamento,
stato di un lavoro) non deve sostituire i pulsanti che l'utente sta per
premere. Un clic è un tasto giù e un tasto su: se in mezzo il pulsante viene
tolto e rimpiazzato da uno identico, il browser non manda nessun clic, e a
schermo non succede niente.

## Il caso che l'ha fatto nascere

Feedback #588, quinto giro di verifica. La domanda «questo programma lo
scarico?» è una riga del pannello scaricamenti. Un installatore vero pesa
decine di megabyte, quindi mentre l'utente legge sta ancora scendendo, e il
pannello si ridisegnava da zero a ogni avanzamento, circa due volte al
secondo. «Scarica» andava a vuoto circa una volta su due, e sempre con un
clic appena lento. Lo stesso valeva per «Pausa» e «Annulla», da prima.

## La regola

Le righe si **riconciliano**, non si ricostruiscono: ogni riga porta un
`data-id`, e se la riga nuova offre gli stessi pulsanti (stessa etichetta,
stesso stato attivo o spento) resta nel documento quella vecchia, e prende
solo i testi e la barra della nuova. Quando i pulsanti cambiano davvero (lo
stato è un altro, un sì si arma) la riga si sostituisce, ed è giusto così:
quello che c'era sotto il cursore non esiste più.

Due dettagli fanno la differenza:

- **Un nodo che resta non si stacca mai**, nemmeno per un attimo: prima si
  tolgono i figli che se ne vanno, poi i nuovi si infilano davanti a quelli
  rimasti. Staccare e riattaccare lo stesso pulsante perde il clic come
  sostituirlo.
- La chiave guarda **ciò che un clic può colpire**, non i dati: i byte
  ricevuti cambiano a ogni evento e non toccano i pulsanti.

## Dove vive

- `src/shared/righeVive.js` — `SN_RIGHE_VIVE.riconcilia(lista, righeNuove, selettoreAzioni)`.
- Lo usano il pannello scaricamenti della barra (`src/renderer/shell.js`) e la pagina Scaricamenti.
- `tests/downloads-eseguibili.spec.mjs` — «Scarica» premuto col tasto giù più a lungo di un avanzamento, su tutte e due le superfici.

Vicini: [Una conferma non è un avviso sopra un fatto già compiuto](una-conferma-non-e-un-avviso-sopra-un-fatto-gia-compiuto.md).
