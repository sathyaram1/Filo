# Il profilo segreto non ha indice

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Al contenitore dei segreti si arriva solo dal motore
(`src/main/services/segreto/motore.js`), passando nome, sale, percorso e
dimensione. Chi lo usa non salva niente che dica che un segreto esiste: né il
nome, né quanti blocchi ha riparato, né «c'erano altri segreti», in nessun log,
messaggio, cronologia o telemetria. Anche un solo numero rivelerebbe che nel
contenitore c'è qualcun altro.

## Il caso (#861)

Primo dei cinque pezzi del profilo segreto (spec dell'owner, sezione «Encrypted
Container Architecture»). Il contenitore è un file di byte casuali di
dimensione fissa; un contenitore vuoto e uno con dieci segreti devono essere
indistinguibili, e niente registra quanti segreti ci sono né dove stanno.

## Com'è fatto, e perché

- **Posizioni dalla chiave.** La copia c del blocco logico j sta in
  HMAC(chiave di posto, j, c, r) mod N. Il contatore r non si salva: chi legge
  prova r = 0, 1, … e salta senza leggerle le posizioni che sa già occupate
  dal segreto stesso o da uno dichiarato. Chi scrive prende il primo r libero.
- **Un blocco da 4 KB si apre da solo.** Nonce casuale da 12 byte in chiaro,
  AES-256-GCM, la posizione come dato associato. Un nonce ricavato dalla
  posizione ripeterebbe chiave e nonce a ogni riscrittura e romperebbe GCM. Dentro
  il cifrato un prefisso dice formato, k del gruppo, copia, blocco logico,
  versione e incarnazione: otto byte casuali scelti alla creazione, così un
  segreto ricreato dopo averlo perso non si mescola coi resti del vecchio.
- **Reed-Solomon 10+10.** Ogni 10 blocchi logici, 10 di parità (Cauchy su
  GF(256)); l'ultimo gruppo ha k blocchi e k di parità. La «copia 1» del blocco
  j è la parità j mod 10 del suo gruppo: due copie per blocco, metà del
  contenitore utile.
- **Versioni e interruzioni.** Ogni riscrittura di un gruppo prende un numero
  nuovo dal contatore del segreto; in lettura vince la versione più alta che ha
  almeno k copie. Si scrivono prima le copie in posti nuovi, poi quelle sopra la
  versione vecchia, poi si tolgono quelle in più: a ogni interruzione resta
  decodificabile una delle due.
- **La testa per ultima.** Il blocco 0 (numero di blocchi, date, tabella dei
  file o le sue estensioni) è il punto in cui una scrittura diventa vera: i
  blocchi nuovi si scrivono accanto ai vecchi, poi la testa. Due eccezioni,
  perché nessuna copia valida resti mai fuori dal segreto: se il segreto cresce,
  la testa col numero nuovo va scritta PRIMA dei blocchi nuovi; se si accorcia,
  prima si distrugge la coda e poi si scrive la testa.
- **Cancellare.** Un file cancellato ha i blocchi riscritti cifrati a zero; un
  segreto cancellato ha tutti i blocchi riscritti a caso, dopo una scansione
  intera che trova anche le copie rimaste lontano.
- **Cercare costa poco anche quando va male.** Una copia è data per persa dopo
  32 letture a vuoto. Se le letture a vuoto superano un sedicesimo del
  contenitore, si legge tutto di fila (1 GB in pochi secondi) e lì si trova tutto.
- **Riparare a ogni apertura, in silenzio.** Le copie mancanti si rifanno dalla
  parità con la stessa versione. Un gruppo perso si riscrive a zero e i file che
  lo usavano restano nell'elenco segnati rovinati: leggerli dà `DANNEGGIATO`,
  non zeri. I blocchi non usati che non sono vuoti si azzerano.
- **Dichiarati.** Le loro chiavi vivono per la durata della chiamata; le
  posizioni dei loro blocchi (non i nomi) restano nella sessione aperta, così le
  evitano anche le scritture successive. Di un dichiarato si rifanno le copie
  mancanti, ma un suo gruppo perso resta com'è: il proprietario se ne accorge
  aprendolo, invece di trovarci zeri.
- **Spazio.** Libero vuol dire il contenitore meno il segreto stesso e quelli
  dichiarati. Una scrittura che non ci sta si rifiuta con `servono` e
  `disponibili` in byte; sostituire un file conta lo spazio che lascia il vecchio,
  e un rifiuto lascia il vecchio intatto.
- **Argon2id t=3, m=256 MiB, p=1** in un thread a parte (hash-wasm, WASM puro:
  uguale su Windows, Mac e Linux; l'Argon2 di Node in Electron non c'è perché
  BoringSSL non lo ha). Cambiare i parametri renderebbe illeggibili i segreti
  che esistono: li tiene `tests/unit/profiloSegreto.test.mjs`.
- **Il nome.** Normalizzato NFC e senza spazi ai lati (lo stesso nome scritto su
  Mac e su Windows dà la stessa chiave); maiuscole e minuscole contano.

## Come si usa

- `creaContenitore(percorso, dimensione)`: rifiuta se il file c'è già.
- `apriSegreto({ contenitore, dimensione, sale, nome, dichiarati })` dà
  `{ esito: 'nessuno', messaggio }`, identico per nome sbagliato e segreto
  inesistente, oppure `{ esito: 'aperto', segreto }`.
- `creaSegreto(...)` dà `{ esito: 'creato' | 'aperto', segreto }`: un nome che
  esiste si apre, mai si svuota.
- Sul segreto: `elencaFile()`, `leggiFile(nome)`, `scriviFile(nome, dati)`,
  `cancellaFile(nome)`, `spazio()`, `info()`, `cancella()`, `chiudi()`. Riaprire
  lo stesso segreto chiude la sessione vecchia (`CHIUSO`); `RIAPRI` vuol dire
  che un altro segreto l'ha sovrascritto mentre era aperto, e la riapertura
  ripara.

Fuori da questo pezzo: il contenitore vero da 1 GB e il sale del dispositivo, i
comandi `/segreto`, l'interfaccia, il backup.
