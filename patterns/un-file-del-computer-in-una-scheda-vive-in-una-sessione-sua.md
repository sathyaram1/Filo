# Un file del computer in una scheda vive in una sessione sua

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Un file locale si apre in una scheda solo in una sessione `file-del-computer:<n>` tutta sua, dove Filo
serve da sé ogni richiesta `file:` (`protocol.handle`): passa solo ciò che la scheda ha avuto in concessione, e a ogni
risposta, di qualunque tipo, va una CSP che carica solo `file:`, `data:` e `blob:`. La concessione è della scheda e si
toglie quando si chiude. Mai un `file://` in un'altra sessione, nemmeno in quella del proxy.

Cosa si concede: la cartella del file, con le sottocartelle, senza file o cartelle nascoste e solo tipi da pagina
(immagini, stili, script, caratteri, media). Se quella cartella è la casa, una che la contiene o la radice di un
disco, solo il file e i file che nomina. Conta il percorso vero: un collegamento simbolico vale per il file a cui
punta, e il nome e il file vero devono passare tutti e due.

## La pagina del computer non ha rete

Quello che una pagina legge non deve avere dove andare. Tre strati, perché ognuno ha buchi che l'altro chiude:

- la CSP: niente `http(s):` né `ws(s):` per nessun tipo di risorsa, niente riquadri, worker né invii di moduli;
- la sessione: `onBeforeRequest` annulla ogni richiesta web, e un proxy che non risponde (anche per il loopback)
  prende preconnessioni e WebRTC, che la CSP non vede; WebRTC solo via proxy (`_applySecurity` in `tabs.js`);
- i salti: `will-navigate` e `setWindowOpenHandler` in `tabs.js` fermano ogni indirizzo web chiesto da una pagina
  della sessione, clic dell'utente compreso, perché l'indirizzo lo scrive la pagina e può portare i dati.

Ogni rifiuto lo dice una volta per pagina (`_senzaRete`: la CSP lo riferisce dal preload, i salti dal main). Non c'è
un «Apri con la rete»: scelta dell'owner, per ora.

## Il contenuto dei file accanto resta chiuso, come in un browser

Immagini, stili e script della cartella si vedono e girano, ma la pagina non ne legge il contenuto: la tela si sporca,
le regole CSS non si leggono, gli errori degli script arrivano come «Script error.» (#1905.1). Lo fa il fusibile
`GrantFileProtocolExtraPrivileges` spento (`scripts/lib/fusibili-electron.js`): con quello acceso la pagina è della
stessa origine dei suoi file e legge tutto. Una CSP `sandbox` non basta: in un'origine opaca Chromium non mostra
più le immagini `file:` (provato in #1905). In più `nosniff` su ogni risposta: un `.txt` o un `.json` non gira come
script, così le sue righe non diventano variabili della pagina.

Il fusibile è del binario, non della sessione, e va spento dappertutto:

- nel pacchetto, in `scripts/after-pack.js`, su ogni sistema e su ogni copia, prima della firma del Mac e del
  lanciatore di Linux; un binario senza filo ferma la costruzione;
- nelle prove, dal globalSetup: sul posto se `node_modules/electron` è di questo checkout, altrimenti (i cloni delle
  routine usano i moduli della cartella della sessione) una copia spenta in `node_modules/.cache/` del checkout, passata con
  `ELECTRON_OVERRIDE_DIST_PATH`; sul Mac la copia o il binario modificato si rifirmano in locale;
- in `npm start`, dal prestart, sul posto.

Un motore rimasto acceso (un `test:shoot` fuori da Playwright) non apre buchi verso fuori: la rete che manca resta, e
per questo nessuno dei tre strati si toglie.

## Perché

Electron, con la sua impostazione di fabbrica (`GrantFileProtocolExtraPrivileges` acceso), lascia a una pagina
`file://` leggere con `fetch` qualunque file del disco: provato nel lavoro di #1905, una pagina locale leggeva un
file di un'altra cartella e poteva mandarlo fuori. Un browser non lo permette, e un HTML scaricato da internet aperto
in Filo diventerebbe un ladro di file. In più un `file://server/...` su Windows consegna l'hash NTLM: nella sessione
sua quella richiesta non parte nemmeno.

Il confine è la cartella, non il file, perché una pagina locale vera (un report, un sito salvato) si porta dietro
immagini, stili e script accanto a sé. Fetch e XHR non li leggono come dati, la tela non li legge (#1905.1), e la
rete non c'è comunque (controllo di sicurezza di #1905). La CSP va su tutto perché anche un `.xml` nel namespace XHTML, o un file senza estensione
che Chromium riconosce come HTML, esegue script (controllo di sicurezza di #1905).

## Chi decide se si apre

La sessione non giudica la provenienza. Quella la decide chi apre, prima di `openTab(..., { fileDelComputer: true })`:
il percorso scritto dall'utente in chat, un suo clic su una pagina di Filo, la sua sessione salvata, le sue schede
chiuse (pila, archivio, «Riapri» della pulizia) o la copia di una sua scheda di file (Duplica). Un percorso che l'utente non ha scritto passa dal suo OK (costo 2 di NAVIGA). Il percorso di rete lo ferma
`concedi`, la porta comune di tutte le strade.

## Una pagina del computer chiede come un sito

Aperta, la pagina locale esegue script e ha il preload delle pagine, Aiuto compreso: per il main è un sito. I cancelli
che distinguono «da un sito» da «da Filo» (memoria, conversazioni, fonti del compito, segnalazioni fidate, «questo
sito», porta delle uscite) chiedono a `daPaginaNonDiFilo` in `src/main/services/handlers/origine.js`, mai allo schema
`http(s):` di chi manda: con quel test un `file://` passava per Filo (controllo di sicurezza di #1905). Sentinella in
`tests/unit/fileDelComputer.test.mjs`.

Codice: `src/main/services/fileDelComputer.js`; prove: `tests/file-del-computer.spec.mjs`,
`tests/unit/fileDelComputer.test.mjs`.
