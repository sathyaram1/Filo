# Istruzioni per Claude Code

Convenzioni valide per QUALSIASI agente che lavora su Filo. Questo file è
l'unico documento condiviso: quello che non è qui sta nel file locale o nel
ruolo che ti viene consegnato.

## Switch di ruolo

- **Sessione locale** (owner + Claude in chat) → leggi anche **`../LOCAL.md`**
  (nella cartella SOPRA il repo: è voluto, non sono informazioni che devono
  stare nel repo pubblico).
- **Routine cloud** → le istruzioni del tuo ruolo le ricevi automaticamente
  (l'orchestratore dal preflight, i worker da dispatch). Non cercare file di
  istruzioni da leggere per conto tuo.

## Letture obbligatorie prima di codice o revisioni

- **`filo_filosofia.txt`** e **`filo_design.txt`** sono già qui sotto, importati
  per intero: NON rileggerli con uno strumento. Stanno nel prompt di sistema di
  proposito: quel prefisso è identico per ogni agente che lavora su Filo e la
  cache dei prompt lo serve a un decimo del prezzo, mentre una lettura si paga
  piena e poi si ripaga a ogni turno per il resto della sessione.
- **`PATTERNS.md`** prima di toccare la UI o prendere decisioni di design. È
  un **indice**: una riga per pattern, titolo e regola. Il racconto di ogni
  pattern sta in `patterns/<slug>.md`, linkato dalla riga: il caso che l'ha
  fatto nascere, i tentativi sbagliati, i riferimenti al codice. Aprilo solo
  per il pattern che stai per toccare. Se stabilisci un pattern nuovo, scrivi
  il file e aggiungi la riga nell'indice.

@filo_filosofia.txt
@filo_design.txt

## Il contesto si paga a ogni turno

Ogni turno rilegge l'intero contesto della sessione. Misurato sulle sessioni
locali dell'owner (settembre 2026): le riletture della cache sono il 61% del
costo, le scritture il 26%, l'output il 13%. Dieci chiamate in dieci turni
costano dieci riletture, in un turno solo una. Quindi:

- **Chiamate indipendenti nello stesso turno.** Letture, ricerche, controlli
  che non dipendono l'uno dall'esito dell'altro partono insieme. Una chiamata
  che dipende da un esito va DOPO l'esito, oppure nella stessa riga di shell
  legata al passo prima, mai in un batch che va avanti anche se il passo prima
  è fallito: un test rosso deve fermare, non finire in coda a un commit. La
  forma giusta, per shell:
  - Bash: `npm run test:unit && git commit …`. Attenzione al tubo: in
    `npm run test:unit | tail -40 && git commit` l'esito che conta è quello di
    `tail`, e il commit parte anche coi test rossi. O non si filtra il comando
    di cui conta l'esito, o si mette `set -o pipefail` prima.
  - PowerShell 5.1: `&&` è un errore di sintassi; si scrive
    `npm run test:unit; if ($?) { git commit … }`, e regge anche attraverso un
    tubo. Non aggiungere `2>&1` a un eseguibile: rende `$?` falso anche a
    esito 0, e la catena si ferma su un successo.
- **Le esplorazioni si delegano.** Se rispondere vuol dire leggere più di
  qualche file, lo fa un sotto-agente e qui resta la conclusione, non i file.
  Tieni in contesto solo ciò che ti servirà davvero nei turni dopo. Più
  sotto-agenti insieme solo se leggono soltanto: due che scrivono si pestano
  sui lock del salvataggio automatico (vale la regola dei ruoli: chi scrive,
  uno alla volta).
- **Si legge la parte, non il file.** Intervalli di righe, uscite filtrate
  (`tail`, `grep`), mai un file da centinaia di KB intero per una sezione.
- **Sessioni che finiscono.** Un compito nuovo in una sessione lunga paga tutto
  il passato a ogni turno: a un cambio di argomento si riparte.

## Regole del repo

- **Salvataggio automatico**: a ogni modifica di file un hook committa e pusha
  il TUO ramo, da solo. È il trasporto del lavoro — rende il ramo visibile a
  verifica e server — oltre che il paracadute se la sessione muore.
- **Su `main` scrive SOLO il server.** Il muro sta su GitHub: una regola di
  protezione del repo lascia scrivere la sola identità del server (una GitHub
  App). Le credenziali locali capaci di fare un push esistono ancora — quello
  che non esiste più è un push su `main` che vada a buon fine: **viene
  respinto** (verificato sul campo). Le due strade — il cancello di merge
  (routine) e `npm run finish` (locale) — sono due modi di CHIEDERE al server di
  fondere; lui scarica il diff, fa girare i controlli deterministici e fonde con
  un'identità sua.
- **Anche gli automatismi locali si astengono da `main`**, e non perché servano
  al muro: un automatismo che tenta e viene respinto in silenzio è un guasto
  invisibile (è già successo — un ramo che non si salvava più da giorni senza
  che nessuno lo sapesse), e una difesa appesa a un muro solo cade con quel
  muro. Salvataggio automatico e diagnostico non committano e non spediscono un
  ramo protetto (`main`, `master`, il default di origin): lo scrivono nei log e
  proseguono. Conseguenza pratica: **se lavori in una cartella che si trova su
  `main`, il tuo lavoro non viene salvato**. Spostalo su un ramo suo:
  `git worktree add .claude/worktrees/<nome> -b claude/<nome>`.
- **Mai committare artefatti dei test** (`tests/.shots/`, `tests/.smoke/`,
  `tests/agent/.out/`, ecc.: output rigenerato, gitignorato). Se un PNG risulta
  tracciato: `git rm --cached <file>`.

## Filo gira anche su Mac

Filo si scrive e si prova su Windows, e si scarica anche su Mac
(`Filo-Mac.dmg`, allegato alla stessa release dall'altra metà di
`.github/workflows/release.yml`). Nessuno di noi ha un Mac sotto mano: un Mac
si rompe in silenzio e la notizia arriva settimane dopo, da un utente. Quindi
le regole valgono **mentre scrivi**, non a un controllo finale che non esiste.

- **Cmd vale quanto Ctrl.** Una scorciatoia si legge `e.ctrlKey || e.metaKey`,
  mai `ctrlKey` da solo. Su Mac il tasto delle scorciatoie è Cmd, e un
  controllo che guarda solo Ctrl tace. Gli acceleratori di Electron si
  dichiarano `CommandOrControl+X`, non `Ctrl+X`.
- **Alt su Mac scrive.** Opzione+E compone `é`, Opzione+cifra fa `¡™£¢`. Una
  scorciatoia GLOBALE con Alt+lettera se lo prende in tutto il sistema, in ogni
  programma; una con Alt+cifra impedisce di digitare quei simboli in qualunque
  pagina. Su Mac Alt+lettera prende un Ctrl davanti
  (`src/main/shortcuts.js`) e Alt+cifra diventa Cmd+cifra (i salti fra schede,
  come in ogni browser su Mac) — tranne lo zero, che su Mac è già lo zoom al
  100%: lì la scheda in fondo si raggiunge con Cmd+9, «l'ultima».
- **Il nome di una scorciatoia non si scrive a mano: si chiede.** Le funzioni
  rispondevano già a Cmd — a mentire erano le SCRITTE, e mentivano una alla
  volta. `src/shared/tasti.js` è la porta unica: `SN_TASTI.etichetta('Ctrl+B')`
  dà `Ctrl+B` su Windows e `Cmd+B` su Mac. Vale ovunque compaia un tasto
  (menu del tasto destro, suggerimenti, elenchi). Nell'HTML non si può
  chiedere, quindi lì una scorciatoia non ci va: la compone il JS della pagina.
  Le eccezioni sono tre e sono dichiarate nella sentinella: la tabella degli
  acceleratori, il manifesto delle capacità (che cita entrambe le forme) e il
  diario delle versioni. `SN_TASTI` tiene anche il COMPORTAMENTO del salto fra
  schede (`indiceSaltoScheda`), perché nome e tasto devono cambiare insieme.
- **Niente percorsi di Windows scritti a mano**, né `C:\...`, né `%APPDATA%`,
  né `process.env.APPDATA`. Le cartelle di sistema le dà Electron
  (`app.getPath`), la home la dà `os.homedir()`, i pezzi si uniscono con
  `path.join`. Vale anche dentro i prompt, dove un esempio è un'istruzione: un
  `C:\Users\...` fa proporre percorsi di Windows a chi sta su un Mac.
- **Un ramo di piattaforma si scrive intero.** `if (process.platform ===
  'win32')` senza l'altro lato è un buco: o l'altro ramo c'è, o il ramo
  Windows è una scorciatoia in più su un comportamento che vale ovunque.
- **Su Mac la barra dei menu esiste sempre, ed è la prima a vedere i tasti.**
  Su Windows la finestra è senza cornice e la barra non si aggancia a niente:
  è per questo che per mesi nessuno si è accorto che era quella di serie di
  Electron, in inglese, e che si prendeva Cmd+W, Cmd+R, Cmd+Z e Cmd +/-/0
  prima delle pagine. La barra di Filo è `src/main/menu.js`: i `role` di
  Electron solo dove il tasto non è di Filo (taglia, copia, incolla, seleziona
  tutto, esci), un `click` che chiama la funzione di Filo dove il tasto è suo,
  e nessun acceleratore inventato — un tasto che vale solo su Mac è la stessa
  asimmetria. Toglierla e basta non è un'uscita: su Mac spegne copia e incolla
  in ogni campo di testo. Il pattern completo sta in
  `patterns/quello-che-il-sistema-aggancia-da-se-va-dichiarato.md`.
- **Un tasto della barra è tolto a tutto il resto.** Su Mac la barra arriva
  prima: promettere quel tasto a un'altra cosa è promettere una cosa che non
  succede mai (Cmd+0 era insieme «zoom al 100%» e «decima scheda», e la scheda
  non arrivava mai). Chi assegna un tasto — Filo o l'utente, come le
  scorciatoie dei moduli nell'Editor — chiede prima `SN_TASTI.riservato()`, che
  tiene la lista dei tasti già presi; una sentinella la confronta con la barra
  vera e diventa rossa se divergono.
- **La ricetta del pacchetto si tocca con cautela**: `build.mac` in
  `package.json`, `scripts/after-pack-mac.js` (la firma locale, senza la quale
  sui Mac con chip Apple l'app non si apre) e il lavoro `release-mac`. Il
  pacchetto è **universale**: nasce da due copie, Intel e Apple Silicon, che
  poi vengono fuse. La fusione pretende che i file non eseguibili delle due
  copie siano identici, quindi le copie NON vanno firmate: si firma solo il
  risultato.
- **Senza certificato Apple, il primo avvio va spiegato dove l'utente è
  bloccato.** macOS rifiuta di aprire Filo la prima volta, e a quel punto
  l'utente non ha ancora visto niente dell'app: un'istruzione che vive solo
  dentro Filo non la leggerà mai. Sta nel disco che ha appena aperto
  (`build/Se Filo non si apre.txt`, allegato dal `build.dmg` del
  `package.json`). E dev'essere **quella giusta**: da macOS Sequoia (2024) il
  clic destro → «Apri» non sblocca più niente, l'unica strada è Impostazioni di
  sistema → Privacy e sicurezza → «Apri comunque», dopo un tentativo fallito.

Come si verifica, dato che un Mac non ce l'abbiamo:

- `tests/unit/macSupport.test.mjs` è la sentinella sempre accesa. Diventa rossa
  su tutto quanto sopra, in millisecondi, sulla macchina di chi ha scritto la
  modifica. Se stabilisci una regola nuova per il Mac, aggiungila lì.
- Il lavoro **«Verifica build Mac»** (`.github/workflows/verifica-mac.yml`)
  costruisce davvero il `.dmg` su una macchina Apple e non pubblica niente.
  Parte da solo quando cambi la ricetta, e si lancia a mano da Actions → Run
  workflow (su qualunque ramo, una volta che il file è su `main`). È il modo
  di rispondere a «il pacchetto si costruisce ancora?» senza bruciare un
  numero di versione.
- Quello che **nessuno dei due prova** è che l'app si apra e funzioni su un
  Mac. Quello lo dice solo un Mac vero: dichiaralo nel report invece di darlo
  per fatto.

## Limiti: abbondanti, e mai un taglio silenzioso

Un tetto troppo stretto è già costato due volte (i feedback inviati dallo
script rifiutati sopra poche migliaia di caratteri; le critiche del
verificatore tagliate a 4000, coi rilievi in coda che sparivano). Prima di
scrivere un tetto rispondi a due domande: **qual è il problema di un tetto
ampio?** e **quanto spesso ci si avvicinerebbe?** Se serve una volta su cento e
il costo è solo qualche credito, il tetto ampio vince: gestire l'eccezione
costa di più. Dimensiona sul caso peggiore realistico, con margine.

Un **troncamento silenzioso e irreversibile è quasi sempre l'idea sbagliata**:
chi manda deve saperlo (rifiuto con la spiegazione e il numero, o un avviso),
così accorcia lui e sceglie cosa tenere. Uno `slice()` muto sul testo di
qualcuno mangia proprio la parte che contava, e lo si scopre settimane dopo.

## Sintomo vs causa

Una lamentela descrive il sintomo come lo vede l'utente. La prima domanda non è
"come faccio sparire questo errore" ma **"cosa stava cercando di fare l'utente,
e perché non gli è riuscito"**. Spesso la causa è altrove.

Segnali che stai fissando il sintomo: stai cambiando solo una stringa per un
bug funzionale; stai facendo passare il test sbagliando meno invece di far
funzionare la feature; non sai rispondere a "se l'utente riprova adesso, gli
funziona?". Segnale di causa vera: **simmetrie mancanti** — due cammini simili
che divergono in modo sospetto. Leggili affiancati.

## Iniziativa: nel dubbio, completa

I feedback arrivano spesso poco specificati — uno screenshot con un bottone
cerchiato e "non va", una critica di due parole. Il tuo lavoro è ricostruire
**l'intento** e completare ciò che implica, non eseguire alla lettera il poco
che c'è scritto.

- **Invarianti UX ovvie**: si fanno, sempre. Se si può aggiungere X si deve
  poter rimuovere X; se l'app salva N cose l'utente deve poterle vedere tutte;
  cammini equivalenti (scorciatoia e menu) fanno la stessa cosa. Non sono
  scelte: sono completezza.
- **Miglioramenti SENZA trade-off**: si fanno. Se un'aggiunta non peggiora
  niente — non costa in servizi a pagamento, non complica l'uso, non chiude
  strade future — nel dubbio falla: ne vale la pena.
- **Trade-off VERO** (velocità vs costo, semplicità vs potenza, dati
  dell'utente, scelte di gusto): NON decidere tu — segnala all'owner e lascia
  a lui la scelta.

Due obblighi nel report: **elenca cosa hai aggiunto oltre il chiesto** (senza
elenco è invisibile e si accumula — è l'argine allo scope creep, insieme ai
casi documentati man mano che emergono), e **se hai fatto una cosa DIVERSA da
quella chiesta dillo per primo, col perché** — vale anche per le richieste
implicite (uno screenshot indicava un punto della UI e tu ne hai scelto un
altro).

## Verifica: niente "fatto" senza aver eseguito

Un task è finito quando il codice toccato è stato **eseguito** e l'esito
osservato — "compila" e "il diff sembra giusto" non bastano. Minimi per tipo di
modifica:

- **logica pura** (parsing, validazioni, trasformazioni) → unit test
  nuovo/aggiornato in `tests/unit/` + `npm run test:unit` (millisecondi, senza
  Electron);
- **feature o fix con UI/flusso app** → spec Playwright mirato
  (`npx playwright test tests/<feature>.spec.mjs`); se non esiste, scrivilo;
- **modifica visiva** → in più `npm run test:shoot -- "<scenario>"` e GUARDA lo
  screenshot (`tests/agent/.out/`); `test:explore` (LLM) è facoltativo;
- **nelle routine** (dal 2026-09-03): chi risolve NON lancia la suite
  completa; la lancia il verificatore, una volta, prima di dare `pass`. Un
  rosso fuori dalla lista dei rossi noti torna a chi risolve con l'elenco
  degli spec rotti. Le regressioni restano responsabilità di chi le
  introduce: i minimi qui sopra (unit + spec mirato) valgono sempre;
- **in locale** → la suite completa solo per modifiche trasversali o se non
  sai cosa tocchi (~25 min: avvisa l'owner, gli occupi la macchina). Se temi
  una regressione precisa, verificala subito: non rimandarla.

Com'è fatto un test che vale: asserisce il **successo dal punto di vista
dell'utente** (l'immagine arriva al destinatario), non l'assenza di un errore
(il toast non compare); e **senza il fix deve essere rosso** — se non sai quale
assert diventerebbe rosso, riscrivilo.

Se la verifica non è possibile (hardware non simulabile, servizi live),
dichiaralo nel report: "implementato ma non verificato perché X".

Note pratiche: gli spec Playwright NON mostrano la finestra (protezione in
`src/main/test-window-mode.js`; `FILO_TEST_VISIBLE=1` per vederla;
`test:shoot`/`test:smoke` restano visibili perché lì la finestra È il
risultato). Fixture: `tests/fixtures/electron.mjs` (userData isolato,
`openTab`, mini server; seleziona i WebContentsView per hostname, mai
`waitForEvent('window')`).

## Consegna: i tre testi

Chi ha scritto il codice scrive anche i testi — nessun ruolo a valle li riscrive
(aggiunge al massimo una riga d'esito). Sono TRE testi distinti, non lo stesso
accorciato:

1. **Report per l'owner** (cifrato, lo legge solo lui). MINIMO: conferma in una
   riga; scelte funzionali diverse dal chiesto col perché; scelte tecniche non
   ovvie che ricadono su di lui (servizi a pagamento, dati utente, decisioni
   difficili da invertire). MAI: ridescrivere il problema, raccontare come hai
   verificato, vantare comportamenti attesi, nomi di file/funzioni.
2. **Frase per chi ha segnalato** (in chiaro, una riga): cosa può fare adesso.
   Se per lui non cambia niente di visibile, non si scrive.
3. **Riga di changelog** in `src/shared/patchNotes.js`: solo se un utente
   qualunque può usare la cosa; una riga, orientata al beneficio. Superfici
   owner e parti interne NON entrano.

Prima di consegnare QUALSIASI testo destinato a un umano (i tre testi qui
sopra, ma anche testi UI e documentazione) applica
**`.claude/skills/unslop/SKILL.md`**: toglie i tic da testo generato e rende
la scrittura chiara.

## Fonti di verità singole (aggiornale nello stesso commit)

- **`src/shared/patchNotes.js`** — changelog per l'utente comune (che non sa
  nulla di codice). Allineato a `package.json`.
- **`src/shared/capabilities.js`** — manifesto di cosa sa fare Filo, per
  l'utente: nuova capacità = voce nuova; cambiata = aggiornata; rimossa =
  tolta. Un manifesto che mente è peggio di uno assente. Una sentinella negli
  unit test confronta le voci verificabili (scorciatoie, pagine interne) col
  codice reale e diventa rossa se derivano.
- **`src/shared/feedbackTransitions.js`** — le TABELLE della macchina a stati
  (stati, transizioni, statusPublic, imbottitura, default dei contatori del
  verificatore N/M) come DATI. La dashboard le legge da qui; il server di
  filo-security le INCORPORA al deploy (predeploy `bake-shared`), insieme a
  **`filo_filosofia.txt`** per i prompt dei giudici L2. Niente copie a mano:
  se tocchi transizioni o filosofia, l'unica cura è **rideployare le
  functions**.

## Run / test

```bash
npm install                # se manca il binario Electron: node node_modules/electron/install.js
npm start
npm run test:unit          # logica pura, ms, senza Electron
npm run test:smoke         # smoke headless con screenshot
npm test                   # SUITE COMPLETA (~100 spec, ~25 min)
npm run test:shoot         # cattura visiva della finestra reale
```

Modelli per gli strumenti di test (`test:explore`): open via OpenRouter, chiave
in `tests/agent/.env` — MAI chiavi del produttore dei pesi (politica modelli).

## Architettura (riassunto)

```
src/main/       processo main Electron (window, tabs, protocol, ipc, shortcuts)
  services/     loader (shared/* su globalThis), handlers per dominio, providers
  shim/         chrome.* per i moduli portati
src/preload/    shell / internal / page
src/renderer/   shell della finestra
src/pages/      dashboard, options, history, feedback, manage, board…
src/shared/     moduli IIFE su globalThis (constants, messages, feedback, …)
src/content/    content scripts
```

- Storage: `%APPDATA%/Filo/storage.json` in produzione, `$FILO_USER_DATA` nei
  test.
- **Convenzione IIFE**: i moduli condivisi si auto-registrano su `globalThis`
  (`global.SN_MODULE = …`); un modulo nuovo va aggiunto all'ordine di
  `src/main/services/loader.js`.
- **Messaggi nuovi**: definisci in `src/shared/messages.js`, gestisci in
  `src/main/services/handlers/<dominio>.js`, broadcast con
  `broadcastToTabs`/`broadcastLiveUpdate`. Lo shim chrome.* vive in tre file a
  seconda del contesto (main / pagine filo:// / pagine web).

Macchina a stati dei feedback: spec in **`FEEDBACK-STATES.md`**; il canale
autenticato delle routine in **`ROUTINE-AUTH-SPEC.md`**; il ridisegno in corso
in **`SPEC-RIDISEGNO-MAX.md`**.
