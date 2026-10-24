# In chat: i passi intermedi sono TRACCE, i risultati sono bottoni

[← Tutti i pattern](../PATTERNS.md)

Nella conversazione di Filo ha la forma di bottone (pill `.dash-action-btn`)
**solo ciò su cui l'utente può agire**: il link aperto, la conferma, il pannello.
I passi che Filo compie per arrivarci — la ricerca sul web, la lettura di un
file, la consultazione del manifesto capacità — sono **tracce scritte**
(`.dash-action-step`: riga in corsivo, tenue, senza bordo né pill).

- **Perché:** i chip inerti erano `<button disabled>` con la stessa pill dei
  bottoni veri; una singola azione ("mettimi questa canzone") lasciava così due
  pill affiancate e l'utente contava "due bottoni" per una cosa sola (#376).
  Restano visibili — la trasparenza sui passi (#368) è un valore — ma non
  competono col risultato.
- **Regola pratica:** se cliccarlo non fa niente, non deve *sembrare* cliccabile.
- **Dove:** `stepTrace()` in `src/pages/dashboard/dashboard-attivita.js`, stile in
  `dashboard.css`. Test `tests/filo-open-background-tab.spec.mjs`.

## Un'azione che PROPONE non è un'azione fallita, e il suo bottone fa la cosa

Alcune azioni non si eseguono da sole: il loro lavoro è mettere un bottone in chat e aspettare l'utente
(l'evento di calendario, #567.5). Nel main tornano `executed: false, kept: true`, la stessa forma di un'azione
non riuscita: l'evento aveva un `<button disabled>` e il diario lo diceva «Evento creato».

- **La proposta si DICHIARA nell'esito** (`output.proposta`), non si indovina dal tipo: un elenco di tipi «che
  propongono» tenuto nella pagina diverge dal main al primo tipo nuovo.
- **Il bottone di una proposta fa la cosa**, mai `disabled`; se il sistema non risponde (nessun calendario
  installato) si dice dov'è finito il risultato.
- **Il verbo del diario è quello della proposta** («Evento proposto», «Ha proposto un evento»), e la risposta allo
  strumento dice al modello che è una proposta, così non la annuncia fatta.
- **Quando l'utente la finisce, si scrive**: il click aggiorna la riga che c'era (non ne aggiunge una che la
  contraddice), cambia il verbo del riassunto e segna l'azione confermata, che è il canale da cui il modello e
  l'archivio della chat sanno che è successa.

Dove: `eseguiAzioneFilo` (`src/main/services/handlers.js`); `rigaAttivita`, `rigaEBottone`, `segnaCompiuta`,
`contaAzione` (`dashboard-attivita.js`). Sentinella: `tests/unit/diarioAzioniCoperte.test.mjs`; casi G e I di
`tests/dashboard-chat-diario.spec.mjs`.
