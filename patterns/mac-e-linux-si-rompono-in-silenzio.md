# Mac e Linux si rompono in silenzio

[← Tutti i pattern](../PATTERNS.md)

Filo si scrive e si prova su Windows, e si scarica anche su Mac (`Filo-Mac.dmg`) e su
Linux (`Filo-Linux.AppImage`), allegati alla stessa release da
`.github/workflows/release.yml`. Nessuno di noi ha un Mac o un Linux desktop sotto mano:
quando si rompono, lo fanno in silenzio e la notizia arriva settimane dopo, da un utente.
Quindi le regole valgono **mentre scrivi**, non a un controllo finale che non esiste. Le
sentinelle sempre accese sono `tests/unit/macSupport.test.mjs` e
`tests/unit/linuxSupport.test.mjs`: una regola nuova per una delle due piattaforme si
aggiunge lì.

## Mac

- **Cmd vale quanto Ctrl.** Una scorciatoia si legge `e.ctrlKey || e.metaKey`, mai
  `ctrlKey` da solo. Gli acceleratori di Electron si dichiarano `CommandOrControl+X`.
- **Alt su Mac scrive.** Opzione+E compone `é`, Opzione+cifra fa `¡™£¢`. Una scorciatoia
  con Alt+lettera toglie l'accento a chi scrive in una pagina; una con Alt+cifra impedisce di
  digitare quei simboli. Su Mac Alt+lettera prende un Ctrl davanti
  (`src/main/shortcuts.js`) e Alt+cifra diventa Cmd+cifra (i salti fra schede, come in
  ogni browser su Mac), tranne lo zero, che su Mac è già lo zoom al 100%: lì la scheda in
  fondo si raggiunge con Cmd+9, «l'ultima».
- **Niente scorciatoie di sistema con Alt+lettera, su nessun sistema.** Su Windows e Linux
  Alt+lettera apre menu e schede negli altri programmi (Alt+H è la Home di Word): le
  scorciatoie di Filo si ascoltano sui suoi webContents (`before-input-event`), così valgono
  solo con Filo davanti (#838, sentinella `tests/unit/scorciatoieSoloInFilo.test.mjs`).
  Il visore dei PDF, da Electron 41, è un riquadro della scheda: i suoi tasti passano dallo
  stesso evento.
- **Il nome di una scorciatoia non si scrive a mano: si chiede.** Le funzioni
  rispondevano già a Cmd: a mentire erano le SCRITTE, una alla volta.
  `src/shared/tasti.js` è la porta unica: `SN_TASTI.etichetta('Ctrl+B')` dà `Ctrl+B` su
  Windows e `Cmd+B` su Mac. Nell'HTML non si può chiedere, quindi lì una scorciatoia non
  ci va: la compone il JS della pagina. Le eccezioni sono tre e sono dichiarate nella
  sentinella: la tabella degli acceleratori, il manifesto delle capacità e il diario delle
  versioni. `SN_TASTI` tiene anche il COMPORTAMENTO del salto fra schede
  (`indiceSaltoScheda`), perché nome e tasto devono cambiare insieme.
- **Su Mac la barra dei menu esiste sempre, ed è la prima a vedere i tasti.** Su Windows
  la finestra è senza cornice e la barra non si aggancia a niente: per mesi nessuno si è
  accorto che era quella di serie di Electron, in inglese, e che si prendeva Cmd+W, Cmd+R,
  Cmd+Z e Cmd +/-/0 prima delle pagine. La barra di Filo è `src/main/menu.js`: i `role` di
  Electron solo dove il tasto non è di Filo (taglia, copia, incolla, seleziona tutto,
  esci), un `click` che chiama la funzione di Filo dove il tasto è suo, e nessun
  acceleratore inventato. Toglierla e basta non è un'uscita: su Mac spegne copia e incolla
  in ogni campo di testo. Il racconto completo sta in
  [Quello che il sistema aggancia da sé va DICHIARATO, o resta quello di Electron](quello-che-il-sistema-aggancia-da-se-va-dichiarato.md).
- **Un tasto della barra è tolto a tutto il resto.** Cmd+0 era insieme «zoom al 100%» e
  «decima scheda», e la scheda non arrivava mai. Chi assegna un tasto (Filo o l'utente,
  come le scorciatoie dei moduli nell'Editor) chiede prima `SN_TASTI.riservato()`; una
  sentinella confronta quella lista con la barra vera. `template()` accetta la
  piattaforma proprio per questo: senza, da Windows si confronterebbe una barra che su
  Mac non esiste — e su Mac indietro e avanti stanno su Cmd+[ e Cmd+], non su Alt+freccia.
- **La ricetta del pacchetto**: `build.mac` in `package.json`,
  `scripts/after-pack-mac.js` (la firma locale, senza la quale sui Mac con chip Apple
  l'app non si apre) e il lavoro `release-mac`. Il pacchetto è **universale**: nasce da
  due copie, Intel e Apple Silicon, poi fuse. La fusione pretende che i file non
  eseguibili delle due copie siano identici, quindi le copie NON vanno firmate: si firma
  solo il risultato.
- **Senza certificato Apple, il primo avvio va spiegato dove l'utente è bloccato.** macOS
  rifiuta di aprire Filo la prima volta, quando l'utente non ha ancora visto niente
  dell'app: l'istruzione sta nel disco che ha appena aperto
  (`build/Se Filo non si apre.txt`, allegato dal `build.dmg` del `package.json`). E
  dev'essere quella giusta: da macOS Sequoia il clic destro → «Apri» non sblocca più
  niente, l'unica strada è Impostazioni di sistema → Privacy e sicurezza → «Apri
  comunque», dopo un tentativo fallito.

## Linux

- **Ctrl resta Ctrl.** Su Linux non c'è Cmd e non c'è la barra dei menu
  dell'applicazione: `SN_TASTI` lo sa già, non servono rami per Linux.
- **I caratteri sono più larghi di Segoe UI.** `--sn-font` lì cade su un altro font (Inter
  nel contenitore delle routine): una scritta che su Windows sta in una riga va a capo, e
  un tetto d'altezza fisso fa scorrere un testo che doveva leggersi tutto. Un'impaginazione
  si regge sulla misura vera (la scatola presa prima di cambiare la scritta, un tetto
  relativo allo spazio che c'è), mai sui pixel visti su Windows. Per lo stesso motivo un
  rosso d'impaginazione nel contenitore è quello che vede un utente Linux, non un rosso
  d'ambiente: si corregge, non si mette fra i rossi noti (#663.4: il tasto Approva armato
  e la casella della chat dell'editor, corretti da #256.3 e #530.5).
- **La modalità terminale non è PowerShell.** Fuori da Windows si parte da `/bin/sh`, o
  da `bash` se l'utente l'ha scelto nelle Preferenze. La regola sta solo in `resolveShell`
  di `src/main/services/terminal.js`: la sessione persistente
  (`src/main/services/shell.js`) e i comandi dell'assistente chiedono lì. Due copie
  divergevano già (la voce «Bash» delle Preferenze non faceva niente).
- **L'aggiornamento automatico può fermarsi, e allora lo dice.** electron-updater
  riscrive l'AppImage da cui Filo sta girando: riesce se il file è scrivibile e l'app è
  partita davvero come AppImage. Quando inciampa, `avvisaSeAggiornamentoBloccato` scrive
  fra le notifiche che la versione nuova va presa a mano, come su Mac. «Riavvia e aggiorna»
  compare solo dove l'installazione può riuscire (`haPulsante` in
  `src/main/aggiornamentoRegole.js`): su Mac mai, su Linux solo con la cartella dell'AppImage
  scrivibile. Lì Filo si riapre con `app.relaunch`, cioè a processo chiuso: lanciato subito, il
  Filo nuovo troverebbe preso il lucchetto dell'istanza unica e si chiuderebbe.
- **Il link d'invito passa dalla voce di menu.** `filo://` arriva a Filo solo se il
  `.desktop` dentro l'AppImage dichiara `x-scheme-handler/filo`, riga che
  electron-builder scrive solo perché `build.protocols` è dichiarato.
- **Il doppio clic apre Filo solo grazie a un lanciatore dentro il pacchetto.** Chromium
  all'avvio vuole gli spazi dei nomi utente non privilegiati; dove sono negati (Ubuntu,
  di serie dalla 23.10) ripiega su `chrome-sandbox`, che dentro un AppImage non può essere
  setuid, e non parte affatto («No usable sandbox!», sul terminale, dove nessuno lo
  legge). `scripts/after-pack-linux.js` mette al posto del programma un lanciatore che
  guarda le tre manopole del kernel e aggiunge `--no-sandbox` SOLO dove dicono di no:
  Filo è un browser, e dove la gabbia regge deve restare. Il lanciatore usa `exec -a` per
  non cambiare il nome del processo, da cui viene l'aggancio dell'icona nella barra.
- **In una sessione Wayland Filo parte su X.** Da Electron 38 Chromium lì parte come
  programma Wayland, dove una finestra non sceglie dove aprirsi: i menu e le anteprime di
  Filo sono finestre a sé messe accanto al puntatore. Lo stesso lanciatore aggiunge
  `--ozone-platform=x11` quando c'è un X (anche XWayland) e l'utente non ha scelto da sé.
  `app.commandLine.appendSwitch` non basta: la piattaforma si sceglie prima che parta il JS.
- **La ricetta**: `build.linux` in `package.json`, `scripts/after-pack-linux.js` e il
  lavoro `release-linux`. Il nome del file è **fisso** perché il sito ha un collegamento
  solo; `artifactName`, `category` e `desktop` non sono decorazioni: senza il primo il
  collegamento si rompe, senza gli altri Filo non compare nel menu di sistema e la
  finestra non si aggancia alla propria icona.

## Come si verifica senza la macchina

- **«Verifica build Mac»** (`.github/workflows/verifica-mac.yml`) costruisce davvero il
  `.dmg` su una macchina Apple e non pubblica niente. Parte da solo quando cambi la
  ricetta, e si lancia a mano da Actions → Run workflow.
- **«Verifica build Linux»** (`.github/workflows/verifica-linux.yml`) costruisce
  l'AppImage, guarda dentro il pacchetto e nella voce di menu, poi lo AVVIA con la
  manopola del kernel a zero, come su Ubuntu 24.04.
- L'AppImage si costruisce anche nel contenitore delle routine: `npm run build:linux`
  mette `dist/Filo-Linux.AppImage` e `dist/latest-linux.yml`. Senza FUSE non si monta:
  si estrae (`./Filo-Linux.AppImage --appimage-extract`) e, dalla cartella che contiene
  `squashfs-root`, si lancia così, intero:
  `APPDIR=$PWD/squashfs-root ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a ./squashfs-root/AppRun --no-sandbox`
- Nessuna di queste prove dice che l'app si apra e funzioni su un Mac o su un Linux
  desktop vero, con la sua sessione grafica e le sue notifiche. Nel report si dichiara.

## Se la mezza release di una piattaforma fallisce, apre un feedback

`release-mac` e `release-linux` sono `continue-on-error`, e deve restare così: un guasto
su Linux non deve togliere l'aggiornamento a chi sta su Windows. Il prezzo è che la corsa
resta verde e il lavoro diventa rosso in una pagina che nessuno apre — Filo per Linux è
mancato da OGNI release per sei giorni senza che nessuno lo sapesse (#733).

Quindi ogni lavoro di piattaforma finisce con un passo `if: failure()` che chiama
`scripts/release-platform-alarm.mjs`: il guasto diventa un feedback in coda, con
piattaforma, versione, passo fallito e link all'esecuzione, e la release Windows non si
tocca. Ogni passo prima di lui ha un `id`, perché è da quelli che si capisce quale si è
fermato. I file che devono stare nella release (`PIATTAFORME` nello script) vivono lì e
basta: il controllo finale del lavoro li chiede con `--attesi <piattaforma>`.

Un lavoro nuovo marcato `continue-on-error` senza l'allarme non nasce:
`tests/unit/releaseSuite.test.mjs` lo ferma.

**Una versione già pubblicata non si ripubblica rilanciando il lavoro**: decide se
pubblicare contando i commit dopo l'ultimo tag, quindi senza commit nuovi non rifà nulla.
Per rimettere i file su quella stessa release si avvia `release.yml` a mano con
`ripubblica_mac` o `ripubblica_linux` e il numero in `ripubblica_versione`: il lavoro
costruisce il codice di QUEL tag e gli riattacca i suoi file, senza far girare la suite e
senza pubblicare una versione nuova. Il feedback dell'allarme manda proprio lì, e il nome
della casella vive in `casella()` dello script, così i due non divergono.

Un guasto lo si racconta **per quello che è**, e lo dice solo la pagina della versione:
l'avviso la legge da sé (`GH_TOKEN` nel suo passo), e vale anche l'elenco del controllo
finale. Dare per perso tutto manda chi lo prende a cercare un guasto più grosso di quello
vero (#733, primo giro). Dedurlo dai passi girati sbagliava al secondo tentativo, quando
programma e manifesto stanno già lì dal primo, e su un numero scritto a mano che non esiste
(#733.3): senza la pagina l'avviso dice che non ha potuto guardare, e una versione che fra
le release non c'è la chiama inesistente.

**La chiave dice quale guasto è, non solo quale piattaforma.** Il server non apre un
feedback nuovo per una chiave già in un feedback aperto o parcheggiato. Con la chiave fissa
`piattaforma:linux` un guasto NUOVO, dopo che Linux era tornato a uscire, finiva dentro il
feedback vecchio e la corsa restava verde (#752). La chiave porta l'ultima versione uscita
per quella piattaforma, cioè con tutti i suoi file (`piattaforma:mac:dopo-v0.2.302`): finché
resta rotta non cambia e non nascono doppioni, tornata a uscire un guasto dopo ne ha una
nuova. Se i file nella pagina ci sono tutti, è rotto il resto del lavoro (le impronte):
la chiave è `piattaforma:mac:impronte:dopo-v…` e conta uscita solo una versione che ha
anche le impronte, lette nella sua pagina dallo strumento che le scrive. Contando i soli
file, ogni versione rotta alle impronte era «uscita» e apriva un feedback suo (#1348,
verifica). Senza release lette, o senza quello strumento, la chiave è della versione
(`in-v…`): un doppione è meglio di un guasto inghiottito.

**L'allarme deve poter parlare prima di tutto il resto.** Lo strumento che apre il
feedback vive nel repo, e la copia di lavoro del lavoro di piattaforma diventa quella del
tag a cui ci si attacca: un tag vecchio non ce l'ha, e se il prelievo fallisce non c'è
niente. Quindi il primo passo preleva il codice di QUESTA corsa e il secondo ne copia
`release-platform-alarm.mjs` e `build-alarm.mjs` sotto `runner.temp`; da lì in poi
l'allarme e il controllo finale usano quella copia, non `scripts/`.

**E se l'allarme non parte, la corsa non resta verde.** Il passo riprova tre volte, poi
scrive `esito=muto` fra gli output del lavoro, lo dice nel riepilogo della corsa ed esce
rosso. Il lavoro `avviso-mancato` fa fallire la corsa quando una metà che doveva girare
non ha detto `finito=si` (lo scrive solo il riepilogo, l'ultimo passo) e non ha detto
`aperto`. Non basta guardare `muto`: un lavoro stroncato dal tetto di tempo o da una
macchina persa non fa girare il passo dell'avviso, e il suo esito resta vuoto (#733.4).
Non ci si fida neanche di `needs.<lavoro>.result`, che con `continue-on-error` può dire
riuscito. Un `|| echo` o un `|| true` sull'invio è il bug.

La sentinella in `tests/unit/releaseSuite.test.mjs` non legge la forma delle righe: valuta la
condizione della rete, scenario per scenario e per tutte e due le piattaforme, ed esegue il
passo dell'avviso con un invio che fallisce (`tests/helpers/azioniGithub.mjs`). Una seconda
prova le applica i due guasti che la forma lasciava passare (la rete che guarda solo il Mac,
l'invio che non può fallire seguito da `aperto`) e pretende che diventi rossa (#733.6).

**Il titolo dice solo quello che si è guardato.** Se nessuno ha letto la pagina della
versione non si annuncia un elenco di file mancanti, e se il lavoro si è fermato prima di
sapere a quale versione attaccarsi non si dichiara rotto nessun download: le sentinelle
in `tests/unit/releasePlatformAlarm.test.mjs` lo tengono fermo.
