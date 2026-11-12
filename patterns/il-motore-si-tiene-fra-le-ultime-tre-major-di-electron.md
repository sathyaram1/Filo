# Il motore si tiene fra le ultime tre major di Electron

[← Tutti i pattern](../PATTERNS.md)

Electron porta il Chromium che apre ogni pagina, e corregge le falle solo nelle ultime tre major stabili; ne esce una
ogni otto settimane. Filo è rimasto sulla 33 diciassette mesi dopo la fine del suo supporto (#1068), e le schede web
girano senza la gabbia di Chromium (#834): una falla pubblica del motore bastava a una pagina qualunque. Da allora
`tests/unit/electronSupportato.test.mjs` diventa rossa quando la major del lockfile esce dalle ultime tre, e a ogni
salto si alzano lì `MAJOR` e `USCITA_STABILE`.

## Cosa guardare nel salto

- **L'elenco ufficiale dei cambi**: `docs/breaking-changes.md` nel repo di Electron, una sezione per major. Si leggono
  tutte quelle fra la vecchia e la nuova, non solo l'ultima.
- **Quello che è sparito dalle firme**: prima di installare si copia `node_modules/electron/electron.d.ts`, dopo si
  confrontano i nomi dei metodi e degli eventi; un nome sparito che Filo usa è una rottura sicura.
- **Le sentinelle che diventano rosse apposta**: `tests/unit/permessiPagine.test.mjs` per ogni nome di permesso nuovo
  (si decide se chiederlo, concederlo o negarlo, con la regola scritta in `src/main/services/permessiPagine.js`), e
  questa.
- **Il binario**: dalla 42 `npm install` non lo scarica più, lo scarica `require('electron')` al primo uso. Nel
  contenitore delle routine il download di Electron non passa dal proxy: `node scripts/ensure-electron.mjs`.
- **Dopo il salto, chi non reinstalla prova sul motore vecchio**: le prove scritte per il nuovo diventano rosse e
  sembrano regressioni (#1141.5: il visore PDF «non compare» su Electron 33). Per questo ogni corsa di Playwright,
  `test:smoke`, `test:shoot` e `test:explore` si fermano se il motore installato non è quello del lockfile
  (`tests/helpers/motoreDelleProve.mjs`); un binario scelto con `ELECTRON_OVERRIDE_DIST_PATH` lo dicono e proseguono.

## Le patch della stessa major

Le correzioni di Chromium arrivano nelle patch di Electron (dalla 44.7.0 alla 44.9.3, in due settimane, più di cento
correzioni di Chromium, V8 e PDFium), e quasi mai diventano un avviso sul pacchetto npm: gli avvisi di Dependabot non le
vedono. Il lockfile le ferma, perché la pubblicazione installa con `npm ci`. Ogni sei ore, nel lavoro `scegli` della
pubblicazione, `scripts/motore-ultima-patch.mjs` confronta il lockfile con l'ultima stabile della stessa major
(`npm view electron@<major> version --json`) e, se è indietro, apre un feedback con una chiave per major
(`motore:electron-44`): finché è aperto, le patch uscite dopo non ne aprono un altro. Avvisa e non ferma: una
pubblicazione ferma non toglie il motore vecchio a nessuno, lascia i tester sull'ultima uscita col motore vecchio e senza
le correzioni di Filo. Rete giù o risposta illeggibile: un avviso nel registro e la corsa prosegue.

- **Il salto**: `npm install --save-dev electron@<ultima>`, in cloud il binario con `node scripts/ensure-electron.mjs`.
- **I cambi fra le due versioni**: da qui le note delle release di Electron su GitHub non si leggono, la storia del ramo
  sì: `git clone --bare --filter=blob:none --single-branch --branch 44-x-y --shallow-since=<data della vecchia>
  https://github.com/electron/electron` e `git log`. Le righe `fix:` e `feat:` sono quelle da leggere.
- **Anche una minor cambia comportamenti**: dalla 44.9.0 un collegamento aperto con Ctrl, Maiuscolo o il tasto centrale
  passa dal gestore delle finestre come un `window.open()`, e `createWindow` riceve sempre `options.webContents`
  (prima per i collegamenti arrivava senza). Si lanciano gli spec delle aree che una riga `fix:` tocca.

## Cosa si è rotto da 33 a 44

- **Gli appunti nel main sono asincroni** (44): `readText`/`writeText` rendono una Promise, `readImage` e gli altri
  lettori dedicati non ci sono più (si legge con `clipboard.read()` e il tipo MIME). Una lettura senza `await` dà un
  oggetto e sbaglia in silenzio: sentinella `tests/unit/appuntiDelMain.test.mjs`.
- **La prima finestra arriva vuota a Playwright** (44): si prende con `primaFinestra(app)`
  (`tests/helpers/primaFinestra.mjs`), mai con `firstWindow()` nudo.
- **Su Linux, in una sessione Wayland, Chromium parte su Wayland** (38): il lanciatore del pacchetto lo riporta su X,
  vedi [Mac e Linux si rompono in silenzio](mac-e-linux-si-rompono-in-silenzio.md).
- **Il visore dei PDF non è più un webContents a sé** (41): i suoi tasti arrivano già alla scheda.
- **I numeri italiani a quattro cifre perdono il punto** (44, dati di ICU più nuovi): `Intl` scrive 4990 invece di
  4.990. Ogni numero formattato in italiano chiede `useGrouping: true`; sentinella `tests/unit/numeriItaliani.test.mjs`.
- **`input-event` dice il tasto del mouse in `button`**, non più fra i modificatori: si legge con `tastoPremuto`
  (`src/main/tastoDelMouse.js`).
- **`cookies.get({ url })` restituisce anche i cookie partizionati**, e nessun campo li distingue: li distingue una
  scrittura, perché un set già scaduto toglie solo il cookie normale (`src/main/services/cookieIncorporati.js`).
- **Le prove**: una finestra tutta fuori schermo smette di disegnare (le finestre nascoste dei test chiedono
  `disable-frame-rate-limit`); senza scheda grafica non c'è WebGL (nei test `enable-unsafe-swiftshader`); la lista
  HSTS di Chromium cresce a ogni versione e un nome vero servito in http da una rete finta (bing.com, youtube.com,
  bbc.co.uk) si apre solo in https: nelle prove si usano nomi inventati, o un server https locale come in
  `tests/ad-skip.spec.mjs`; le regole di un foglio di stile di un'altra origine `filo://` non si leggono più, si
  guarda lo stile calcolato.

## Cosa non si prova da qui

Le notifiche di sistema su Mac passano dalla 42 a un'API che vuole l'app firmata (Filo è firmato solo in locale), la
44 vuole almeno macOS 13 e non esce più per Windows a 32 bit. Nel report si dichiara.
