# Filo

> **Non ancora pronto.** Questo repository è il dietro le quinte di un progetto
> in costruzione, non un prodotto da usare. I documenti di trasparenza sono
> incompleti e ci sono problemi di sicurezza noti in corso di risoluzione.
> L'eseguibile è scaricabile perché lo sviluppo è pubblico, ma per ora provalo
> solo per curiosità.

Filo è un modo nuovo di usare il computer, costruito sull'intelligenza
artificiale, soprattutto sui modelli linguistici. L'interazione è pensata da
zero, senza le convenzioni nate da vecchi limiti tecnici e rimaste per
abitudine. Non è chi lo usa a dover imparare Filo. È Filo che impara a
conoscere chi lo usa, e prova a capire cosa vuole prima che lo dica.

- Tutto si ottiene scrivendo cosa si vuole. I pulsanti sono scorciatoie: lo
  zoom della pagina si può chiedere a Filo o dare con un clic, che fa prima.
- Il tasto destro vuol dire «voglio fare qualcosa qui». Cambia secondo
  l'elemento e porta quello che ci si può fare.
- Quasi tutto è un modulo che si sposta o si sostituisce. Le scelte estetiche,
  come colori e font, si cambiano nelle impostazioni o chiedendolo a Filo.
- Deve reggere l'uso sbagliato, come un telefono regge una caduta. Chi non
  salva mai, non dà un nome ai file o sbaglia una parola su tre non deve
  trovarsi nei guai.

Oggi Filo gira sul computer, su Windows, Mac e Linux: è un browser con l'AI
dentro. Più avanti sarà un sistema solo, condiviso fra computer, telefono e TV.

Le scelte sono spiegate per esteso. I documenti in
[`transparency/`](transparency/) dicono quali modelli usa Filo e perché, cosa
resta sul computer e cosa esce, verso chi, e come si cercano i problemi di
sicurezza. [`SECURITY.md`](SECURITY.md) spiega come protegge dati e account,
misura per misura, e quali misure sono già attive e quali in arrivo. Cosa sa
fare oggi lo elenca voce per voce
[`src/shared/capabilities.js`](src/shared/capabilities.js): è la stessa lista
che Filo legge per rispondere a «puoi farlo?».

## Quick start

```bash
npm install                     # installa Electron + Playwright
npm start                       # avvia Filo (apre la finestra)
npm run test:smoke              # smoke headless (verifica che la newtab carichi)
```

Prima di aprire la finestra, `npm start` (e `npm run dev`) prova ad allineare
il ramo in cui sei a `origin/main` (`git pull --rebase --autostash`). Se non ci
riesce, per esempio offline o con un conflitto, annulla e apre Filo comunque.
Poi installa i pacchetti che `package-lock.json` chiede e `node_modules` non
ha. Se va aggiornato Electron mentre un Filo è acceso, aspetta il prossimo
avvio: su Windows un Electron acceso non si sostituisce. Le prove
(`npm run test:unit`, gli spec Playwright, `npm run finish`) fanno lo stesso
controllo prima di partire, nella cartella da cui arrivano i pacchetti.

Il binario di Electron non lo scarica `npm install`: lo scarica il primo
`npm start`, o il primo lancio dei test. Per scaricarlo subito:

```bash
node node_modules/electron/install.js
```

## Sistemi e aggiornamenti

Filo si scarica da [filo.red](https://filo.red). I pacchetti li costruisce
electron-builder (`npm run build` per Windows, `npm run build:mac`,
`npm run build:linux`) e li pubblica `.github/workflows/release.yml` nelle
release di GitHub.

- **Windows.** Un installatore. Filo scarica la versione nuova e la installa da
  solo: la prossima volta che lo apri, oppure in silenzio quando lo chiudi, a
  scelta nelle Preferenze. «Riavvia e aggiorna» la installa subito.
- **Mac.** Un'immagine disco universale, per Intel e Apple Silicon. Filo non ha
  una firma di Apple, e il Mac non lo lascia aggiornare da solo. Quando c'è una
  versione nuova Filo avvisa, e la si scarica da filo.red per sostituire l'app.
  Dentro l'immagine c'è «Se Filo non si apre», che spiega il primo avvio.
- **Linux.** Un AppImage. Se Filo può riscrivere il proprio file, la versione
  nuova si installa quando lo chiudi, o subito con «Riavvia e aggiorna». Se non
  può, per esempio perché la cartella del file non si può scrivere, Filo lo
  segnala e la versione nuova si scarica a mano da filo.red: prende il posto
  del file vecchio, e al file va ridato il permesso di esecuzione.

Su Windows e Linux, con «Installa gli aggiornamenti da solo» spento nelle
Preferenze, la versione nuova arriva solo quando premi «Installa».

## Architettura

```
src/
├── main/         processo main di Electron: finestra, schede, filo://, IPC, scorciatoie, aggiornamenti
│   ├── services/ servizi, handler dei messaggi per dominio, provider dei modelli
│   └── shim/     le API chrome.* ricreate per il codice nato nell'estensione
├── preload/      i preload della shell, delle pagine filo://, delle pagine web e delle finestrelle native
├── renderer/     la shell della finestra (schede, barra degli indirizzi) e le finestrelle native
├── pages/        le pagine interne, servite da filo://
├── content/      gli script nelle pagine web (tasto destro, popup, barra laterale, evidenziatore…)
├── shared/       i moduli condivisi fra main e pagine, registrati su globalThis
├── styles/       i CSS condivisi
└── vendor/       codice e dati di terzi
tests/            unit test in tests/unit/, spec Playwright in tests/*.spec.mjs
scripts/          strumenti di sviluppo, rilascio e routine
transparency/     i documenti di trasparenza, sorgente unica
site/             pagine web: la trasparenza generata da transparency/, le approvazioni
patterns/         il racconto delle convenzioni indicizzate in PATTERNS.md
routines/         i ruoli degli agenti che lavorano su Filo in cloud
assets/           le icone dell'app
build/            i file che accompagnano i pacchetti
```

Il dettaglio di `src/` sta in `CLAUDE.md`, sezione Architettura.
`node scripts/mappa-moduli.mjs <cartella>` elenca i file di una cartella con la
prima frase della loro intestazione.

Le istruzioni per gli agenti che lavorano su Filo stanno in `CLAUDE.md`. Le
routine in cloud ricevono il loro ruolo da `scripts/dispatch.mjs`, che lo
prende da `routines/roles/`. Le convenzioni della UI stanno in `PATTERNS.md`,
una riga per regola, col racconto di ognuna in `patterns/<slug>.md`.

## Com'è fatto il codice

Filo è nato come estensione di Chrome. L'estensione non poteva avere una vera
pagina nuova nativa, intercettare la navigazione prima che parta, o tenere dati
oltre le quote strette di `chrome.storage`. Su Electron Filo ha tutto questo.
Il porting è finito, e gran parte del codice di oggi è nata dopo.

Dall'estensione resta lo stile senza build, a moduli IIFE su `globalThis`:

```js
(function (global) {
  global.SN_MODULE = { ... };
})(typeof globalThis !== 'undefined' ? globalThis : self);
```

Nel processo main ogni file si carica con `require()`, si registra su
`globalThis`, e gli altri lo trovano lì, come succedeva nel service worker con
`importScripts`. L'ordine di caricamento sta in `src/main/services/loader.js`,
e un modulo nuovo va aggiunto lì.

Le API `chrome.*` usate dal codice nato nell'estensione sono ricreate in tre
posti, uno per contesto: `src/main/shim/chrome-api.js` nel main,
`src/preload/internal-preload.js` nelle pagine `filo://` (passa ogni chiamata
al main via IPC), `src/preload/page-preload.js` nelle pagine web. Lo storage è
un file JSON, `storage.json`, nella cartella dati dell'app
(`app.getPath('userData')`), che cambia da un sistema all'altro.

Un messaggio IPC nuovo:
1. si definisce in `src/shared/messages.js` (costante `MSG.*`);
2. si gestisce nel modulo di dominio giusto sotto `src/main/services/handlers/`,
   registrandolo con `on(MSG.X, fn)` (il registro sta in `handlers.js`);
3. se va dal main a tutte le pagine, parte con `broadcastToTabs` o
   `broadcastLiveUpdate` (in `handlers.js`).

## Test

```bash
npm run test:smoke     # smoke headless con screenshot (tests/.smoke/)
npm run test:unit      # unit test Node (veloci)
npm test               # suite Playwright completa (~590 spec, ~1.450 casi): non si lancia a mano, gira in GitHub a ogni fusione su main
npm run finish:check   # in locale: unit test + spec delle aree toccate dal ramo
```

La suite completa non la lancia più nessuno a mano (decisione owner
2026-09-15): gira in GitHub a ogni fusione su main, in
`.github/workflows/suite.yml` (Linux senza schermo, divisa in quattro parti che
girano insieme su macchine diverse; sugli esiti uniti `scripts/suite-verdict.mjs`
toglie dal conto i rossi noti del contenitore, `tests/rossi-noti.json`), insieme
agli unit test su Windows che rifà anche il cancello di pubblicazione, e un
rosso nuovo diventa un feedback. Ogni sei ore `release.yml` pubblica il commit
più nuovo di main con la suite verde. Per provare la suite su un ramo:
`gh workflow run suite.yml --ref <ramo>`.
Sulla macchina di chi sviluppa Filo
durerebbe quasi sette ore con un solo worker. Si lancia `npm run finish:check`,
più lo spec mirato della feature toccata (`npx playwright test
tests/<feature>.spec.mjs`). Vedi CLAUDE.md § Verifica.

## Licenza

Il codice di Filo è distribuito sotto [licenza Apache 2.0](LICENSE): puoi
usarlo, modificarlo e ridistribuirlo, anche a scopo commerciale.

Il nome «Filo» e il logo NON sono coperti dalla licenza (è la sezione 6,
"Trademarks"): un fork deve presentarsi con un altro nome. È la stessa
distinzione di Firefox o VS Code: il codice è libero, l'identità no.
