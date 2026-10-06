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

## Il contenitore senza gestore di finestre (#465.1)

Sotto xvfb (le routine, la suite in GitHub) nessuno esegue `minimize()`: la richiesta
cade nel vuoto e la finestra resta com'era. La prova chiede `isMinimized()`; se il
sistema non l'ha ridotta, finge la sua risposta (`isMinimized` vero ed evento
`minimize`, poi il contrario) e prova lo stesso cammino del codice. Sostituire la
riduzione con un'altra uscita dalla vista lascerebbe la riduzione provata solo sul
Windows dell'owner. Lo fa `riduciAIcona`/`rialza` (`tests/helpers/riduzione.mjs`), e
nessuno spec chiama `minimize()` da solo: la home (#873) era nata due giorni dopo questa
regola nascondendo la finestra al posto di ridurla (#810.10). Sentinella:
`tests/unit/riduzioneNeiTest.test.mjs`.

## Il contenitore che disegna adagio (#592.11)

Sotto xvfb un fotogramma può arrivare un secondo dopo che il riquadro sta nel DOM:
`toBeVisible()` guarda il DOM, l'utente vede i fotogrammi. Il dialogo di conferma conta
dal primo fotogramma il mezzo secondo in cui un gesto vero non vale, e una prova che
aspettava 600 ms da `toBeVisible()` prima di premere Invio era rossa tre volte su
quattro. Prima di un gesto che deve valere si chiede al dialogo se è pronto
(`aspettaConfermaPronta`, `tests/helpers/confirm.mjs`), non si aspetta un tempo fisso.

## La macchina dell'owner (#563)

Due proprietà che le altre macchine non hanno, e ogni test che le dava per scontate
nasceva rosso solo per l'owner, per settimane (undici spec così):

- **Lo schermo sta al 125%**, quello delle routine al 100%: la stessa riga di testo cade
  su misure diverse. `FILO_TEST_SCALE=1.25` rimette quel fattore ovunque; un valore
  scritto male (`125`, o una parola) ferma subito invece di girare al 100%. Chi apre Filo
  per conto suo passa la manopola a mano (`args: [...argomentiScala, '.']`, da
  `tests/helpers/scala.mjs` o dalla fixture); una sentinella guarda ogni
  `electron.launch` sotto `tests/`.
- **L'utente si chiama «agenti AI»**, con lo spazio, e su Windows quel nome fa comparire
  anche la forma abbreviata `AGENTI~1` in `%TEMP%`, mentre l'app riporta sempre quella
  lunga. La cartella temporanea di un test si chiede a `cartellaTemporanea()`
  (`tests/helpers/percorsi.mjs`), che la fa canonica e con uno spazio nel nome per tutti:
  una costruita con `mkdtempSync` prova su un percorso che sulla macchina dell'owner non
  esiste, e una sentinella lo impedisce. La stessa funzione la toglie quando il processo
  finisce, verde o rosso (lasciate lì erano diventate 17 GB, #717); quelle di un processo
  ucciso le toglie il lanciatore della corsa dopo, passato un giorno. Quello che nessuna
  prova chiede (i file che il codice provato o Chromium scrivono nella temporanea per
  conto loro) finisce nella temporanea della corsa: la crea chi carica quel modulo (i due
  lanciatori, ma anche un file di prova lanciato da solo), i figli la ereditano e se ne va
  con lui.

Gli ultimi quattro rossi di quella macchina (#650) presumevano altro:

- **L'uscita di un comando ha la forma della sua shell.** `pwd` in PowerShell è una
  tabella («Path», «----», il percorso): si legge l'ultima riga piena, non tutto lo stdout.
- **Il fuoco non c'è.** In Electron Playwright non finge il fuoco come in un browser, e la
  finestra della suite, parcheggiata fuori schermo mentre l'owner lavora, spesso non ce
  l'ha: un `change` che nasce dal passaggio del fuoco da una casella all'altra non arriva.
  La prova manda lei il gesto che conferma.
- **Un segnale acceso da prima.** «Salvato» resta a schermo un secondo e mezzo: lo
  accende anche il salvataggio precedente, e aspettarlo non dice che è arrivato il
  secondo. Si aspetta il valore salvato.
- **Una cache che la prova non vede.** Il colore identità di una scheda si ricorda per
  host, e tre pagine dello stesso server di prova sono un host solo: appena aperta, una
  scheda porta il colore della sorella. Si aspetta che ognuna abbia il suo.

## Il cancello di pubblicazione (#931)

Gli unit test girano su Windows in un posto solo: il cancello prima di una versione,
su una macchina di GitHub dove il repo sta su `D:` e la cartella temporanea su `C:`.
Lì si rompono due cose che passano dove repo e temporanea stanno sullo stesso disco, e
il rosso ferma le versioni per tutti:

- **Due dischi.** Fra `D:\…` e `C:\…` `relative` risponde con un percorso assoluto,
  senza `..`. «Comincia con `..`» dice «dentro» per un file che sta fuori: si chiede a
  `fuoriDa(cartella, percorso)` (`tests/helpers/percorsi.mjs`). E un nome relativo
  rimesso insieme con `join(radice, nome)` incolla i due dischi
  (`D:\a\Filo\Filo\C:\Users\…`): si usa `resolve`.
- **Il node che gira.** Il processo che esegue la prova tiene aperto il proprio
  eseguibile, e su Windows nessun nome di quel file si cancella finché gira: un
  collegamento fisso a `process.execPath` (per fingere un comando) fa fallire la pulizia
  con EPERM. Si copia.

Sentinella delle due forme: `tests/unit/cartelleTemporanee.test.mjs`.

## Il collegamento simbolico (#742)

Su Windows un collegamento simbolico lo crea solo l'amministratore o chi ha la
modalità sviluppatore: per tutti gli altri è EPERM. Il cancello di GitHub gira da
amministratore e lì passa, quindi l'unico posto dove si vede è la macchina
dell'owner, dove ferma ogni chiusura locale. Una cartella si collega con
`collegaCartella` (una junction su Windows, che non chiede privilegi); un file non ha
junction, e `collegaFile` restituisce il motivo da passare a `t.skip` solo su Windows
e solo per EPERM: altrove il caso gira e un errore resta un errore. Gli script che la
chiusura esegue passano `'junction'` da sé. Sentinella nello stesso file.

## La macchina carica (#943)

Gli unit girano in parallelo, e spesso più verifiche girano insieme sulla stessa
macchina. «Due milioni di caratteri in meno di un secondo e mezzo» passava sempre da
solo e cadeva in quasi ogni corsa completa: a macchina carica la stessa valutazione
arriva a tre secondi senza che il codice sia cambiato, e un rosso degli unit rende
rosso `finish:check` (che con `--check` corre lo stesso gli spec, #874.1).

Un tempo non si confronta con millisecondi fissi. Si confronta con un lavoro di
riferimento misurato accanto, nello stesso processo: il carico rallenta tutti e due e il
rapporto resta (con ottanta processi occupati su quattro core la valutazione durava fino
a tre secondi e il rapporto restava fra otto e undici, come a macchina ferma). `costoInUnita`
(`tests/helpers/tempoRelativo.mjs`) misura l'operazione fra due unità di riferimento,
ripete solo se il giro sfora e tiene il giro migliore: una regressione vera sfora a ogni
giro, un carico passeggero no. Il tetto si sceglie una decina di volte sopra il costo
visto: quello che la prova deve fermare, un algoritmo quadratico o un'espressione che
torna indietro, costa centinaia di unità.

Un timer atteso (`await` di qualcosa che scade da sé) misura il timer e non il lavoro, e
resta in millisecondi. Sentinella: `tests/unit/tempiSottoCarico.test.mjs`.

## Il verso opposto (#937)

Una prova nata su Windows che asserisce un percorso `C:\…` cade su Linux se la
funzione chiede la forma al sistema che la esegue: `isAbsolute('C:\\x')` lì risponde
falso. Quando il risultato deve essere lo stesso su ogni macchina (la chiave di un test
rosso confrontata fra due cartelle), si riconoscono entrambe le forme:
`isAbsolute(p) || win32.isAbsolute(p)`. Un rosso solo su Linux non ferma né le fusioni
né le versioni, quindi nessun allarme lo segnala: resta finché una routine non lo trova.
Riferimento: `chiaveTest` in `scripts/lib/unit-sulla-fusione.mjs`.
