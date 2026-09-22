# Un'azione che PROPONE non è un'azione fallita, e il suo bottone deve fare la cosa

[← Tutti i pattern](../PATTERNS.md)

Alcune azioni di Filo non si eseguono da sole: il loro lavoro è **mettere un
bottone in chat** e aspettare l'utente (l'evento di calendario, il file da
aprire, il riordino delle schede). Nel main tornano `executed: false, kept:
true`, che è la stessa forma di un'azione che non è riuscita. Chi disegna la
chat legge quel `false` e racconta un fallimento, o peggio non disegna niente.

Il caso (#567.5). `EVENTO_CALENDARIO` tornava `{ executed: false, kept: true }`
e in chat il bottone era `disabled`: Filo proponeva un appuntamento che non si
poteva aggiungere da nessuna parte. Nel diario del lavoro la stessa azione si
raccontava come «Evento creato», cioè la promessa opposta.

Il seguito (#567, terzo giro). La regola era già scritta qui e nominava il
riordino delle schede, ma `PULISCI_TAB` e `CANCELLA_ARCHIVIO` non dichiaravano
niente: la chat le raccontava «Azione non riuscita» e quella riga prendeva il
posto del bottone, quindi dalla chat quelle due funzioni non si raggiungevano
più. Un pattern che elenca gli esempi non copre le porte che non nomina: a chiudere la
famiglia è la sentinella che legge il registro delle azioni.

- **La proposta si DICHIARA nell'esito**, non si indovina dal tipo: il main
  mette un campo (`output.proposta`) e la chat lo guarda prima di decidere che
  un'azione non eseguita sia fallita. Un elenco di tipi «che propongono» tenuto
  nella pagina diverge dal main al primo tipo nuovo.
- **Il bottone di una proposta fa la cosa.** Un `<button disabled>` è un vicolo
  cieco: se l'azione non è ancora azionabile, non si propone. Vale anche per la
  strada di riserva — se il sistema non risponde (nessun calendario installato),
  si dice all'utente dov'è finito il risultato invece di lasciare il bottone
  muto.
- **Il verbo del diario è quello della proposta**, non quello del fatto:
  «Evento proposto», «Ha proposto un evento». Il riassunto conta le proposte
  come proposte.
- **Anche il modello deve saperlo**: la risposta allo strumento dice «proposta
  all'utente come bottone in chat», così non annuncia una cosa che non è
  successa.
- **Quando l'utente la finisce, si scrive.** Il click che porta a termine
  l'azione aggiorna la riga del diario con l'esito (non ne aggiunge una seconda
  che contraddice la prima), fa cambiare verbo al riassunto e segna l'azione
  come confermata, che è il canale da cui il modello sa, al turno dopo, che è
  successo davvero. Vale per ogni strada: il bottone in chat, il pannello di
  conferma e il suggerimento della home, che deve dire com'è andata lì dove
  l'utente ha cliccato.

Dove: `executeFiloAction` in `src/main/services/handlers.js`, `activityRowFor`,
`rigaEBottone`, `segnaCompiuta` e `compiuta` in
`src/pages/dashboard/dashboard-attivita.js`. Test:
`tests/dashboard-chat-diario.spec.mjs` (casi G e I) e la sentinella
`tests/unit/diarioAzioniCoperte.test.mjs`.
