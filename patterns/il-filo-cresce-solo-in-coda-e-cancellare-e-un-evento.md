# Il filo cresce solo in coda, e cancellare è un evento

[← Tutti i pattern](../PATTERNS.md)

La linea del tempo di Filo (chat della home, pagine visitate, e ciò che entrerà dopo) è un file suo, scritto
**solo in coda** e **da un modulo solo** (`src/main/services/ilFilo.js`). Ogni riga è un evento intero con id,
ora, dispositivo, autore e tipo. Una cancellazione è anche lei una riga in coda, e subito dopo il file si
riscrive **senza le righe che copre e con tutte le altre identiche**. Dall'incognito niente arriva su disco.
Nessun tetto e nessun taglio su messaggi e numero di eventi: l'unica misura tocca indirizzo e titolo che scrive una
pagina, ed è segnata accanto.

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
  modelli (che restano coi costi, senza il testo), anche dove il testo è riscritto su una riga o tagliato in testa o in coda. Sentinella `tests/unit/chatCopieCancellate.test.mjs`.
- **Nascondere una chat è un evento, non una cancellazione** (`chat.nascosta`, #1295): «cancella questa chat» a
  parole la nasconde e si rimette; il testo resta. `chats()` e la coda della home non la danno a chi non la chiede
  (`{ nascoste: true }` tutte, `'solo'` quelle), così esce dalla home, dal contesto di Filo e dai ricordi in un posto
  solo. Cancellarla per sempre resta la `cancellazione` di sopra.
- **Un tetto è una cancellazione automatica.** Il vecchio registro grezzo (5000 voci, testi a 200 caratteri)
  è esattamente il taglio silenzioso che le regole del repo vietano.
- **Una pagina non scrive il filo da sola** (#1525). Una visita nuova chiede un gesto: un input vero sulla scheda
  negli ultimi 5 s, o una navigazione chiesta a Filo (barra, indietro e avanti, preferiti, agente). Il gesto vale per
  la navigazione che lo segue, non per i cambi che la pagina fa dopo. Senza gesto un cambio entro 5 s dal precedente
  resta la visita aperta: in attesa ne segue l'indirizzo, già scritta assorbe un cambio dentro la pagina. Una pagina
  intera dopo una visita già scritta (un rinvio del sito, un accesso che passa da tre indirizzi) resta una visita sua,
  o il filo perderebbe dove l'utente è arrivato. Dopo 30 visite di fila senza gesto tutto resta una visita finché
  l'utente non tocca la scheda, per i cambi dentro la pagina e per le pagine intere. Sentinella
  `tests/unit/visiteSchede.test.mjs`.
- **Indirizzo e titolo hanno una misura**: 8192 e 1024 caratteri (`src/main/services/misurePagine.js`, la stessa
  per l'archivio delle schede chiuse). Li sceglie il sito, e una riga da megabyte a ogni visita farebbe un file che
  non si legge più. Il taglio si segna (`urlTagliato`, `titoloTagliato`), e un indirizzo tagliato non si offre da
  riaprire come intero: si apre il suo sito (`SN_FILO_CODA.daAprire`, e al modello va il sito detto come tale).
- **Il file si legge a righe, mai intero in una stringa** (`src/main/services/leggiARighe.js`), anche nella
  compattazione, che scrive il temporaneo a pezzi: oltre il tetto di una stringa di V8 il filo non si aprirebbe più.
  Se il file non si legge, chi scrive riceve un rifiuto e l'utente un toast con la causa; chi legge soltanto vede il
  filo vuoto, e la richiesta dopo riprova. Sopra 256 MB un avviso per avvio porta alla Sicurezza, dove le pagine si
  cancellano per periodo: non è un tetto.

## Come si usa

- Una funzione nuova che vuole lasciare traccia nel filo aggiunge un **tipo** in `TIPI` e la sua piegatura in
  `applica`; non apre file suoi. Un tipo che una versione non conosce resta su disco e si salta in lettura.
- Leggere-decidere-scrivere passa da `transazione`: due schede che chattano insieme non si mangiano un messaggio.
- Il profilo segreto aprirà un'istanza sua con `creaFilo({ cartella })`, che non vede questa.
- Titoli e indirizzi delle pagine visitate li scrivono i siti: chi li porta in un prompt li imbusta come contenuto
  esterno ([Il canale fidato non trasporta testo di fuori](il-canale-fidato-non-trasporta-testo-di-fuori.md)), e
  chi li mostra li scrive come testo, mai come markup.

## Le chat delle altre app entrano ripiegate

**La regola.** Una chat con Filo che vive in un'app (Editor, Mazzi, Aiuto sopra un sito) scrive ogni messaggio
nel filo passando da un punto solo: `annota` in `src/main/services/conversazioniApp.js`, o il messaggio
`FILO_CONVERSAZIONE_APP` dalla pagina. Nel filo la conversazione è una chat con `app`, `rif` e `soggetto`; nella
home e al modello è **una riga** («4 messaggi nell'Editor su tesi»), e lo scambio si apre o si rilegge con
CERCA_CHAT e l'id. Una chat nuova lo eredita con una voce in `APP` di `src/shared/filoApp.js` e una chiamata.

### Perché (#974, D57 «dentro ripiegate»)

- Senza, la home non sapeva cosa l'utente aveva chiesto nell'Editor un'ora prima. Metterle dentro per intero
  avrebbe affollato il filo e fatto crescere il costo di ogni messaggio della home: al modello va la riga, all'ora
  in cui la conversazione è cominciata, e i ricordi non la ripescano (`tratti` la salta).
- Essere chat del filo le dà gratis quello che le chat hanno già: ricerca della Cronologia e di CERCA_CHAT,
  rilettura con l'id, cancellazione vera con le copie, export e import, incognito in memoria.

### Le scelte che reggono

- **Chi salva annota.** I Mazzi annotano nel magazzino della chat del mazzo (ogni strada che scrive una domanda o
  completa una risposta ci passa); Editor e Aiuto, che tengono la chat nella pagina, mandano il messaggio appena
  lo mostrano. Errori e risposte a metà non entrano.
- **Una riga per conversazione.** Lo stesso `rif` continua la stessa riga finché non passa un'ora di silenzio;
  l'Aiuto ne apre una a ogni apertura del pannello.
- **Il nome segue la cosa, subito.** Documento o mazzo rinominato (a mano, dal titolo automatico, dal commander):
  `rinomina` riscrive il soggetto di tutte le sue righe, senza aspettare il messaggio dopo, così la ricerca trova
  il nome nuovo. Per i Mazzi lo fa il salvataggio del mazzo, per l'Editor le due strade che cambiano il titolo.
- **Lo scambio aperto si legge come nell'app**: le risposte di Filo con la formattazione leggera della home
  (HTML escapato, link filtrati), le domande dell'utente letterali.
- **Dove sta la riga nella home** (`perLaHome`): dentro la conversazione della home in cui è nata, o in testa a
  quella che segue; a home vuota sotto il messaggio, quelle nate dopo l'ultima conversazione lì. Mai più vecchie
  dei giorni che la chat ha davanti.
- **Il sito lo dice il main.** Da una pagina web parla solo l'Aiuto, e soggetto, indirizzo e recinto del `rif` li
  prende dall'indirizzo di chi manda, non dal messaggio. Quello che Filo ha risposto in un'app porta `esterno`:
  riletto, è una lettura.
- **Cancellare in un'app cancella nel filo.** Chat del mazzo svuotata, mazzo eliminato, modulo della chat tolto,
  documento eliminato per sempre: `dimentica`. La riga si toglie anche da sé (tasto destro, Cronologia).
- **Non le chiude e non le classifica nessuno**: nome e tipo li hanno dalla nascita (`listDangling` e
  `listUntriaged` le saltano). Dalla home non si continuano: si guardano aperte, e si scrive in una chat nuova.

Prove: `tests/unit/filoApp.test.mjs`, `tests/chat-app-nel-filo.spec.mjs`.

Sentinella: `tests/unit/filoEventi.test.mjs` (formato, sola aggiunta, cancellazione byte per byte, incognito,
migrazione, nessun tetto, velocità con 50.000 eventi) e `tests/unit/filoMisureELettura.test.mjs` (misura segnata,
lettura a righe, filo illeggibile, avviso sopra 256 MB). Prove dell'app: `tests/filo-linea-del-tempo.spec.mjs`.
