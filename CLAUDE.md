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

- **`filo_filosofia.txt`** e **`filo_design.txt`** (root): ENTRAMBI, sempre.
- **`PATTERNS.md`** prima di toccare la UI o prendere decisioni di design.
  Se stabilisci un pattern nuovo, aggiornalo.

## Regole del repo

- **Salvataggio automatico**: a ogni modifica di file un hook committa e pusha
  il TUO ramo, da solo. È il trasporto del lavoro — rende il ramo visibile a
  verifica e server — oltre che il paracadute se la sessione muore.
- **Su `main` si arriva SOLO dal cancello di merge** (routine) **o da
  `npm run finish`** (locale). Mai un push diretto su `main`.
- **Mai committare artefatti dei test** (`tests/.shots/`, `tests/.smoke/`,
  `tests/agent/.out/`, ecc.: output rigenerato, gitignorato). Se un PNG risulta
  tracciato: `git rm --cached <file>`.

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
- **in cloud, prima di consegnare al verificatore** → `npm test` completo:
  le regressioni incrociate sono responsabilità di chi ha scritto il codice,
  non del verificatore e non di un controllo cumulativo a fine giro;
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
