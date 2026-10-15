# Le cose che aspettano una decisione dell'owner stanno in UN posto: i Ricevuti

[← Tutti i pattern](../PATTERNS.md)

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
- **Una cosa sola, un posto solo (contratto 2026-09-13).** L'avviso in cima ai
  Ricevuti è stato tolto: una fusione ferma è la scheda della sua pratica, col
  quadrato rosso, portata in cima ai Ricevuti; la richiesta si apre dal
  quadrato. Prima la pratica e il ramo che ne era uscito stavano in due posti
  che non si citavano.
- **Chi non ha una scheda non sparisce.** Una richiesta senza pratica (il
  lavoro locale di `npm run finish`, che il server apre senza numero) sta in
  cima ad Automazioni coi tasti di sempre: nasconderla sarebbe un ramo fermo
  per sempre senza dirlo.
- **Chi manda l'owner lì nomina il posto di oggi.** Il terminale ha continuato
  a dire «l'avviso in cima ai Ricevuti» per due settimane dopo il 13/09, e
  l'owner l'ha cercato lì (#761). Il nome sta in `DOVE_SI_APPROVA`
  (`scripts/lib/owner-merge.mjs`), e la sentinella legge la pagina vera.
- **Dove:** `fusioniFermeInCima()` / `fusioniSenzaFeedback()` in
  `src/shared/manageReview.js`, `#mgMergeApprovalsOrphans` in `panel-automation`
  (`manage.html`), modulo `src/shared/mergeApprovals.js`. Test:
  `tests/merge-approvals.spec.mjs`, `tests/manage-fusione-nei-ricevuti.spec.mjs`,
  `tests/unit/ownerMerge.test.mjs`.
