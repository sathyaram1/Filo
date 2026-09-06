# Sezioni con lo stesso nome, una regola sola (e la regola è codice condiviso)

Due pagine che elencano la stessa cosa possono avere due liste diverse, ma non
due sezioni che si chiamano allo stesso modo e si riempiono in modo diverso. La
pagina dei feedback e la dashboard di gestione avevano entrambe una sezione
"Ricevuti": la seconda ci metteva ciò che aspetta una decisione dell'owner, la
prima ci faceva cadere tutto quello che la sua tassonomia (vecchia) non
riconosceva — archiviati, in lavorazione, attacchi confermati. Con la stessa
coda si leggeva "Ricevuti (3)" di là e "Ricevuti (9)" di qua (#509), e chi
guardava una pagina sola non aveva modo di accorgersene: il numero era fedele
alla SUA lista, il difetto stava a monte.

- **Il nome è un contratto.** Riusare il nome di una sezione che esiste
  altrove significa promettere la stessa regola. Se la regola dev'essere
  diversa, allora è un'altra cosa e va chiamata in un altro modo.
- **Una tassonomia sola, e sta in un modulo.** Le sezioni non si ricalcolano in
  ogni pagina: la funzione che decide dove va un elemento (`manageTabFor`),
  quella che costruisce la lista (`listForManageTab`) e quella che la conta
  (`manageTabCounts`) sono le stesse per tutte le superfici. Due liste calcolate
  dallo stesso codice non possono divergere; due liste calcolate da due copie
  divergono, e la scoperta arriva anni dopo.
- **Vale anche per ciò che le pagine SCRIVONO.** I pulsanti della pagina
  vecchia scrivevano ancora il vocabolario vecchio (`new`, `draft`, `verified`,
  `ignored`): ogni clic spingeva un feedback fuori dalla macchina a stati, e la
  gemella doveva poi ridurlo a forza. Cammini equivalenti fanno la STESSA cosa,
  non due cose che si somigliano.
- **Le sezioni in meno tornano come FILTRO, non come sezione in più.** La
  pagina dei feedback aveva una sezione "Agente" che la gemella non ha: toglierla
  avrebbe perso una capacità, tenerla avrebbe rimesso la divergenza. È diventata
  una casella "Solo automatici" nella barra degli strumenti, come il filtro ⭐
  degli Archiviati: il conteggio la segue, e a filtro spento i numeri delle due
  pagine coincidono per costruzione.
- **La granularità persa dalle sezioni torna sulla CARD.** Quattro sezioni al
  posto di nove non devono nascondere a che punto è un feedback: l'etichetta
  dello stato (col suo colore e il suo motivo) sta sulla scheda, letta dal
  vocabolario unico.
- **Dove:** `src/shared/feedbackTransitions.js` (le tabelle),
  `src/shared/feedbackStatus.js` (vocabolario e presentazione),
  `src/shared/manageReview.js` (`normalizeStatus`, `manageTabFor`,
  `listForManageTab`, `listArchiveTab`, `manageTabCounts`, `reasonText`);
  consumate da `src/pages/manage/manage.js` e `src/pages/feedback/feedback.js`.
  Test: `tests/feedback-sezioni-gemelle.spec.mjs` (apre le due pagine con la
  stessa coda e confronta le schede una a una).
