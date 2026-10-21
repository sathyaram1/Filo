# Le cose che aspettano una decisione dell'owner stanno in UN posto: i Ricevuti

[← Tutti i pattern](../PATTERNS.md)

Le fusioni bloccate in attesa del via libera vivevano su DUE superfici — la
prima schermata del browser e la pagina di gestione — con l'idea che "così
l'owner le trova senza cercarle". La scelta dell'owner (2026-08-26) è stata
l'opposta: la home di tutti i giorni non è il posto delle sue pratiche, e le
cose che aspettano una sua decisione hanno GIÀ una casa — la scheda Ricevuti
di Gestione, dove stanno i feedback da decidere.

- **Regola:** una cosa da decidere si mette dove l'owner decide le altre, in
  cima se è più urgente — non su una superficie in più "per visibilità". Due
  posti per la stessa decisione sono rumore per uno dei due, e prima o poi i
  due imparano cose diverse.
- **Una cosa sola, un posto solo (contratto 2026-09-13).** L'avviso in cima ai
  Ricevuti è stato tolto: una fusione ferma è la scheda della sua pratica, col
  quadrato rosso, portata in cima ai Ricevuti; la richiesta si apre dal
  quadrato. Prima la pratica e il ramo che ne era uscito stavano in due posti
  che non si citavano.
- **Una scelta di prodotto ha la sua domanda (#1358).** Un lavoro fermo su una
  scelta dell'owner (domande, decisioni, verifiche che non convergono, arenati)
  ha una domanda fra le Domande, e il posto dove si risponde è quello: la scheda
  del feedback sta In coda col segno «aspetta una domanda» che porta lì, e nel
  dettaglio il rimando prende il posto della casella di risposta. Nei Ricevuti
  restano i giudizi di sicurezza, che si decidono leggendo il testo originale.
  Dove: `domandaDellaPratica()` in `src/shared/manageReview.js`; prove
  `tests/unit/attesaDomanda.test.mjs`, `tests/manage-attesa-domanda.spec.mjs`.
- **Chi non ha una scheda non sparisce.** Una richiesta senza pratica (il
  lavoro locale di `npm run finish`, che il server apre senza numero) sta in
  cima ad Automazioni coi tasti di sempre: nasconderla sarebbe un ramo fermo
  per sempre senza dirlo.
- Il terminale di `npm run finish` nomina il posto con `DOVE_SI_APPROVA`
  (`scripts/lib/owner-merge.mjs`): la regola sta in
  [chi manda altrove](vai-a-guardare-in-quellaltro-posto-quel-posto.md) (#761).
- **Dove:** `fusioniFermeInCima()` / `fusioniSenzaFeedback()` in
  `src/shared/manageReview.js`, `#mgMergeApprovalsOrphans` in `panel-automation`
  (`manage.html`), modulo `src/shared/mergeApprovals.js`. Test:
  `tests/merge-approvals.spec.mjs`, `tests/manage-fusione-nei-ricevuti.spec.mjs`,
  `tests/unit/ownerMerge.test.mjs`.
