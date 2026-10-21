# Se un dato ESCE da Filo, deve poter RIENTRARE (e l'import mostra prima cosa scrive)

[← Tutti i pattern](../PATTERNS.md)

Un "esporta" senza il gemello "importa" non è una mezza feature: è una promessa
falsa. Il bottone "Esporta dati (.zip)" dichiarava di servire "come backup o per
trasferire i dati su un altro computer", ma sull'altro computer non c'era nulla
in cui caricare lo zip (#234) — la promessa era irrealizzabile. Vale per
qualsiasi formato che Filo produce (archivio dati, lista di un mazzo, documento):
se lo scriviamo noi, dobbiamo saperlo rileggere noi.

- **Il lettore è l'INVERSO ESATTO dello scrittore, e il round-trip è il test.**
  L'esportazione stacca le immagini dai data-URL e le mette in `images/…`; la
  reimportazione le rimette dentro come data-URL. L'assert che conta è
  `readExportZip(buildExportZip(x)).data` **deep-equal** `x`: un test sulle
  singole voci lascia passare le perdite silenziose.
- **Accetta il file "usato male".** L'utente ha il diritto di scompattare
  l'archivio, guardarci dentro e ri-comprimerlo: il lettore accetta anche
  DEFLATE (non solo lo STORE che scriviamo) e `data.json` dentro una cartella.
  Un file che non è nostro si **rifiuta con un codice riconoscibile**
  (`not_a_zip` / `no_data_json` / `bad_data_json` → un messaggio umano), mai
  importato a metà.
- **Quello che non si legge si dice (#1088).** Un gestore di archivi può
  ricomprimere con bzip2 o LZMA, e un disco può rovinare dei byte. `unzip`
  controlla il CRC e restituisce le voci saltate col motivo, e conta quelle che
  l'indice in fondo non raggiunge più (`mancanti`): il manifesto dichiara se il
  filo c'era. Un `data.json` illeggibile è un archivio rovinato
  (`zip_damaged`), non «non è di Filo»; ma se è solo compresso con un metodo che
  Filo non legge o protetto da password il messaggio dice quello, perché
  l'archivio è sano e basta ricomprimerlo.
  Un'immagine persa diventa `null`, mai il testo `images/img-N.png` al suo
  posto, e la conferma dice quante sono, come dice se il filo (chat e pagine
  visitate) non si legge.
  L'indice in fondo si legge per tutta la lunghezza che dichiara, non per il
  numero di voci che dichiara (#1256): un numero rovinato non nasconde voci,
  una riga rovinata si salta e si conta (`vociPerse`, detto nella conferma), e
  il record finale si riconosce anche senza firma, da dove l'indice finisce.
- **Prima leggere, poi chiedere, poi scrivere.** L'import è in due messaggi:
  `IMPORT_DATA_PREVIEW` sceglie e legge il file e ritorna cosa contiene (data
  del backup, quante sezioni, quante immagini); `IMPORT_DATA_APPLY` scrive solo
  dopo un sì esplicito (`SN_CONFIRM_UI.confirm`). Una conferma generica prima di
  sapere cosa c'è nel file non è una conferma. Il contenuto letto **resta nel
  main** fra i due passi (con scadenza): non si fa attraversare l'IPC a un dump
  completo dei dati utente — chiavi API comprese — solo per contarne le sezioni.
- **Importare AGGIUNGE, non cancella.** Le liste si uniscono senza duplicati
  (identità per `id`, altrimenti per contenuto), le sezioni assenti si prendono,
  sui conflitti vince il file importato perché è un ripristino — e ciò che il
  backup non conosce resta. Conseguenza voluta: reimportare due volte lo stesso
  file non duplica nulla. Detto tutto nel popup, perché il confine di un'azione
  che tocca i dati va dichiarato prima (vedi "Ripristini e annullamenti").
- **Un backup vecchio non riavvolge niente (#1088).** Ogni chiave dello storage
  ha la sua regola in `REGOLE_IMPORT`. Il contenuto (quello che l'utente ha
  fatto o scelto) si fonde come sopra. Lo stato di questa installazione (code
  da spedire, schede aperte, registro dei cambi, avvisi, accoglienza,
  bandierine di migrazione, crediti, copie locali di ciò che decide il server)
  resta quello di qui. La spesa del mese tiene il valore più alto, se no il
  tetto torna ad avere margine. Dei timer entrano solo le sveglie ricorrenti,
  puntate sulla prossima volta, perché un timer passato suonerebbe subito. Le
  pagine salvate restano una per indirizzo, ordinate per data ed entro il loro
  tetto: quelle che restano fuori le conta la conferma, prima del sì. Lo
  stesso per ogni lista che ha un tetto (appunti copiati, download, #1256):
  l'unione lo rispetta subito, le più recenti prima, perché il primo
  salvataggio dopo taglierebbe in fondo, proprio dove arriva il backup. Il
  tetto di spesa mensile resta il più stretto dei due (alzarlo vuole un sì,
  #1050): quello più largo del backup la conferma lo offre con un bottone suo.
  Una chiave nuova di `STORAGE_KEYS` senza regola fa diventare rosso
  `tests/unit/importRegole.test.mjs`.
- **L'importazione arriva a chi tiene la lista, non solo al disco (#1256).**
  Una lista che un modulo del main tiene in memoria e salva da lì (i
  download) entra dal modulo (`importa`): scritta solo sul disco non si vede
  fino al riavvio, e il primo salvataggio da quella memoria la cancella. Chi
  ne tiene una copia la rilegge subito dopo la scrittura
  (`rileggiInMemoria`), e le pagine aperte ricevono `DATI_IMPORTATI` e
  rileggono quello che mostrano, come fanno con le impostazioni. Un modulo
  nuovo che tiene in memoria una chiave importata entra in quell'elenco.
- **Ciò che si ripristina dev'essere ATTIVO, non solo scritto.** Le impostazioni
  importate passano da `applySettingsUpdate` come qualsiasi altra modifica, così
  tema, sicurezza, cookie e fingerprint del backup valgono subito senza
  riavviare. E si riscrivono **solo le chiavi davvero cambiate**: rimettere a
  posto valori identici sveglia per niente i listener `onChanged`.
- **I segreti escono solo se chi esporta lo chiede (#905).** Un archivio si
  manda in giro facilmente. Le chiavi (`SN_CONST.campiSegreti`: chiavi API,
  Safe Browsing, proxy con utente e password) restano fuori, e il loro valore
  si toglie anche da appunti, chat e filo, a meno che l'utente spunti «Includi
  le chiavi». Il campo va via, non diventa vuoto, e all'importazione una chiave
  vuota non cancella quella di qui. Prova: `tests/unit/esportaSenzaChiavi.test.mjs`.
- **Stesso confine d'origine dell'export**: `filo://` soltanto — una pagina web
  non deve poter aprire un file dialog né riscrivere lo storage.
- **Dove:** `readExportZip` / `mergeImportedData` in
  `src/main/services/exportData.js`, handler in
  `src/main/services/handlers/storage.js`, UI in `src/pages/security/`. Test
  `tests/unit/importData.test.mjs`, `tests/import-data.spec.mjs`.
