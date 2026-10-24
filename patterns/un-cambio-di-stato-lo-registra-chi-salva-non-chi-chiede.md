# Un cambio di stato lo registra chi salva, non chi chiede

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Un cambio allo stato di Filo (impostazioni, aspetto, timer e
sveglie, regole del proxy, zoom) diventa un evento del filo nel punto in cui si
salva. Chi lo chiede dichiara solo da dove viene.

**Perché (#867).** «Tema scuro» in chat lasciava una conversazione con dentro
un comando e un «fatto»; lo stesso cambio dalle Preferenze non lasciava niente,
e «rimetti come prima» non poteva funzionare. Registrare nelle porte (l'azione
della chat, la pagina Preferenze, il menu della scheda) vuol dire due cose: le
porte divergono, e la prossima porta si dimentica di registrare.

**Come è fatto.**
- Lo shim dello storage fa vedere ogni scrittura prima che avvenga, anche quelle
  dell'incognito, col valore vecchio e quello nuovo (`onScrittura` in
  `src/main/shim/storage.js`). `src/main/services/registroCambi.js` confronta e
  scrive l'evento dalla stessa parte: disco per le finestre normali, RAM per
  l'incognito.
- Le chiavi che il registro confronta le dichiara a `onScrittura`, e da lì lo
  shim non le presta più vive: chi le legge e chi le scrive riceve una copia.
  Prima `addTimer` aggiungeva in cima alla lista letta e poi la salvava, quindi
  il registro vedeva prima uguale a dopo: dal secondo timer niente segno, e
  «annulla» toglieva il timer sbagliato (#1088). La regola sta sulla lettura e
  non su ogni funzione che scrive, così la prossima che muta la lista non la
  rompe. Prova: `tests/unit/cambiOggettoVivo.test.mjs`.
- La provenienza è un contesto (`con`): l'IPC lo mette per ogni pagina, la chat
  lo sovrascrive col suo, l'importazione col suo. Una strada che non lo dichiara
  finisce «da Filo», ma finisce nel registro.
- Quello che NON diventa un evento sta in un posto solo, ognuno col suo perché:
  `ESCLUSIONI` in `src/shared/cambi.js`.
- Ogni impostazione ha una frase in `VOCI`, col nome della sua pagina, mai la
  chiave interna. Una chiave nuova senza frase fa diventare rosso
  `tests/unit/cambi.test.mjs`.
- I segreti (chiavi, indirizzi dei proxy) entrano come «cambiata», senza
  valori, e quindi non si annullano.
- Ritocchi ripetuti sono un evento solo: i passi della stessa strada sulle
  stesse chiavi, senza altri cambi in mezzo e a meno di due minuti dall'ultimo,
  si fondono (un cursore trascinato, lo zoom 125 → 114 → 87 → 100 che il filo
  dice «125% → 100%», #1490); tornare al valore di partenza non lascia niente.
  L'evento tiene l'ora del primo passo e quella dell'ultimo (`agg`): la riga
  della home resta dov'è nata, e chi la mostra la riscrive o la toglie.
- Anche annullare è un evento, scritto dallo stesso salvataggio. Annullare un
  annullo rifà il cambio.
- Lo zoom non passa dallo storage (lo tiene Chromium per sito): il suo
  salvataggio è dove il main lo viene a sapere, in `src/main/tabs.js`.

Vicini: [Ripristini e annullamenti: riportano indietro SOLO ciò che il pannello mostra](ripristini-e-annullamenti-riportano-indietro.md),
[Chi rilegge tutto e riscrive tutto mette le scritture in fila](chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md).
