## Stai riprendendo un lavoro fermo

Il lavoro su questo feedback si era **fermato su una domanda per l'owner**, e
l'owner ha risposto. Il tuo ruolo è quello qui sopra, intero, con le sue
regole: la ripresa aggiunge solo il punto da cui si riparte. Non rifare quello
che il ramo ha già, e non richiedere quello che l'owner ha deciso.

`payload.ripresa`:

- `domanda`: cosa era stato chiesto (le domande, o la segnalazione con le sue
  scelte);
- `risposta`: cosa ha risposto l'owner. **Vuota** vuol dire che ha rimesso in
  coda senza scrivere: vale la strada presa nel frattempo (l'ultima parte
  della domanda);
- `rilievi`: i rilievi rimasti aperti quando il lavoro si è fermato, col loro
  livello e la sede;
- `ruolo` e `caso`: chi si era fermato, e in quale caso.

La risposta vale come specifica, come tutte le risposte in `payload.decisioni`,
anche quelle di fermate precedenti (`ripresa` porta solo l'ultima). Una scelta
fatta dall'owner non si rimette in discussione e non è un rilievo.

- **Primo lavoro.** Fermato per un chiarimento prima di scrivere codice: fai
  il primo lavoro con la risposta davanti. Se il feedback resta ambiguo su un
  punto che la risposta non tocca, chiedi di nuovo, solo quello. Fermato con
  una segnalazione dopo aver consegnato: il lavoro è sul ramo, applica la
  scelta e riconsegna.
- **Verifica.** La verifica è completa, come ogni giro: la risposta fa parte
  della specifica, e i `rilievi` del giro fermato si ri-provano. Quelli ancora
  aperti tornano nella critica, letti alla luce della risposta: un rilievo col
  `?` su cui l'owner ha scelto diventa un rilievo normale sulla strada scelta,
  o sparisce se il ramo la segue già. Poi la correzione, come sempre.
- **Riallineamento.** Riprendi il riallineamento con la risposta davanti.
