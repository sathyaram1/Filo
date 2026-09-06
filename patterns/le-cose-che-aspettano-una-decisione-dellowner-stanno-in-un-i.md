# Le cose che aspettano una decisione dell'owner stanno in UN posto: i Ricevuti

Le fusioni bloccate in attesa del via libera vivevano su DUE superfici — la
prima schermata del browser e la pagina di gestione — con l'idea che "così
l'owner le trova senza cercarle". La scelta dell'owner (2026-08-26) è stata
l'opposta: la home di tutti i giorni non è il posto delle sue pratiche, e le
cose che aspettano una sua decisione hanno GIÀ una casa — la scheda Ricevuti
della dashboard di gestione, dove stanno i feedback da decidere.

- **Regola:** una cosa da decidere si mette dove l'owner decide le altre, in
  cima se è più urgente — non su una superficie in più "per visibilità". Due
  posti per la stessa decisione sono rumore per uno dei due, e prima o poi i
  due imparano cose diverse.
- Il pannello dei Ricevuti è condiviso dalle quattro schede-lista: la
  visibilità dell'avviso dipende da "c'è qualcosa" E "sei sulla scheda giusta",
  e il cambio scheda riapplica la regola senza rileggere dal server.
- L'avviso nomina la segnalazione da cui nasce il lavoro (`automazione ·
  feedback #N`) e — vivendo già dentro la dashboard dei feedback — quel numero
  è un bottone che la apre: "guarda cosa era stato chiesto" è il gesto che
  serve prima di approvare.
- **Dove:** `#mgMergeApprovals` dentro `panel-list` in
  `src/pages/manage/manage.html`, `applyMergeApprovalsVisibility()` /
  `openFeedbackByNum()` in `manage.js`, modulo `src/shared/mergeApprovals.js`.
  Test: `tests/merge-approvals.spec.mjs`.
