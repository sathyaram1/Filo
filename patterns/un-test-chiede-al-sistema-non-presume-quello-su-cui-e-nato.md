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

## Lo stesso percorso vuol dire due cose (#1610)

Il percorso che una prova scrive ha il significato del sistema su cui gira, e il
codice lo legge con il `path` e il `process.platform` di quel sistema. Il caso:
`/net/nas/condivisa` è un altro computer sul Mac e su Linux, ma su Windows è la
cartella `\net\nas\condivisa` dell'unità corrente. La prova aspettava un rifiuto
che su Windows sarebbe stato un errore. Su Windows lo stesso rifiuto si prova con
`\\nas\condivisa`. Il resto della prova resta uguale sui due lati.

Lì vicino: su Windows un percorso che parte da `\` prende l'unità della cartella
corrente, e il runner di GitHub lavora su `D:` mentre la casa finta sta su `C:`.
Fra due unità `path.win32.relative` non dà un `..`: dà il percorso di arrivo, che è
assoluto. «Dentro la casa» quindi vuol dire relativo, senza `..` in testa e non
assoluto. Una prova che dipende dall'unità prova anche il caso `D:` in modo
esplicito, così lo vede pure il Linux delle routine.

Riferimento: `tests/unit/percorsiDiRete.test.mjs`.

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

## La sessione che li lancia (#949.1, #1144.1)

Nel contenitore delle routine la shell porta l'identità della sessione (`FILO_ROUTINE`, e
a volte il suo transcript), e uno script del canale lanciato da un test la crede sua:
misura il consumo vero, lo mette nel corpo che la prova confronta e scrive il suo stato
nella cartella di prova. Il lanciatore toglie quell'identità a tutti i test
(`ambientePerITest`, `scripts/run-unit-tests.mjs`); un file lanciato da solo con
`node --test` non passa da lui, quindi una prova che confronta il corpo spedito da uno
di quegli script, o lo stato della sua cartella, passa al figlio
`ambientePerITest(process.env)` e non `process.env`. Sentinelle:
`tests/unit/unitRunner.test.mjs` e `tests/unit/routineChannelRilascio.test.mjs`.

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

**Il codice che fa una cosa diversa per sistema** (#1135). Su Windows la versione
nuova si installa all'apertura dopo, altrove alla chiusura (#1039): la prova scritta
su Linux asseriva «alla chiusura», passava ovunque tranne al cancello, e otto rossi
hanno fermato la pubblicazione. Quando l'esito dipende dalla piattaforma, la prova la
sceglie lei e gira per ognuna (`perOgniSistema` in
`tests/unit/aggiornamentiAutomatici.test.mjs`), così Linux corre anche il caso
Windows: `conPiattaforma` cambia `process.platform` per la durata del caso e lo
rimette com'era. Regge solo perché il codice la chiede al momento, da un punto solo
(`dip.piattaforma()`), mai fissata in una costante al caricamento del modulo: lì la
prova non arriverebbe più, e il caso Windows girerebbe da Linux. Uno spec in Electron
fa lo stesso: la piattaforma la sceglie `perProva` nel main, e lo spec gira per ognuna
(`tests/aggiornamenti-da-soli.spec.mjs`). Un `process.platform` letto dallo spec
dà un ramo che la suite in GitHub non corre mai (#1171). Un caso nuovo che non si
sceglie la piattaforma è rosso anche su Linux: le prove dell'aggiornatore si rifanno
con Node che si crede Windows e Mac (`tests/unit/aggiornamentiDaOgniSistema.test.mjs`,
#1146). Da Windows non si finge: un Node di Windows che si crede Linux sceglie
un'altra shell e il rosso sarebbe della finzione; un caso che presume Windows è già
rosso su Linux da sé.

**Il commit provato è vecchio** (#1185). Il cancello prova l'ultimo commit di main con
la suite verde, che può stare giorni dietro la punta: gli stessi otto rossi, corretti
su main da un giorno, hanno riaperto il loro feedback appena il primo si era chiuso.
Prima di aprirlo il cancello rifà ogni file rosso sulla punta di main
(`scripts/rossi-sulla-punta.mjs`): verdi tutti, nessun feedback e la corsa resta rossa;
altrimenti il feedback dice il commit provato e quali file sono già verdi. Nel dubbio
(main irraggiungibile, rosso senza file, controllo rotto) si apre come prima.
Sentinella: `tests/unit/rossiSullaPunta.test.mjs`.

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

### Nessun unit dipende dalla velocità della macchina (#1063)

Dieci chiusure locali di fila rosse, ogni volta per un unit diverso, tutti verdi da soli.
Le forme che cadevano, e cosa le ha sostituite:

- **Un tempo atteso dal codice provato** (tempo limite, rate limit, attesa del menu, vita
  massima di una finestra): orologio finto (`mock.timers` con `setTimeout` e `Date`), e il
  tempo passa a tick con `scorri`/`finoA` (`tests/helpers/orologio.mjs`). Così la prova dice
  anche il quando esatto: «non prima di 199 ms, sì a 200».
- **Un processo o un file vero che deve arrivare** (un battito, la porta di un server finto,
  un segno scritto da un figlio): si aspetta il fatto con `aspettaChe`
  (`tests/helpers/attese.mjs`), mai «entro N secondi». Il tempo massimo di un processo vero
  è una guardia contro l'appeso, `TETTO_ATTESA_MS`: un numero scritto a mano lo ferma una
  sentinella, nelle opzioni di `spawnSync` ed esecuzioni simili, in un `setTimeout` da un
  secondo in su, in un `timeoutMs`/`attesaMs` dato al codice provato. Il server finto di
  `config/routines` si lancia da `tests/helpers/server-finto.mjs`, mai da una copia. Vale anche per il tempo
  massimo che sta nel codice provato: la funzione che chiede qualcosa a un programma di
  sistema prende l'attesa da chi la chiama, e la prova le passa `TETTO_ATTESA_MS` (il
  controllo del comando che esiste: dieci secondi bastano all'uso, non a una macchina carica).
- **«Non cresce con i dati»** (un messaggio con 50.000 eventi nel filo, una scheda chiusa con
  6.000 in archivio): prima si contano le operazioni sul disco (nessuna rilettura, nessuna
  riscrittura, una riga in coda; `tests/helpers/spiaDisco.mjs`), poi il lavoro in memoria si
  misura a turno contro lo stesso lavoro su dati quasi vuoti, campione per campione, col
  minimo di ciascuno (`rapportoFraCosti`). Quando i dati quasi vuoti non sono il paragone giusto
  (un flush di 4 MB copia comunque 4 MB), si paragona lo stesso lavoro fatto per intero; e se il
  campione ha un pezzo da non contare (la scrittura su disco), `ora` è un orologio che corre solo
  nella finestra misurata (#1228, `tests/unit/storageScritturePerChiave.test.mjs`). Un `await` fra
  partenza e arrivo nasconde la soglia fissa alla sentinella: lì la regola la tiene chi scrive.
  Una finestra di tempo fra due figli che devono sovrapporsi si toglie facendoli girare in fila.
- **La pulizia**: una cartella si toglie con `togliCartella`, che ritenta e non fa rosso il
  test quando Windows la tiene ancora; `rmSync` ricorsivo nudo nei test lo ferma una
  sentinella (`tests/unit/cartelleTemporanee.test.mjs`). Gli script che i test lanciano
  ritentano anche loro (`maxRetries`).
- **Il tetto del lanciatore** (20 minuti in cui un file non va avanti, non la sua durata: un
  file sano sotto carico è lento ma avanza): il file fermo si chiude da solo, rosso col suo
  nome, e gli altri girano (#1231). Node mostra in diretta solo i passi del primo file in
  corso: se in un tetto non finisce nessun file, con lui si chiudono i file partiti da più
  di un tetto (in fila costerebbero un tetto ciascuno), e se dopo non finisce più niente si
  chiude la corsa (il disco pieno). L'avviso di chiusura nomina sempre chi la teneva ferma:
  i file in corso o, se non ce n'è più, quelli già chiusi che non l'hanno sbloccata (#1573:
  chiuso il file, una corsa che non finiva lo stesso diceva «non è andato avanti niente»).
  Una prova sola che ci si avvicina si divide, e una
  scena che si ricostruisce identica a ogni prova si costruisce una volta e si copia
  (`tests/helpers/scenaHook.mjs`). Nessun tempo d'orologio sopra di lui: anche gli unit sul
  risultato della fusione, che la chiusura rifà quando main si è mosso, passano dal
  lanciatore, e la riprova dei rossi pure (`--solo`). Una prova che fa girare altri file di
  prova con un ambiente suo (le prove da sole in sessione, #1214) usa la stessa guardia,
  `lanciaSorvegliato`, col tetto delle attese: cinque minuti sulla durata della corsa
  cadevano con due corse insieme su un portatile lento.
- **Un file non si appende sul primo errore.** Un intervallo vero che tiene vivo il processo
  per tutto il file tiene vivo anche una promessa rimasta a metà: si accende solo finché
  l'attesa vera è in viaggio (`tests/helpers/letturaIsolata.mjs`). Un pacchetto che il
  codice provato usa si cerca al caricamento del modulo, così se manca il file cade subito
  col nome del pacchetto.

### Una prova che guarda un momento lo tiene aperto lei (#1321)

Con quattro esecuzioni in parallelo le prove della chat della home cadevano a caso. La
risposta in streaming usciva in pezzi a 500 ms l'uno dall'altro e la prova doveva vedere la
testa senza la coda in quel mezzo secondo; il ragionamento in corso durava 3,6 s e la prova
doveva cliccarci due volte e fare una foto; la riga «Avvio un timer…» restava 2,5 s.

- Il modello finto si ferma dove la prova deve guardare (`await` di una promessa che la
  prova scioglie con `app.evaluate(() => globalThis.__…())`). Senza il comportamento
  provato la prova resta rossa: lo stato atteso non arriva mai.
- La fine del turno si aspetta su un segno della pagina (il tasto d'invio che torna, il
  bottone dell'azione), con un tetto che copre le attese che l'app fa apposta: aperta una
  pagina, il turno aspetta fino a 5 s che arrivi (`esitoApertura`), e la prova ne dava 3.
- Un'azione che apre un sito apre il server di prova (`testServer.html(…, { pubblico: true })`):
  con example.com il turno aspettava la rete, che nei contenitori non c'è.
- Un'attesa che prova un'assenza («nessuna scritta, nemmeno dopo un secondo») resta: guarda
  che non succeda niente, non scommette che qualcosa arrivi prima di un orologio.

Prove: `tests/dashboard-chat-streaming.spec.mjs`, `tests/dashboard-chat-attivita.spec.mjs`
(A, B), `tests/dashboard-chat-strumenti.spec.mjs` (C). L'altra metà di quei rossi era un
difetto vero: [Il filo dell'attesa](il-filo-dell-attesa.md), «La diretta si chiude sul segno di fine».

## Il verso opposto (#937)

Una prova nata su Windows che asserisce un percorso `C:\…` cade su Linux se la
funzione chiede la forma al sistema che la esegue: `isAbsolute('C:\\x')` lì risponde
falso. Quando il risultato deve essere lo stesso su ogni macchina (la chiave di un test
rosso confrontata fra due cartelle), si riconoscono entrambe le forme:
`isAbsolute(p) || win32.isAbsolute(p)`. Un rosso solo su Linux non ferma né le fusioni
né le versioni, quindi nessun allarme lo segnala: resta finché una routine non lo trova.
Riferimento: `chiaveTest` in `scripts/lib/unit-sulla-fusione.mjs`.

## La sessione che lancia le prove (#949.1, #1110.1)

Gli strumenti delle routine misurano la sessione in cui girano: il suo nome
(`FILO_ROUTINE`, `FILO_TRANSCRIPT`…), o, con un biglietto nella radice del repo, il
transcript più recente della cartella. Una prova che li esegue misurava così la
sessione che la lanciava: consumo vero nei corpi confrontati, il suo conto nella copia di
prova, rossi solo in una routine. Il lanciatore toglie ai test nome e cartella dei
transcript (`ambientePerITest`, sentinella in `tests/unit/unitRunner.test.mjs`); un
figlio che una prova lancia da sé prende l'ambiente da lì, così un `node --test` a mano
dà lo stesso esito del lanciatore.

## La pagina nascosta che Playwright tiene sveglia (#1494)

«Salta le pubblicità dei video» riconosce il «Salta» da un'animazione CSS muta, che il
motore fa partire quando disegna il pulsante. Una pagina nascosta (scheda dietro,
finestra ridotta a icona o coperta) non disegna: `requestAnimationFrame` si ferma, le
animazioni non partono, e la pubblicità suonava per intero. La prova «in una scheda in
secondo piano salta lo stesso» era verde lo stesso.

Playwright, per ogni pagina che aggancia, chiede a Chromium di emulare il fuoco
(`Emulation.setFocusEmulationEnabled`), e Chromium tratta come visibile una pagina col
fuoco emulato. Sotto Playwright una scheda dietro, con la vista grande zero e
`setVisible(false)`, risponde `visibilityState === 'visible'` e disegna a 60 fotogrammi
al secondo, anche a finestra nascosta. Lo stesso Electron senza Playwright risponde
`hidden` e i fotogrammi vanno a zero.

- Ciò che cambia a pagina nascosta (animazioni, `rAF`, `IntersectionObserver`,
  `ResizeObserver`, `visibilitychange`, timer rallentati) si prova con
  `apriFiloSenzaPlaywright()` di `tests/helpers/filoSenzaPlaywright.mjs`: guida il main
  dal suo ispettore, come `app.evaluate`, e lascia le pagine senza client di debug.
  Anche il Node è parte del sistema: il contenitore delle routine ha il 22, la suite e
  gli unit su GitHub girano sul `node-version` dei workflow (oggi 20), senza il
  `WebSocket` globale. Il client dell'ispettore è perciò il `ws` di Playwright, e le
  quattro prove nate così erano rosse solo su main (#1611, sentinella
  `tests/unit/filoSenzaPlaywright.test.mjs`).
- La prova asserisce prima la precondizione, `document.visibilityState === 'hidden'`
  nella pagina: senza, crede di guardare una scheda dietro e ne guarda una visibile.
- Le anteprime delle schede svegliano per un attimo la scheda dietro che cambia
  (`src/main/tabs/anteprime.js`): la prova che deve vedere la pagina nascosta le spegne
  (`anteprime.chiudi()`), o l'esito dipende da quando scatta la foto.
- La finestra dei test, parcheggiata fuori schermo e trasparente, tiene nascoste anche
  le schede davanti. Per la differenza fra davanti e dietro serve la finestra vera
  (`FILO_HIDE_WINDOW: '0'`), solo su Linux, dove lo schermo è virtuale.

Misurato su Electron 44 e Linux, una pagina nascosta tiene la sua misura;
`getBoundingClientRect`, `checkVisibility` ed `elementFromPoint` rispondono giusto, i
timer girano a un secondo, `MutationObserver` funziona e `sendInputEvent` arriva al frame
principale come clic vero. Il clic del protocollo di debug mandato alla pagina e
instradato dal punto a un riquadro d'altro sito, con la pagina nascosta o appena tornata
davanti (non ancora disegnata), lo riceve spesso la pagina che lo ospita; mandato alla
sessione del riquadro stesso (`Target.setAutoAttach` con `flatten`), nel suo punto, gli
arriva anche nascosta. Lo spostamento del mouse dello stesso protocollo non risponde
finché la pagina non disegna.
