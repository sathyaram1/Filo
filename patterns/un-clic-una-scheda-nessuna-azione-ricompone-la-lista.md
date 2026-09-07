# Un clic, una scheda: nessuna azione ricompone la lista sotto il cursore

[← Tutti i pattern](../PATTERNS.md)

Un pulsante che sta DENTRO una riga di una lista che si riordina da sé è una
trappola: al clic la riga esce dalla sezione, le altre risalgono e sotto il
puntatore FERMO arriva il pulsante della riga successiva. Il secondo clic cade
su un altro elemento. Non è il doppio clic accidentale — succede anche a quattro
decimi di secondo di distanza, e cliccare due volte viene naturale proprio
perché al primo clic non si vede succedere niente. Sulla pagina dei feedback due
volte «→ In coda» mettevano in coda il primo e marcavano il SECONDO come attacco
confermato: la decisione più pesante della pagina, presa per sbaglio, in
silenzio, su una segnalazione che nessuno aveva scelto (#509).

- **La regola è una sola e le copre tutte.** Non "disabilita quel bottone":
  *nessuna azione presa dentro una scheda ricompone la lista*. Chiudere una
  porta per volta (prima «In coda», poi «Risolto», poi «Ripristina», poi i
  pallini della priorità che in una sezione sono un criterio di ordinamento)
  costa un giro di verifica a testa e ne lascia sempre una aperta.
- **La scheda si aggiorna AL PROPRIO POSTO.** Si spegne mentre scrive (il clic
  così si vede, ed è il motivo per cui non se ne dà un secondo), poi resta dov'è
  con l'esito scritto al posto dei pulsanti: «✓ Spostata in «In coda»». Niente
  si muove da sotto il puntatore, e un secondo clic non trova niente da premere.
- **La lista si ricompone solo su richiesta esplicita** — cambio sezione,
  ricerca, filtro, Aggiorna, dati nuovi. È lì, e solo lì, che le schede già
  decise lasciano il posto.
- **I numeri, invece, dicono subito la verità.** Il conteggio della sezione
  scende all'istante: la scheda decisa è visibilmente marcata come non più
  appartenente, quindi il numero non contraddice ciò che si vede. Il totale in
  cima lo dice a parole («4 feedback · 1 decisa»).
- **Vale anche dentro la scheda.** La × che toglie un allegato ridisegnava la
  scheda e faceva scorrere le miniature: la seconda × cadeva su un allegato
  diverso. Stesso rimedio, stesso motivo.
- **L'aggiornamento ottimistico non è il colpevole; il ridisegno sì.** Scrivere
  subito nel modello va benissimo: quello che non si può fare è ricostruire
  l'elenco mentre la mano dell'utente è ancora lì. Serve anche nel ramo
  d'errore, o il ripristino rimescola la lista esattamente come il successo.
- **Dove:** `azioneScheda` / `spegniScheda` / `marcaDecisa` / `bindCardActions`
  e l'opzione `inPlace` di `patch()` in `src/pages/feedback/feedback.js`; la
  gemella `src/pages/manage/manage.js` non ha il problema perché l'azione vive
  in un pannello fermo e riguarda la scheda selezionata. Test:
  `tests/feedback-doppio-clic.spec.mjs` (clicca due volte alle STESSE
  coordinate con `page.mouse.click`, non sul locator: un locator seguirebbe il
  pulsante ovunque vada e il difetto non si vedrebbe).
