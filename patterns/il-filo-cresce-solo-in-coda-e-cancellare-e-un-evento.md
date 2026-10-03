# Il filo cresce solo in coda, e cancellare è un evento

[← Tutti i pattern](../PATTERNS.md)

La linea del tempo di Filo (chat della home, pagine visitate, e ciò che entrerà dopo) è un file suo, scritto
**solo in coda** e **da un modulo solo** (`src/main/services/ilFilo.js`). Ogni riga è un evento intero con id,
ora, dispositivo, autore e tipo. Una cancellazione è anche lei una riga in coda, e subito dopo il file si
riscrive **senza le righe che copre e con tutte le altre identiche**. Dall'incognito niente arriva su disco.
Nessun tetto e nessun taglio.

## Perché

- **Lo stato non sta in `storage.json`.** Quel file si riscrive per intero a ogni salvataggio (e con 100 ms di
  ritardo): con anni di chat ogni messaggio costava la riscrittura di megabyte, e un'app chiusa di colpo perdeva
  l'ultimo decimo di secondo. Un'aggiunta in coda costa uguale con 10 eventi o con 50.000, e arriva sul disco
  prima che il turno prosegua (`datasync`).
- **La forma a sola aggiunta con id stabili è quella che si sincronizza.** Due dispositivi che si scambiano
  eventi non litigano: un id già visto si salta (`applica` in `src/shared/filoEventi.js`), quindi import e
  migrazione si possono ripetere senza doppioni.
- **Cancellare deve essere vero.** Un registro che segna «cancellato» e lascia il testo sul disco mente
  all'utente. La riga di cancellazione resta (un altro dispositivo dovrà saperla), il contenuto se ne va.
  Se l'app muore fra le due cose, la partenza dopo finisce il lavoro.
- **Una cancellazione vale per il tempo che dice, non per l'ordine di arrivo.** Copre le pagine aperte prima
  di lei nel suo periodo (e del suo sito, se ne nomina uno), anche quelle che arrivano dopo: una visita
  ancora in caricamento, un import, un altro dispositivo. «Tutto» è tutto fino a quel momento: un backup
  importato non porta via le pagine visitate dopo.
- **L'incognito ha un filo in memoria.** La garanzia di `src/main/shim/storage.js` (overlay in RAM) vale solo
  per chi passa da lì: un file scritto per conto proprio la romperebbe. Il filo decide l'incognito alla
  richiesta (contesto dell'IPC, o la finestra per le pagine visitate) e tiene quell'altro filo in RAM fino
  alla chiusura dell'ultima finestra incognito.
- **Una visita è una voce nuova della cronologia della scheda.** Ricaricare, cambiare il frammento, riaprire le
  schede di prima o riscrivere la propria voce (una mappa spostata, un filtro) non è una pagina nuova; una pagina
  nuova dentro la stessa (un video dopo l'altro) sì. Sentinella `tests/unit/visiteSchede.test.mjs`.
- **Il titolo di una visita segue la pagina.** Le app web lo scrivono dopo il caricamento, o passano da
  «Caricamento…» al nome vero: il titolo nuovo è un evento in coda (`navigazione.titolo`) quando resta fermo un
  attimo, subito nel primo mezzo minuto e poi all'uscita dalla pagina, così un titolo che cambia di continuo non
  riempie il filo. Se ne va con la sua pagina.
- **Una chat cancellata sparisce anche dalle sue copie**: registro grezzo, cache delle risposte e richieste ai
  modelli (che restano coi costi, senza il testo). Sentinella `tests/unit/chatCopieCancellate.test.mjs`.
- **Un tetto è una cancellazione automatica.** Il vecchio registro grezzo (5000 voci, testi a 200 caratteri)
  è esattamente il taglio silenzioso che le regole del repo vietano.

## Come si usa

- Una funzione nuova che vuole lasciare traccia nel filo aggiunge un **tipo** in `TIPI` e la sua piegatura in
  `applica`; non apre file suoi. Un tipo che una versione non conosce resta su disco e si salta in lettura.
- Leggere-decidere-scrivere passa da `transazione`: due schede che chattano insieme non si mangiano un messaggio.
- Il profilo segreto aprirà un'istanza sua con `creaFilo({ cartella })`, che non vede questa.
- Titoli e indirizzi delle pagine visitate li scrivono i siti: chi li porta in un prompt li imbusta come contenuto
  esterno ([Il canale fidato non trasporta testo di fuori](il-canale-fidato-non-trasporta-testo-di-fuori.md)), e
  chi li mostra li scrive come testo, mai come markup.

Sentinella: `tests/unit/filoEventi.test.mjs` (formato, sola aggiunta, cancellazione byte per byte, incognito,
migrazione, nessun tetto, velocità con 50.000 eventi). Prove dell'app: `tests/filo-linea-del-tempo.spec.mjs`.
