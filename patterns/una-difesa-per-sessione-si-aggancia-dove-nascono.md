# Una difesa per sessione si aggancia dove le sessioni nascono

[← Tutti i pattern](../PATTERNS.md)

Una protezione che vive **sulla sessione** (i permessi che i siti chiedono, il
segnale GPC, il blocco dei tracker, il proxy) non si installa dove si apre una
scheda: si installa **dove nasce la sessione**. Filo di sessioni ne crea molte —
quella di default, la partizione effimera di ogni finestra incognito, un jar per
sito in modalità privacy, una per ogni scheda «aperta da un altro paese», quella
isolata in cui il safebrowse fa detonare i link sospetti — e ognuna nasce in un
punto diverso del codice. Una difesa appesa ai punti di creazione è una difesa
che il prossimo punto di creazione non avrà.

Il caso che l'ha fatto nascere (#586). In tutto `src/main` non c'era nessuna
chiamata a `setPermissionRequestHandler`: senza gestore Electron **concede**, e
un sito qualunque accendeva fotocamera e microfono, leggeva posizione e appunti
e mandava notifiche senza che comparisse niente. Il tentativo ovvio — installare
il gestore nel punto in cui si crea la vista della scheda — copre le schede
normali e lascia scoperte tutte le altre; e la copre finché qualcuno non
aggiunge il prossimo posto da cui nasce una partizione, cosa che in quel file
non si vede.

Le due metà che servono, insieme:

- **Una porta sola** (`src/main/sessioni.js`): `sessioneDiPartizione()` e
  `sessionePredefinita()` sono gli unici punti che chiamano
  `session.fromPartition` / `session.defaultSession`, e installano la difesa
  prima di restituire la sessione. Serve a rendere leggibile chi crea cosa. Una
  sentinella negli unit test (`tests/unit/permessiSiti.test.mjs`) diventa rossa
  se una di quelle due chiamate ricompare altrove sotto `src/main`.
- **La rete di sicurezza** (`app.on('session-created')`, in `src/main/main.js`,
  registrato **prima** di `app.whenReady`): Electron crea sessioni anche da sé,
  quando una vista dichiara `webPreferences.partition`, senza che nessuno passi
  dalla porta. L'evento le prende tutte, comprese quelle che non esistevano
  quando il pattern è stato scritto.

L'installazione dev'essere **idempotente** (un marchio sulla sessione, es.
`ses._filoPermessi`): passando dalla porta e dall'evento, la stessa sessione
viene protetta due volte, e per Electron una seconda registrazione SOSTITUISCE
la prima — buttando via le richieste che quella teneva in attesa.

Il gestore vero vive in `src/main/services/permessiSito.js`; la regola pura di
cosa sia innocuo e come si ricorda una risposta sta in
`src/shared/permessiSiti.js`.
