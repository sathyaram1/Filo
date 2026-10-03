# Un pezzo di Filo dentro un sito ubbidisce solo all'utente

[← Tutti i pattern](../PATTERNS.md)

Il menu del tasto destro, i riquadri, la barra d'aiuto vivono nel documento del
sito. Il mondo isolato tiene separati gli oggetti JavaScript, **non il DOM**: lo
script della pagina raggiunge i nostri nodi come raggiunge i suoi, ci fabbrica
sopra clic, passaggi e tasti, e legge il testo che ci scriviamo.

Il caso (#589.8): copiata una password, l'utente apre un sito e clicca un suo
pulsante. Il sito manda alla sua casella un tasto destro creato da script, preme
da script la freccia di Incolla e legge la cronologia degli appunti dal
sottomenu. Può nascondere il menu e toglierlo subito: l'utente non vede niente.
Il controllo del main sul gesto recente non bastava, perché un gesto vero c'era:
il clic sul pulsante del sito.

## Le due regole

1. **Solo gesti veri.** Ogni ingresso accetta solo eventi `isTrusted`:
   - il tasto destro che apre il menu, nel ponte del page-preload (vale anche nei
     riquadri incorporati, dove il ponte rigioca il clic);
   - clic, passaggi, tasti, rotella sulle voci: `SN_FILO_UI.soloGestiVeri(el)`
     sulla radice di ogni pezzo attaccato al documento, **per primo**, appena il
     nodo nasce (`src/shared/filoUi.js`);
   - un ascoltatore su `window`/`document` che fa qualcosa di più che chiudere
     (il trascinamento delle icone) guarda `e.isTrusted` da sé, come fa già il
     cartellino dello zoom (`gestoVero` in `src/preload/wheel-zoom.js`).

   Un'azione nostra che apre un pannello chiama la funzione, non `el.click()`:
   il clic fabbricato da codice nostro è identico a quello del sito, e il
   cancello lo ferma (`apritori` in `src/content/menu.js`).

   Eccezioni volute: **chiudere** resta aperto ai finti (l'Esc che Filo rimette
   in circolo per lo schermo intero, #514, non è fidato e deve chiudere il menu;
   chiudere non dà niente al sito). Sulle pagine `filo://` il codice è tutto
   nostro: lì il menu si apre anche da un evento fabbricato, e gli spec lo usano.

2. **Quello che non è del sito non entra nel suo documento come testo.** La
   cronologia degli appunti arriva da altri siti e da altre app, password
   comprese: anche aperta dall'utente, il sito non deve poterla leggere. Sta in
   uno shadow root `closed`, e nel documento c'è solo un host vuoto. I fogli di
   stile del documento lì dentro non arrivano: si portano i nostri con
   `adoptedStyleSheets` (che la CSP del sito non blocca, un `<style>` sì). Stesso
   schema del dialogo di conferma (#249, `src/shared/confirmUi.js`).

   Lo shadow chiuso ferma `innerHTML`, la selezione e `getComputedStyle`, **ma
   non `window.find`**: la ricerca testuale del browser attraversa anche lo
   shadow chiuso e, interrogata lettera per lettera da uno script, ricostruisce
   un **nodo di testo** parola per parola (#589.8, il buco che la sola scatola
   chiusa lasciava aperto). La regola unica: il testo di una voce **non diventa
   mai un nodo di testo** nel documento. Lo si rende come **contenuto generato**
   (`::before { content: var(--sn-gentesto) }`) da una proprietà posata
   sull'elemento dentro lo shadow chiuso — glifi, non testo cercabile — e il nome
   accessibile sta in un **attributo** (`aria-label`), che la ricerca non trova e
   che il sito non legge oltre il confine dello shadow chiuso. `window.find` non
   guarda dentro il contenuto generato; così nessuna strada del sito (find,
   `innerHTML`, selezione, `getComputedStyle`) vede i caratteri. Un dato privato
   nuovo nel menu segue la stessa regola: niente nodo di testo.

Il resto del menu resta nel documento: non porta dati di altri siti, e una
settantina di spec lo guarda coi locator. Se un giorno ci entra un dato privato
(appunti, password, cose di un'altra scheda), entra in un pannello chiuso.

## Provarlo

I locator non attraversano uno shadow root chiuso, e il testo non è un nodo ma
contenuto generato. Lo stato del pannello si chiede a `SN_MENU._test.cronologia()`
nel mondo dei content script (isolato sui siti, la pagina stessa su `filo://`)
con `tests/helpers/cronologiaAppunti.mjs`: il testo di ogni voce lo legge
dall'`aria-label`, non dal nodo. I clic sono quelli veri del mouse sulle
coordinate che l'hook restituisce. Sui siti la pagina non vede l'hook: vive nel
mondo isolato.

La prova dell'attacco sta in `tests/menu-solo-gesti-veri.spec.mjs`: lo script
del sito fa tutto da sé dentro il clic dell'utente, anche da un riquadro di un
altro sito, e la cronologia non gli arriva; a cronologia aperta dall'utente la
ricerca testuale del browser, interrogata lettera per lettera, non ricostruisce
il testo, che l'utente intanto vede e incolla.

## Limite noto

Un sito controlla lo stile dei nodi che stanno nel suo documento: può nascondere
o coprire il menu e far cliccare all'utente un punto che non vede. È un gesto
vero, quindi passa. Il cancello chiude le strade senza l'utente, non il raggiro.
