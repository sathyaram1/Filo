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
  GLOBALE con Alt+lettera se lo prende in tutto il sistema; una con Alt+cifra impedisce di
  digitare quei simboli in qualunque pagina. Su Mac Alt+lettera prende un Ctrl davanti
  (`src/main/shortcuts.js`) e Alt+cifra diventa Cmd+cifra (i salti fra schede, come in
  ogni browser su Mac), tranne lo zero, che su Mac è già lo zoom al 100%: lì la scheda in
  fondo si raggiunge con Cmd+9, «l'ultima».
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
- **La modalità terminale non è PowerShell.** Fuori da Windows si parte da `/bin/sh`, o
  da `bash` se l'utente l'ha scelto nelle Preferenze. La regola sta solo in `resolveShell`
  di `src/main/services/terminal.js`: la sessione persistente
  (`src/main/services/shell.js`) e i comandi dell'assistente chiedono lì. Due copie
  divergevano già (la voce «Bash» delle Preferenze non faceva niente).
- **L'aggiornamento automatico può fermarsi, e allora lo dice.** electron-updater
  riscrive l'AppImage da cui Filo sta girando: riesce se il file è scrivibile e l'app è
  partita davvero come AppImage. Quando inciampa, `avvisaSeAggiornamentoBloccato` scrive
  fra le notifiche che la versione nuova va presa a mano, come su Mac.
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
I file mancanti vanno rimessi su quella stessa release.
