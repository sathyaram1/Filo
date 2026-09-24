# Un test chiede al sistema, non presume quello su cui è nato

[← Tutti i pattern](../PATTERNS.md)

Le prove di Filo si scrivono in due posti: sul Linux delle routine e sul Windows
dell'owner. Il Mac non ce l'ha nessuno. Un'asserzione che fissa il valore visto sul
primo sistema diventa rossa sul secondo, e quel rosso lo vede una macchina sola, di
solito settimane dopo.

## Il caso (#714)

Tre unit test rossi solo su Windows.

- `documentRead`: per provare che un nome ambiguo non si indovina, la prova creava
  «Relazione — città.txt» e «RELAZIONE - CITTA.txt» e chiedeva «Relazione - citta.txt».
  Su Windows e sul Mac il disco non distingue le maiuscole, quindi il secondo file È
  quello chiesto. Il sistema lo apre, la lettura riesce, e il codice fa bene. La prova
  presumeva un disco che le distingue.
- `terminaleCodifica`: asseriva `encodingPrelude('sh') === ''`. Su Windows «sh» gira
  come PowerShell e il preludio giusto è quello di PowerShell. La prova fissava il
  valore di Linux.
- Il terzo era un difetto vero. In PowerShell un cmdlet fallito lascia
  `$LASTEXITCODE` a 0, e l'assistente leggeva «riuscito» un comando fallito. Su Linux
  la shell è sh e il difetto non si vede: l'unica macchina che fa girare quel ramo è
  quella dell'owner.

## La regola

- Quando l'esito dipende da una proprietà del sistema, la prova la chiede al sistema e
  asserisce per ogni risposta. Il disco distingue le maiuscole? Si scrive `SONDA.tmp` e
  si guarda se esiste `sonda.tmp`. `process.platform` non è la domanda giusta: la
  proprietà è del disco, e un disco che fa il contrario si monta ovunque.
- Quando il codice traduce una richiesta in quello che gira davvero (la shell chiesta
  nella shell vera), si asserisce la relazione e non il valore:
  `encodingPrelude(s) === PRELUDI_CODIFICA[resolveShell(s)]`. Vale su ogni sistema e
  diventa rossa se qualcuno lega il risultato alla richiesta.
- Se il caso non c'entra con la proprietà, si scelgono dati che non ne dipendono: due
  nomi che differiscono per l'accento, non per le maiuscole, danno la stessa ambiguità
  dappertutto.
- Un comando diverso per piattaforma va bene se i due lati fanno la stessa prova
  (CLAUDE.md, «Un ramo di piattaforma si scrive intero»).

Riferimenti: `tests/unit/documentRead.test.mjs` (nomi ambigui, maiuscole),
`tests/unit/terminaleCodifica.test.mjs` (preludio per shell, esito dei comandi).
