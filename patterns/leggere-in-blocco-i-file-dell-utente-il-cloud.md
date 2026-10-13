# Leggere in blocco i file dell'utente: il cloud resta nel cloud

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Chi legge da sé tanti file dell'utente (un indice, un giro in
sottofondo) non apre un file che sta solo nel cloud, e su macOS non tocca
Documenti, Scrivania e Download prima che l'utente abbia chiesto qualcosa che li
riguarda. Non entra nelle cartelle che la lettura di un file tratta da private,
se non è l'utente a nominarle; e quello che ha letto in una cartella chiesta per
l'occasione lo tiene finché il file non cambia.

## Il caso (#947)

La ricerca dei documenti per contenuto tiene un indice del testo dei file di
Documenti, Download e Scrivania, aggiornato in sottofondo. Due cose che su
Windows con un disco normale non si vedono:

- **OneDrive e iCloud.** Con OneDrive che sincronizza Documenti e Scrivania (su
  Windows è la norma) e con l'archiviazione ottimizzata di iCloud, molti file sul
  disco sono solo un segnaposto: hanno nome e misura, ma il contenuto è nel cloud.
  Aprirli per leggerli li scarica. Un indice che legge tutto scaricherebbe
  l'intera cartella, gigabyte compresi. Il segnaposto si riconosce senza aprirlo:
  misura vera e nessun blocco occupato sul disco (`stat().blocks === 0`). Sotto i
  4 KB la regola non vale, perché NTFS tiene i file piccoli dentro il proprio
  indice e li dà con zero blocchi anche quando sono sul disco. Un file così si
  trova per nome, e il modello sa che sta nel cloud. Prima ancora, l'elenco di
  una cartella su Windows dà per collegamento ogni segnaposto, file e
  sottocartelle, anche già scaricati: chi salta i collegamenti senza chiedere a
  `lstat` se lo sono davvero non vede niente di Documenti e Scrivania.
- **macOS.** Leggere Documenti, Scrivania e Download fa comparire la richiesta di
  permesso del sistema, una per cartella. Se la fa un giro in sottofondo, compare
  venti secondi dopo l'avvio senza che l'utente abbia chiesto niente. Su Mac il
  primo giro lo fa la prima ricerca chiesta dall'utente; da lì in poi il giro in
  sottofondo riparte da sé. Chi risponde «Non consentire» ha una cartella che
  esiste ma non si elenca (EPERM), e il Mac non lo richiede più: contata come
  vuota, la ricerca risponderebbe «non c'è» per sempre. Il rifiuto si dice al
  modello e in Preferenze, col modo di dare il permesso; le frasi che spiegano la
  richiesta stanno nell'`extendInfo` del pacchetto.

## Due elenchi della stessa regola (#947.3)

- **Le cartelle private.** «Cerca in tutta la mia cartella» faceva entrare
  l'indice nella Libreria del Mac: allegati della posta, dati delle altre app,
  e su un Mac recente le richieste di permesso del sistema. Per leggere un solo
  file lì Filo chiedeva un OK, e su Windows AppData stava nell'elenco delle
  cartelle saltate: due elenchi della stessa regola che divergevano. Adesso il
  giro chiede a `SN_CMD_CLASSIFY.privato` (la regola della lettura) se una
  cartella è privata, e non ci entra a meno che la cartella chiesta non sia già
  lì dentro. La stessa regola filtra i candidati di una ricerca: quello letto
  nella Libreria, chiesta per nome, non torna con la cartella personale.
  Dentro la Libreria però il Mac tiene iCloud Drive (`Mobile Documents`) e le
  cartelle di Dropbox, OneDrive e Google Drive (`CloudStorage`): per la regola
  sono documenti, e il giro scende dalla Libreria solo lì
  (`SN_CMD_CLASSIFY.aperteDentro`), senza elencarne il resto.
- **Le cartelle chieste per l'occasione.** Una cartella fuori elenco
  («cerca nell'Archivio») usciva dall'indice al primo giro sulle cartelle di
  sempre, e la richiesta dopo rileggeva tutto: con migliaia di PDF, minuti. Ora
  l'indice ricorda la cartella (una riga `{ o }` nel suo file) e ne tiene i
  documenti finché non cambiano; il giro di sempre non ci passa. Si vede e si
  dimentica in Preferenze, o in chat con «togli» sulla preferenza delle
  cartelle. Una cartella entrata nell'elenco smette di essere «per
  l'occasione»: tolta dall'elenco, esce dall'indice come le altre.

Il resto del giro segue
[Il computer si legge senza permessi e finché serve](il-computer-si-legge-senza-permessi-e-finche-serve.md):
il testo si estrae in un processo a parte (`utilityProcess`), uno alla volta, e
il lettore si spegne quando non serve.

## Dove vive

- `src/main/services/documentiIndice.js`: `soloNelCloud`, `giroInSottofondo`,
  `privata`, `occasionali`.
- Prove: `tests/unit/documentiRicerca.test.mjs` (un file sparso fa da
  segnaposto; la piattaforma Mac simulata).

Nessuna prova gira su un Windows con OneDrive o su un Mac veri: che `blocks` sia
zero per un segnaposto di OneDrive lo dice come libuv riempie `stat` su Windows,
non una prova.
