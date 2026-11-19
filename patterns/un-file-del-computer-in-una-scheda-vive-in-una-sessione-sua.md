# Un file del computer in una scheda vive in una sessione sua

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Un file locale si apre in una scheda solo nella sessione `file-del-computer`, dove Filo serve da sé ogni
richiesta `file:` (`protocol.handle`): passa solo ciò che sta nella cartella di un file che l'utente ha aperto, e ai
documenti va una CSP che toglie `file:` a fetch, XHR, riquadri e worker. Mai un `file://` in un'altra sessione.

## Perché

Electron, con la sua impostazione di fabbrica (`GrantFileProtocolExtraPrivileges` acceso), lascia a una pagina
`file://` leggere con `fetch` qualunque file del disco: provato nel lavoro di #1905, una pagina locale leggeva un
file di un'altra cartella e poteva mandarlo fuori. Un browser non lo permette, e un HTML scaricato da internet aperto
in Filo diventerebbe un ladro di file. In più un `file://server/...` su Windows consegna l'hash NTLM: nella sessione
sua quella richiesta non parte nemmeno.

Il confine è la cartella, non il file, perché una pagina locale vera (un report, un sito salvato) si porta dietro
immagini, stili e script accanto a sé. Leggerli come dati resta chiuso: la CSP ferma fetch e XHR, e i riquadri
`file:` non si caricano.

## Chi decide se si apre

La sessione non giudica la provenienza. Quella la decide chi apre, prima di `openTab(..., { fileDelComputer: true })`:
il percorso scritto dall'utente in chat, un suo clic su una pagina di Filo, la sua sessione salvata o le sue schede
chiuse. Un percorso che l'utente non ha scritto passa dal suo OK (costo 2 di NAVIGA).

Codice: `src/main/services/fileDelComputer.js`; prove: `tests/file-del-computer.spec.mjs`,
`tests/unit/fileDelComputer.test.mjs`.
