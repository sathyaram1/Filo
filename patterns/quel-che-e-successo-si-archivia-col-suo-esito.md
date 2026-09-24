# Quel che è successo si archivia col suo esito, non col suo nome

[← Tutti i pattern](../PATTERNS.md)

Un turno di chat finisce in archivio e settimane dopo l'utente lo riapre dalla
Cronologia per capire com'era andata. Se di un'azione resta il solo NOME, chi
riscrive il racconto può solo darla per riuscita: è l'unica cosa che sa.

Il caso (#567, quinto giro). L'archivio teneva `['CANCELLA_MEMORIA']`. Una
conferma che l'utente aveva letto e non dato si rileggeva «Ha cancellato la
memoria» — la cosa più distruttiva che Filo sa fare da chat, raccontata come
avvenuta. Un comando mai partito perché la modalità terminale era spenta:
«Ha eseguito un comando». Una cena che stava nel calendario da giorni: «Ha
proposto un evento». Lo stesso turno, mentre era a schermo, lo raccontava
giusto: il diario in diretta l'esito ce l'aveva, l'archivio no.

- **L'esito si archivia insieme al tipo.** `SN_ESITO.esitoAzione` è l'unica
  regola che lo decide (chiesto, proposto, compiuto, fallito, fatto), e la usano
  sia chi archivia sia chi disegna il diario in diretta. Due giudizi separati
  divergono, ed è esattamente il difetto: la stessa schermata che si contraddice
  a distanza di giorni.
- **Si archivia l'azione RESA, non quella chiamata.** L'oggetto che porta
  `_confirm`, `_output` e `_executed` è quello che l'utente ha visto; quello
  uscito dal modello non sa ancora niente.
- **Un esito che arriva dopo torna indietro.** La conferma nel popup e il
  bottone che l'utente clicca succedono a turno già archiviato: l'azione porta
  una targa (`_callId`) e il click manda l'esito nuovo all'archivio
  (`FILO_CHAT_AZIONE`). Senza, l'archivio resta fermo alla proposta.
- **Un esito che non si può vantare non si conta.** «Conferma chiesta» e i
  fallimenti hanno la loro riga nel diario, ma il riassunto in cima li salta:
  un'azione eseguita che non ha mosso niente (la home chiesta dalla home) vale
  come fallita.
- **Le chat archiviate prima continuano a leggersi.** Chi legge normalizza
  (`SN_ESITO.voci`): il solo nome vale «fatto», che è quello che si leggeva già.

Il gemello sullo schermo vivo: ogni azione tiene la sua riga per CHIAVE, non per
tipo. Due appuntamenti chiesti nella stessa frase sono due: aggiungendo il primo,
la riga riscritta era quella del secondo, che spariva dal racconto sostituito da
una copia del primo.

Dove: `src/shared/esitoAzione.js`, `toStoredMessage` in
`src/shared/chatArchive.js`, `setActionEsito` in
`src/main/services/filoChats.js`, `scriviEsito` e `summarizeActivity` in
`src/pages/dashboard/dashboard-attivita.js`, `reopenChat` in
`src/pages/dashboard/dashboard.js`. Test: `tests/unit/esitoAzione.test.mjs` e
`tests/dashboard-chat-diario.spec.mjs` (casi L, L2 e M).
