# Nuovo tipo di messaggio: decidi SUBITO se le pagine web possono chiamarlo

[← Tutti i pattern](../PATTERNS.md)

Il canale `filo:message` è **uno solo** e ci arrivano sia le pagine interne
(shell, `filo://`) sia i content script delle pagine web esterne. Registrare un
handler senza dire nulla significa **aprirlo a qualunque sito visitato**: è il
default sbagliato, e non ce ne si accorge finché qualcuno non lo cerca.

- **Domanda obbligatoria** per ogni `MSG.*` nuovo: *"ha senso che un sito
  qualsiasi lo chiami?"*. Se la risposta è no — e lo è per tutto ciò che legge
  dati dell'utente, tocca il disco, o aziona il sistema operativo — gattalo:
  ```js
  const { soloFilo } = require('./origine');
  on(MSG.X, soloFilo(async (msg) => { … }));
  ```
  (`origine.js` è la porta unica del confine: risponde `code: 'forbidden'`, così
  chi deve dirlo all'utente sa che è la provenienza e non la rete. `origin` è il
  terzo argomento dell'handler; la shell è `filo://shell/shell.html`.)
- **Due bandiere rosse** che rendono il gate non negoziabile: la risposta
  contiene **percorsi assoluti su disco** (rivelano lo username e la struttura
  del computer), oppure il comando fa **aprire/eseguire qualcosa** al sistema
  (`shell.openPath`, `showItemInFolder`, spawn). Un sito che può far aprire un
  file appena scaricato, su Windows, può farlo eseguire.
- **Documentalo dove il messaggio è definito** (`src/shared/messages.js`), non
  solo nell'handler: chi aggiunge il messaggio gemello lo vede.
- **Testalo** con un dispatch di origine web: `SN_HANDLE_MESSAGE(msg, { tab: {
  url: 'http://sito-ostile.example/' }, url: '…' })` deve dare `forbidden`, e la
  stessa chiamata da `filo://` deve passare. Esempi:
  `tests/downloads-nav.spec.mjs`, `tests/clipboard-origin-gate.spec.mjs`,
  `tests/audit-quit-app-origin.spec.mjs`.

## Il potere di proprietario passa da UNA porta, non da nove

`isAdmin()` da solo non è un gate. Sul computer di chiunque altro la risposta è
no e non succede niente; su quello dell'owner è sempre sì, ed è l'unico dove c'è
qualcosa da prendere. Il controllo che conta è l'ORIGINE, e va chiesto **prima**
dell'identità.

Il caso (#583, tre giri di verifica). L'audit ha dato il controllo di
provenienza alla porta che legge i feedback. Il secondo giro ha trovato che le
porte che li SCRIVONO non ce l'avevano, e le ha chiuse. Il terzo giro ha trovato
che nello stesso file restavano cinque porte con lo stesso potere e senza
controllo: cambiare i modelli predefiniti (che valgono per tutte le
installazioni di Filo), accendere e spegnere l'automazione, i bilanci dei giri
di correzione, i modelli dei giudici, i registri del lavoro e delle routine. Tre
giri, una porta alla volta.

La cura non è ricordarsi il gate a ogni handler:

- **Una funzione sola** che avvolge l'handler e fa i due controlli in ordine
  (origine, poi amministratore), e **ogni** handler con potere di proprietario
  ci passa. In Filo è `ownerOnly` in
  `src/main/services/handlers/auth.js`. Un handler che non ci passa si vede a
  occhio nell'elenco dei `on(MSG.…)`: `async (` invece di `ownerOnly(async (`.
- **Il rifiuto per provenienza porta il motivo in una parola** (`code:
  'forbidden'`), diverso da quello per identità (`code: 'not_admin'`). Senza,
  una pagina di Filo traduce il rifiuto in «controlla la connessione» e manda a
  guardare la cosa sbagliata.
- **Una prova che bussa a TUTTE le porte della famiglia** da un sito visitato,
  in un elenco solo: è lì che si aggiunge la porta nuova, e diventa rossa se una
  risponde qualcosa di diverso.
  (`tests/feedback-canali-origine.spec.mjs`.)

## La famiglia non è solo il proprietario

Quarto giro dello stesso feedback: chiuse le nove porte del proprietario,
restavano accanto quelle che chiedono soltanto **«hai una sessione aperta?»**.
Sul computer di chiunque sia entrato la risposta è sempre sì, quindi valgono
quanto le altre: votare in bacheca, ritirare il voto, riaprire un fix a
pagamento (che spende i crediti e apre una segnalazione a nome suo), uscire
dall'account. Quando cerchi le porte analoghe, non fermarti a `isAdmin()`:
guarda anche `isSignedIn()`.

**«Chi sei» si risponde a metà.** L'unica porta che DEVE rispondere anche a un
content script è quella dello stato dell'accesso, perché pezzi di Filo girano
dentro le pagine dei siti e da lì decidono cosa mostrare (la griglia del tasto
destro nasconde l'icona Feedback a chi non gestisce i feedback). Rispondere non
vuol dire dire tutto: di là dal confine passano i booleani che servono a
disegnare, non l'identità (indirizzo email, nome, identificativo dell'account).

## Anche quello che si MANDA passa il confine

Il confine vale nei due versi. `broadcastToTabs` raggiunge ogni frame di ogni
scheda, siti compresi (#589: la spinta `SETTINGS_UPDATED` portava a tutti le
chiavi dei servizi e le credenziali del proxy che le letture già toglievano; poi
l'intervista di benvenuto, che un sito non poteva chiedere, arrivava da sola).

Tutto quello che attraversa il confine con un sito sta in **liste di ciò che è
ammesso**, in un file solo (`src/main/services/impostazioniPerOrigine.js`):

- i **canali** su cui parla il preload delle pagine web; gli altri (schede,
  finestra, terminale) passano da `handle`/`ascolta` di `ipc.js` e rispondono
  solo alla cornice e alle pagine di Filo;
- le **domande** (tipi di `filo:message`) che il codice di Filo dentro le pagine
  fa davvero: da un sito ogni altra si rifiuta in `handleMessage`, prima di
  arrivare all'handler, anche se l'handler non ha un gate suo (#589.1: memoria,
  pagine salvate, stato della home, archivio, categorie, chiusura di altre
  schede rispondevano a qualunque sito);
- i **tipi di messaggio** spinti che raggiungono un frame non `filo://` (quelli
  che un content script ascolta); un tipo nuovo resta nelle pagine di Filo;
- i **campi delle impostazioni** che un sito riceve (risposte, letture dello
  storage, spinte) e quelli che può **scrivere** (la voce della dettatura);
- gli **scomparti del magazzino** che un sito legge, scrive o toglie;
- le **azioni di Filo** che un sito può chiedere: quelle che la barra d'aiuto
  descrive al modello e quelle che manda da sé (apri il link, solo verso
  indirizzi web). La conferma disegnata dentro la pagina la può dare anche la
  pagina: da un sito un'azione fuori lista si rifiuta, confermata o no, anche
  quando arriva da una chat aperta lì (#589, giro 6: preferenze, memoria e
  terminale).

Quattro regole valgono per tutte le liste. Un destinatario è di Filo solo se lo
è anche la **scheda** che lo contiene: l'indirizzo di un riquadro lo sceglie la
pagina, e un sito può puntarlo su `filo://`. Nell'altro verso un mittente è di
Filo solo se lo sono la scheda e la pagina che parla, e la **cornice** è la
finestra che tiene le schede: un popup di accesso aperto da un sito ha la sua
finestra tutta per sé, ma resta un sito (#589.1). Di un dato che il sito usa per un
sì o un no (i siti esclusi) gli arriva solo la parte che lo riguarda. La lista
scende **dentro le sezioni**: di una sezione ammessa passano i campi elencati, e
un campo nuovo resta a casa finché qualcuno non lo decide (#589, giro 8: un
segreto messo nella sezione della voce sarebbe arrivato a ogni sito). E ciò che
si mostra una volta sola, come un avviso, va solo al frame principale della
scheda **in primo piano**: le altre non lo mostrerebbero mai. Lo stesso per le
foto che un sito chiede: le ottiene solo il frame principale della scheda in
vista, che inquadra sé stessa; una scheda di sfondo avrebbe quella che l'utente
sta guardando.

Una domanda ammessa non arriva **oltre la scheda che la fa** (#589.1, giro 1).
Ciò che cambia quello che l'utente guarda (i tasti della barra, lo schermo
intero, una scheda o una finestra portata davanti, l'ombra del feedback, la
lettura ferma altrove) lo chiede solo la scheda in primo piano, da qualunque
suo riquadro: da una scheda di sfondo il tasto Home portava via la pagina che
l'utente stava scrivendo. E una risposta porta solo ciò che serve a chi chiede:
il premio del feedback dice la cifra, non il saldo; la foto della barra in alto,
che mostra i titoli delle altre schede, un sito la riceve solo mentre l'utente
ci ha disegnato sopra per un feedback.

Una domanda che il codice di Filo fa solo **dopo un gesto dell'utente** vuole il
gesto anche nel main (#589.1, giro 2). Incolla e Detta si danno il permesso
breve di appunti e microfono, Salva per dopo scrive nella lista, il dizionario,
le correzioni e la disposizione del menu si scrivono dopo un clic: da un sito
senza gesto il permesso leggeva la password copiata, mille salvataggi da una
scheda di sfondo spingevano fuori tutte le pagine salvate, e una richiesta
cancellava dizionario e menu. Il gesto è quello vero, visto dal main
(`seguiGesti` in `permessiPagine.js`): un clic o un tasto nella pagina, il
tasto destro o un tasto anche dentro un riquadro di un altro sito, dove il clic
sinistro non arriva. Per questo il margine è largo, venti secondi: copre la
scelta dal menu aperto col tasto destro in un riquadro. I salvataggi sono **uno
per gesto**: la lista tiene le ultime mille. E la risposta a un sito dice dove
è finita la pagina, non il titolo o la miniatura della voce che c'era già. Una
domanda nuova di questo genere entra in `DOMANDE_WEB_COL_GESTO`, uno scomparto
in `CHIAVI_STORAGE_WEB_COL_GESTO`.

Ogni spinta che gira su più schede o finestre passa da `spingiAllaScheda` /
`spingiAllaFinestra` di quel file, o si limita da sé alle superfici di Filo: una
strada parallela (l'avviso dei dati dal vivo, quello degli scaricamenti, lo
schermo intero) scavalcava la lista, e un popup di accesso è una finestra che
contiene un sito (#589, giro 7).

Un content script che comincia ad ascoltare una spinta, fare una domanda,
leggere un campo o usare uno scomparto nuovo lo aggiunge lì: le sentinelle di
`tests/unit/impostazioniPerOrigine.test.mjs` e `tests/unit/domandeDaiSiti.test.mjs`
diventano rosse finché non lo fa, invece di lasciarlo spegnere in silenzio solo
sui siti; e una domanda che nessuno fa più va tolta. La prova dal vero parla dal
mondo isolato del preload di un sito (`tests/domande-dai-siti.spec.mjs`). Un dato che un sito non
deve vedere affatto può andare anche con `broadcastToFiloPages`, che lo dice
esplicitamente.
