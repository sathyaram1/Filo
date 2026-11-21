# Un file del computer in una scheda vive in una sessione sua

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Un file locale si apre in una scheda solo in una sessione `file-del-computer:<n>` tutta sua, dove Filo
serve da sé ogni richiesta `file:` (`protocol.handle`): passa solo ciò che la scheda ha avuto in concessione, e a ogni
risposta, di qualunque tipo, va una CSP che toglie `file:` a fetch, XHR, riquadri e worker. La concessione è della
scheda e si toglie quando si chiude. Mai un `file://` in un'altra sessione, nemmeno in quella del proxy.

Cosa si concede: la cartella del file, con le sottocartelle, senza file o cartelle nascoste e solo tipi da pagina
(immagini, stili, script, caratteri, media). Se quella cartella è la casa, una che la contiene o la radice di un
disco, solo il file e i file che nomina.

## Perché

Electron, con la sua impostazione di fabbrica (`GrantFileProtocolExtraPrivileges` acceso), lascia a una pagina
`file://` leggere con `fetch` qualunque file del disco: provato nel lavoro di #1905, una pagina locale leggeva un
file di un'altra cartella e poteva mandarlo fuori. Un browser non lo permette, e un HTML scaricato da internet aperto
in Filo diventerebbe un ladro di file. In più un `file://server/...` su Windows consegna l'hash NTLM: nella sessione
sua quella richiesta non parte nemmeno.

Il confine è la cartella, non il file, perché una pagina locale vera (un report, un sito salvato) si porta dietro
immagini, stili e script accanto a sé. Leggerli come dati resta chiuso: la CSP ferma fetch e XHR, e i riquadri
`file:` non si caricano. La CSP va su tutto perché anche un `.xml` nel namespace XHTML, o un file senza estensione
che Chromium riconosce come HTML, esegue script (controllo di sicurezza di #1905).

## Chi decide se si apre

La sessione non giudica la provenienza. Quella la decide chi apre, prima di `openTab(..., { fileDelComputer: true })`:
il percorso scritto dall'utente in chat, un suo clic su una pagina di Filo, la sua sessione salvata o le sue schede
chiuse. Un percorso che l'utente non ha scritto passa dal suo OK (costo 2 di NAVIGA). Il percorso di rete lo ferma
`concedi`, la porta comune di tutte le strade.

## Una pagina del computer chiede come un sito

Aperta, la pagina locale esegue script e ha il preload delle pagine, Aiuto compreso: per il main è un sito. I cancelli
che distinguono «da un sito» da «da Filo» (memoria, conversazioni, fonti del compito, segnalazioni fidate, «questo
sito», porta delle uscite) chiedono a `daPaginaNonDiFilo` in `src/main/services/handlers/origine.js`, mai allo schema
`http(s):` di chi manda: con quel test un `file://` passava per Filo (controllo di sicurezza di #1905). Sentinella in
`tests/unit/fileDelComputer.test.mjs`.

Codice: `src/main/services/fileDelComputer.js`; prove: `tests/file-del-computer.spec.mjs`,
`tests/unit/fileDelComputer.test.mjs`.
