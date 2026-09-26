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
  per intero: NON rileggerli con uno strumento (stanno nel prefisso in cache,
  identico per ogni agente).
- **`PATTERNS.md`** prima di toccare la UI o prendere decisioni di design. È un
  **indice**, una riga per pattern; il racconto sta in `patterns/<slug>.md` e si
  apre solo per il pattern che stai per toccare. Un pattern nuovo: file più riga
  nell'indice.

@filo_filosofia.txt
@filo_design.txt

## Il contesto si paga a ogni turno

Le riletture della cache sono la voce più grossa del costo di una sessione.

- **Chiamate indipendenti nello stesso turno**; una che dipende da un esito va
  DOPO l'esito, o nella stessa riga di shell legata al passo prima. Un test
  rosso deve fermare, non finire in coda a un commit:
  - Bash: `npm run test:unit && git commit …`. In `npm run test:unit | tail -40
    && git commit` l'esito che conta è quello di `tail`: o non si filtra, o
    `set -o pipefail` prima.
  - PowerShell 5.1: `&&` è un errore di sintassi; si scrive
    `npm run test:unit; if ($?) { git commit … }`. Niente `2>&1` su un
    eseguibile: rende `$?` falso anche a esito 0.
- **Le esplorazioni si delegano** a un sotto-agente; qui resta la conclusione.
  Più sotto-agenti insieme solo se leggono soltanto: due che scrivono si
  pestano sui lock del salvataggio automatico.
- **Si legge la parte, non il file**: intervalli di righe, uscite filtrate.
- **Attese.** Un comando che può superare i due minuti si lancia in sottofondo;
  se serve aspettarlo, a pezzi da quattro minuti al massimo. Il timeout si
  dimensiona sulla durata vera del comando, mai sotto.
- **A un cambio di argomento si riparte** con una sessione nuova.

## Regole del repo

- **Salvataggio automatico**: a ogni modifica di file un hook committa e pusha
  il TUO ramo. È il trasporto del lavoro verso verifica e server, oltre che il
  paracadute.
- **Su `main` scrive SOLO il server** (regola di protezione su GitHub: un push
  su `main` viene respinto). Le due strade, il cancello di merge (routine) e
  `npm run finish` (locale), CHIEDONO al server di fondere.
- **Su `main` il tuo lavoro non viene salvato**: gli automatismi locali non
  committano su un ramo protetto, lo scrivono nei log e proseguono. Spostati su
  un ramo: `git worktree add .claude/worktrees/<nome> -b claude/<nome>`.
- **Mai committare artefatti dei test** (`tests/.shots/`, `tests/.smoke/`,
  `tests/agent/.out/`…). Se un PNG risulta tracciato: `git rm --cached <file>`.
- **Fine riga: LF ovunque.** `.gitattributes` (`* text=auto eol=lf`) vince su
  `core.autocrlf` e non si toglie: su CRLF gli hook escono 0 senza fare niente e
  le regex ancorate a fine riga smettono di riconoscere i file. Un NUL in un
  sorgente si scrive `\u0000`. Racconto e rimedi:
  `patterns/la-fine-riga-la-decide-il-repo-non-la-macchina-che-clona.md`.

## Commenti nel codice

Nessun umano legge il codice di Filo: i commenti sono per gli agenti, e ogni
riga si ripaga a ogni lettura del file. Quindi:

- **Un commento dice il PERCHÉ**: l'intento, l'invariante, il caso che ha fatto
  nascere la guardia. **Mai il COSA**: se rileggendo il codice sotto lo si
  ricostruisce, non si scrive; se lo trovi, lo togli.
- **Una o due righe.** Il racconto sta nel feedback o nel file di pattern. Il
  numero del feedback (`#nnn`) si può citare, ma la regola deve reggere da sola
  nel commento.
- **Una regola vive in un posto solo**, in quest'ordine di preferenza:
  sentinella in `tests/unit/` > file di pattern > CLAUDE.md > commento. Gli
  altri posti rimandano, non copiano. Un «NON cambiare» che si può verificare a
  macchina è una sentinella, non un commento.
- **Intestazione di file: tre righe al massimo.** Cos'è, cosa non deve fare,
  dove stanno le sue regole.
- **Niente cronologia** (la tiene git) e niente commento che ripete il nome
  della funzione.

Nei CSS i commenti che spiegano un token estetico o una scelta di design
restano, compressi. La parte misurabile la tiene
`tests/unit/commentiRegola.test.mjs`.

## Filo gira anche su Mac e Linux

Nessuno di noi ha un Mac o un Linux desktop: si rompono in silenzio, quindi le
regole valgono mentre scrivi.

- **Cmd vale quanto Ctrl**: `e.ctrlKey || e.metaKey`, acceleratori
  `CommandOrControl+X`. Su Linux Ctrl resta Ctrl.
- **Il nome di una scorciatoia si chiede** a `SN_TASTI.etichetta()`
  (`src/shared/tasti.js`), mai scritto a mano; nell'HTML non ci va. Un tasto
  nuovo si controlla con `SN_TASTI.riservato()`: su Mac la barra dei menu
  (`src/main/menu.js`) vede i tasti per prima. Su Mac Alt scrive: una
  scorciatoia globale Alt+lettera lì prende un Ctrl davanti
  (`src/main/shortcuts.js`), Alt+cifra diventa Cmd+cifra.
- **Niente percorsi di Windows scritti a mano**, nemmeno nei prompt: `app.getPath`,
  `os.homedir()`, `path.join`.
- **Un ramo di piattaforma si scrive intero**: `if (process.platform ===
  'win32')` senza l'altro lato è un buco.
- **La shell** fuori da Windows si decide solo in `resolveShell`
  (`src/main/services/terminal.js`).
- **Le ricette dei pacchetti** (`build.mac`, `build.linux`, gli script
  `after-pack-*`, i lavori `release-mac`/`release-linux`) si toccano solo dopo
  aver letto `patterns/mac-e-linux-si-rompono-in-silenzio.md`, che racconta
  anche tutto il resto.

Sentinelle: `tests/unit/macSupport.test.mjs` e `tests/unit/linuxSupport.test.mjs`
(una regola nuova si aggiunge lì). Nessuna prova dice che l'app si apra su un
Mac o un Linux vero: nel report si dichiara.

## Limiti: abbondanti, e mai un taglio silenzioso

Un tetto troppo stretto è già costato due volte. Prima di scriverne uno:
**qual è il problema di un tetto ampio?** e **quanto spesso ci si
avvicinerebbe?** Se serve una volta su cento e costa qualche credito, vince il
tetto ampio: dimensiona sul caso peggiore realistico, con margine. Un
troncamento silenzioso e irreversibile è quasi sempre sbagliato: chi manda deve
saperlo (rifiuto col numero, o un avviso) e scegliere lui cosa tenere.

## Sintomo vs causa

La prima domanda non è «come faccio sparire questo errore» ma **«cosa stava
cercando di fare l'utente, e perché non gli è riuscito»**. Stai fissando il
sintomo se cambi solo una stringa per un bug funzionale, se fai passare il test
sbagliando meno, o se non sai rispondere a «se l'utente riprova adesso, gli
funziona?». Segnale di causa vera: due cammini simili che divergono in modo
sospetto.

## Iniziativa: nel dubbio, completa

I feedback arrivano spesso poco specificati. Il tuo lavoro è ricostruire
**l'intento** e completare ciò che implica.

- **Invarianti UX ovvie**: si fanno, sempre. Se si può aggiungere X si deve
  poter rimuovere X; se l'app salva N cose l'utente deve poterle vedere tutte;
  cammini equivalenti (scorciatoia e menu) fanno la stessa cosa.
- **Miglioramenti SENZA trade-off** (non costano servizi a pagamento, non
  complicano l'uso, non chiudono strade future): nel dubbio si fanno.
- **Trade-off VERO** (velocità vs costo, semplicità vs potenza, dati
  dell'utente, scelte di gusto): NON decidere tu, segnala all'owner.

Nel report: **elenca cosa hai aggiunto oltre il chiesto**, e **se hai fatto una
cosa DIVERSA da quella chiesta dillo per primo, col perché** (anche per le
richieste implicite, come un punto indicato in uno screenshot).

## Verifica: niente "fatto" senza aver eseguito

Un task è finito quando il codice toccato è stato **eseguito** e l'esito
osservato. Minimi per tipo di modifica:

- **niente da aprire** (logica pura, testi, strumenti da riga di comando) →
  controllo veloce in `tests/unit/` + `npm run test:unit`, non una spec che
  apre Filo per non guardarci niente;
- **feature o fix con UI/flusso app** → spec Playwright mirato
  (`npx playwright test tests/<feature>.spec.mjs`); se non esiste, scrivilo;
- **modifica visiva** → in più `npm run test:shoot -- "<scenario>"` e GUARDA lo
  screenshot (`tests/agent/.out/`);
- **la suite completa non la lancia nessuno**, da nessuna parte: gira in GitHub
  nel lavoro di release, ogni sei ore, e un rosso nuovo ferma la patch e
  diventa un feedback. Al suo posto chi verifica lancia `npm run finish:check`
  (unit più gli spec delle aree toccate). Le regressioni restano di chi le
  introduce: se ne temi una precisa, lancia quello spec.

**Prima di consegnare, la verifica te la fai tu**, con gli stessi criteri che
userà chi ti verifica: **`routines/roles/_criteri-verifica.md`** (nelle routine
li hai già nel ruolo). Quello che trovi lo correggi adesso.

Le prove di un **giro di verifica** stanno in `tests/verifica/<numero>/` e si
corrono una volta per giro, da chi verifica:
`npx playwright test tests/verifica/<numero>`, col percorso relativo alla
radice del repo e le barre normali (con le barre di Windows risponde «No tests
found» anche a cartella piena). Quando si cancellano, cosa si può aggiungere
dopo un verdetto e perché stanno fuori dalla suite:
`patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md`.

Un test che vale asserisce il **successo dal punto di vista dell'utente**, non
l'assenza di un errore, e **senza il fix è rosso**. Se la verifica non è
possibile, dichiaralo: «implementato ma non verificato perché X».

Gli spec Playwright non mostrano la finestra (`FILO_TEST_VISIBLE=1` per
vederla; `test:shoot` e `test:smoke` sì, lì la finestra è il risultato). Fixture: `tests/fixtures/electron.mjs` (userData isolato, `openTab`,
mini server; seleziona i WebContentsView per hostname, mai
`waitForEvent('window')`).

## Consegna: i tre testi

Chi ha scritto il codice scrive anche i testi; nessun ruolo a valle li
riscrive. Sono TRE testi distinti:

1. **Report per l'owner** (cifrato, lo legge solo lui): conferma in una riga;
   scelte funzionali diverse dal chiesto col perché; scelte tecniche non ovvie
   che ricadono su di lui. MAI: ridescrivere il problema, raccontare come hai
   verificato, vantare comportamenti attesi, nomi di file/funzioni.
2. **Frase per chi ha segnalato** (in chiaro, la può leggere chiunque; una
   riga): cosa può fare adesso. Mai i dettagli di un buco di sicurezza: quelli
   stanno solo nel report. Se non cambia niente di visibile, non si scrive.
3. **Riga di changelog** in `src/shared/patchNotes.js`: solo se un utente
   qualunque può usare la cosa (superfici owner e parti interne no); una
   riga, orientata al beneficio.

Prima di consegnare un testo destinato a un umano applica
**`.claude/skills/unslop/SKILL.md`**.

## Fonti di verità singole (aggiornale nello stesso commit)

- **`src/shared/patchNotes.js`**: changelog per l'utente comune, allineato a
  `package.json`.
- **`src/shared/capabilities.js`**: manifesto di cosa sa fare Filo. Capacità
  nuova, cambiata o rimossa = voce aggiornata; una sentinella la confronta col
  codice.
- **`src/shared/feedbackTransitions.js`**: le tabelle della macchina a stati
  come DATI (i numeri dei bilanci no: li scrive l'owner in Gestione →
  Automazioni, e chi ne ha bisogno li legge dal server o si ferma). Il server
  di filo-security le incorpora al deploy insieme a **`filo_filosofia.txt`**: se tocchi transizioni o filosofia, **rideploya le
  functions**.

## Run / test

```bash
npm install                # se manca il binario Electron: node node_modules/electron/install.js
npm start
npm run test:unit          # logica pura, ms, senza Electron
npm run test:smoke         # smoke headless con screenshot
npm test                   # SUITE COMPLETA (~350 spec, ~1.450 casi): NON si lancia a mano (vedi § Verifica)
npm run finish:check       # in locale: unit + spec delle aree toccate dal ramo
npm run test:shoot         # cattura visiva della finestra reale
```

- **La macchina dell'owner** ha lo schermo al 125% e un nome utente con lo
  spazio («agenti AI»): `FILO_TEST_SCALE=1.25` per rivedere i suoi rossi, e le
  cartelle temporanee dei test si chiedono a `cartellaTemporanea()`
  (`tests/helpers/percorsi.mjs`). Le sentinelle lo controllano; il racconto sta
  in `patterns/un-test-chiede-al-sistema-non-presume-quello-su-cui-e-nato.md`.
- **I rossi d'ambiente noti** stanno in `tests/rossi-noti.json`: un rosso che
  non è lì dentro è una regressione.
- **Nel contenitore delle routine** gli spec che aprono Electron vogliono davanti `ELECTRON_DISABLE_SANDBOX=1` e `xvfb-run -a`; senza, il rosso non è del codice.
- Modelli per `test:explore`: open via OpenRouter, chiave in
  `tests/agent/.env`, MAI chiavi del produttore dei pesi (politica modelli).

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

- Storage: `storage.json` nella cartella dati dell'app (`app.getPath('userData')`),
  `$FILO_USER_DATA` nei test.
- **Convenzione IIFE**: i moduli condivisi si auto-registrano su `globalThis`
  (`global.SN_MODULE = …`); un modulo nuovo va aggiunto all'ordine di
  `src/main/services/loader.js`.
- **Messaggi nuovi**: definisci in `src/shared/messages.js`, gestisci in
  `src/main/services/handlers/<dominio>.js`, broadcast con
  `broadcastToTabs`/`broadcastLiveUpdate`. Lo shim chrome.* vive in tre file a
  seconda del contesto (main / pagine filo:// / pagine web).

Macchina a stati dei feedback: **`FEEDBACK-STATES.md`**; canale autenticato
delle routine: **`ROUTINE-AUTH-SPEC.md`**; ridisegno in corso:
**`SPEC-RIDISEGNO-MAX.md`**.
