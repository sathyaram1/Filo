# Un archivio che cresce sta in file suoi, a sole aggiunte

[← Tutti i pattern](../PATTERNS.md)

`storage.json` è un file unico che si riscrive per intero a ogni modifica di
qualunque chiave. Un archivio che cresce per anni lì dentro rende più lenta
ogni scrittura di Filo, voce dopo voce. L'archivio delle schede ci stava, e
per tenerlo piccolo aveva due tetti ereditati dai 10 MB di
`chrome.storage.local` (che in Filo non esistono): oltre 5000 schede si
tagliavano le più vecchie, oltre le ultime 2000 si toglievano i vettori. Le
schede sparivano senza avviso, e ogni ricerca ripagava l'indicizzazione dei
vettori appena tolti (#825).

- **Ciò che cresce con l'uso** (schede chiuse, chat, registri) non vive in una
  chiave di `chrome.storage.local`. Si usa `creaDeposito`
  (`src/main/services/depositoAggiunte.js`) con una cartella propria sotto la
  cartella dati (`app.getPath('userData')`, `$FILO_USER_DATA` nei test).
- **Aggiungere e aggiornare accodano una riga** a un file per mese. Costano uguale
  con dieci voci o centomila, e dopo un arresto quello che era già scritto c'è.
  Una riga troncata non si incolla alla successiva: al caricamento il file
  riprende da capo riga.
- **Cancellare riscrive solo i mesi toccati** (file temporaneo e rinomina), senza
  la voce e senza le sue righe di aggiornamento: il dato sparisce davvero dal
  disco. Se altre voci contengono un rimando a quella cancellata (per le schede
  sono gli indirizzi delle «aperte insieme»), il rimando si toglie nella stessa
  riscrittura.
- **Nessun tetto.** Se un limite serve davvero, deve essere alto e avvisare chi
  manda (CLAUDE.md § Limiti).
- **Un dato derivato che costa** (riassunto, vettore) si salva con la voce e dura
  quanto lei. Se lo si pota per risparmiare spazio, la lettura dopo lo ripaga.
  La ricerca calcola solo quello che manca, tutto nella stessa corsa e senza un
  tetto per ricerca.
- **L'incognito va rifatto a mano.** `storage.json` lo garantisce con
  l'allowlist fail-closed; un file proprio no. Ogni funzione pubblica chiede
  `inIncognito()` allo shim (`src/main/shim/storage.js`): se la chiamata arriva
  dall'incognito, non legge e non scrive.
- **Migrazione dalla chiave vecchia.** Il deposito si apre solo fuori
  dall'incognito, perché lì la vista di `storage.json` è vuota. Le voci si
  scrivono nei file nuovi e solo dopo si toglie la chiave: se un arresto
  interrompe la migrazione, all'avvio dopo si rifà, e gli id già presenti non si
  duplicano.
- **Le strade «tutti i dati» lo devono includere.** Esporta e Importa
  (`EXPORT_DATA`, `IMPORT_DATA_APPLY` in `handlers/storage.js`) rimettono
  l'archivio sotto la sua chiave di sempre, così i backup vecchi e nuovi si
  leggono uguali. `chrome.storage.local.clear()` (shim del main) svuota anche
  il deposito.
- **Dove:** `src/main/services/archivedTabs.js`. Prove:
  `tests/unit/depositoAggiunte.test.mjs`, `tests/unit/archivedTabsStore.test.mjs`,
  `tests/archive-store-unlimited.spec.mjs`.
