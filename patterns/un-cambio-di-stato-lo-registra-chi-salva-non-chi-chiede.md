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
- Un cursore trascinato è un evento solo: i passi della stessa pagina sulle
  stesse chiavi, entro pochi secondi, si fondono; tornare al valore di partenza
  non lascia niente.
- Anche annullare è un evento, scritto dallo stesso salvataggio. Annullare un
  annullo rifà il cambio.
- Lo zoom non passa dallo storage (lo tiene Chromium per sito): il suo
  salvataggio è dove il main lo viene a sapere, in `src/main/tabs.js`.

Vicini: [Ripristini e annullamenti: riportano indietro SOLO ciò che il pannello mostra](ripristini-e-annullamenti-riportano-indietro.md),
[Chi rilegge tutto e riscrive tutto mette le scritture in fila](chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md).
