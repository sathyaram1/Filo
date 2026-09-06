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
- **Ciò che si ripristina dev'essere ATTIVO, non solo scritto.** Le impostazioni
  importate passano da `applySettingsUpdate` come qualsiasi altra modifica, così
  tema, sicurezza, cookie e fingerprint del backup valgono subito senza
  riavviare. E si riscrivono **solo le chiavi davvero cambiate**: rimettere a
  posto valori identici sveglia per niente i listener `onChanged`.
- **Stesso confine d'origine dell'export**: `filo://` soltanto — una pagina web
  non deve poter aprire un file dialog né riscrivere lo storage.
- **Dove:** `readExportZip` / `mergeImportedData` in
  `src/main/services/exportData.js`, handler in
  `src/main/services/handlers/storage.js`, UI in `src/pages/security/`. Test
  `tests/unit/importData.test.mjs`, `tests/import-data.spec.mjs`.
