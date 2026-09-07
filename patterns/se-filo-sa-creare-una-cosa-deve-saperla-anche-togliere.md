# Se Filo sa CREARE una cosa, deve saperla anche togliere e cambiare

[← Tutti i pattern](../PATTERNS.md)

Ogni azione che mette al mondo qualcosa (una sveglia, un timer, una regola, un
file) ne implica altre due: toglierla e modificarla. Senza, l'utente resta con
un elenco che sa solo allungarsi, e il modello davanti a "cancella la sveglia
delle 7" fa una delle due cose peggiori: dichiara di averlo fatto, oppure si
arrende e manda l'utente a cercarsi il bottone. Le tre azioni si progettano
insieme, non una alla volta.

- **L'utente non dice mai un id: dice "quella della palestra".** Serve una
  risoluzione del riferimento a gradi, che parte dall'etichetta esatta e scende
  fino all'orario ("quella delle 7"), ed è una funzione **pura** sulla lista, non
  logica sparsa nell'handler: è la parte che si sbaglia più facilmente e l'unica
  facile da testare (`resolveTimerRefs` in `src/shared/filoMemory.js`).
- **Quando non ha capito non deve indovinare.** Riferimento che non combacia →
  zero bersagli, l'azione non esegue e il modello chiede quale. Cancellare la
  cosa sbagliata è peggio che chiedere.
- **Il livello di conferma dipende da QUANTE cose sparirebbero, non da come è
  scritta la richiesta.** Togliere quella appena nominata è reversibile a costo
  zero (la si richiede) → livello 1. Toglierne più d'una con un colpo solo no:
  "leva tutte le sveglie, sono in ferie" porta via anche quella dell'antibiotico.
  Il conto lo fa il main risolvendo il riferimento **prima** del gate e
  iniettando `_targets` (le voci in chiaro) e `_targetIds` (su cui agire dopo
  l'OK, così non si rifà la ricerca su una lista nel frattempo cambiata), come già
  fanno `_illegible` e `_exfil`. Mai l'LLM.
- **Il popup elenca le cose vere, non la categoria.** "Togliere tutte le
  sveglie" non è un consenso informato; l'elenco con orari e giorni sì.
- **Ciò che si ripete non si consuma quando scatta.** Una scadenza ricorrente
  suona e nello stesso momento si sposta all'occorrenza successiva; il "Ferma"
  la zittisce, non la disdice (per quello c'è la ×). Attenzione a chi tiene un
  registro di "già avvisato" per id: va dimenticato quando la cosa smette di
  suonare, o la seconda occorrenza resta muta (`notified` in
  `src/main/services/alarmWatcher.js`).
- **Test:** `tests/unit/alarmRecurrence.test.mjs` (risoluzione del riferimento,
  prossima occorrenza, livelli), `tests/sveglia-gestione.spec.mjs` (il giro
  reale: creo, vedo in colonna destra, cancello, sposto, e "tutte" passa dal
  popup prima di toccare qualcosa).
